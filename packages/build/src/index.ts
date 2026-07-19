import { compileStoryProject } from '@rpgnarrativeengine/compiler';
import {
  canonicalJson,
  createWebFolderExport,
  createWebSingleExport,
  createWebZipExport,
  sha256Hex,
  type WebExportFile,
  type WebFileContent,
  type WebFolderExport,
} from '@rpgnarrativeengine/exporter-web';
import {
  loadNarrativeProject,
  type ProjectFileInput,
  type ProjectManifest,
} from '@rpgnarrativeengine/project';

export const ENGINE_VERSION = '0.0.0';

export type WebBuildTarget = 'web' | 'web-single' | 'web-zip';
export type BuildPhase = 'compile' | 'complete' | 'export' | 'validate';

export interface BuildProgressEvent {
  readonly phase: BuildPhase;
  readonly progress: number;
  readonly message: string;
}

export interface BuildCancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

export interface BuildProjectRequest {
  readonly files: readonly ProjectFileInput[];
  /** Explicit one-run targets. Omit to use project.toml without rewriting it. */
  readonly targets?: readonly WebBuildTarget[];
  readonly signal?: BuildCancellationSignal;
  readonly onProgress?: (event: BuildProgressEvent) => void;
}

export type BuildOutputFile = WebExportFile;

export interface BuildFileArtifact {
  readonly kind: 'file';
  readonly id: string;
  readonly target: 'bundle' | 'web-single' | 'web-zip';
  readonly format: 'game-bundle' | 'html' | 'zip';
  readonly path: string;
  readonly file: BuildOutputFile;
  readonly runnable: boolean;
}

export interface BuildFolderArtifact {
  readonly kind: 'folder';
  readonly id: string;
  readonly target: 'web';
  readonly format: 'folder';
  readonly path: string;
  readonly files: readonly BuildOutputFile[];
  readonly size: number;
  readonly sha256: string;
  readonly runnable: true;
}

export type BuildArtifact = BuildFileArtifact | BuildFolderArtifact;

export interface BuildProjectResult {
  readonly project: ProjectManifest;
  readonly targets: readonly WebBuildTarget[];
  readonly gameBundleHash: string;
  readonly artifacts: readonly BuildArtifact[];
  /** Complete canonical build-directory contents for filesystem hosts. */
  readonly outputFiles: readonly BuildOutputFile[];
}

export class BuildConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildConfigurationError';
  }
}

export class BuildCancelledError extends Error {
  readonly reason: unknown;

  constructor(reason?: unknown) {
    super('The build was cancelled.');
    this.name = 'BuildCancelledError';
    this.reason = reason;
  }
}

const webTargets = new Set<WebBuildTarget>(['web', 'web-single', 'web-zip']);

function emit(request: BuildProjectRequest, event: BuildProgressEvent): void {
  request.onProgress?.(Object.freeze(event));
}

function checkCancellation(request: BuildProjectRequest): void {
  if (request.signal?.aborted === true) throw new BuildCancelledError(request.signal.reason);
}

export function configuredWebBuildTargets(manifest: ProjectManifest): readonly WebBuildTarget[] {
  const targets = new Set<WebBuildTarget>();
  for (const target of manifest.build.targets) {
    if (webTargets.has(target as WebBuildTarget)) targets.add(target as WebBuildTarget);
  }
  if (targets.has('web') && manifest.build.web.zip) targets.add('web-zip');
  if (targets.has('web') && manifest.build.web.singleHtml) targets.add('web-single');
  return Object.freeze([...targets]);
}

function selectedTargets(
  request: BuildProjectRequest,
  manifest: ProjectManifest,
): readonly WebBuildTarget[] {
  const selected = request.targets ?? configuredWebBuildTargets(manifest);
  const unique = new Set<WebBuildTarget>();
  for (const target of selected) {
    if (!webTargets.has(target)) {
      throw new BuildConfigurationError(`Unsupported web build target ${JSON.stringify(target)}.`);
    }
    unique.add(target);
  }
  if (unique.size === 0) {
    throw new BuildConfigurationError(
      'No web build target is selected. Enable web, web-zip, or web-single.',
    );
  }
  return Object.freeze([...unique]);
}

async function outputFile(
  path: string,
  mimeType: string,
  content: WebFileContent,
): Promise<BuildOutputFile> {
  const size =
    typeof content === 'string' ? new TextEncoder().encode(content).length : content.length;
  return Object.freeze({ path, mimeType, content, size, sha256: await sha256Hex(content) });
}

async function folderArtifactHash(files: readonly BuildOutputFile[]): Promise<string> {
  return sha256Hex(canonicalJson(files.map(({ path, sha256 }) => Object.freeze({ path, sha256 }))));
}

interface ArtifactManifestEntry {
  readonly id: string;
  readonly target: string;
  readonly format: string;
  readonly path: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
  readonly gameBundleHash: string;
  readonly projectId: string;
  readonly projectVersion: string;
  readonly engineVersion: string;
  readonly profile: string;
  readonly signing: 'not-applicable';
  readonly runnable: boolean;
}

function manifestEntry(
  artifact: BuildArtifact,
  manifest: ProjectManifest,
  gameBundleHash: string,
): ArtifactManifestEntry {
  const mimeType = artifact.kind === 'folder' ? 'inode/directory' : artifact.file.mimeType;
  const size = artifact.kind === 'folder' ? artifact.size : artifact.file.size;
  const sha256 = artifact.kind === 'folder' ? artifact.sha256 : artifact.file.sha256;
  return Object.freeze({
    id: artifact.id,
    target: artifact.target,
    format: artifact.format,
    path: artifact.path,
    mimeType,
    size,
    sha256,
    gameBundleHash,
    projectId: manifest.project.id,
    projectVersion: manifest.project.version,
    engineVersion: ENGINE_VERSION,
    profile: manifest.build.profile,
    signing: 'not-applicable',
    runnable: artifact.runnable,
  });
}

function checksumText(files: readonly BuildOutputFile[]): string {
  return `${[...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.path}`)
    .join('\n')}\n`;
}

/** Compile once and produce deterministic browser-neutral web build outputs for GUI or CLI hosts. */
export async function buildWebProject(request: BuildProjectRequest): Promise<BuildProjectResult> {
  checkCancellation(request);
  emit(request, { phase: 'validate', progress: 0.05, message: 'Validating project files' });
  const loaded = loadNarrativeProject(request.files);
  const targets = selectedTargets(request, loaded.manifest);

  checkCancellation(request);
  emit(request, { phase: 'compile', progress: 0.2, message: 'Compiling story sources' });
  const game = compileStoryProject(loaded.storyFiles, {
    title: loaded.manifest.project.title,
    startSceneId: loaded.manifest.project.entryScene,
  });
  const metadata = Object.freeze({
    projectId: loaded.manifest.project.id,
    title: loaded.manifest.project.title,
    version: loaded.manifest.project.version,
    slug: loaded.manifest.distribution.slug,
    language: loaded.manifest.project.defaultLocale,
  });
  const exportRequest = Object.freeze({
    game,
    metadata,
    basePath: loaded.manifest.build.web.basePath,
  });

  checkCancellation(request);
  emit(request, { phase: 'export', progress: 0.45, message: 'Creating web player files' });
  let folder: WebFolderExport | null = null;
  if (targets.includes('web') || targets.includes('web-zip')) {
    folder = await createWebFolderExport(exportRequest);
  }
  const bundleContent = `${canonicalJson(game)}\n`;
  const gameBundleHash = folder?.contentHash ?? (await sha256Hex(bundleContent));
  const bundleFile = await outputFile(
    'bundle/game-bundle.json',
    'application/json;charset=utf-8',
    bundleContent,
  );
  const outputFiles: BuildOutputFile[] = [bundleFile];
  const artifacts: BuildArtifact[] = [
    Object.freeze({
      kind: 'file',
      id: `${metadata.slug}-bundle`,
      target: 'bundle',
      format: 'game-bundle',
      path: bundleFile.path,
      file: bundleFile,
      runnable: false,
    }),
  ];

  if (targets.includes('web')) {
    if (folder === null) throw new Error('Web folder generation did not run.');
    const files = await Promise.all(
      folder.files.map((file) =>
        outputFile(`web/folder/${file.path}`, file.mimeType, file.content),
      ),
    );
    outputFiles.push(...files);
    artifacts.push(
      Object.freeze({
        kind: 'folder',
        id: `${metadata.slug}-web`,
        target: 'web',
        format: 'folder',
        path: 'web/folder',
        files: Object.freeze(files),
        size: files.reduce((total, file) => total + file.size, 0),
        sha256: await folderArtifactHash(files),
        runnable: true,
      }),
    );
  }

  checkCancellation(request);
  if (targets.includes('web-zip')) {
    if (folder === null) throw new Error('Web ZIP generation did not create its source folder.');
    const zip = await createWebZipExport(folder, `${metadata.slug}-${metadata.version}-web.zip`);
    const file = await outputFile(`web/${zip.file.path}`, zip.file.mimeType, zip.file.content);
    outputFiles.push(file);
    artifacts.push(
      Object.freeze({
        kind: 'file',
        id: `${metadata.slug}-web-zip`,
        target: 'web-zip',
        format: 'zip',
        path: file.path,
        file,
        runnable: true,
      }),
    );
  }

  checkCancellation(request);
  if (targets.includes('web-single')) {
    const single = await createWebSingleExport(exportRequest);
    if (single.contentHash !== gameBundleHash) {
      throw new Error('Web targets did not receive the same canonical game bundle.');
    }
    const file = await outputFile(
      `web/${single.file.path}`,
      single.file.mimeType,
      single.file.content,
    );
    outputFiles.push(file);
    artifacts.push(
      Object.freeze({
        kind: 'file',
        id: `${metadata.slug}-web-single`,
        target: 'web-single',
        format: 'html',
        path: file.path,
        file,
        runnable: true,
      }),
    );
  }

  checkCancellation(request);
  emit(request, { phase: 'export', progress: 0.8, message: 'Writing artifact metadata' });
  const artifactManifest = `${JSON.stringify(
    {
      schema: 1,
      project: { id: metadata.projectId, title: metadata.title, version: metadata.version },
      engineVersion: ENGINE_VERSION,
      profile: loaded.manifest.build.profile,
      gameBundleHash,
      artifacts: artifacts.map((artifact) =>
        manifestEntry(artifact, loaded.manifest, gameBundleHash),
      ),
    },
    null,
    2,
  )}\n`;
  const manifestFile = await outputFile(
    'artifact-manifest.json',
    'application/json;charset=utf-8',
    artifactManifest,
  );
  outputFiles.push(manifestFile);
  const buildReport = `${JSON.stringify(
    {
      schema: 1,
      status: 'succeeded',
      projectId: metadata.projectId,
      projectVersion: metadata.version,
      profile: loaded.manifest.build.profile,
      targets,
      storyFiles: loaded.storyFiles.map(({ path }) => path),
      sceneCount: Object.keys(game.scenes).length,
      gameBundleHash,
    },
    null,
    2,
  )}\n`;
  const reportFile = await outputFile(
    'build-report.json',
    'application/json;charset=utf-8',
    buildReport,
  );
  outputFiles.push(reportFile);
  const checksums = await outputFile(
    'checksums.sha256',
    'text/plain;charset=utf-8',
    checksumText(outputFiles),
  );
  outputFiles.push(checksums);

  emit(request, { phase: 'complete', progress: 1, message: 'Build complete' });
  return Object.freeze({
    project: loaded.manifest,
    targets,
    gameBundleHash,
    artifacts: Object.freeze(artifacts),
    outputFiles: Object.freeze(outputFiles),
  });
}
