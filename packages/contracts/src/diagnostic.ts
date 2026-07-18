import type { SourceLocation, SourceSpan } from './source-location.js';

const diagnosticCodeBrand: unique symbol = Symbol('DiagnosticCode');

export const DIAGNOSTIC_CODE_PREFIX = 'RPGNE';

export const DIAGNOSTIC_DOMAIN_RANGES = {
  language: { first: 1000, last: 1999 },
  project: { first: 2000, last: 2999 },
  compiler: { first: 3000, last: 3999 },
  runtime: { first: 4000, last: 4999 },
  presentation: { first: 5000, last: 5999 },
  modules: { first: 6000, last: 6999 },
  plugins: { first: 7000, last: 7999 },
  tooling: { first: 8000, last: 8999 },
  internal: { first: 9000, last: 9999 },
} as const;

export type DiagnosticDomain = keyof typeof DIAGNOSTIC_DOMAIN_RANGES;
export type DiagnosticCode = string & { readonly [diagnosticCodeBrand]: true };
export type DiagnosticSeverity = 'error' | 'information' | 'warning';
export type DiagnosticTag = 'accessibility' | 'deprecated' | 'security' | 'unnecessary';
export type DiagnosticFixApplicability = 'automatic' | 'suggested';

export interface SourceTextEdit {
  readonly file: string;
  readonly span: SourceSpan;
  /** Exact source text expected at the half-open span before this edit may apply. */
  readonly expectedText: string;
  readonly replacement: string;
}

export interface DiagnosticFix {
  readonly title: string;
  readonly applicability: DiagnosticFixApplicability;
  readonly edits: readonly SourceTextEdit[];
}

export interface RelatedDiagnosticLocation {
  readonly message: string;
  readonly location: SourceLocation;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly location: SourceLocation;
  readonly related: readonly RelatedDiagnosticLocation[];
  readonly fixes: readonly DiagnosticFix[];
  readonly tags: readonly DiagnosticTag[];
}

export interface CreateDiagnosticInput {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly location: SourceLocation;
  readonly related?: readonly RelatedDiagnosticLocation[];
  readonly fixes?: readonly DiagnosticFix[];
  readonly tags?: readonly DiagnosticTag[];
}

export interface DiagnosticPolicy {
  readonly warningsAsErrors?: boolean;
  readonly severityOverrides?: Readonly<Record<string, DiagnosticSeverity>>;
}

function assertSingleLineLabel(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} cannot be empty.`);
  }
  if (/\r|\n/u.test(value)) {
    throw new TypeError(`${name} must be a single line.`);
  }
}

function assertSeverity(value: string): asserts value is DiagnosticSeverity {
  if (value !== 'error' && value !== 'information' && value !== 'warning') {
    throw new TypeError(`Unknown diagnostic severity ${JSON.stringify(value)}.`);
  }
}

function assertFixApplicability(value: string): asserts value is DiagnosticFixApplicability {
  if (value !== 'automatic' && value !== 'suggested') {
    throw new TypeError(`Unknown diagnostic fix applicability ${JSON.stringify(value)}.`);
  }
}

function assertTag(value: string): asserts value is DiagnosticTag {
  if (
    value !== 'accessibility' &&
    value !== 'deprecated' &&
    value !== 'security' &&
    value !== 'unnecessary'
  ) {
    throw new TypeError(`Unknown diagnostic tag ${JSON.stringify(value)}.`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createDiagnosticCode(
  domain: DiagnosticDomain,
  numericCode: number,
): DiagnosticCode {
  const range = DIAGNOSTIC_DOMAIN_RANGES[domain];
  if (!Number.isInteger(numericCode) || numericCode < range.first || numericCode > range.last) {
    throw new RangeError(
      `Diagnostic domain ${domain} owns codes ${range.first}-${range.last}; received ${numericCode}.`,
    );
  }
  return `${DIAGNOSTIC_CODE_PREFIX}${numericCode}` as DiagnosticCode;
}

export function parseDiagnosticCode(input: string): DiagnosticCode {
  const match = /^RPGNE([1-9][0-9]{3})$/u.exec(input);
  if (match === null) {
    throw new TypeError(
      `Diagnostic code ${JSON.stringify(input)} must match RPGNE followed by four digits from 1000 to 9999.`,
    );
  }
  return input as DiagnosticCode;
}

export function diagnosticDomain(code: DiagnosticCode): DiagnosticDomain {
  const numericCode = Number(code.slice(DIAGNOSTIC_CODE_PREFIX.length));
  for (const [domain, range] of Object.entries(DIAGNOSTIC_DOMAIN_RANGES)) {
    if (numericCode >= range.first && numericCode <= range.last) {
      return domain as DiagnosticDomain;
    }
  }
  throw new RangeError(`Diagnostic code ${code} is outside every registered domain.`);
}

export function createSourceTextEdit(input: SourceTextEdit): SourceTextEdit {
  if (input.file.trim().length === 0) {
    throw new TypeError('A source edit file cannot be empty.');
  }
  if (input.file.includes('\0')) {
    throw new TypeError('A source edit file cannot contain a null character.');
  }
  const spanLength = input.span.end.offset - input.span.start.offset;
  if (input.expectedText.length !== spanLength) {
    throw new RangeError(
      `Source edit expectedText has ${input.expectedText.length} UTF-16 code units but its span has ${spanLength}.`,
    );
  }
  return Object.freeze({ ...input });
}

function editsConflict(left: SourceTextEdit, right: SourceTextEdit): boolean {
  if (left.file !== right.file) {
    return false;
  }
  const leftEmpty = left.span.start.offset === left.span.end.offset;
  const rightEmpty = right.span.start.offset === right.span.end.offset;
  if (leftEmpty && rightEmpty && left.span.start.offset === right.span.start.offset) {
    return true;
  }
  return (
    left.span.start.offset < right.span.end.offset && right.span.start.offset < left.span.end.offset
  );
}

export function createDiagnosticFix(
  title: string,
  applicability: DiagnosticFixApplicability,
  edits: readonly SourceTextEdit[],
): DiagnosticFix {
  assertSingleLineLabel(title, 'Diagnostic fix title');
  assertFixApplicability(applicability);
  if (edits.length === 0) {
    throw new TypeError('A diagnostic fix must contain at least one source edit.');
  }

  const normalizedEdits = edits
    .map(createSourceTextEdit)
    .sort(
      (left, right) =>
        compareText(left.file, right.file) ||
        left.span.start.offset - right.span.start.offset ||
        left.span.end.offset - right.span.end.offset,
    );
  for (let leftIndex = 0; leftIndex < normalizedEdits.length; leftIndex += 1) {
    const left = normalizedEdits[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedEdits.length; rightIndex += 1) {
      const right = normalizedEdits[rightIndex];
      if (right !== undefined && editsConflict(left, right)) {
        throw new RangeError(
          `Diagnostic fix ${JSON.stringify(title)} contains conflicting edits in ${left.file}.`,
        );
      }
    }
  }

  return Object.freeze({
    title,
    applicability,
    edits: Object.freeze(normalizedEdits),
  });
}

export function createDiagnostic(input: CreateDiagnosticInput): Diagnostic {
  parseDiagnosticCode(input.code);
  assertSeverity(input.severity);
  assertSingleLineLabel(input.message, 'Diagnostic message');

  const related = (input.related ?? []).map((entry) => {
    assertSingleLineLabel(entry.message, 'Related diagnostic message');
    return Object.freeze({ ...entry });
  });
  const fixes = (input.fixes ?? []).map((fix) =>
    createDiagnosticFix(fix.title, fix.applicability, fix.edits),
  );
  const tags = [...new Set(input.tags ?? [])];
  for (const tag of tags) {
    assertTag(tag);
  }
  tags.sort(compareText);

  return Object.freeze({
    code: input.code,
    severity: input.severity,
    message: input.message,
    location: input.location,
    related: Object.freeze(related),
    fixes: Object.freeze(fixes),
    tags: Object.freeze(tags),
  });
}

export function applyDiagnosticPolicy(
  diagnostic: Diagnostic,
  policy: DiagnosticPolicy,
): Diagnostic {
  const override = policy.severityOverrides?.[diagnostic.code];
  if (override !== undefined) {
    assertSeverity(override);
  }
  const severity =
    override ??
    (policy.warningsAsErrors === true && diagnostic.severity === 'warning'
      ? 'error'
      : diagnostic.severity);
  return severity === diagnostic.severity ? diagnostic : Object.freeze({ ...diagnostic, severity });
}

/** Serialize with stable property insertion order and a trailing newline for golden fixtures. */
export function serializeDiagnostic(diagnostic: Diagnostic): string {
  return `${JSON.stringify(diagnostic, null, 2)}\n`;
}
