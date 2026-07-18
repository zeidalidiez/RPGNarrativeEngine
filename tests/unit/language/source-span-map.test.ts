import { describe, expect, it } from 'vitest';

import { createSourceSpanMap } from '../../../packages/language/src/source-span-map.js';

describe('language source span map', () => {
  it('matches the source contract across LF, CRLF, and lone CR boundaries', () => {
    const source = 'a\r\nb\nc\rd';
    const map = createSourceSpanMap(source);
    expect(map.position(0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(map.position(2)).toEqual({ offset: 2, line: 2, column: 1 });
    expect(map.position(3)).toEqual({ offset: 3, line: 2, column: 1 });
    expect(map.position(5)).toEqual({ offset: 5, line: 3, column: 1 });
    expect(map.position(7)).toEqual({ offset: 7, line: 4, column: 1 });
    expect(map.position(source.length)).toEqual({
      offset: source.length,
      line: 4,
      column: 2,
    });
  });

  it('counts UTF-16 code units and rejects invalid ranges', () => {
    const map = createSourceSpanMap('😀x');
    expect(map.position(2)).toEqual({ offset: 2, line: 1, column: 3 });
    expect(() => map.position(4)).toThrow(RangeError);
    expect(() => map.span(2, 1)).toThrow(RangeError);
  });
});
