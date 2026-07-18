import type { Tree } from '@lezer/common';

import { parser as generatedParser } from './story-parser.generated.js';

export type SyntaxIssueCode =
  'bom-position' | 'invalid-indentation' | 'lone-carriage-return' | 'parse-error' | 'tab-character';

export interface SyntaxIssue {
  readonly code: SyntaxIssueCode;
  readonly message: string;
  readonly from: number;
  readonly to: number;
}

export interface SyntaxParseResult {
  readonly tree: Tree;
  readonly issues: readonly SyntaxIssue[];
}

export const storyParser = generatedParser;
export const expressionParser = generatedParser.configure({ top: 'Expression' });

function issue(code: SyntaxIssueCode, message: string, from: number, to: number): SyntaxIssue {
  return Object.freeze({ code, message, from, to });
}

function collectTreeIssues(tree: Tree): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'InvalidIndent') {
        issues.push(
          issue(
            'invalid-indentation',
            'Structural indentation must increase by exactly two spaces.',
            node.from,
            node.to,
          ),
        );
      } else if (node.type.isError) {
        issues.push(
          issue(
            'parse-error',
            'The source does not match the story language grammar at this position.',
            node.from,
            node.to,
          ),
        );
      }
    },
  });
  return issues;
}

function collectStoryCharacterIssues(source: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    const codeUnit = source.charCodeAt(offset);
    if (codeUnit === 0xfeff && offset !== 0) {
      issues.push(
        issue(
          'bom-position',
          'A byte-order mark is accepted only at the start of a story file.',
          offset,
          offset + 1,
        ),
      );
    } else if (codeUnit === 13 && source.charCodeAt(offset + 1) !== 10) {
      issues.push(
        issue(
          'lone-carriage-return',
          'Story files accept LF or CRLF line endings, not a lone carriage return.',
          offset,
          offset + 1,
        ),
      );
    } else if (codeUnit === 9) {
      issues.push(
        issue(
          'tab-character',
          'Raw tab characters are not allowed in story source; use spaces or a quoted \\t escape.',
          offset,
          offset + 1,
        ),
      );
    }
  }
  return issues;
}

function collectIndentationIssues(source: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  let lineStart = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (lineStart < source.length) {
    let contentStart = lineStart;
    while (source.charCodeAt(contentStart) === 32) {
      contentStart += 1;
    }
    const indentation = contentStart - lineStart;
    const next = source.charCodeAt(contentStart);
    const blankOrComment =
      next === 10 ||
      next === 13 ||
      Number.isNaN(next) ||
      (next === 47 && source.charCodeAt(contentStart + 1) === 47);
    if (!blankOrComment && indentation % 2 !== 0) {
      issues.push(
        issue(
          'invalid-indentation',
          'Structural indentation must use exact two-space levels.',
          lineStart,
          contentStart,
        ),
      );
    }

    const lineFeed = source.indexOf('\n', contentStart);
    if (lineFeed === -1) {
      break;
    }
    lineStart = lineFeed + 1;
  }
  return issues;
}

function finalizeIssues(issues: readonly SyntaxIssue[]): readonly SyntaxIssue[] {
  const unique = new Map<string, SyntaxIssue>();
  for (const current of issues) {
    unique.set(`${current.code}:${current.from}:${current.to}`, current);
  }
  return Object.freeze(
    [...unique.values()].sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        (left.code < right.code ? -1 : left.code > right.code ? 1 : 0),
    ),
  );
}

export function parseStorySyntax(source: string): SyntaxParseResult {
  const tree = storyParser.parse(source);
  return Object.freeze({
    tree,
    issues: finalizeIssues([
      ...collectStoryCharacterIssues(source),
      ...collectIndentationIssues(source),
      ...collectTreeIssues(tree),
    ]),
  });
}

export function parseExpressionSyntax(source: string): SyntaxParseResult {
  const tree = expressionParser.parse(source);
  return Object.freeze({ tree, issues: finalizeIssues(collectTreeIssues(tree)) });
}

export function syntaxTreeHasErrors(tree: Tree): boolean {
  let hasErrors = false;
  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        hasErrors = true;
        return false;
      }
      return !hasErrors;
    },
  });
  return hasErrors;
}
