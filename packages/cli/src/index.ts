import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import {
  buildWebProject,
  type BuildProfile,
  type BuildProgressEvent,
  type BuildProjectResult,
  type BuildTarget,
} from '@rpgnarrativeengine/build';
import {
  normalizeProjectPath,
  parseProjectManifest,
  type ProjectBuildTarget,
  type ProjectFileInput,
} from '@rpgnarrativeengine/project';

export interface FilesystemBuildOptions {
  readonly projectDirectory: string;
  readonly output?: string;
  readonly targets?: readonly BuildTarget[];
  readonly profile?: BuildProfile;
  readonly clean?: boolean;
  readonly onProgress?: (event: BuildProgressEvent) => void;
}

export interface FilesystemBuildResult {
  readonly projectDirectory: string;
  readonly outputDirectory: string;
  readonly unavailableTargets: readonly ProjectBuildTarget[];
  readonly build: BuildProjectResult;
}

export class FilesystemBuildError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FilesystemBuildError';
  }
}

const ignoredProjectDirectories = new Set(['.git', '.rpgne', 'node_modules']);
const stagingMarkerFilename = '.rpgne-staging.json';
const nativeTargets = new Set<ProjectBuildTarget>(['android', 'ios', 'linux', 'macos', 'windows']);
const transientRenameErrorCodes = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isExistingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isTransientRenameError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return transientRenameErrorCodes.has(String(error.code));
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  const retryDelays = [25, 50, 100, 200, 400, 800, 1600] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const delay = retryDelays[attempt];
      if (delay === undefined || !isTransientRenameError(error)) throw error;
      await wait(delay);
    }
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAtOrBelow(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

async function collectStoryFiles(
  projectRoot: string,
  outputPath: string,
  directory = projectRoot,
  relativeDirectory = '',
): Promise<ProjectFileInput[]> {
  const files: ProjectFileInput[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of entries) {
    const relativePath =
      relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (
        ignoredProjectDirectories.has(entry.name) ||
        entry.name.startsWith('.rpgne-') ||
        entry.name.endsWith('.rpgne-staging') ||
        entry.name.endsWith('.rpgne-previous') ||
        isAtOrBelow(relativePath, outputPath)
      ) {
        continue;
      }
      files.push(
        ...(await collectStoryFiles(
          projectRoot,
          outputPath,
          path.join(directory, entry.name),
          relativePath,
        )),
      );
    } else if (entry.isFile() && relativePath.endsWith('.story')) {
      files.push({
        path: relativePath,
        content: await readFile(path.join(directory, entry.name), 'utf8'),
      });
    }
  }
  return files;
}

function resolvedChild(projectRoot: string, relativePath: string, label: string): string {
  const candidate = path.resolve(projectRoot, ...relativePath.split('/'));
  const relative = path.relative(projectRoot, candidate);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FilesystemBuildError(`${label} must resolve beneath the project directory.`);
  }
  return candidate;
}

async function rejectSymlinkComponents(projectRoot: string, relativePath: string): Promise<void> {
  let current = projectRoot;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new FilesystemBuildError(
          `Build output cannot pass through symbolic link ${JSON.stringify(path.relative(projectRoot, current))}.`,
        );
      }
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
  }
}

async function removeOwnedDirectory(candidate: string, projectRoot: string): Promise<void> {
  const relative = path.relative(projectRoot, candidate);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FilesystemBuildError('Refusing to remove a path outside the project directory.');
  }
  if (!(await pathExists(candidate))) return;
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink()) {
    throw new FilesystemBuildError(
      `Refusing to remove symbolic link ${JSON.stringify(relative)} as build output.`,
    );
  }
  await rm(candidate, { recursive: true, force: true });
}

function manifestProjectId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('project' in value)) return null;
  const project = value.project;
  if (typeof project !== 'object' || project === null || !('id' in project)) return null;
  return typeof project.id === 'string' ? project.id : null;
}

async function verifyOutputOwnership(candidate: string, projectId: string): Promise<void> {
  if (!(await pathExists(candidate))) return;
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new FilesystemBuildError(
      `Build output ${JSON.stringify(candidate)} must be an ordinary directory.`,
    );
  }
  const entries = await readdir(candidate);
  if (entries.length === 0) return;
  try {
    const source = await readFile(path.join(candidate, 'artifact-manifest.json'), 'utf8');
    if (manifestProjectId(JSON.parse(source) as unknown) === projectId) return;
  } catch (error) {
    if (!isMissingPath(error) && !(error instanceof SyntaxError)) throw error;
  }
  throw new FilesystemBuildError(
    `Refusing to replace nonempty directory ${JSON.stringify(candidate)} because it is not build output owned by ${projectId}.`,
  );
}

async function verifyStagingOwnership(candidate: string, projectId: string): Promise<void> {
  if (!(await pathExists(candidate))) return;
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new FilesystemBuildError('The stale build staging path is not an ordinary directory.');
  }
  try {
    const source = await readFile(path.join(candidate, stagingMarkerFilename), 'utf8');
    const marker = JSON.parse(source) as unknown;
    if (
      typeof marker === 'object' &&
      marker !== null &&
      'projectId' in marker &&
      marker.projectId === projectId
    ) {
      return;
    }
  } catch (error) {
    if (!isMissingPath(error) && !(error instanceof SyntaxError)) throw error;
  }
  throw new FilesystemBuildError(
    `Refusing to remove unowned staging directory ${JSON.stringify(candidate)}.`,
  );
}

async function writeBuildFiles(
  stagingDirectory: string,
  result: BuildProjectResult,
): Promise<void> {
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(
    path.join(stagingDirectory, stagingMarkerFilename),
    `${JSON.stringify({ projectId: result.project.project.id })}\n`,
    'utf8',
  );
  for (const file of result.outputFiles) {
    const normalized = normalizeProjectPath(file.path);
    if (normalized !== file.path) {
      throw new FilesystemBuildError(`Build service returned non-canonical path ${file.path}.`);
    }
    const destination = resolvedChild(stagingDirectory, normalized, 'Artifact path');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
}

async function acquireBuildLock(lockPath: string): Promise<FileHandle> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
    return handle;
  } catch (error) {
    if (handle !== null) {
      await handle.close();
      await rm(lockPath, { force: true });
    }
    if (isExistingPath(error)) {
      throw new FilesystemBuildError(
        `Another build owns ${path.basename(lockPath)}. If no build is running, remove that stale lock file.`,
      );
    }
    throw error;
  }
}

async function promoteBuild(
  projectRoot: string,
  outputDirectory: string,
  stagingDirectory: string,
  backupDirectory: string,
  projectId: string,
): Promise<void> {
  let outputExists = await pathExists(outputDirectory);
  if (await pathExists(backupDirectory)) {
    await verifyOutputOwnership(backupDirectory, projectId);
    if (outputExists) await removeOwnedDirectory(backupDirectory, projectRoot);
    else {
      await renameWithRetry(backupDirectory, outputDirectory);
      outputExists = true;
    }
  }
  if (outputExists) await renameWithRetry(outputDirectory, backupDirectory);
  try {
    await renameWithRetry(stagingDirectory, outputDirectory);
  } catch (error) {
    if (outputExists && (await pathExists(backupDirectory))) {
      await renameWithRetry(backupDirectory, outputDirectory);
    }
    throw new FilesystemBuildError('Could not promote the staged build output.', {
      cause: error,
    });
  }
  await rm(path.join(outputDirectory, stagingMarkerFilename), { force: true });
  if (outputExists) await removeOwnedDirectory(backupDirectory, projectRoot);
}

/** Build a project and atomically replace only its validated, project-owned output directory. */
export async function buildProjectDirectory(
  options: FilesystemBuildOptions,
): Promise<FilesystemBuildResult> {
  const projectRoot = await realpath(path.resolve(options.projectDirectory));
  const rootMetadata = await lstat(projectRoot);
  if (!rootMetadata.isDirectory()) {
    throw new FilesystemBuildError(`${projectRoot} is not a project directory.`);
  }

  const manifestPath = path.join(projectRoot, 'project.toml');
  let manifestSource: string;
  try {
    manifestSource = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (isMissingPath(error)) {
      throw new FilesystemBuildError(`No project.toml exists in ${projectRoot}.`);
    }
    throw error;
  }
  const manifest = parseProjectManifest(manifestSource);
  const outputPath = normalizeProjectPath(options.output ?? manifest.build.output);
  const outputRootName = outputPath.split('/')[0] ?? '';
  if (ignoredProjectDirectories.has(outputRootName) || outputRootName.startsWith('.rpgne-')) {
    throw new FilesystemBuildError(
      `Build output cannot use reserved project directory ${JSON.stringify(outputRootName)}.`,
    );
  }
  await rejectSymlinkComponents(projectRoot, outputPath);
  const outputDirectory = resolvedChild(projectRoot, outputPath, 'Build output');
  await verifyOutputOwnership(outputDirectory, manifest.project.id);
  const storyFiles = await collectStoryFiles(projectRoot, outputPath);
  const files: ProjectFileInput[] = [
    { path: 'project.toml', content: manifestSource },
    ...storyFiles,
  ];
  const result = await buildWebProject({
    files,
    ...(options.targets === undefined ? {} : { targets: options.targets }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });

  const stagingDirectory = `${outputDirectory}.rpgne-staging`;
  const backupDirectory = `${outputDirectory}.rpgne-previous`;
  const lockPath = `${outputDirectory}.rpgne-lock`;
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  const lock = await acquireBuildLock(lockPath);
  try {
    await verifyStagingOwnership(stagingDirectory, manifest.project.id);
    await removeOwnedDirectory(stagingDirectory, projectRoot);
    await writeBuildFiles(stagingDirectory, result);
    await promoteBuild(
      projectRoot,
      outputDirectory,
      stagingDirectory,
      backupDirectory,
      manifest.project.id,
    );
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  }

  const unavailableTargets =
    options.targets === undefined
      ? manifest.build.targets.filter((target) => nativeTargets.has(target))
      : [];
  return Object.freeze({
    projectDirectory: projectRoot,
    outputDirectory,
    unavailableTargets: Object.freeze(unavailableTargets),
    build: result,
  });
}

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

interface BuildCommandOptions {
  readonly projectDirectory: string;
  readonly output?: string;
  readonly targets?: readonly BuildTarget[];
  readonly profile?: BuildProfile;
  readonly clean: boolean;
  readonly report: 'both' | 'json' | 'text';
}

const supportedTargets = new Set<BuildTarget>(['bundle', 'web', 'web-single', 'web-zip']);

function optionValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new FilesystemBuildError(`${option} requires a value.`);
  }
  return value;
}

function parseBuildArguments(arguments_: readonly string[]): BuildCommandOptions {
  let projectDirectory = '.';
  let output: string | undefined;
  let profile: BuildProfile | undefined;
  let report: BuildCommandOptions['report'] = 'text';
  let clean = false;
  let sawProject = false;
  let useAllTargets = false;
  const targets: BuildTarget[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (argument === '--clean') {
      clean = true;
      continue;
    }
    if (argument === '--target') {
      const value = optionValue(arguments_, index, '--target');
      index += 1;
      if (value === 'all') useAllTargets = true;
      else if (supportedTargets.has(value as BuildTarget)) targets.push(value as BuildTarget);
      else if (nativeTargets.has(value as ProjectBuildTarget)) {
        throw new FilesystemBuildError(
          `Target ${value} is not available yet. Web targets work on this host; native targets will use Tauri.`,
        );
      } else throw new FilesystemBuildError(`Unknown build target ${JSON.stringify(value)}.`);
      continue;
    }
    if (argument === '--output') {
      output = optionValue(arguments_, index, '--output');
      index += 1;
      continue;
    }
    if (argument === '--profile') {
      const value = optionValue(arguments_, index, '--profile');
      index += 1;
      if (value !== 'development' && value !== 'release') {
        throw new FilesystemBuildError('--profile must be development or release.');
      }
      profile = value;
      continue;
    }
    if (argument === '--report') {
      const value = optionValue(arguments_, index, '--report');
      index += 1;
      if (value !== 'text' && value !== 'json' && value !== 'both') {
        throw new FilesystemBuildError('--report must be text, json, or both.');
      }
      report = value;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new FilesystemBuildError(`Unknown build option ${JSON.stringify(argument)}.`);
    }
    if (sawProject) throw new FilesystemBuildError('rpgne build accepts one project directory.');
    projectDirectory = argument;
    sawProject = true;
  }

  if (useAllTargets && targets.length > 0) {
    throw new FilesystemBuildError('--target all cannot be combined with another target.');
  }
  return {
    projectDirectory,
    clean,
    report,
    ...(output === undefined ? {} : { output }),
    ...(profile === undefined ? {} : { profile }),
    ...(useAllTargets || targets.length === 0 ? {} : { targets: Object.freeze(targets) }),
  };
}

function helpText(): string {
  return `RPG Narrative Engine CLI

Usage:
  rpgne build [project-directory] [options]

Build options:
  --target bundle|web|web-zip|web-single|all   Repeat to select outputs
  --profile development|release               One-run profile override
  --output <project-relative-path>             One-run output directory override
  --clean                                      Replace only the owned output directory
  --report text|json|both                      Console report format

The editor Build workspace and this command use the same build service.`;
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const issues: unknown = 'issues' in error ? error.issues : undefined;
  if (Array.isArray(issues)) {
    const messages = issues.flatMap((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null || !('message' in issue)) return [];
      const message = issue.message;
      return typeof message === 'string' ? [message] : [];
    });
    if (messages.length > 0) return `${error.message}\n- ${messages.join('\n- ')}`;
  }
  return error.message;
}

function reportSummary(result: FilesystemBuildResult): Record<string, unknown> {
  return {
    status: result.unavailableTargets.length === 0 ? 'succeeded' : 'partial',
    project: result.build.project.project.title,
    version: result.build.project.project.version,
    profile: result.build.profile,
    outputDirectory: result.outputDirectory,
    gameBundleHash: result.build.gameBundleHash,
    targets: result.build.targets,
    unavailableTargets: result.unavailableTargets,
    artifacts: result.build.artifacts.map((artifact) => ({
      id: artifact.id,
      target: artifact.target,
      format: artifact.format,
      path: artifact.path,
      size: artifact.kind === 'folder' ? artifact.size : artifact.file.size,
      sha256: artifact.kind === 'folder' ? artifact.sha256 : artifact.file.sha256,
    })),
  };
}

/** Run the public CLI adapter. Returns 2 when configured native targets need another host. */
export async function runCli(
  arguments_: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const [command, ...rest] = arguments_;
  if (command === undefined || command === '--help' || command === '-h') {
    io.stdout(helpText());
    return 0;
  }
  if (command === '--version' || command === '-v') {
    io.stdout('0.0.0');
    return 0;
  }
  if (command !== 'build') {
    throw new FilesystemBuildError(
      `Unknown command ${JSON.stringify(command)}. The working command is "build".`,
    );
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout(helpText());
    return 0;
  }

  const options = parseBuildArguments(rest);
  const showText = options.report === 'text' || options.report === 'both';
  const result = await buildProjectDirectory({
    projectDirectory: options.projectDirectory,
    clean: options.clean,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.targets === undefined ? {} : { targets: options.targets }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(showText
      ? {
          onProgress(event: BuildProgressEvent) {
            io.stdout(`[${Math.round(event.progress * 100)}%] ${event.message}`);
          },
        }
      : {}),
  });
  const summary = reportSummary(result);
  if (showText) {
    io.stdout(
      `Built ${result.build.project.project.title} ${result.build.project.project.version}`,
    );
    io.stdout(`Output: ${result.outputDirectory}`);
    io.stdout(`Bundle: ${result.build.gameBundleHash}`);
    for (const artifact of result.build.artifacts) {
      io.stdout(`- ${artifact.target}: ${artifact.path}`);
    }
    for (const target of result.unavailableTargets) {
      io.stderr(`Unavailable on this build path: ${target}`);
    }
  }
  if (options.report === 'json' || options.report === 'both') {
    io.stdout(JSON.stringify(summary, null, 2));
  }
  return result.unavailableTargets.length === 0 ? 0 : 2;
}

export function formatCliError(error: unknown): string {
  return `Build failed: ${errorDetails(error)}`;
}
