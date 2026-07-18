const stableIdBrand: unique symbol = Symbol('StableId');

export const STABLE_ID_MAX_LENGTH = 128;
export const STABLE_ID_PATTERN_SOURCE = '^[a-z0-9_-]+(?:\\.[a-z0-9_-]+)*$';
export const RESERVED_ID_NAMESPACES = ['rpgne'] as const;

const STABLE_ID_PATTERN = new RegExp(STABLE_ID_PATTERN_SOURCE, 'u');
const ALLOWED_CHARACTER_PATTERN = /^[a-z0-9._-]$/u;
const RESERVED_NAMESPACE_SET = new Set<string>(RESERVED_ID_NAMESPACES);

export type StableIdKind =
  | 'actor'
  | 'asset'
  | 'command'
  | 'content'
  | 'effect'
  | 'entity'
  | 'event'
  | 'generic'
  | 'localization'
  | 'module'
  | 'plugin'
  | 'project'
  | 'scene'
  | 'transition'
  | 'variant'
  | 'voice';

export type StableId<Kind extends StableIdKind = 'generic'> = string & {
  readonly [stableIdBrand]: Kind;
};

export type AnyStableId = StableId<StableIdKind>;

export type ActorId = StableId<'actor'>;
export type AssetId = StableId<'asset'>;
export type CommandId = StableId<'command'>;
export type ContentId = StableId<'content'>;
export type EffectId = StableId<'effect'>;
export type EntityId = StableId<'entity'>;
export type EventId = StableId<'event'>;
export type LocalizationId = StableId<'localization'>;
export type ModuleId = StableId<'module'>;
export type PluginId = StableId<'plugin'>;
export type ProjectId = StableId<'project'>;
export type SceneId = StableId<'scene'>;
export type TransitionId = StableId<'transition'>;
export type VariantId = StableId<'variant'>;
export type VoiceId = StableId<'voice'>;

export type StableIdIssueCode =
  'empty' | 'empty-namespace-segment' | 'invalid-character' | 'reserved-namespace' | 'too-long';

export interface StableIdIssue {
  readonly code: StableIdIssueCode;
  readonly message: string;
  readonly index?: number;
}

export interface StableIdValidationOptions {
  /** Core-owned declarations may opt into the otherwise reserved `rpgne` namespace. */
  readonly allowReservedNamespace?: boolean;
}

export class InvalidStableIdError extends TypeError {
  readonly input: string;
  readonly issues: readonly StableIdIssue[];

  constructor(input: string, issues: readonly StableIdIssue[]) {
    super(
      `Invalid stable ID ${JSON.stringify(input)}: ${issues.map((issue) => issue.message).join(' ')}`,
    );
    this.name = 'InvalidStableIdError';
    this.input = input;
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Validate an authored ID without changing it. Canonical IDs are exact and are never silently
 * lowercased, Unicode-normalized, or trimmed.
 */
export function validateStableId(
  input: string,
  options: StableIdValidationOptions = {},
): readonly StableIdIssue[] {
  const issues: StableIdIssue[] = [];

  if (input.length === 0) {
    return Object.freeze([
      { code: 'empty', message: 'A stable ID must contain at least one character.' },
    ]);
  }

  if (input.length > STABLE_ID_MAX_LENGTH) {
    issues.push({
      code: 'too-long',
      message: `A stable ID cannot exceed ${STABLE_ID_MAX_LENGTH} ASCII characters.`,
    });
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? '';
    if (!ALLOWED_CHARACTER_PATTERN.test(character)) {
      issues.push({
        code: 'invalid-character',
        index,
        message: `Character ${JSON.stringify(character)} at offset ${index} is not allowed in a stable ID.`,
      });
    }
  }

  if (input.split('.').some((segment) => segment.length === 0)) {
    issues.push({
      code: 'empty-namespace-segment',
      message: 'Dots separate namespaces and cannot appear first, last, or consecutively.',
    });
  }

  const topLevelNamespace = input.split('.', 1)[0] ?? '';
  if (options.allowReservedNamespace !== true && RESERVED_NAMESPACE_SET.has(topLevelNamespace)) {
    issues.push({
      code: 'reserved-namespace',
      message: `Namespace ${JSON.stringify(topLevelNamespace)} is reserved for first-party engine content.`,
    });
  }

  return Object.freeze(issues);
}

export function isStableId<Kind extends StableIdKind = 'generic'>(
  input: unknown,
  options: StableIdValidationOptions = {},
): input is StableId<Kind> {
  return (
    typeof input === 'string' &&
    STABLE_ID_PATTERN.test(input) &&
    input.length <= STABLE_ID_MAX_LENGTH &&
    validateStableId(input, options).length === 0
  );
}

export function parseStableId<Kind extends StableIdKind = 'generic'>(
  input: string,
  options: StableIdValidationOptions = {},
): StableId<Kind> {
  const issues = validateStableId(input, options);
  if (issues.length > 0) {
    throw new InvalidStableIdError(input, issues);
  }
  return input as StableId<Kind>;
}

/**
 * Create an editor suggestion from a display label. This helper is never used implicitly by the
 * compiler and may return undefined when no legal ASCII candidate can be produced.
 */
export function suggestStableId(input: string): StableId | undefined {
  const candidate = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/\.{2,}/gu, '.')
    .replace(/^[._-]+|[._-]+$/gu, '')
    .replace(/\.[_-]+|[_-]+\./gu, '.');

  return isStableId(candidate) ? candidate : undefined;
}

export function stableIdSegments(id: AnyStableId): readonly string[] {
  return Object.freeze(id.split('.'));
}

export function stableIdNamespace(id: AnyStableId): string | undefined {
  const segments = id.split('.');
  return segments.length > 1 ? segments.slice(0, -1).join('.') : undefined;
}

export function isOwnedByStableIdNamespace(id: AnyStableId, namespace: AnyStableId): boolean {
  return id === namespace || id.startsWith(`${namespace}.`);
}

export function qualifyStableId<Kind extends StableIdKind = 'generic'>(
  namespace: AnyStableId,
  localId: AnyStableId,
  options: StableIdValidationOptions = {},
): StableId<Kind> {
  return parseStableId<Kind>(`${namespace}.${localId}`, options);
}

export interface StableIdMigration<Kind extends StableIdKind = 'generic'> {
  readonly from: StableId<Kind>;
  readonly to: StableId<Kind>;
}

export type StableIdMigrationIssueCode = 'cycle' | 'duplicate-source' | 'self-reference';

export interface StableIdMigrationIssue<Kind extends StableIdKind = 'generic'> {
  readonly code: StableIdMigrationIssueCode;
  readonly message: string;
  readonly ids: readonly StableId<Kind>[];
}

export class InvalidStableIdMigrationError<
  Kind extends StableIdKind = StableIdKind,
> extends TypeError {
  readonly issues: readonly StableIdMigrationIssue<Kind>[];

  constructor(issues: readonly StableIdMigrationIssue<Kind>[]) {
    super(`Invalid stable ID migrations: ${issues.map((issue) => issue.message).join(' ')}`);
    this.name = 'InvalidStableIdMigrationError';
    this.issues = Object.freeze([...issues]);
  }
}

export function validateStableIdMigrations<Kind extends StableIdKind>(
  migrations: readonly StableIdMigration<Kind>[],
): readonly StableIdMigrationIssue<Kind>[] {
  const issues: StableIdMigrationIssue<Kind>[] = [];
  const targets = new Map<StableId<Kind>, StableId<Kind>>();

  for (const migration of migrations) {
    if (targets.has(migration.from)) {
      issues.push({
        code: 'duplicate-source',
        ids: Object.freeze([migration.from]),
        message: `Stable ID ${migration.from} has more than one migration target.`,
      });
      continue;
    }
    if (migration.from === migration.to) {
      issues.push({
        code: 'self-reference',
        ids: Object.freeze([migration.from]),
        message: `Stable ID ${migration.from} cannot migrate to itself.`,
      });
      continue;
    }
    targets.set(migration.from, migration.to);
  }

  const completed = new Set<StableId<Kind>>();
  for (const start of targets.keys()) {
    if (completed.has(start)) {
      continue;
    }

    const path: StableId<Kind>[] = [];
    const pathIndexes = new Map<StableId<Kind>, number>();
    let current: StableId<Kind> | undefined = start;
    while (current !== undefined && !completed.has(current)) {
      const repeatedAt = pathIndexes.get(current);
      if (repeatedAt !== undefined) {
        const cycle = [...path.slice(repeatedAt), current];
        issues.push({
          code: 'cycle',
          ids: Object.freeze(cycle),
          message: `Stable ID migration cycle: ${cycle.join(' -> ')}.`,
        });
        break;
      }
      pathIndexes.set(current, path.length);
      path.push(current);
      current = targets.get(current);
    }
    for (const id of path) {
      completed.add(id);
    }
  }

  return Object.freeze(issues);
}

export function resolveStableIdMigration<Kind extends StableIdKind>(
  id: StableId<Kind>,
  migrations: readonly StableIdMigration<Kind>[],
): StableId<Kind> {
  const issues = validateStableIdMigrations(migrations);
  if (issues.length > 0) {
    throw new InvalidStableIdMigrationError(issues);
  }

  const targets = new Map(migrations.map((migration) => [migration.from, migration.to]));
  let resolved = id;
  let next = targets.get(resolved);
  while (next !== undefined) {
    resolved = next;
    next = targets.get(resolved);
  }
  return resolved;
}
