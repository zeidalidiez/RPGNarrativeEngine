export type ExpressionValue = boolean | number | string;
export type ExpressionValueType = 'boolean' | 'number' | 'string';
export type UnaryExpressionOperator = '!' | '-';
export type LogicalExpressionOperator = '&&' | '||';
export type StrictBinaryExpressionOperator =
  '!=' | '%' | '*' | '+' | '-' | '/' | '<' | '<=' | '==' | '>' | '>=';
export type ExpressionOperator =
  LogicalExpressionOperator | StrictBinaryExpressionOperator | UnaryExpressionOperator;
export type ExpressionAssociativity = 'left' | 'right';
export type ExpressionErrorCode =
  | 'division-by-zero'
  | 'invalid-arguments'
  | 'non-finite-number'
  | 'stateful-function'
  | 'type-mismatch'
  | 'unknown-operator'
  | 'unknown-function';

export interface ExpressionOperatorDescriptor {
  readonly operator: ExpressionOperator;
  readonly precedence: number;
  readonly associativity: ExpressionAssociativity;
  readonly arity: 1 | 2;
}

export interface ExpressionFunctionSignature {
  readonly parameters: readonly ExpressionValueType[];
  readonly variadic?: ExpressionValueType;
  readonly returns: ExpressionValueType;
}

export interface ExpressionFunctionDescriptor {
  readonly name: string;
  readonly determinism: 'pure' | 'seeded';
  readonly signatures: readonly ExpressionFunctionSignature[];
  readonly rngStream?: 'story';
}

function freezeOperatorDescriptors(
  descriptors: readonly ExpressionOperatorDescriptor[],
): readonly ExpressionOperatorDescriptor[] {
  return Object.freeze(descriptors.map((descriptor) => Object.freeze({ ...descriptor })));
}

function freezeFunctionDescriptors(
  descriptors: readonly ExpressionFunctionDescriptor[],
): readonly ExpressionFunctionDescriptor[] {
  return Object.freeze(
    descriptors.map((descriptor) =>
      Object.freeze({
        ...descriptor,
        signatures: Object.freeze(
          descriptor.signatures.map((signature) =>
            Object.freeze({
              ...signature,
              parameters: Object.freeze([...signature.parameters]),
            }),
          ),
        ),
      }),
    ),
  );
}

export const EXPRESSION_OPERATORS: readonly ExpressionOperatorDescriptor[] =
  freezeOperatorDescriptors([
    { operator: '||', precedence: 1, associativity: 'left', arity: 2 },
    { operator: '&&', precedence: 2, associativity: 'left', arity: 2 },
    { operator: '==', precedence: 3, associativity: 'left', arity: 2 },
    { operator: '!=', precedence: 3, associativity: 'left', arity: 2 },
    { operator: '<', precedence: 4, associativity: 'left', arity: 2 },
    { operator: '<=', precedence: 4, associativity: 'left', arity: 2 },
    { operator: '>', precedence: 4, associativity: 'left', arity: 2 },
    { operator: '>=', precedence: 4, associativity: 'left', arity: 2 },
    { operator: '+', precedence: 5, associativity: 'left', arity: 2 },
    { operator: '-', precedence: 5, associativity: 'left', arity: 2 },
    { operator: '*', precedence: 6, associativity: 'left', arity: 2 },
    { operator: '/', precedence: 6, associativity: 'left', arity: 2 },
    { operator: '%', precedence: 6, associativity: 'left', arity: 2 },
    { operator: '!', precedence: 7, associativity: 'right', arity: 1 },
    { operator: '-', precedence: 7, associativity: 'right', arity: 1 },
  ]);

export const STANDARD_EXPRESSION_FUNCTIONS: readonly ExpressionFunctionDescriptor[] =
  freezeFunctionDescriptors([
    {
      name: 'min',
      determinism: 'pure',
      signatures: [{ parameters: ['number'], variadic: 'number', returns: 'number' }],
    },
    {
      name: 'max',
      determinism: 'pure',
      signatures: [{ parameters: ['number'], variadic: 'number', returns: 'number' }],
    },
    {
      name: 'clamp',
      determinism: 'pure',
      signatures: [{ parameters: ['number', 'number', 'number'], returns: 'number' }],
    },
    {
      name: 'round',
      determinism: 'pure',
      signatures: [{ parameters: ['number'], returns: 'number' }],
    },
    {
      name: 'length',
      determinism: 'pure',
      signatures: [{ parameters: ['string'], returns: 'number' }],
    },
    {
      name: 'random',
      determinism: 'seeded',
      rngStream: 'story',
      signatures: [
        { parameters: [], returns: 'number' },
        { parameters: ['number', 'number'], returns: 'number' },
      ],
    },
  ]);

export const MODULE_EXPRESSION_NAMESPACES = Object.freeze([
  'combat',
  'economy',
  'encounters',
  'inventory',
  'party',
  'progression',
  'quests',
  'world',
] as const);

export type PureStandardExpressionFunctionName = 'clamp' | 'length' | 'max' | 'min' | 'round';

export class ExpressionContractError extends TypeError {
  readonly code: ExpressionErrorCode;

  constructor(code: ExpressionErrorCode, message: string) {
    super(message);
    this.name = 'ExpressionContractError';
    this.code = code;
  }
}

function expressionValueType(value: unknown): ExpressionValueType {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ExpressionContractError(
        'non-finite-number',
        'Expression numbers must always be finite.',
      );
    }
    return 'number';
  }
  throw new ExpressionContractError(
    'type-mismatch',
    'Expression values must be booleans, finite numbers, or strings.',
  );
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ExpressionContractError(
      'non-finite-number',
      'An expression operation produced a non-finite number.',
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireNumber(value: ExpressionValue, context: string): number {
  if (expressionValueType(value) !== 'number') {
    throw new ExpressionContractError('type-mismatch', `${context} requires a number.`);
  }
  return value as number;
}

function requireBoolean(value: ExpressionValue, context: string): boolean {
  if (expressionValueType(value) !== 'boolean') {
    throw new ExpressionContractError('type-mismatch', `${context} requires a boolean.`);
  }
  return value as boolean;
}

function assertUnaryExpressionOperator(
  operator: string,
): asserts operator is UnaryExpressionOperator {
  if (operator !== '!' && operator !== '-') {
    throw new ExpressionContractError(
      'unknown-operator',
      `Unknown unary expression operator ${JSON.stringify(operator)}.`,
    );
  }
}

function assertLogicalExpressionOperator(
  operator: string,
): asserts operator is LogicalExpressionOperator {
  if (operator !== '&&' && operator !== '||') {
    throw new ExpressionContractError(
      'unknown-operator',
      `Unknown logical expression operator ${JSON.stringify(operator)}.`,
    );
  }
}

export function evaluateUnaryExpressionOperator(
  operator: UnaryExpressionOperator,
  operand: ExpressionValue,
): ExpressionValue {
  assertUnaryExpressionOperator(operator);
  if (operator === '!') {
    return !requireBoolean(operand, 'Logical negation');
  }
  return normalizeNumber(-requireNumber(operand, 'Unary minus'));
}

export function evaluateLogicalExpressionOperator(
  operator: LogicalExpressionOperator,
  left: ExpressionValue,
  evaluateRight: () => ExpressionValue,
): boolean {
  assertLogicalExpressionOperator(operator);
  const leftBoolean = requireBoolean(left, `Operator ${operator}`);
  if ((operator === '&&' && !leftBoolean) || (operator === '||' && leftBoolean)) {
    return leftBoolean;
  }
  return requireBoolean(evaluateRight(), `Operator ${operator}`);
}

export function evaluateBinaryExpressionOperator(
  operator: StrictBinaryExpressionOperator,
  left: ExpressionValue,
  right: ExpressionValue,
): ExpressionValue {
  if (operator === '==' || operator === '!=') {
    if (expressionValueType(left) !== expressionValueType(right)) {
      throw new ExpressionContractError(
        'type-mismatch',
        `Operator ${operator} requires operands of the same type.`,
      );
    }
    const equal = left === right;
    return operator === '==' ? equal : !equal;
  }

  if (operator === '+' && typeof left === 'string' && typeof right === 'string') {
    return left + right;
  }

  const leftNumber = requireNumber(left, `Operator ${operator}`);
  const rightNumber = requireNumber(right, `Operator ${operator}`);
  switch (operator) {
    case '<':
      return leftNumber < rightNumber;
    case '<=':
      return leftNumber <= rightNumber;
    case '>':
      return leftNumber > rightNumber;
    case '>=':
      return leftNumber >= rightNumber;
    case '+':
      return normalizeNumber(leftNumber + rightNumber);
    case '-':
      return normalizeNumber(leftNumber - rightNumber);
    case '*':
      return normalizeNumber(leftNumber * rightNumber);
    case '/':
      if (rightNumber === 0) {
        throw new ExpressionContractError('division-by-zero', 'Division by zero is not allowed.');
      }
      return normalizeNumber(leftNumber / rightNumber);
    case '%':
      if (rightNumber === 0) {
        throw new ExpressionContractError('division-by-zero', 'Modulo by zero is not allowed.');
      }
      return normalizeNumber(leftNumber % rightNumber);
    default:
      throw new ExpressionContractError(
        'type-mismatch',
        `Operator ${operator as string} is not a strict binary operator.`,
      );
  }
}

function requireArgumentCount(
  name: string,
  arguments_: readonly ExpressionValue[],
  minimum: number,
  maximum = minimum,
): void {
  if (arguments_.length < minimum || arguments_.length > maximum) {
    const expected = minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
    throw new ExpressionContractError(
      'invalid-arguments',
      `Function ${name} expects ${expected} arguments; received ${arguments_.length}.`,
    );
  }
}

function numericArguments(name: string, arguments_: readonly ExpressionValue[]): readonly number[] {
  return arguments_.map((argument) => requireNumber(argument, `Function ${name}`));
}

function assertPureStandardFunctionName(
  name: string,
): asserts name is PureStandardExpressionFunctionName {
  if (name === 'random') {
    throw new ExpressionContractError(
      'stateful-function',
      'Function random requires the serialized RNG adapter and is not a pure function.',
    );
  }
  if (
    name !== 'clamp' &&
    name !== 'length' &&
    name !== 'max' &&
    name !== 'min' &&
    name !== 'round'
  ) {
    throw new ExpressionContractError(
      'unknown-function',
      `Unknown pure standard function ${JSON.stringify(name)}.`,
    );
  }
}

export function evaluatePureStandardFunction(
  name: PureStandardExpressionFunctionName,
  arguments_: readonly ExpressionValue[],
): ExpressionValue {
  assertPureStandardFunctionName(name);
  switch (name) {
    case 'min': {
      if (arguments_.length === 0) {
        throw new ExpressionContractError(
          'invalid-arguments',
          'Function min expects at least one argument.',
        );
      }
      return normalizeNumber(
        numericArguments(name, arguments_).reduce((left, right) => Math.min(left, right)),
      );
    }
    case 'max': {
      if (arguments_.length === 0) {
        throw new ExpressionContractError(
          'invalid-arguments',
          'Function max expects at least one argument.',
        );
      }
      return normalizeNumber(
        numericArguments(name, arguments_).reduce((left, right) => Math.max(left, right)),
      );
    }
    case 'clamp': {
      requireArgumentCount(name, arguments_, 3);
      const [value, minimum, maximum] = numericArguments(name, arguments_);
      if (
        value === undefined ||
        minimum === undefined ||
        maximum === undefined ||
        minimum > maximum
      ) {
        throw new ExpressionContractError(
          'invalid-arguments',
          'Function clamp requires value, minimum, and maximum with minimum <= maximum.',
        );
      }
      return normalizeNumber(Math.min(Math.max(value, minimum), maximum));
    }
    case 'round': {
      requireArgumentCount(name, arguments_, 1);
      return normalizeNumber(Math.round(requireNumber(arguments_[0]!, 'Function round')));
    }
    case 'length': {
      requireArgumentCount(name, arguments_, 1);
      const value = arguments_[0];
      if (typeof value !== 'string') {
        throw new ExpressionContractError('type-mismatch', 'Function length requires a string.');
      }
      return [...value].length;
    }
  }
}
