const sourcePositionBrand: unique symbol = Symbol('SourcePosition');
const sourceSpanBrand: unique symbol = Symbol('SourceSpan');
const sourceLocationBrand: unique symbol = Symbol('SourceLocation');

export type SourcePosition = Readonly<{
  /** Zero-based UTF-16 code-unit offset, matching JavaScript and browser editor APIs. */
  offset: number;
  /** One-based logical line. CRLF is one line break. */
  line: number;
  /** One-based UTF-16 code-unit column. */
  column: number;
}> & {
  readonly [sourcePositionBrand]: true;
};

export type SourceSpan = Readonly<{
  /** Inclusive start position. */
  start: SourcePosition;
  /** Exclusive end position. */
  end: SourcePosition;
}> & {
  readonly [sourceSpanBrand]: true;
};

export type SourceLocation = Readonly<{
  /** Project-relative source identifier. Path normalization is owned by the project contract. */
  file: string;
  span: SourceSpan;
}> & {
  readonly [sourceLocationBrand]: true;
};

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer; received ${value}.`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer; received ${value}.`);
  }
}

export function createSourcePosition(offset: number, line: number, column: number): SourcePosition {
  assertNonNegativeSafeInteger(offset, 'Source offset');
  assertPositiveSafeInteger(line, 'Source line');
  assertPositiveSafeInteger(column, 'Source column');
  return Object.freeze({ offset, line, column }) as SourcePosition;
}

export function compareSourcePositions(left: SourcePosition, right: SourcePosition): number {
  return left.offset - right.offset;
}

export function createSourceSpan(start: SourcePosition, end: SourcePosition): SourceSpan {
  if (end.offset < start.offset) {
    throw new RangeError('A source span end offset cannot precede its start offset.');
  }
  if (end.line < start.line || (end.line === start.line && end.column < start.column)) {
    throw new RangeError('A source span end line/column cannot precede its start line/column.');
  }
  return Object.freeze({ start, end }) as SourceSpan;
}

export function createSourceLocation(file: string, span: SourceSpan): SourceLocation {
  if (file.length === 0 || file.trim().length === 0) {
    throw new TypeError('A source location file cannot be empty.');
  }
  if (file.includes('\0')) {
    throw new TypeError('A source location file cannot contain a null character.');
  }
  return Object.freeze({ file, span }) as SourceLocation;
}

/**
 * Resolve a UTF-16 offset to a one-based line and column. LF, CRLF, and lone CR are accepted. The
 * offset between CR and LF and the offset immediately after LF intentionally share a visual
 * line/column while retaining distinct absolute offsets.
 */
export function sourcePositionAt(source: string, offset: number): SourcePosition {
  assertNonNegativeSafeInteger(offset, 'Source offset');
  if (offset > source.length) {
    throw new RangeError(`Source offset ${offset} exceeds source length ${source.length}.`);
  }

  let line = 1;
  let column = 1;
  let previousWasCarriageReturn = false;

  for (let index = 0; index < offset; index += 1) {
    const codeUnit = source.charCodeAt(index);
    if (codeUnit === 13) {
      line += 1;
      column = 1;
      previousWasCarriageReturn = true;
    } else if (codeUnit === 10) {
      if (!previousWasCarriageReturn) {
        line += 1;
        column = 1;
      }
      previousWasCarriageReturn = false;
    } else {
      column += 1;
      previousWasCarriageReturn = false;
    }
  }

  return createSourcePosition(offset, line, column);
}

export function sourceSpanFromOffsets(
  source: string,
  startOffset: number,
  endOffset: number,
): SourceSpan {
  if (endOffset < startOffset) {
    throw new RangeError('A source span end offset cannot precede its start offset.');
  }
  return createSourceSpan(
    sourcePositionAt(source, startOffset),
    sourcePositionAt(source, endOffset),
  );
}

export function sourceSlice(source: string, span: SourceSpan): string {
  if (span.end.offset > source.length) {
    throw new RangeError(
      `Source span end ${span.end.offset} exceeds source length ${source.length}.`,
    );
  }
  return source.slice(span.start.offset, span.end.offset);
}
