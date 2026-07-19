import {
  parseSemanticVersion,
  parseStableId,
  type ProjectId,
  type SceneId,
  type SemanticVersion,
  type StableId,
} from '@rpgnarrativeengine/contracts';
import { parse as parseToml } from 'smol-toml';

export const PROJECT_MANIFEST_FILENAME = 'project.toml';
export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectFeatureName =
  'combat' | 'economy' | 'encounters' | 'inventory' | 'party' | 'progression' | 'quests' | 'world';

export type ProjectBuildTarget =
  'android' | 'ios' | 'linux' | 'macos' | 'web' | 'web-single' | 'web-zip' | 'windows';

export interface ProjectMetadata {
  readonly id: ProjectId;
  readonly title: string;
  readonly version: SemanticVersion;
  readonly entryScene: SceneId;
  readonly defaultLocale: string;
}

export interface ProjectStoryConfiguration {
  /** Ordered authored globs; matching files are de-duplicated and compiled in canonical path order. */
  readonly files: readonly string[];
}

export interface ProjectDistributionConfiguration {
  readonly slug: string;
  readonly publisher: string | null;
  readonly copyright: string | null;
  readonly license: string | null;
  readonly icons: string | null;
}

export interface ProjectPlayerConfiguration {
  readonly theme: string | null;
  readonly history: boolean;
  readonly saves: boolean;
  readonly skipMode: 'all' | 'read-only' | 'disabled';
}

export interface ProjectBuildConfiguration {
  readonly output: string;
  readonly profile: 'development' | 'release';
  readonly targets: readonly ProjectBuildTarget[];
  readonly web: {
    readonly basePath: string;
    readonly pwa: boolean;
    readonly singleHtml: boolean;
    readonly zip: boolean;
  };
}

export interface ProjectManifest {
  readonly schema: 1;
  readonly project: ProjectMetadata;
  readonly story: ProjectStoryConfiguration;
  readonly distribution: ProjectDistributionConfiguration;
  readonly player: ProjectPlayerConfiguration;
  readonly features: Readonly<Record<ProjectFeatureName, boolean>>;
  readonly build: ProjectBuildConfiguration;
}

export interface ProjectFileInput {
  /** Project-selection-relative path. Directory selection prefixes are removed by the loader. */
  readonly path: string;
  readonly content: string;
}

export interface LoadedProjectStoryFile {
  readonly path: string;
  readonly source: string;
}

export interface LoadedNarrativeProject {
  readonly rootName: string | null;
  readonly manifest: ProjectManifest;
  readonly manifestSource: string;
  /** All text files supplied beneath the selected project root, in canonical path order. */
  readonly files: readonly ProjectFileInput[];
  readonly storyFiles: readonly LoadedProjectStoryFile[];
}

export type ProjectIssueCode =
  | 'duplicate-file'
  | 'invalid-field'
  | 'invalid-glob'
  | 'invalid-path'
  | 'invalid-toml'
  | 'missing-file'
  | 'missing-manifest'
  | 'multiple-manifests'
  | 'unsupported-schema';

export interface ProjectIssue {
  readonly code: ProjectIssueCode;
  readonly message: string;
  readonly field?: string;
  readonly path?: string;
}

export class ProjectLoadError extends Error {
  readonly issues: readonly ProjectIssue[];

  constructor(issues: readonly ProjectIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'ProjectLoadError';
    this.issues = Object.freeze([...issues]);
  }
}

type UnknownTable = Record<string, unknown>;

const FEATURE_NAMES: readonly ProjectFeatureName[] = [
  'combat',
  'economy',
  'encounters',
  'inventory',
  'party',
  'progression',
  'quests',
  'world',
];

const BUILD_TARGETS = new Set<ProjectBuildTarget>([
  'android',
  'ios',
  'linux',
  'macos',
  'web',
  'web-single',
  'web-zip',
  'windows',
]);

function issue(
  issues: ProjectIssue[],
  code: ProjectIssueCode,
  message: string,
  details: { readonly field?: string; readonly path?: string } = {},
): void {
  issues.push({ code, message, ...details });
}

function isTable(value: unknown): value is UnknownTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableValue(
  parent: UnknownTable,
  key: string,
  issues: ProjectIssue[],
  required: boolean,
): UnknownTable {
  const value = parent[key];
  if (isTable(value)) return value;
  if (required || value !== undefined) {
    issue(issues, 'invalid-field', `${key} must be a TOML table.`, { field: key });
  }
  return {};
}

function stringValue(
  table: UnknownTable,
  key: string,
  field: string,
  issues: ProjectIssue[],
  fallback: string | null,
  required = false,
): string | null {
  const value = table[key];
  if (value === undefined) {
    if (required) {
      issue(issues, 'invalid-field', `${field} is required and must be a non-empty string.`, {
        field,
      });
    }
    return fallback;
  }
  if (typeof value === 'string' && value.length > 0) return value;
  issue(issues, 'invalid-field', `${field} must be a non-empty string.`, { field });
  return fallback;
}

function booleanValue(
  table: UnknownTable,
  key: string,
  field: string,
  issues: ProjectIssue[],
  fallback: boolean,
): boolean {
  const value = table[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  issue(issues, 'invalid-field', `${field} must be true or false.`, { field });
  return fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringArrayValue(
  table: UnknownTable,
  key: string,
  field: string,
  issues: ProjectIssue[],
): readonly string[] {
  const value = table[key];
  if (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)) {
    return Object.freeze([...value]);
  }
  issue(issues, 'invalid-field', `${field} must be a non-empty array of strings.`, { field });
  return Object.freeze([]);
}

function parseId<Kind extends 'project' | 'scene'>(
  value: string | null,
  field: string,
  issues: ProjectIssue[],
): StableId<Kind> {
  try {
    return parseStableId<Kind>(value ?? '');
  } catch (error) {
    issue(
      issues,
      'invalid-field',
      error instanceof Error ? error.message : `${field} is invalid.`,
      {
        field,
      },
    );
    return '' as StableId<Kind>;
  }
}

function parseVersion(value: string | null, issues: ProjectIssue[]): SemanticVersion {
  try {
    return parseSemanticVersion(value ?? '');
  } catch (error) {
    issue(
      issues,
      'invalid-field',
      error instanceof Error ? error.message : 'project.version is invalid.',
      { field: 'project.version' },
    );
    return '' as SemanticVersion;
  }
}

function defaultSlug(projectId: string): string {
  const finalSegment = projectId.split('.').at(-1) ?? 'story';
  return finalSegment.replace(/_/gu, '-');
}

function parseFeatures(
  root: UnknownTable,
  issues: ProjectIssue[],
): Readonly<Record<ProjectFeatureName, boolean>> {
  const table = tableValue(root, 'features', issues, false);
  const features = {} as Record<ProjectFeatureName, boolean>;
  for (const name of FEATURE_NAMES) {
    features[name] = booleanValue(table, name, `features.${name}`, issues, false);
  }
  if (features.combat && !features.party) {
    issue(issues, 'invalid-field', 'features.combat requires features.party.', {
      field: 'features.combat',
    });
  }
  if (features.encounters && (!features.world || !features.combat)) {
    issue(
      issues,
      'invalid-field',
      'features.encounters requires features.world and features.combat.',
      {
        field: 'features.encounters',
      },
    );
  }
  return Object.freeze(features);
}

function parseTargets(table: UnknownTable, issues: ProjectIssue[]): readonly ProjectBuildTarget[] {
  const raw = table['targets'];
  if (raw === undefined) return Object.freeze(['web']);
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((target) => typeof target === 'string')
  ) {
    issue(issues, 'invalid-field', 'build.targets must be a non-empty array of target IDs.', {
      field: 'build.targets',
    });
    return Object.freeze([]);
  }
  const targets: ProjectBuildTarget[] = [];
  for (const target of raw) {
    if (!BUILD_TARGETS.has(target as ProjectBuildTarget)) {
      issue(issues, 'invalid-field', `Unknown build target ${JSON.stringify(target)}.`, {
        field: 'build.targets',
      });
      continue;
    }
    if (!targets.includes(target as ProjectBuildTarget)) targets.push(target as ProjectBuildTarget);
  }
  return Object.freeze(targets);
}

/** Normalize a path without allowing absolute paths or traversal outside the project. */
export function normalizeProjectPath(input: string): string {
  if (input.length === 0 || input.includes('\0')) {
    throw new ProjectLoadError([
      { code: 'invalid-path', message: 'Project paths cannot be empty or contain NUL.' },
    ]);
  }
  const normalized = input.replace(/\\/gu, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) {
    throw new ProjectLoadError([
      { code: 'invalid-path', message: `Project path ${JSON.stringify(input)} must be relative.` },
    ]);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ProjectLoadError([
      {
        code: 'invalid-path',
        message: `Project path ${JSON.stringify(input)} contains an empty, current, or parent segment.`,
      },
    ]);
  }
  return segments.join('/');
}

function normalizeStoryGlob(input: string): string {
  const normalized = input.replace(/\\/gu, '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/u.test(normalized) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ProjectLoadError([
      {
        code: 'invalid-glob',
        message: `Story glob ${JSON.stringify(input)} must stay inside the project.`,
      },
    ]);
  }
  if (['[', ']', '{', '}', '!'].some((token) => normalized.includes(token))) {
    throw new ProjectLoadError([
      {
        code: 'invalid-glob',
        message: `Story glob ${JSON.stringify(input)} uses unsupported expansion syntax; use path segments, *, **, or ? only.`,
      },
    ]);
  }
  return normalized;
}

function globExpression(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? '';
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'u');
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/** Parse and validate the stable, platform-neutral portion of `project.toml`. */
export function parseProjectManifest(source: string): ProjectManifest {
  const issues: ProjectIssue[] = [];
  let parsed: unknown;
  try {
    parsed = parseToml(source, { maxDepth: 32 });
  } catch (error) {
    throw new ProjectLoadError([
      {
        code: 'invalid-toml',
        message: error instanceof Error ? error.message : 'project.toml is not valid TOML.',
        path: PROJECT_MANIFEST_FILENAME,
      },
    ]);
  }
  if (!isTable(parsed)) {
    throw new ProjectLoadError([
      { code: 'invalid-toml', message: 'project.toml must contain a TOML table.' },
    ]);
  }

  if (parsed['schema'] !== PROJECT_SCHEMA_VERSION) {
    issue(
      issues,
      'unsupported-schema',
      `project.toml schema must be ${PROJECT_SCHEMA_VERSION}; received ${JSON.stringify(parsed['schema'])}.`,
      { field: 'schema' },
    );
  }

  const project = tableValue(parsed, 'project', issues, true);
  const projectIdRaw = stringValue(project, 'id', 'project.id', issues, null, true);
  const projectId = parseId<'project'>(projectIdRaw, 'project.id', issues);
  const title = stringValue(project, 'title', 'project.title', issues, null, true) ?? '';
  const version = parseVersion(
    stringValue(project, 'version', 'project.version', issues, null, true),
    issues,
  );
  const entryScene = parseId<'scene'>(
    stringValue(project, 'entry_scene', 'project.entry_scene', issues, null, true),
    'project.entry_scene',
    issues,
  );
  const defaultLocale =
    stringValue(project, 'default_locale', 'project.default_locale', issues, 'en') ?? 'en';
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(defaultLocale)) {
    issue(issues, 'invalid-field', 'project.default_locale must be a BCP 47-style language tag.', {
      field: 'project.default_locale',
    });
  }

  const story = tableValue(parsed, 'story', issues, true);
  const storyFiles = stringArrayValue(story, 'files', 'story.files', issues);
  const normalizedGlobs: string[] = [];
  for (const pattern of storyFiles) {
    try {
      const normalized = normalizeStoryGlob(pattern);
      if (!normalizedGlobs.includes(normalized)) normalizedGlobs.push(normalized);
    } catch (error) {
      if (error instanceof ProjectLoadError) issues.push(...error.issues);
      else throw error;
    }
  }

  const distribution = tableValue(parsed, 'distribution', issues, false);
  const slug =
    stringValue(
      distribution,
      'slug',
      'distribution.slug',
      issues,
      defaultSlug(String(projectId)),
    ) ?? 'story';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    issue(
      issues,
      'invalid-field',
      'distribution.slug must use lowercase letters, digits, and single hyphens.',
      {
        field: 'distribution.slug',
      },
    );
  }
  const publisher = stringValue(distribution, 'publisher', 'distribution.publisher', issues, null);
  const copyright = stringValue(distribution, 'copyright', 'distribution.copyright', issues, null);
  const license = stringValue(distribution, 'license', 'distribution.license', issues, null);
  const iconsRaw = stringValue(distribution, 'icons', 'distribution.icons', issues, null);
  let icons: string | null = null;
  if (iconsRaw !== null) {
    try {
      icons = normalizeProjectPath(iconsRaw);
    } catch (error) {
      if (error instanceof ProjectLoadError) issues.push(...error.issues);
      else throw error;
    }
  }

  const player = tableValue(parsed, 'player', issues, false);
  const theme = stringValue(player, 'theme', 'player.theme', issues, null);
  const history = booleanValue(player, 'history', 'player.history', issues, true);
  const saves = booleanValue(player, 'saves', 'player.saves', issues, true);
  const skipModeRaw = stringValue(player, 'skip_mode', 'player.skip_mode', issues, 'read-only');
  const skipMode =
    skipModeRaw === 'all' || skipModeRaw === 'read-only' || skipModeRaw === 'disabled'
      ? skipModeRaw
      : 'read-only';
  if (skipModeRaw !== skipMode) {
    issue(issues, 'invalid-field', 'player.skip_mode must be all, read-only, or disabled.', {
      field: 'player.skip_mode',
    });
  }

  const build = tableValue(parsed, 'build', issues, false);
  const outputRaw = stringValue(build, 'output', 'build.output', issues, 'build') ?? 'build';
  let output = 'build';
  try {
    output = normalizeProjectPath(outputRaw);
  } catch (error) {
    if (error instanceof ProjectLoadError) issues.push(...error.issues);
    else throw error;
  }
  const profileRaw = stringValue(build, 'profile', 'build.profile', issues, 'development');
  const profile =
    profileRaw === 'release' || profileRaw === 'development' ? profileRaw : 'development';
  if (profileRaw !== profile) {
    issue(issues, 'invalid-field', 'build.profile must be development or release.', {
      field: 'build.profile',
    });
  }
  const web = tableValue(build, 'web', issues, false);
  const targets = parseTargets(build, issues);
  const basePath = stringValue(web, 'base_path', 'build.web.base_path', issues, './') ?? './';
  const pwa = booleanValue(web, 'pwa', 'build.web.pwa', issues, false);
  const singleHtml = booleanValue(web, 'single_html', 'build.web.single_html', issues, false);
  const zip = booleanValue(web, 'zip', 'build.web.zip', issues, false);
  const features = parseFeatures(parsed, issues);

  if (issues.length > 0) throw new ProjectLoadError(issues);
  return Object.freeze({
    schema: 1,
    project: Object.freeze({ id: projectId, title, version, entryScene, defaultLocale }),
    story: Object.freeze({ files: Object.freeze(normalizedGlobs) }),
    distribution: Object.freeze({
      slug,
      publisher,
      copyright,
      license,
      icons,
    }),
    player: Object.freeze({
      theme,
      history,
      saves,
      skipMode,
    }),
    features,
    build: Object.freeze({
      output,
      profile,
      targets,
      web: Object.freeze({
        basePath,
        pwa,
        singleHtml,
        zip,
      }),
    }),
  });
}

/** Find `project.toml`, remove a selected directory prefix, and select story files deterministically. */
export function loadNarrativeProject(files: readonly ProjectFileInput[]): LoadedNarrativeProject {
  const issues: ProjectIssue[] = [];
  const normalized = new Map<string, string>();
  for (const file of files) {
    let path: string;
    try {
      path = normalizeProjectPath(file.path);
    } catch (error) {
      if (error instanceof ProjectLoadError) {
        issues.push(...error.issues.map((current) => ({ ...current, path: file.path })));
        continue;
      }
      throw error;
    }
    if (normalized.has(path)) {
      issue(
        issues,
        'duplicate-file',
        `Project selection contains duplicate path ${JSON.stringify(path)}.`,
        {
          path,
        },
      );
    } else {
      normalized.set(path, file.content);
    }
  }
  if (issues.length > 0) throw new ProjectLoadError(issues);

  const manifests = [...normalized.keys()].filter(
    (path) => path === PROJECT_MANIFEST_FILENAME || path.endsWith(`/${PROJECT_MANIFEST_FILENAME}`),
  );
  if (manifests.length === 0) {
    throw new ProjectLoadError([
      {
        code: 'missing-manifest',
        message: `The selected files do not contain ${PROJECT_MANIFEST_FILENAME}.`,
      },
    ]);
  }
  if (manifests.length > 1) {
    throw new ProjectLoadError([
      {
        code: 'multiple-manifests',
        message: `Select one project directory; found ${manifests.length} project.toml files.`,
      },
    ]);
  }

  const manifestPath = manifests[0]!;
  const rootPrefix = manifestPath.slice(0, -PROJECT_MANIFEST_FILENAME.length);
  const rootName =
    rootPrefix.length === 0 ? null : (rootPrefix.slice(0, -1).split('/').at(-1) ?? null);
  const relativeFiles = new Map<string, string>();
  for (const [path, content] of normalized) {
    if (!path.startsWith(rootPrefix)) continue;
    relativeFiles.set(path.slice(rootPrefix.length), content);
  }
  const manifestSource = relativeFiles.get(PROJECT_MANIFEST_FILENAME)!;
  const manifest = parseProjectManifest(manifestSource);
  const matchers = manifest.story.files.map((pattern) => globExpression(pattern));
  const storyPaths = [...relativeFiles.keys()]
    .filter((path) => matchers.some((matcher) => matcher.test(path)))
    .sort(compareUnicodeCodePoints);
  if (storyPaths.length === 0) {
    throw new ProjectLoadError([
      {
        code: 'missing-file',
        message: `No story files match ${manifest.story.files.map((value) => JSON.stringify(value)).join(', ')}.`,
        field: 'story.files',
      },
    ]);
  }
  for (const path of storyPaths) {
    if (!path.endsWith('.story')) {
      issue(issues, 'invalid-glob', `Story glob selected non-story file ${JSON.stringify(path)}.`, {
        field: 'story.files',
        path,
      });
    }
  }
  if (issues.length > 0) throw new ProjectLoadError(issues);

  return Object.freeze({
    rootName,
    manifest,
    manifestSource,
    files: Object.freeze(
      [...relativeFiles.entries()]
        .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
        .map(([path, content]) => Object.freeze({ path, content })),
    ),
    storyFiles: Object.freeze(
      storyPaths.map((path) => Object.freeze({ path, source: relativeFiles.get(path)! })),
    ),
  });
}
