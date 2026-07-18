const variablePathBrand: unique symbol = Symbol('VariablePath');
const durationBrand: unique symbol = Symbol('StoryDurationMilliseconds');

export const STORY_FILE_EXTENSION = '.story';
export const STORY_INDENT = '  ';
export const VARIABLE_PATH_PATTERN_SOURCE = '^[a-z_][a-z0-9_]*(?:\\.[a-z_][a-z0-9_]*)*$';
export const STORY_NUMBER_LITERAL_PATTERN_SOURCE =
  '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$';
export const STORY_DURATION_PATTERN_SOURCE =
  '^(?:(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,3})?s|(?:0|[1-9][0-9]*)ms)$';

const VARIABLE_PATH_PATTERN = new RegExp(VARIABLE_PATH_PATTERN_SOURCE, 'u');
const STORY_NUMBER_LITERAL_PATTERN = new RegExp(STORY_NUMBER_LITERAL_PATTERN_SOURCE, 'u');
const STORY_DURATION_PATTERN = /^(?:(0|[1-9][0-9]*)(?:\.([0-9]{1,3}))?s|(0|[1-9][0-9]*)ms)$/u;
const STORY_STRING_SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  '/': '/',
  '\\': '\\',
  n: '\n',
  r: '\r',
  t: '\t',
});

export type VariablePath = string & { readonly [variablePathBrand]: true };
export type StoryDurationMilliseconds = number & { readonly [durationBrand]: true };
export type StoryTokenKind = 'duration' | 'number' | 'quoted-string' | 'variable-path';

export class InvalidStoryTokenError extends SyntaxError {
  readonly kind: StoryTokenKind;
  readonly input: string;

  constructor(kind: StoryTokenKind, input: string, detail: string) {
    super(`Invalid story ${kind} ${JSON.stringify(input)}: ${detail}`);
    this.name = 'InvalidStoryTokenError';
    this.kind = kind;
    this.input = input;
  }
}

export function isVariablePath(input: unknown): input is VariablePath {
  return typeof input === 'string' && VARIABLE_PATH_PATTERN.test(input);
}

export function parseVariablePath(input: string): VariablePath {
  if (!isVariablePath(input)) {
    throw new InvalidStoryTokenError(
      'variable-path',
      input,
      'expected lowercase ASCII segments beginning with a letter or underscore, separated by dots.',
    );
  }
  return input;
}

export function parseStoryNumberLiteral(input: string): number {
  if (!STORY_NUMBER_LITERAL_PATTERN.test(input)) {
    throw new InvalidStoryTokenError(
      'number',
      input,
      'expected an unsigned decimal literal without leading zeroes; negative values use unary minus.',
    );
  }
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new InvalidStoryTokenError(
      'number',
      input,
      'the literal is outside the finite number range.',
    );
  }
  return value;
}

export function parseStoryDuration(input: string): StoryDurationMilliseconds {
  const match = STORY_DURATION_PATTERN.exec(input);
  if (match === null) {
    throw new InvalidStoryTokenError(
      'duration',
      input,
      'expected integer milliseconds or seconds with at most three fractional digits.',
    );
  }

  const milliseconds =
    match[3] === undefined
      ? BigInt(match[1] ?? '0') * 1000n + BigInt((match[2] ?? '').padEnd(3, '0') || '0')
      : BigInt(match[3]);
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidStoryTokenError(
      'duration',
      input,
      'the duration exceeds the maximum exactly representable millisecond value.',
    );
  }
  return Number(milliseconds) as StoryDurationMilliseconds;
}

function decodeUnicodeEscape(input: string, digits: string): string {
  if (!/^[0-9A-Fa-f]{1,6}$/u.test(digits)) {
    throw new InvalidStoryTokenError(
      'quoted-string',
      input,
      'a Unicode escape must contain one to six hexadecimal digits.',
    );
  }
  const codePoint = Number.parseInt(digits, 16);
  if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    throw new InvalidStoryTokenError(
      'quoted-string',
      input,
      'a Unicode escape must name a non-null Unicode scalar value.',
    );
  }
  return String.fromCodePoint(codePoint);
}

/** Parse a double-quoted story string without interpreting interpolation. */
export function parseStoryQuotedString(input: string): string {
  if (!input.startsWith('"')) {
    throw new InvalidStoryTokenError('quoted-string', input, 'the value must begin with a quote.');
  }

  let output = '';
  for (let index = 1; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (index !== input.length - 1) {
        throw new InvalidStoryTokenError(
          'quoted-string',
          input,
          'unexpected content follows the closing quote.',
        );
      }
      return output;
    }
    if (character === undefined || character === '\r' || character === '\n') {
      throw new InvalidStoryTokenError(
        'quoted-string',
        input,
        'quoted strings cannot contain a physical line break.',
      );
    }
    const codeUnit = character.charCodeAt(0);
    if (codeUnit < 0x20) {
      throw new InvalidStoryTokenError(
        'quoted-string',
        input,
        'control characters must use an escape sequence.',
      );
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      if (!Number.isInteger(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        throw new InvalidStoryTokenError(
          'quoted-string',
          input,
          'quoted strings cannot contain an unpaired Unicode surrogate.',
        );
      }
      output += `${character}${input[index + 1] ?? ''}`;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new InvalidStoryTokenError(
        'quoted-string',
        input,
        'quoted strings cannot contain an unpaired Unicode surrogate.',
      );
    }
    if (character !== '\\') {
      output += character;
      continue;
    }

    const escaped = input[index + 1];
    if (escaped === undefined) {
      break;
    }
    const simple = STORY_STRING_SIMPLE_ESCAPES[escaped];
    if (simple !== undefined) {
      output += simple;
      index += 1;
      continue;
    }
    if (escaped === 'u' && input[index + 2] === '{') {
      const closingBrace = input.indexOf('}', index + 3);
      if (closingBrace !== -1) {
        output += decodeUnicodeEscape(input, input.slice(index + 3, closingBrace));
        index = closingBrace;
        continue;
      }
    }
    throw new InvalidStoryTokenError(
      'quoted-string',
      input,
      `unsupported escape sequence \\${escaped}.`,
    );
  }

  throw new InvalidStoryTokenError('quoted-string', input, 'the closing quote is missing.');
}
