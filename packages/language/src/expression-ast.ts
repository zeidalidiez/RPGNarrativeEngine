import type { SyntaxNode, Tree } from '@lezer/common';
import type { SourceSpan } from '@rpgnarrativeengine/contracts';

import type {
  LogicalExpressionOperator,
  StrictBinaryExpressionOperator,
  UnaryExpressionOperator,
} from './expression-contract.js';
import {
  parseStoryNumberLiteral,
  parseStoryQuotedString,
  parseVariablePath,
  type VariablePath,
} from './lexical-contract.js';
import { createSourceSpanMap, type SourceSpanMap } from './source-span-map.js';
import {
  parseExpressionSyntax,
  type SyntaxIssue,
  type SyntaxParseResult,
} from './syntax-parser.js';

export type BinaryExpressionOperator = LogicalExpressionOperator | StrictBinaryExpressionOperator;

interface ExpressionAstBase {
  readonly span: SourceSpan;
}

export interface BooleanLiteralExpressionAst extends ExpressionAstBase {
  readonly kind: 'boolean-literal';
  readonly value: boolean;
}

export interface NumberLiteralExpressionAst extends ExpressionAstBase {
  readonly kind: 'number-literal';
  readonly raw: string;
  readonly value: number;
}

export interface StringLiteralExpressionAst extends ExpressionAstBase {
  readonly kind: 'string-literal';
  readonly raw: string;
  readonly value: string;
}

export interface VariableExpressionAst extends ExpressionAstBase {
  readonly kind: 'variable';
  readonly path: VariablePath;
}

export interface CallExpressionAst extends ExpressionAstBase {
  readonly kind: 'call';
  readonly callee: VariablePath;
  readonly calleeSpan: SourceSpan;
  readonly arguments: readonly ExpressionAst[];
}

export interface UnaryExpressionAst extends ExpressionAstBase {
  readonly kind: 'unary';
  readonly operator: UnaryExpressionOperator;
  readonly operand: ExpressionAst;
}

export interface BinaryExpressionAst extends ExpressionAstBase {
  readonly kind: 'binary';
  readonly operator: BinaryExpressionOperator;
  readonly left: ExpressionAst;
  readonly right: ExpressionAst;
}

export interface GroupExpressionAst extends ExpressionAstBase {
  readonly kind: 'group';
  readonly expression: ExpressionAst;
}

export type ExpressionAst =
  | BinaryExpressionAst
  | BooleanLiteralExpressionAst
  | CallExpressionAst
  | GroupExpressionAst
  | NumberLiteralExpressionAst
  | StringLiteralExpressionAst
  | UnaryExpressionAst
  | VariableExpressionAst;

export interface ExpressionAstParseResult {
  readonly expression: ExpressionAst | null;
  readonly issues: readonly SyntaxIssue[];
}

const BINARY_OPERATORS = new Set<BinaryExpressionOperator>([
  '!=',
  '%',
  '&&',
  '*',
  '+',
  '-',
  '/',
  '<',
  '<=',
  '==',
  '>',
  '>=',
  '||',
]);

const BINARY_NODE_NAMES = new Set([
  'AdditiveExpression',
  'ComparisonExpression',
  'EqualityExpression',
  'LogicalAndExpression',
  'LogicalOrExpression',
  'MultiplicativeExpression',
]);

function childrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

function onlyChild(node: SyntaxNode): SyntaxNode {
  const children = childrenOf(node);
  if (children.length !== 1 || children[0] === undefined) {
    throw new Error(`Expected ${node.name} to contain exactly one child.`);
  }
  return children[0];
}

function sourceText(source: string, node: SyntaxNode): string {
  return source.slice(node.from, node.to);
}

function spanFor(map: SourceSpanMap, node: SyntaxNode): SourceSpan {
  return map.span(node.from, node.to);
}

function isBinaryOperator(value: string): value is BinaryExpressionOperator {
  return BINARY_OPERATORS.has(value as BinaryExpressionOperator);
}

function isUnaryOperator(value: string): value is UnaryExpressionOperator {
  return value === '!' || value === '-';
}

function normalizeBinaryExpression(
  source: string,
  node: SyntaxNode,
  map: SourceSpanMap,
): ExpressionAst {
  const children = childrenOf(node);
  const first = children[0];
  if (first === undefined || children.length % 2 === 0) {
    throw new Error(`Expected ${node.name} to contain alternating operands and operators.`);
  }

  let expression = normalizeExpressionNode(source, first, map);
  for (let index = 1; index < children.length; index += 2) {
    const operatorNode = children[index];
    const rightNode = children[index + 1];
    if (operatorNode === undefined || rightNode === undefined) {
      throw new Error(`Expected ${node.name} to contain a complete binary operation.`);
    }
    const operator = sourceText(source, operatorNode);
    if (!isBinaryOperator(operator)) {
      throw new Error(`Unexpected binary expression operator ${JSON.stringify(operator)}.`);
    }
    const right = normalizeExpressionNode(source, rightNode, map);
    expression = Object.freeze({
      kind: 'binary',
      operator,
      left: expression,
      right,
      span: map.span(expression.span.start.offset, right.span.end.offset),
    });
  }
  return expression;
}

function normalizeCallExpression(
  source: string,
  node: SyntaxNode,
  map: SourceSpanMap,
): CallExpressionAst {
  const calleeNode = node.getChild('VariablePath');
  if (calleeNode === null) {
    throw new Error('Expected CallExpression to contain a VariablePath.');
  }
  const argumentList = node.getChild('ArgumentList');
  const arguments_ =
    argumentList === null
      ? []
      : argumentList
          .getChildren('LogicalOrExpression')
          .map((argument) => normalizeExpressionNode(source, argument, map));
  return Object.freeze({
    kind: 'call',
    callee: parseVariablePath(sourceText(source, calleeNode)),
    calleeSpan: spanFor(map, calleeNode),
    arguments: Object.freeze(arguments_),
    span: spanFor(map, node),
  });
}

function normalizeExpressionNode(
  source: string,
  node: SyntaxNode,
  map: SourceSpanMap,
): ExpressionAst {
  if (BINARY_NODE_NAMES.has(node.name)) {
    return normalizeBinaryExpression(source, node, map);
  }

  switch (node.name) {
    case 'Expression':
    case 'PrimaryExpression':
      return normalizeExpressionNode(source, onlyChild(node), map);
    case 'UnaryExpression': {
      const children = childrenOf(node);
      if (children.length === 1) {
        return normalizeExpressionNode(source, onlyChild(node), map);
      }
      const operatorNode = children[0];
      const operandNode = children[1];
      if (operatorNode === undefined || operandNode === undefined || children.length !== 2) {
        throw new Error('Expected UnaryExpression to contain an operator and operand.');
      }
      const operator = sourceText(source, operatorNode);
      if (!isUnaryOperator(operator)) {
        throw new Error(`Unexpected unary expression operator ${JSON.stringify(operator)}.`);
      }
      return Object.freeze({
        kind: 'unary',
        operator,
        operand: normalizeExpressionNode(source, operandNode, map),
        span: spanFor(map, node),
      });
    }
    case 'BooleanLiteral':
      return Object.freeze({
        kind: 'boolean-literal',
        value: sourceText(source, node) === 'true',
        span: spanFor(map, node),
      });
    case 'NumberLiteral': {
      const raw = sourceText(source, node);
      return Object.freeze({
        kind: 'number-literal',
        raw,
        value: parseStoryNumberLiteral(raw),
        span: spanFor(map, node),
      });
    }
    case 'StringLiteral': {
      const raw = sourceText(source, node);
      return Object.freeze({
        kind: 'string-literal',
        raw,
        value: parseStoryQuotedString(raw),
        span: spanFor(map, node),
      });
    }
    case 'VariableExpression': {
      const pathNode = onlyChild(node);
      return Object.freeze({
        kind: 'variable',
        path: parseVariablePath(sourceText(source, pathNode)),
        span: spanFor(map, node),
      });
    }
    case 'CallExpression':
      return normalizeCallExpression(source, node, map);
    case 'ParenthesizedExpression': {
      const expressionNode = node.getChild('LogicalOrExpression');
      if (expressionNode === null) {
        throw new Error('Expected ParenthesizedExpression to contain an expression.');
      }
      return Object.freeze({
        kind: 'group',
        expression: normalizeExpressionNode(source, expressionNode, map),
        span: spanFor(map, node),
      });
    }
    default:
      throw new Error(`Cannot normalize unexpected expression node ${node.name}.`);
  }
}

function invalidTokenIssue(node: { readonly from: number; readonly to: number }, error: unknown) {
  const message = error instanceof Error ? error.message : 'The expression token is invalid.';
  return Object.freeze({
    code: 'invalid-token' as const,
    message,
    from: node.from,
    to: node.to,
  });
}

function collectTokenIssues(source: string, tree: Tree): readonly SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  tree.iterate({
    enter(node) {
      try {
        if (node.name === 'NumberLiteral') {
          parseStoryNumberLiteral(source.slice(node.from, node.to));
        } else if (node.name === 'StringLiteral') {
          parseStoryQuotedString(source.slice(node.from, node.to));
        }
      } catch (error) {
        issues.push(invalidTokenIssue(node, error));
      }
    },
  });
  return Object.freeze(issues);
}

function combinedIssues(
  syntax: SyntaxParseResult,
  tokenIssues: readonly SyntaxIssue[],
): readonly SyntaxIssue[] {
  const issues = [...syntax.issues, ...tokenIssues];
  issues.sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      (left.code < right.code ? -1 : left.code > right.code ? 1 : 0),
  );
  return Object.freeze(issues);
}

/** Parse and detach an expression from Lezer's concrete tree into the stable public AST. */
export function parseExpressionAst(source: string): ExpressionAstParseResult {
  const syntax = parseExpressionSyntax(source);
  const issues = combinedIssues(syntax, collectTokenIssues(source, syntax.tree));
  if (issues.length > 0) {
    return Object.freeze({ expression: null, issues });
  }
  return Object.freeze({
    expression: normalizeExpressionNode(source, syntax.tree.topNode, createSourceSpanMap(source)),
    issues,
  });
}
