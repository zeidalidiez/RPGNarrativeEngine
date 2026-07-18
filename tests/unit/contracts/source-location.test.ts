import { describe, expect, it } from 'vitest';

import {
  createSourcePosition,
  createSourceSpan,
  sourcePositionAt,
  sourceSlice,
  sourceSpanFromOffsets,
} from '../../../packages/contracts/src/index.js';

describe('source location contract', () => {
  it('uses UTF-16 offsets and treats CRLF as one logical line break', () => {
    const source = 'a\r\n😀b\n';

    expect(sourcePositionAt(source, 0)).toMatchObject({ offset: 0, line: 1, column: 1 });
    expect(sourcePositionAt(source, 1)).toMatchObject({ offset: 1, line: 1, column: 2 });
    expect(sourcePositionAt(source, 2)).toMatchObject({ offset: 2, line: 2, column: 1 });
    expect(sourcePositionAt(source, 3)).toMatchObject({ offset: 3, line: 2, column: 1 });
    expect(sourcePositionAt(source, 5)).toMatchObject({ offset: 5, line: 2, column: 3 });
    expect(sourcePositionAt(source, 7)).toMatchObject({ offset: 7, line: 3, column: 1 });
  });

  it('constructs half-open spans that slice the original source exactly', () => {
    const source = ':: station.arrival\n';
    const span = sourceSpanFromOffsets(source, 3, 18);
    expect(sourceSlice(source, span)).toBe('station.arrival');
    expect(span.start).toMatchObject({ offset: 3, line: 1, column: 4 });
    expect(span.end).toMatchObject({ offset: 18, line: 1, column: 19 });
  });

  it('rejects impossible positions and reversed spans', () => {
    expect(() => createSourcePosition(-1, 1, 1)).toThrow(RangeError);
    expect(() => sourcePositionAt('short', 6)).toThrow(RangeError);
    expect(() =>
      createSourceSpan(createSourcePosition(2, 1, 3), createSourcePosition(1, 1, 2)),
    ).toThrow(RangeError);
  });
});
