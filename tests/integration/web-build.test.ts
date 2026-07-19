import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildWebProject } from '../../packages/build/src/index.js';
import { buildProjectDirectory } from '../../packages/cli/src/index.js';
import type { ProjectFileInput } from '../../packages/project/src/index.js';

async function starterProject(): Promise<readonly ProjectFileInput[]> {
  const paths = ['project.toml', 'story/opening.story', 'story/endings.story'];
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(
        new URL(`../../templates/first-story/${path}`, import.meta.url),
        'utf8',
      ),
    })),
  );
}

describe('web project build', () => {
  it('creates reproducible folder, ZIP, and direct-open HTML artifacts from one game bundle', async () => {
    const files = await starterProject();
    const first = await buildWebProject({ files });
    const second = await buildWebProject({ files });

    expect(first.targets).toEqual(['web', 'web-single', 'web-zip']);
    expect(first.gameBundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.gameBundleHash).toBe(first.gameBundleHash);

    const folder = first.artifacts.find((artifact) => artifact.target === 'web');
    expect(folder?.kind).toBe('folder');
    if (folder?.kind !== 'folder') throw new Error('Expected a web folder artifact.');
    expect(folder.files.map(({ path }) => path)).toEqual([
      'web/folder/index.html',
      'web/folder/game-bundle.json',
      'web/folder/assets/player.css',
      'web/folder/assets/player.js',
    ]);

    const zip = first.artifacts.find((artifact) => artifact.target === 'web-zip');
    const secondZip = second.artifacts.find((artifact) => artifact.target === 'web-zip');
    if (zip?.kind !== 'file' || secondZip?.kind !== 'file') {
      throw new Error('Expected web ZIP artifacts.');
    }
    expect(zip.file.content).toBeInstanceOf(Uint8Array);
    expect([...zip.file.content.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(zip.file.sha256).toBe(secondZip.file.sha256);
    expect(zip.file.content).toEqual(secondZip.file.content);

    const single = first.artifacts.find((artifact) => artifact.target === 'web-single');
    if (single?.kind !== 'file' || typeof single.file.content !== 'string') {
      throw new Error('Expected a single HTML artifact.');
    }
    expect(single.file.content).toContain('Content-Security-Policy');
    expect(single.file.content).toContain('id="rpgne-game"');
    expect(single.file.content).toContain('The Road Between');

    const manifestFile = first.outputFiles.find((file) => file.path === 'artifact-manifest.json');
    if (manifestFile === undefined || typeof manifestFile.content !== 'string') {
      throw new Error('Expected the artifact manifest.');
    }
    const manifest = JSON.parse(manifestFile.content) as {
      readonly gameBundleHash: string;
      readonly artifacts: readonly { readonly gameBundleHash: string }[];
    };
    expect(manifest.gameBundleHash).toBe(first.gameBundleHash);
    expect(
      manifest.artifacts.every((artifact) => artifact.gameBundleHash === first.gameBundleHash),
    ).toBe(true);
  });

  it('promotes filesystem output atomically and preserves the last build after compilation fails', async () => {
    const temporaryParent = fileURLToPath(new URL('../../build/', import.meta.url));
    await mkdir(temporaryParent, { recursive: true });
    const projectDirectory = await mkdtemp(path.join(temporaryParent, 'cli-integration-'));
    try {
      const files = await starterProject();
      for (const file of files) {
        const destination = path.join(projectDirectory, ...file.path.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.content, 'utf8');
      }

      const protectedFile = path.join(projectDirectory, 'creator-files', 'keep.txt');
      await mkdir(path.dirname(protectedFile), { recursive: true });
      await writeFile(protectedFile, 'creator owned', 'utf8');
      await expect(
        buildProjectDirectory({
          projectDirectory,
          output: 'creator-files',
          targets: ['web-single'],
        }),
      ).rejects.toThrow(/not build output owned/u);
      expect(await readFile(protectedFile, 'utf8')).toBe('creator owned');

      const first = await buildProjectDirectory({
        projectDirectory,
        output: 'release',
        targets: ['web-single'],
        profile: 'release',
      });
      expect(first.build.profile).toBe('release');
      const htmlPath = path.join(first.outputDirectory, 'web', 'the-road-between-0.1.0.html');
      const successfulHtml = await readFile(htmlPath, 'utf8');

      const stalePath = path.join(first.outputDirectory, 'stale.txt');
      await writeFile(stalePath, 'old output', 'utf8');
      const second = await buildProjectDirectory({
        projectDirectory,
        output: 'release',
        targets: ['web-single'],
      });
      expect(second.build.gameBundleHash).toBe(first.build.gameBundleHash);
      await expect(access(stalePath)).rejects.toThrow();
      await expect(access(`${first.outputDirectory}.rpgne-lock`)).rejects.toThrow();
      await expect(access(`${first.outputDirectory}.rpgne-staging`)).rejects.toThrow();

      const openingPath = path.join(projectDirectory, 'story', 'opening.story');
      const opening = await readFile(openingPath, 'utf8');
      await writeFile(openingPath, `${opening}\n* Break the build -> missing.scene\n`, 'utf8');
      await expect(
        buildProjectDirectory({
          projectDirectory,
          output: 'release',
          targets: ['web-single'],
        }),
      ).rejects.toThrow();
      expect(await readFile(htmlPath, 'utf8')).toBe(successfulHtml);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
});
