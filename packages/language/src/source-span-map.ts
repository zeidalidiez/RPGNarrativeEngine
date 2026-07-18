import {
  createSourcePosition,
  createSourceSpan,
  type SourcePosition,
  type SourceSpan,
} from '@rpgnarrativeengine/contracts';

interface LineBreak {
  readonly start: number;
  readonly end: number;
}

export interface SourceSpanMap {
  readonly sourceLength: number;
  position(offset: number): SourcePosition;
  span(from: number, to: number): SourceSpan;
}

function assertOffset(offset: number, sourceLength: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > sourceLength) {
    throw new RangeError(
      `Source offset must be a safe integer between 0 and ${sourceLength}; received ${offset}.`,
    );
  }
}

function findPreviousBreak(lineBreaks: readonly LineBreak[], offset: number): number {
  let lower = 0;
  let upper = lineBreaks.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = lineBreaks[middle];
    if (candidate !== undefined && candidate.start < offset) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower - 1;
}

/** Build an immutable, reusable UTF-16 offset mapper without allocating one position per character. */
export function createSourceSpanMap(source: string): SourceSpanMap {
  const lineBreaks: LineBreak[] = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    const codeUnit = source.charCodeAt(offset);
    if (codeUnit === 13) {
      const width = source.charCodeAt(offset + 1) === 10 ? 2 : 1;
      lineBreaks.push(Object.freeze({ start: offset, end: offset + width }));
      offset += width - 1;
    } else if (codeUnit === 10) {
      lineBreaks.push(Object.freeze({ start: offset, end: offset + 1 }));
    }
  }
  const frozenLineBreaks = Object.freeze(lineBreaks);

  function position(offset: number): SourcePosition {
    assertOffset(offset, source.length);
    const previousIndex = findPreviousBreak(frozenLineBreaks, offset);
    if (previousIndex < 0) {
      return createSourcePosition(offset, 1, offset + 1);
    }
    const previous = frozenLineBreaks[previousIndex];
    if (previous === undefined) {
      throw new Error('Source line-break lookup returned an impossible index.');
    }
    const column = offset < previous.end ? 1 : offset - previous.end + 1;
    return createSourcePosition(offset, previousIndex + 2, column);
  }

  return Object.freeze({
    sourceLength: source.length,
    position,
    span(from: number, to: number): SourceSpan {
      assertOffset(from, source.length);
      assertOffset(to, source.length);
      if (to < from) {
        throw new RangeError(`Source span end ${to} cannot precede start ${from}.`);
      }
      return createSourceSpan(position(from), position(to));
    },
  });
}
