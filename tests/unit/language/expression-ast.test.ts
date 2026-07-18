import { describe, expect, it } from 'vitest';

import {
  parseExpressionAst,
  type BinaryExpressionAst,
  type CallExpressionAst,
  type GroupExpressionAst,
  type UnaryExpressionAst,
} from '../../../packages/language/src/index.js';

describe('normalized expression AST', () => {
  it('detaches precedence and grouping semantics from Lezer node shapes', () => {
    const result = parseExpressionAst('!(trust == 2) || clamp(score + 1, 0, 5) >= 4');
    expect(result.issues).toEqual([]);
    const root = result.expression as BinaryExpressionAst;
    expect(root.kind).toBe('binary');
    expect(root.operator).toBe('||');

    const left = root.left as UnaryExpressionAst;
    expect(left).toMatchObject({ kind: 'unary', operator: '!' });
    const group = left.operand as GroupExpressionAst;
    expect(group.expression).toMatchObject({ kind: 'binary', operator: '==' });

    const comparison = root.right as BinaryExpressionAst;
    expect(comparison.operator).toBe('>=');
    const call = comparison.left as CallExpressionAst;
    expect(call.callee).toBe('clamp');
    expect(call.arguments).toHaveLength(3);
    expect(call.arguments[0]).toMatchObject({ kind: 'binary', operator: '+' });
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(call.arguments)).toBe(true);
  });

  it('preserves left-associative binary and right-associative unary structure', () => {
    const subtraction = parseExpressionAst('10 - 3 - 2').expression as BinaryExpressionAst;
    expect(subtraction.operator).toBe('-');
    expect(subtraction.left).toMatchObject({ kind: 'binary', operator: '-' });

    const unary = parseExpressionAst('!!false').expression as UnaryExpressionAst;
    expect(unary.operator).toBe('!');
    expect(unary.operand).toMatchObject({ kind: 'unary', operator: '!' });
  });

  it('decodes literals while retaining canonical raw number and string source', () => {
    const call = parseExpressionAst('min(12.5e-1, length("rain\\ntrain"))')
      .expression as CallExpressionAst;
    expect(call.arguments[0]).toMatchObject({
      kind: 'number-literal',
      raw: '12.5e-1',
      value: 1.25,
    });
    const nested = call.arguments[1] as CallExpressionAst;
    expect(nested.arguments[0]).toMatchObject({
      kind: 'string-literal',
      raw: '"rain\\ntrain"',
      value: 'rain\ntrain',
    });
  });

  it('maps every AST range to one-based lines and UTF-16 columns', () => {
    const source = 'score + 2 * 3';
    const root = parseExpressionAst(source).expression as BinaryExpressionAst;
    expect(root.span).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: source.length, line: 1, column: source.length + 1 },
    });
    const product = root.right as BinaryExpressionAst;
    expect(product.span).toEqual({
      start: { offset: 8, line: 1, column: 9 },
      end: { offset: 13, line: 1, column: 14 },
    });
  });

  it('returns no AST when recovery or lexical validation reports an issue', () => {
    expect(parseExpressionAst('1 +')).toMatchObject({ expression: null });
    expect(parseExpressionAst('1e9999')).toEqual({
      expression: null,
      issues: [expect.objectContaining({ code: 'invalid-token', from: 0, to: 6 })],
    });
    expect(parseExpressionAst('"\\x20"')).toEqual({
      expression: null,
      issues: [expect.objectContaining({ code: 'invalid-token', from: 0, to: 6 })],
    });
  });
});
