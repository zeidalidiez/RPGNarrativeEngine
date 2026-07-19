import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { buildWebProject } from '../../packages/build/src/index.js';
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
});
