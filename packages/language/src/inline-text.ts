import type { SourceSpan } from '@rpgnarrativeengine/contracts';

import { parseEmbeddedExpressionAst, type ExpressionAst } from './expression-ast.js';
import { parseStoryQuotedString } from './lexical-contract.js';
import type { SourceSpanMap } from './source-span-map.js';
import type { SyntaxIssue } from './syntax-parser.js';

interface StoryInlineAstBase {
  readonly span: SourceSpan;
}

export interface StoryInlineTextAst extends StoryInlineAstBase {
  readonly kind: 'text';
  readonly value: string;
}

export interface StoryInlineLineBreakAst extends StoryInlineAstBase {
  readonly kind: 'line-break';
}

export interface StoryInlineEmphasisAst extends StoryInlineAstBase {
  readonly kind: 'emphasis';
  readonly children: readonly StoryInlineAst[];
}

export interface StoryInlineStrongAst extends StoryInlineAstBase {
  readonly kind: 'strong';
  readonly children: readonly StoryInlineAst[];
}

export interface StoryInlineLanguageAst extends StoryInlineAstBase {
  readonly kind: 'language';
  readonly languageTag: string;
  readonly languageTagSpan: SourceSpan;
  readonly children: readonly StoryInlineAst[];
}

export interface StoryInlinePronunciationAst extends StoryInlineAstBase {
  readonly kind: 'pronunciation';
  readonly hint: string;
  readonly hintSpan: SourceSpan;
  readonly children: readonly StoryInlineAst[];
}

export interface StoryInlineInterpolationAst extends StoryInlineAstBase {
  readonly kind: 'interpolation';
  readonly expression: ExpressionAst;
}

export type StoryInlineAst =
  | StoryInlineEmphasisAst
  | StoryInlineInterpolationAst
  | StoryInlineLanguageAst
  | StoryInlineLineBreakAst
  | StoryInlinePronunciationAst
  | StoryInlineStrongAst
  | StoryInlineTextAst;

export interface StoryInlineSourceSegment {
  readonly from: number;
  readonly to: number;
}

export interface StoryInlineNormalizationResult {
  readonly nodes: readonly StoryInlineAst[];
  readonly issues: readonly SyntaxIssue[];
}

interface LogicalSource {
  readonly text: string;
  /** One source-document offset for each boundary in `text`. */
  readonly boundaries: readonly number[];
}

interface InlineParserContext {
  readonly logical: LogicalSource;
  readonly map: SourceSpanMap;
  readonly issues: SyntaxIssue[];
}

interface SequenceResult {
  readonly nodes: readonly StoryInlineAst[];
  readonly next: number;
  readonly closed: boolean;
}

const ESCAPABLE_TEXT_CHARACTERS = new Set(['*', '[', ']', '{', '}', '^', '/', '\\', '@', ':']);
const ENGINE_CLOSING_TAGS = ['[/lang]', '[/pronounce]'] as const;

function buildLogicalSource(
  source: string,
  segments: readonly StoryInlineSourceSegment[],
): LogicalSource {
  if (segments.length === 0) {
    return Object.freeze({ text: '', boundaries: Object.freeze([0]) });
  }

  let text = '';
  const first = segments[0];
  if (first === undefined) {
    throw new Error('Inline segment lookup returned an impossible index.');
  }
  const boundaries: number[] = [first.from];
  let previousEnd = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      segment === undefined ||
      !Number.isSafeInteger(segment.from) ||
      !Number.isSafeInteger(segment.to) ||
      segment.from < 0 ||
      segment.to < segment.from ||
      segment.to > source.length ||
      segment.from < previousEnd
    ) {
      throw new RangeError(
        'Inline source segments must be ordered, non-overlapping source ranges.',
      );
    }
    if (index > 0) {
      text += '\n';
      boundaries.push(segment.from);
    }
    const value = source.slice(segment.from, segment.to);
    text += value;
    for (let offset = segment.from + 1; offset <= segment.to; offset += 1) {
      boundaries.push(offset);
    }
    previousEnd = segment.to;
  }
  return Object.freeze({ text, boundaries: Object.freeze(boundaries) });
}

function boundary(context: InlineParserContext, logicalOffset: number): number {
  const value = context.logical.boundaries[logicalOffset];
  if (value === undefined) {
    throw new RangeError(`Logical inline offset ${logicalOffset} has no source boundary.`);
  }
  return value;
}

function span(context: InlineParserContext, from: number, to: number): SourceSpan {
  return context.map.span(boundary(context, from), boundary(context, to));
}

function addIssue(context: InlineParserContext, message: string, from: number, to: number): void {
  context.issues.push(
    Object.freeze({
      code: 'invalid-token',
      message,
      from: boundary(context, from),
      to: boundary(context, to),
    }),
  );
}

function trimHorizontal(text: string, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  while (start < end && (text[start] === ' ' || text[start] === '\t')) {
    start += 1;
  }
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) {
    end -= 1;
  }
  return { from: start, to: end };
}

function findTagEnd(text: string, from: number): number {
  let quoted = false;
  let escaped = false;
  for (let position = from; position < text.length; position += 1) {
    const character = text[position];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ']') {
      return position;
    } else if (character === '\n') {
      return -1;
    }
  }
  return -1;
}

function findInterpolationEnd(context: InlineParserContext, expressionStart: number): number {
  const text = context.logical.text;
  let quoted = false;
  let escaped = false;
  for (let position = expressionStart; position < text.length - 1; position += 1) {
    const character = text[position];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && text.startsWith('{{', position)) {
      addIssue(
        context,
        'Interpolation cannot be nested inside another interpolation.',
        position,
        position + 2,
      );
    }
    if (!quoted && text.startsWith('}}', position)) {
      return position;
    }
  }
  return -1;
}

function parseInterpolation(
  context: InlineParserContext,
  position: number,
): { readonly node: StoryInlineInterpolationAst | null; readonly next: number } {
  const text = context.logical.text;
  const closing = findInterpolationEnd(context, position + 2);
  if (closing === -1) {
    addIssue(context, 'Interpolation is missing its closing }} delimiter.', position, text.length);
    return Object.freeze({ node: null, next: text.length });
  }
  const expressionRange = trimHorizontal(text, position + 2, closing);
  if (text.slice(expressionRange.from, expressionRange.to).includes('\n')) {
    addIssue(
      context,
      'An interpolation expression cannot cross a physical line.',
      position,
      closing + 2,
    );
    return Object.freeze({ node: null, next: closing + 2 });
  }
  const expressionSource = text.slice(expressionRange.from, expressionRange.to);
  const sourceStart = boundary(context, expressionRange.from);
  const result = parseEmbeddedExpressionAst(expressionSource, context.map, sourceStart);
  context.issues.push(...result.issues);
  return Object.freeze({
    node:
      result.expression === null
        ? null
        : Object.freeze({
            kind: 'interpolation',
            expression: result.expression,
            span: span(context, position, closing + 2),
          }),
    next: closing + 2,
  });
}

function parseEngineSpan(
  context: InlineParserContext,
  position: number,
  name: 'lang' | 'pronounce',
  engineDepth: number,
): { readonly node: StoryInlineAst | null; readonly next: number } {
  const text = context.logical.text;
  const prefix = name === 'lang' ? '[lang=' : '[pronounce=';
  const openingEnd = findTagEnd(text, position + prefix.length);
  if (openingEnd === -1) {
    addIssue(
      context,
      `The [${name}=...] span is missing its closing ] delimiter.`,
      position,
      text.length,
    );
    return Object.freeze({ node: null, next: text.length });
  }
  if (engineDepth > 0) {
    addIssue(
      context,
      'Language and pronunciation spans cannot contain another engine span.',
      position,
      openingEnd + 1,
    );
  }

  const attributeRange = trimHorizontal(text, position + prefix.length, openingEnd);
  const attributeSource = text.slice(attributeRange.from, attributeRange.to);
  let attributeValue: string | null = null;
  if (name === 'lang') {
    if (attributeSource.length === 0 || attributeSource.trim() !== attributeSource) {
      addIssue(
        context,
        'A language span requires a non-empty BCP 47 tag without surrounding whitespace.',
        attributeRange.from,
        attributeRange.to,
      );
    } else {
      attributeValue = attributeSource;
    }
  } else {
    try {
      attributeValue = parseStoryQuotedString(attributeSource);
    } catch (error) {
      addIssue(
        context,
        error instanceof Error ? error.message : 'The pronunciation hint is invalid.',
        attributeRange.from,
        attributeRange.to,
      );
    }
  }

  const closingTag = name === 'lang' ? '[/lang]' : '[/pronounce]';
  const children = parseSequence(context, openingEnd + 1, closingTag, engineDepth + 1);
  if (!children.closed) {
    addIssue(context, `The [${name}=...] span is missing ${closingTag}.`, position, text.length);
  }
  if (attributeValue === null || !children.closed || engineDepth > 0) {
    return Object.freeze({ node: null, next: children.next });
  }
  const fullSpan = span(context, position, children.next);
  const attributeSpan = span(context, attributeRange.from, attributeRange.to);
  return Object.freeze({
    node:
      name === 'lang'
        ? Object.freeze({
            kind: 'language',
            languageTag: attributeValue,
            languageTagSpan: attributeSpan,
            children: children.nodes,
            span: fullSpan,
          })
        : Object.freeze({
            kind: 'pronunciation',
            hint: attributeValue,
            hintSpan: attributeSpan,
            children: children.nodes,
            span: fullSpan,
          }),
    next: children.next,
  });
}

function isClosingDelimiter(text: string, position: number, closing: string): boolean {
  if (!text.startsWith(closing, position)) {
    return false;
  }
  return closing !== '*' || !text.startsWith('**', position);
}

function parseSequence(
  context: InlineParserContext,
  start: number,
  closing: string | null,
  engineDepth: number,
): SequenceResult {
  const text = context.logical.text;
  const nodes: StoryInlineAst[] = [];
  let position = start;
  let textStart = -1;
  let textEnd = -1;
  let textValue = '';

  function appendText(value: string, from: number, to: number): void {
    if (textStart === -1) {
      textStart = from;
    }
    textEnd = to;
    textValue += value;
  }

  function flushText(): void {
    if (textStart === -1) {
      return;
    }
    nodes.push(
      Object.freeze({
        kind: 'text',
        value: textValue,
        span: span(context, textStart, textEnd),
      }),
    );
    textStart = -1;
    textEnd = -1;
    textValue = '';
  }

  while (position < text.length) {
    if (closing !== null && isClosingDelimiter(text, position, closing)) {
      flushText();
      return Object.freeze({
        nodes: Object.freeze(nodes),
        next: position + closing.length,
        closed: true,
      });
    }

    const character = text[position] ?? '';
    if (character === '\n') {
      flushText();
      nodes.push(
        Object.freeze({ kind: 'line-break', span: span(context, position, position + 1) }),
      );
      position += 1;
      continue;
    }
    if (character === '\\') {
      const escaped = text[position + 1];
      if (escaped !== undefined && ESCAPABLE_TEXT_CHARACTERS.has(escaped)) {
        appendText(escaped, position, position + 2);
        position += 2;
      } else {
        appendText(character, position, position + 1);
        position += 1;
      }
      continue;
    }
    if (text.startsWith('{{', position)) {
      flushText();
      const interpolation = parseInterpolation(context, position);
      if (interpolation.node !== null) {
        nodes.push(interpolation.node);
      }
      position = interpolation.next;
      continue;
    }
    if (text.startsWith('}}', position)) {
      addIssue(context, 'Unexpected interpolation closing delimiter }}.', position, position + 2);
      appendText('}}', position, position + 2);
      position += 2;
      continue;
    }
    if (text.startsWith('**', position)) {
      flushText();
      const children = parseSequence(context, position + 2, '**', engineDepth);
      if (!children.closed) {
        addIssue(
          context,
          'Strong emphasis is missing its closing ** delimiter.',
          position,
          text.length,
        );
      }
      nodes.push(
        Object.freeze({
          kind: 'strong',
          children: children.nodes,
          span: span(context, position, children.next),
        }),
      );
      position = children.next;
      continue;
    }
    if (character === '*') {
      flushText();
      const children = parseSequence(context, position + 1, '*', engineDepth);
      if (!children.closed) {
        addIssue(context, 'Emphasis is missing its closing * delimiter.', position, text.length);
      }
      nodes.push(
        Object.freeze({
          kind: 'emphasis',
          children: children.nodes,
          span: span(context, position, children.next),
        }),
      );
      position = children.next;
      continue;
    }
    if (text.startsWith('[lang=', position) || text.startsWith('[pronounce=', position)) {
      flushText();
      const engineSpan = parseEngineSpan(
        context,
        position,
        text.startsWith('[lang=', position) ? 'lang' : 'pronounce',
        engineDepth,
      );
      if (engineSpan.node !== null) {
        nodes.push(engineSpan.node);
      }
      position = engineSpan.next;
      continue;
    }
    const closingTag = ENGINE_CLOSING_TAGS.find((tag) => text.startsWith(tag, position));
    if (closingTag !== undefined) {
      addIssue(
        context,
        `Unexpected closing tag ${closingTag}.`,
        position,
        position + closingTag.length,
      );
      appendText(closingTag, position, position + closingTag.length);
      position += closingTag.length;
      continue;
    }
    if (character === '[' && /^\/?[A-Za-z]/u.test(text.slice(position + 1))) {
      const tagEnd = findTagEnd(text, position + 1);
      const end = tagEnd === -1 ? position + 1 : tagEnd + 1;
      addIssue(
        context,
        'Only [lang=...] and [pronounce="..."] engine spans are allowed in player text.',
        position,
        end,
      );
      appendText(text.slice(position, end), position, end);
      position = end;
      continue;
    }
    if (character === '<' && /^[/!?A-Za-z]/u.test(text[position + 1] ?? '')) {
      const closingBracket = text.indexOf('>', position + 1);
      const end = closingBracket === -1 ? position + 1 : closingBracket + 1;
      addIssue(context, 'Raw HTML is not allowed in player text.', position, end);
      appendText(text.slice(position, end), position, end);
      position = end;
      continue;
    }
    appendText(character, position, position + 1);
    position += 1;
  }

  flushText();
  return Object.freeze({ nodes: Object.freeze(nodes), next: text.length, closed: false });
}

function finalizeIssues(issues: readonly SyntaxIssue[]): readonly SyntaxIssue[] {
  const unique = new Map<string, SyntaxIssue>();
  for (const current of issues) {
    unique.set(`${current.code}:${current.from}:${current.to}:${current.message}`, current);
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

export function normalizeStoryInline(
  source: string,
  segments: readonly StoryInlineSourceSegment[],
  map: SourceSpanMap,
): StoryInlineNormalizationResult {
  const context: InlineParserContext = {
    logical: buildLogicalSource(source, segments),
    map,
    issues: [],
  };
  const parsed = parseSequence(context, 0, null, 0);
  return Object.freeze({
    nodes: parsed.nodes,
    issues: finalizeIssues(context.issues),
  });
}
