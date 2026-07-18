import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  EXPRESSION_OPERATORS,
  STANDARD_EXPRESSION_FUNCTIONS,
  ExpressionContractError,
  evaluateBinaryExpressionOperator,
  evaluateLogicalExpressionOperator,
  evaluatePureStandardFunction,
  evaluateUnaryExpressionOperator,
  type ExpressionOperatorDescriptor,
  type ExpressionValue,
  type LogicalExpressionOperator,
  type PureStandardExpressionFunctionName,
  type StrictBinaryExpressionOperator,
  type UnaryExpressionOperator,
} from '../../../packages/language/src/index.js';

interface BinaryVector {
  readonly operator: StrictBinaryExpressionOperator;
  readonly left: ExpressionValue;
  readonly right: ExpressionValue;
  readonly result: ExpressionValue;
}

interface FunctionVector {
  readonly name: PureStandardExpressionFunctionName;
  readonly arguments: readonly ExpressionValue[];
  readonly result: ExpressionValue;
}

interface ExpressionVectors {
  readonly binary: readonly BinaryVector[];
  readonly functions: readonly FunctionVector[];
}

async function readJsonFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../../fixtures/language/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

describe('expression contract', () => {
  it('publishes the exact precedence and associativity fixture', async () => {
    const expected = (await readJsonFixture(
      'expression-operators.json',
    )) as readonly ExpressionOperatorDescriptor[];
    expect(EXPRESSION_OPERATORS).toEqual(expected);
  });

  it('matches deterministic operator and pure-function vectors', async () => {
    const vectors = (await readJsonFixture('expression-vectors.json')) as ExpressionVectors;
    for (const vector of vectors.binary) {
      expect(evaluateBinaryExpressionOperator(vector.operator, vector.left, vector.right)).toEqual(
        vector.result,
      );
    }
    for (const vector of vectors.functions) {
      expect(evaluatePureStandardFunction(vector.name, vector.arguments)).toEqual(vector.result);
    }
  });

  it('short-circuits logical operators without evaluating the unused operand', () => {
    let evaluations = 0;
    const right = () => {
      evaluations += 1;
      return true;
    };
    expect(evaluateLogicalExpressionOperator('&&', false, right)).toBe(false);
    expect(evaluateLogicalExpressionOperator('||', true, right)).toBe(true);
    expect(evaluations).toBe(0);
    expect(evaluateLogicalExpressionOperator('&&', true, right)).toBe(true);
    expect(evaluations).toBe(1);
  });

  it('rejects coercion, zero divisors, invalid clamps, and non-finite results', () => {
    expect(() => evaluateBinaryExpressionOperator('==', 1, '1')).toThrow(ExpressionContractError);
    expect(() => evaluateBinaryExpressionOperator('+', 'trust=', 1)).toThrow(
      ExpressionContractError,
    );
    expect(() => evaluateBinaryExpressionOperator('/', 1, 0)).toThrow(ExpressionContractError);
    expect(() => evaluateBinaryExpressionOperator('%', 1, 0)).toThrow(ExpressionContractError);
    expect(() => evaluateBinaryExpressionOperator('*', Number.MAX_VALUE, 2)).toThrow(
      ExpressionContractError,
    );
    expect(() => evaluatePureStandardFunction('clamp', [1, 5, 0])).toThrow(ExpressionContractError);
    expect(Object.is(evaluatePureStandardFunction('min', [0, -0]), -0)).toBe(false);
    expect(() =>
      evaluateLogicalExpressionOperator('and' as LogicalExpressionOperator, true, () => true),
    ).toThrow(ExpressionContractError);
    expect(() => evaluateUnaryExpressionOperator('~' as UnaryExpressionOperator, 1)).toThrow(
      ExpressionContractError,
    );
    expect(() =>
      evaluatePureStandardFunction('random' as PureStandardExpressionFunctionName, []),
    ).toThrow(ExpressionContractError);
  });

  it('marks random as seeded and keeps it out of the pure evaluator', () => {
    expect(STANDARD_EXPRESSION_FUNCTIONS.find((entry) => entry.name === 'random')).toMatchObject({
      determinism: 'seeded',
      rngStream: 'story',
    });
  });
});
