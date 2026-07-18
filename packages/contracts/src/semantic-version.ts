const semanticVersionBrand: unique symbol = Symbol('SemanticVersion');

const CORE_NUMBER_PATTERN_SOURCE = '(?:0|[1-9][0-9]*)';
const PRERELEASE_IDENTIFIER_PATTERN_SOURCE =
  '(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';

export const SEMANTIC_VERSION_PATTERN_SOURCE =
  `^(${CORE_NUMBER_PATTERN_SOURCE})\\.(${CORE_NUMBER_PATTERN_SOURCE})\\.(${CORE_NUMBER_PATTERN_SOURCE})` +
  `(?:-(${PRERELEASE_IDENTIFIER_PATTERN_SOURCE}(?:\\.${PRERELEASE_IDENTIFIER_PATTERN_SOURCE})*))?` +
  '(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$';

const SEMANTIC_VERSION_PATTERN = new RegExp(SEMANTIC_VERSION_PATTERN_SOURCE, 'u');
const NUMERIC_IDENTIFIER_PATTERN = /^[0-9]+$/u;

export type SemanticVersion = string & { readonly [semanticVersionBrand]: true };

export interface SemanticVersionParts {
  readonly version: SemanticVersion;
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

export interface SemanticVersionRangeInput {
  /** Inclusive lower bound. */
  readonly minimum?: SemanticVersion;
  /** Exclusive upper bound. */
  readonly before?: SemanticVersion;
  /** Prerelease versions are rejected by default even when they fall between the bounds. */
  readonly includePrerelease?: boolean;
}

export interface SemanticVersionRange {
  readonly minimum?: SemanticVersion;
  readonly before?: SemanticVersion;
  readonly includePrerelease: boolean;
}

export type SemanticCompatibilityPolicy = 'same-major' | 'same-minor' | 'same-patch' | 'semver';

export class InvalidSemanticVersionError extends TypeError {
  readonly input: string;

  constructor(input: string) {
    super(
      `Invalid semantic version ${JSON.stringify(input)}. Expected an exact SemVer 2.0.0 version without a prefix, whitespace, or leading zeroes.`,
    );
    this.name = 'InvalidSemanticVersionError';
    this.input = input;
  }
}

export class InvalidSemanticVersionRangeError extends RangeError {
  readonly range: SemanticVersionRangeInput;

  constructor(range: SemanticVersionRangeInput) {
    super(
      'A semantic version range upper bound must have greater precedence than its lower bound.',
    );
    this.name = 'InvalidSemanticVersionRangeError';
    this.range = Object.freeze({ ...range });
  }
}

export function isSemanticVersion(input: unknown): input is SemanticVersion {
  return typeof input === 'string' && SEMANTIC_VERSION_PATTERN.test(input);
}

export function parseSemanticVersion(input: string): SemanticVersion {
  if (!isSemanticVersion(input)) {
    throw new InvalidSemanticVersionError(input);
  }
  return input;
}

export function semanticVersionParts(version: SemanticVersion): SemanticVersionParts {
  const match = SEMANTIC_VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new InvalidSemanticVersionError(version);
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new InvalidSemanticVersionError(version);
  }

  return Object.freeze({
    version,
    major,
    minor,
    patch,
    prerelease: Object.freeze(match[4]?.split('.') ?? []),
    build: Object.freeze(match[5]?.split('.') ?? []),
  });
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (leftNumeric && rightNumeric) {
    return compareNumericIdentifiers(left, right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Compare SemVer precedence. Build metadata intentionally has no effect. */
export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);

  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumericIdentifiers(leftParts[key], rightParts[key]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  if (leftParts.prerelease.length === 0 || rightParts.prerelease.length === 0) {
    if (leftParts.prerelease.length === rightParts.prerelease.length) {
      return 0;
    }
    return leftParts.prerelease.length === 0 ? 1 : -1;
  }

  const sharedLength = Math.min(leftParts.prerelease.length, rightParts.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftIdentifier = leftParts.prerelease[index];
    const rightIdentifier = rightParts.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      break;
    }
    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return leftParts.prerelease.length - rightParts.prerelease.length;
}

export function haveEqualSemanticVersionPrecedence(
  left: SemanticVersion,
  right: SemanticVersion,
): boolean {
  return compareSemanticVersions(left, right) === 0;
}

export function isPrereleaseSemanticVersion(version: SemanticVersion): boolean {
  return semanticVersionParts(version).prerelease.length > 0;
}

export function createSemanticVersionRange(
  input: SemanticVersionRangeInput = {},
): SemanticVersionRange {
  if (input.includePrerelease !== undefined && typeof input.includePrerelease !== 'boolean') {
    throw new TypeError('A semantic version range includePrerelease value must be boolean.');
  }
  if (
    input.minimum !== undefined &&
    input.before !== undefined &&
    compareSemanticVersions(input.minimum, input.before) >= 0
  ) {
    throw new InvalidSemanticVersionRangeError(input);
  }

  return Object.freeze({
    ...(input.minimum === undefined ? {} : { minimum: input.minimum }),
    ...(input.before === undefined ? {} : { before: input.before }),
    includePrerelease: input.includePrerelease ?? false,
  });
}

export function satisfiesSemanticVersionRange(
  version: SemanticVersion,
  range: SemanticVersionRange,
): boolean {
  if (!range.includePrerelease && isPrereleaseSemanticVersion(version)) {
    return false;
  }
  if (range.minimum !== undefined && compareSemanticVersions(version, range.minimum) < 0) {
    return false;
  }
  return range.before === undefined || compareSemanticVersions(version, range.before) < 0;
}

function incrementNumericIdentifier(identifier: string): string {
  const digits = [...identifier];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    const digit = Number(digits[index]);
    if (digit === 9) {
      digits[index] = '0';
    } else {
      digits[index] = String(digit + 1);
      carry = 0;
    }
  }
  if (carry === 1) {
    digits.unshift('1');
  }
  return digits.join('');
}

function assertSemanticCompatibilityPolicy(
  policy: string,
): asserts policy is SemanticCompatibilityPolicy {
  if (
    policy !== 'semver' &&
    policy !== 'same-major' &&
    policy !== 'same-minor' &&
    policy !== 'same-patch'
  ) {
    throw new TypeError(`Unknown semantic compatibility policy ${JSON.stringify(policy)}.`);
  }
}

function nextVersionForPolicy(
  minimum: SemanticVersion,
  policy: SemanticCompatibilityPolicy,
): SemanticVersion {
  assertSemanticCompatibilityPolicy(policy);
  const parts = semanticVersionParts(minimum);
  const resolvedPolicy =
    policy === 'semver'
      ? parts.major !== '0'
        ? 'same-major'
        : parts.minor !== '0'
          ? 'same-minor'
          : 'same-patch'
      : policy;

  if (resolvedPolicy === 'same-major') {
    return parseSemanticVersion(`${incrementNumericIdentifier(parts.major)}.0.0`);
  }
  if (resolvedPolicy === 'same-minor') {
    return parseSemanticVersion(`${parts.major}.${incrementNumericIdentifier(parts.minor)}.0`);
  }
  return parseSemanticVersion(
    `${parts.major}.${parts.minor}.${incrementNumericIdentifier(parts.patch)}`,
  );
}

/**
 * Build the normal compatibility interval beginning at a minimum version. The `semver` policy
 * accepts later versions in the same stable major, the same pre-1.0 minor, or the same 0.0 patch.
 */
export function compatibleSemanticVersionRange(
  minimum: SemanticVersion,
  policy: SemanticCompatibilityPolicy = 'semver',
): SemanticVersionRange {
  const includePrerelease = isPrereleaseSemanticVersion(minimum);
  const nextVersion = nextVersionForPolicy(minimum, policy);
  return createSemanticVersionRange({
    minimum,
    before: includePrerelease ? parseSemanticVersion(`${nextVersion}-0`) : nextVersion,
    includePrerelease,
  });
}
