import { describe, expect, it } from 'vitest';

import {
  InvalidStoryTokenError,
  parseStoryDuration,
  parseStoryNumberLiteral,
  parseStoryQuotedString,
  parseVariablePath,
} from '../../../packages/language/src/index.js';

describe('story lexical contract', () => {
  it('accepts unambiguous variable paths and rejects subtraction-like hyphens', () => {
    expect(parseVariablePath('memory.mara_met')).toBe('memory.mara_met');
    expect(parseVariablePath('_internal.draw_count')).toBe('_internal.draw_count');
    expect(() => parseVariablePath('player.max-hp')).toThrow(InvalidStoryTokenError);
    expect(() => parseVariablePath('Player.courage')).toThrow(InvalidStoryTokenError);
  });

  it('parses finite unsigned decimal literals and leaves signs to unary operators', () => {
    expect(parseStoryNumberLiteral('0')).toBe(0);
    expect(parseStoryNumberLiteral('12.5e-1')).toBe(1.25);
    expect(() => parseStoryNumberLiteral('-1')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryNumberLiteral('01')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryNumberLiteral('1e9999')).toThrow(InvalidStoryTokenError);
  });

  it('converts duration syntax to exact integer milliseconds', () => {
    expect(parseStoryDuration('800ms')).toBe(800);
    expect(parseStoryDuration('2s')).toBe(2000);
    expect(parseStoryDuration('0.45s')).toBe(450);
    expect(parseStoryDuration('0.001s')).toBe(1);
    expect(() => parseStoryDuration('.5s')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryDuration('1.0000s')).toThrow(InvalidStoryTokenError);
  });

  it('decodes only the documented quoted-string escapes', () => {
    expect(parseStoryQuotedString('"rain\\ntrain"')).toBe('rain\ntrain');
    expect(parseStoryQuotedString('"Mara: \\"wait\\""')).toBe('Mara: "wait"');
    expect(parseStoryQuotedString('"\\u{1F600}"')).toBe('😀');
    expect(() => parseStoryQuotedString('"missing')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryQuotedString('"\\x20"')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryQuotedString('"\\u{0}"')).toThrow(InvalidStoryTokenError);
    expect(() => parseStoryQuotedString(`"${String.fromCharCode(0xd800)}"`)).toThrow(
      InvalidStoryTokenError,
    );
  });
});
