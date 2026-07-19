import type { SyntaxNode } from '@lezer/common';
import {
  parseStableId,
  type CommandId,
  type ContentId,
  type SceneId,
  type SourceSpan,
  type VariantId,
} from '@rpgnarrativeengine/contracts';

import { parseEmbeddedExpressionAst, type ExpressionAst } from './expression-ast.js';
import {
  normalizeStoryInline,
  type StoryInlineAst,
  type StoryInlineSourceSegment,
} from './inline-text.js';
import { createSourceSpanMap, type SourceSpanMap } from './source-span-map.js';
import { parseStorySyntax, type SyntaxIssue } from './syntax-parser.js';

interface StoryAstBase {
  readonly span: SourceSpan;
}

export interface StoryTriviaAst extends StoryAstBase {
  readonly kind: 'trivia';
  readonly triviaKind: 'blank-line' | 'comment';
  readonly raw: string;
}

export interface StoryTextLineAst {
  readonly raw: string;
  readonly text: string;
  readonly contentSpan: SourceSpan;
  readonly span: SourceSpan;
}

export interface StoryDialogueSpeakerAst {
  /** Unresolved configured alias or stable voice ID exactly as authored. */
  readonly reference: string;
  readonly referenceSpan: SourceSpan;
  readonly variant: VariantId | null;
  readonly variantSpan: SourceSpan | null;
}

export interface StoryTextAst extends StoryAstBase {
  readonly kind: 'text';
  readonly mode: 'dialogue' | 'narration';
  readonly speaker: StoryDialogueSpeakerAst | null;
  readonly escapedLeadingMarker: boolean;
  readonly contentId: ContentId | null;
  readonly contentIdSpan: SourceSpan | null;
  readonly lines: readonly StoryTextLineAst[];
  readonly inline: readonly StoryInlineAst[];
}

export interface StoryCommandAst extends StoryAstBase {
  readonly kind: 'command';
  readonly name: CommandId;
  readonly nameSpan: SourceSpan;
  readonly arguments: string;
  readonly argumentsSpan: SourceSpan | null;
  readonly headerSpan: SourceSpan;
}

export interface StoryChoiceAst extends StoryAstBase {
  readonly kind: 'choice';
  readonly label: string;
  readonly labelSpan: SourceSpan;
  readonly target: SceneId | null;
  readonly targetSpan: SourceSpan | null;
  readonly condition: ExpressionAst | null;
  readonly conditionSpan: SourceSpan | null;
  readonly contentId: ContentId | null;
  readonly contentIdSpan: SourceSpan | null;
  readonly body: readonly StoryItemAst[];
  readonly headerSpan: SourceSpan;
}

export interface StoryConditionalAst extends StoryAstBase {
  readonly kind: 'conditional';
  readonly condition: ExpressionAst;
  readonly conditionSpan: SourceSpan;
  readonly thenBranch: readonly StoryItemAst[];
  readonly elseBranch: readonly StoryItemAst[] | null;
  readonly headerSpan: SourceSpan;
  readonly elseHeaderSpan: SourceSpan | null;
  readonly endSpan: SourceSpan;
}

export type StoryItemAst =
  StoryChoiceAst | StoryCommandAst | StoryConditionalAst | StoryTextAst | StoryTriviaAst;

export interface StorySceneAst extends StoryAstBase {
  readonly kind: 'scene';
  readonly id: SceneId;
  readonly idSpan: SourceSpan;
  readonly headerSpan: SourceSpan;
  readonly items: readonly StoryItemAst[];
}

export interface StoryDocumentAst extends StoryAstBase {
  readonly kind: 'story-document';
  readonly hasByteOrderMark: boolean;
  readonly leadingTrivia: readonly StoryTriviaAst[];
  readonly scenes: readonly StorySceneAst[];
}

export interface StoryAstParseResult {
  readonly document: StoryDocumentAst | null;
  readonly issues: readonly SyntaxIssue[];
}

interface NormalizationContext {
  readonly source: string;
  readonly map: SourceSpanMap;
  readonly issues: SyntaxIssue[];
}

interface SourceRange {
  readonly from: number;
  readonly to: number;
}

interface ChoiceSuffixes {
  readonly labelRange: SourceRange;
  readonly target: SceneId | null;
  readonly targetSpan: SourceSpan | null;
  readonly condition: ExpressionAst | null;
  readonly conditionSpan: SourceSpan | null;
  readonly contentId: ContentId | null;
  readonly contentIdSpan: SourceSpan | null;
  readonly valid: boolean;
}

interface DialogueHead {
  readonly speaker: StoryDialogueSpeakerAst | null;
  readonly bodyRange: SourceRange;
  readonly valid: boolean;
}

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

function trimHorizontal(source: string, from: number, to: number): SourceRange {
  let start = from;
  let end = to;
  while (start < end) {
    const codeUnit = source.charCodeAt(start);
    if (codeUnit !== 32 && codeUnit !== 9) {
      break;
    }
    start += 1;
  }
  while (end > start) {
    const codeUnit = source.charCodeAt(end - 1);
    if (codeUnit !== 32 && codeUnit !== 9) {
      break;
    }
    end -= 1;
  }
  return Object.freeze({ from: start, to: end });
}

function findLineComment(source: string, from: number, to: number): number {
  let quoted = false;
  let escaped = false;
  for (let offset = from; offset < to; offset += 1) {
    const character = source[offset];
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
    if (!quoted && character === '/' && source[offset + 1] === '/') {
      return offset;
    }
  }
  return to;
}

function significantLineRange(
  context: NormalizationContext,
  node: SyntaxNode,
  prefixLength: number,
): SourceRange {
  const contentEnd = findLineComment(context.source, node.from, node.to);
  return trimHorizontal(context.source, node.from + prefixLength, contentEnd);
}

function issue(context: NormalizationContext, message: string, from: number, to: number): void {
  context.issues.push(Object.freeze({ code: 'invalid-token', message, from, to }));
}

function parseSceneId(context: NormalizationContext, range: SourceRange): SceneId | null {
  const raw = context.source.slice(range.from, range.to);
  try {
    return parseStableId<'scene'>(raw);
  } catch (error) {
    issue(
      context,
      error instanceof Error ? error.message : 'The scene ID is invalid.',
      range.from,
      range.to,
    );
    return null;
  }
}

function parseCommandId(context: NormalizationContext, range: SourceRange): CommandId | null {
  const raw = context.source.slice(range.from, range.to);
  try {
    return parseStableId<'command'>(raw);
  } catch (error) {
    issue(
      context,
      error instanceof Error ? error.message : 'The command name is invalid.',
      range.from,
      range.to,
    );
    return null;
  }
}

function parseChoiceSceneId(context: NormalizationContext, range: SourceRange): SceneId | null {
  const raw = context.source.slice(range.from, range.to);
  try {
    return parseStableId<'scene'>(raw);
  } catch (error) {
    issue(
      context,
      error instanceof Error ? error.message : 'The choice target ID is invalid.',
      range.from,
      range.to,
    );
    return null;
  }
}

function parseContentId(context: NormalizationContext, range: SourceRange): ContentId | null {
  const raw = context.source.slice(range.from, range.to);
  try {
    return parseStableId<'content'>(raw);
  } catch (error) {
    issue(
      context,
      error instanceof Error ? error.message : 'The content ID is invalid.',
      range.from,
      range.to,
    );
    return null;
  }
}

function parseEmbeddedExpression(
  context: NormalizationContext,
  range: SourceRange,
): ExpressionAst | null {
  const source = context.source.slice(range.from, range.to);
  const result = parseEmbeddedExpressionAst(source, context.map, range.from);
  for (const current of result.issues) {
    context.issues.push(current);
  }
  return result.expression;
}

function normalizeTrivia(context: NormalizationContext, node: SyntaxNode): StoryTriviaAst {
  const raw = context.source.slice(node.from, node.to);
  return Object.freeze({
    kind: 'trivia',
    triviaKind: raw.trimStart().startsWith('//') ? 'comment' : 'blank-line',
    raw,
    span: context.map.span(node.from, node.to),
  });
}

function decodeLeadingTextMarker(raw: string): {
  readonly escaped: boolean;
  readonly inlineEscapeWidth: 0 | 1;
  readonly text: string;
} {
  if (raw.startsWith('\\::') || raw.startsWith('\\@') || raw.startsWith('\\*')) {
    return Object.freeze({ escaped: true, inlineEscapeWidth: 0, text: raw.slice(1) });
  }
  if (raw.startsWith('\\\\')) {
    return Object.freeze({ escaped: true, inlineEscapeWidth: 0, text: raw.slice(1) });
  }
  if (raw.startsWith('\\') && /:[ \t]/u.test(raw.slice(1))) {
    return Object.freeze({ escaped: true, inlineEscapeWidth: 1, text: raw.slice(1) });
  }
  return Object.freeze({ escaped: false, inlineEscapeWidth: 0, text: raw });
}

function findDialogueDelimiter(source: string, range: SourceRange): number {
  let escaped = false;
  for (let offset = range.from; offset < range.to; offset += 1) {
    const character = source[offset];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (
      character === ':' &&
      (source.charCodeAt(offset + 1) === 32 || source.charCodeAt(offset + 1) === 9)
    ) {
      return offset;
    }
  }
  return -1;
}

function parseDialogueVariant(context: NormalizationContext, range: SourceRange): VariantId | null {
  const raw = context.source.slice(range.from, range.to);
  try {
    return parseStableId<'variant'>(raw);
  } catch (error) {
    issue(
      context,
      error instanceof Error ? error.message : 'The dialogue variant ID is invalid.',
      range.from,
      range.to,
    );
    return null;
  }
}

function parseDialogueHead(
  context: NormalizationContext,
  range: SourceRange,
  forcedNarration: boolean,
): DialogueHead {
  if (forcedNarration) {
    return Object.freeze({ speaker: null, bodyRange: range, valid: true });
  }
  const delimiter = findDialogueDelimiter(context.source, range);
  if (delimiter === -1) {
    return Object.freeze({ speaker: null, bodyRange: range, valid: true });
  }

  let referenceRange = trimHorizontal(context.source, range.from, delimiter);
  let variant: VariantId | null = null;
  let variantSpan: SourceSpan | null = null;
  let valid = true;
  if (context.source[referenceRange.to - 1] === ']') {
    const opening = context.source.lastIndexOf('[', referenceRange.to - 1);
    if (opening < referenceRange.from) {
      issue(
        context,
        'A dialogue variant closing bracket has no matching opening bracket.',
        referenceRange.from,
        referenceRange.to,
      );
      valid = false;
    } else {
      const untrimmedVariantRange = Object.freeze({
        from: opening + 1,
        to: referenceRange.to - 1,
      });
      const variantRange = trimHorizontal(
        context.source,
        untrimmedVariantRange.from,
        untrimmedVariantRange.to,
      );
      if (
        variantRange.from !== untrimmedVariantRange.from ||
        variantRange.to !== untrimmedVariantRange.to
      ) {
        issue(
          context,
          'Dialogue variant brackets cannot contain surrounding whitespace.',
          untrimmedVariantRange.from,
          untrimmedVariantRange.to,
        );
        valid = false;
      }
      variant = parseDialogueVariant(context, variantRange);
      variantSpan = context.map.span(variantRange.from, variantRange.to);
      valid &&= variant !== null;
      referenceRange = trimHorizontal(context.source, referenceRange.from, opening);
    }
  } else {
    const prefix = context.source.slice(referenceRange.from, referenceRange.to);
    if (prefix.includes('[') || prefix.includes(']')) {
      issue(
        context,
        'A dialogue variant must use a complete [variant-id] suffix before the colon.',
        referenceRange.from,
        referenceRange.to,
      );
      valid = false;
    }
  }
  const referenceSource = context.source.slice(referenceRange.from, referenceRange.to);
  if (referenceSource.includes('[') || referenceSource.includes(']')) {
    issue(
      context,
      'Dialogue accepts at most one final [variant-id] suffix before the colon.',
      referenceRange.from,
      referenceRange.to,
    );
    valid = false;
  }
  if (referenceRange.from === referenceRange.to) {
    issue(
      context,
      'Dialogue requires a configured speaker alias or stable voice ID before the colon.',
      range.from,
      delimiter,
    );
    valid = false;
  }

  const bodyRange = trimHorizontal(context.source, delimiter + 1, range.to);
  if (bodyRange.from === bodyRange.to) {
    issue(context, 'Dialogue text cannot be empty.', delimiter + 1, range.to);
    valid = false;
  }
  return Object.freeze({
    speaker: Object.freeze({
      reference: context.source.slice(referenceRange.from, referenceRange.to),
      referenceSpan: context.map.span(referenceRange.from, referenceRange.to),
      variant,
      variantSpan,
    }),
    bodyRange,
    valid,
  });
}

function normalizeText(context: NormalizationContext, node: SyntaxNode): StoryTextAst | null {
  const lineNodes: SyntaxNode[] = [];
  const firstLine = node.getChild('TextLine');
  if (firstLine === null) {
    throw new Error('Expected TextStatement to contain a TextLine.');
  }
  lineNodes.push(firstLine);
  const continuation = node.getChild('TextContinuation');
  if (continuation !== null) {
    lineNodes.push(...continuation.getChildren('TextLine'));
  }

  let escapedLeadingMarker = false;
  let leadingInlineEscapeWidth: 0 | 1 = 0;
  let contentId: ContentId | null = null;
  let contentIdSpan: SourceSpan | null = null;
  let valid = true;
  const lines: StoryTextLineAst[] = [];
  const contentRanges: SourceRange[] = [];
  for (let index = 0; index < lineNodes.length; index += 1) {
    const lineNode = lineNodes[index];
    if (lineNode === undefined) {
      throw new Error('Text line lookup returned an impossible index.');
    }
    const raw = context.source.slice(lineNode.from, lineNode.to);
    const contentEnd = findLineComment(context.source, lineNode.from, lineNode.to);
    let contentRange = trimHorizontal(context.source, lineNode.from, contentEnd);
    const caret = lastUnescapedToken(context.source, contentRange.from, contentRange.to, '^');
    if (
      caret !== -1 &&
      (caret === contentRange.from || /[ \t]/u.test(context.source[caret - 1] ?? ''))
    ) {
      if (index !== lineNodes.length - 1) {
        issue(
          context,
          'A text content ID suffix is allowed only on the final physical line of a beat.',
          caret,
          contentRange.to,
        );
        valid = false;
      } else {
        const idRange = trimHorizontal(context.source, caret + 1, contentRange.to);
        contentId = parseContentId(context, idRange);
        valid &&= contentId !== null;
        contentIdSpan = context.map.span(idRange.from, idRange.to);
        contentRange = trimHorizontal(context.source, contentRange.from, caret);
      }
    }
    const content = context.source.slice(contentRange.from, contentRange.to);
    const decoded =
      index === 0
        ? decodeLeadingTextMarker(content)
        : { escaped: false, inlineEscapeWidth: 0 as const, text: content };
    escapedLeadingMarker ||= decoded.escaped;
    if (index === 0) leadingInlineEscapeWidth = decoded.inlineEscapeWidth;
    contentRanges.push(contentRange);
    lines.push(
      Object.freeze({
        raw,
        text: decoded.text,
        contentSpan: context.map.span(contentRange.from, contentRange.to),
        span: context.map.span(lineNode.from, lineNode.to),
      }),
    );
  }
  if (!valid) {
    return null;
  }
  const firstContentRange = contentRanges[0];
  if (firstContentRange === undefined) {
    throw new Error('Expected normalized text to contain a content range.');
  }
  const dialogue = parseDialogueHead(context, firstContentRange, escapedLeadingMarker);
  const inlineSegments: StoryInlineSourceSegment[] = contentRanges.map((range, index) =>
    Object.freeze(
      index === 0
        ? { from: dialogue.bodyRange.from + leadingInlineEscapeWidth, to: dialogue.bodyRange.to }
        : range,
    ),
  );
  const inline = normalizeStoryInline(context.source, inlineSegments, context.map);
  context.issues.push(...inline.issues);
  if (!dialogue.valid || inline.issues.length > 0) {
    return null;
  }
  return Object.freeze({
    kind: 'text',
    mode: dialogue.speaker === null ? 'narration' : 'dialogue',
    speaker: dialogue.speaker,
    escapedLeadingMarker,
    contentId,
    contentIdSpan,
    lines: Object.freeze(lines),
    inline: inline.nodes,
    span: context.map.span(node.from, node.to),
  });
}

function normalizeCommand(context: NormalizationContext, node: SyntaxNode): StoryCommandAst | null {
  const line = node.getChild('CommandLine');
  if (line === null) {
    throw new Error('Expected CommandStatement to contain a CommandLine.');
  }
  const contentEnd = findLineComment(context.source, line.from, line.to);
  let nameEnd = line.from + 1;
  while (nameEnd < contentEnd) {
    const codeUnit = context.source.charCodeAt(nameEnd);
    if (codeUnit === 32 || codeUnit === 9) {
      break;
    }
    nameEnd += 1;
  }
  const nameRange = Object.freeze({ from: line.from + 1, to: nameEnd });
  const name = parseCommandId(context, nameRange);
  const argumentRange = trimHorizontal(context.source, nameEnd, contentEnd);
  if (name === null) {
    return null;
  }
  if (name === 'else' || name === 'end') {
    issue(context, `Stray @${name} is not paired with an open @if block.`, line.from, line.to);
    return null;
  }
  return Object.freeze({
    kind: 'command',
    name,
    nameSpan: context.map.span(nameRange.from, nameRange.to),
    arguments: context.source.slice(argumentRange.from, argumentRange.to),
    argumentsSpan:
      argumentRange.from === argumentRange.to
        ? null
        : context.map.span(argumentRange.from, argumentRange.to),
    headerSpan: context.map.span(line.from, line.to),
    span: context.map.span(node.from, node.to),
  });
}

function lastUnescapedToken(source: string, from: number, to: number, token: string): number {
  let searchFrom = to;
  while (searchFrom > from) {
    const found = source.lastIndexOf(token, searchFrom - 1);
    if (found < from) {
      return -1;
    }
    let backslashes = 0;
    for (let offset = found - 1; offset >= from && source[offset] === '\\'; offset -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return found;
    }
    searchFrom = found;
  }
  return -1;
}

function parseChoiceSuffixes(
  context: NormalizationContext,
  initialRange: SourceRange,
): ChoiceSuffixes {
  let range = initialRange;
  let valid = true;
  let contentId: ContentId | null = null;
  let contentIdSpan: SourceSpan | null = null;
  let condition: ExpressionAst | null = null;
  let conditionSpan: SourceSpan | null = null;
  let target: SceneId | null = null;
  let targetSpan: SourceSpan | null = null;

  const caret = lastUnescapedToken(context.source, range.from, range.to, '^');
  if (caret !== -1 && (caret === range.from || /[ \t]/u.test(context.source[caret - 1] ?? ''))) {
    const idRange = trimHorizontal(context.source, caret + 1, range.to);
    contentId = parseContentId(context, idRange);
    valid &&= contentId !== null;
    contentIdSpan = context.map.span(idRange.from, idRange.to);
    range = trimHorizontal(context.source, range.from, caret);
  }

  const when = lastUnescapedToken(context.source, range.from, range.to, '[when');
  if (when !== -1) {
    const afterKeyword = when + '[when'.length;
    const hasSeparator = /[ \t]/u.test(context.source[afterKeyword] ?? '');
    const closesAtEnd = context.source[range.to - 1] === ']';
    if (!hasSeparator || !closesAtEnd) {
      issue(
        context,
        'A choice condition must use the final form [when expression].',
        when,
        range.to,
      );
      valid = false;
    } else {
      const expressionRange = trimHorizontal(context.source, afterKeyword, range.to - 1);
      conditionSpan = context.map.span(expressionRange.from, expressionRange.to);
      condition = parseEmbeddedExpression(context, expressionRange);
      valid &&= condition !== null;
      range = trimHorizontal(context.source, range.from, when);
    }
  }

  const arrow = lastUnescapedToken(context.source, range.from, range.to, '->');
  if (arrow !== -1) {
    const idRange = trimHorizontal(context.source, arrow + 2, range.to);
    target = parseChoiceSceneId(context, idRange);
    valid &&= target !== null;
    targetSpan = context.map.span(idRange.from, idRange.to);
    range = trimHorizontal(context.source, range.from, arrow);
  }

  if (range.from === range.to) {
    issue(context, 'A choice must contain a non-empty player-facing label.', range.from, range.to);
    valid = false;
  }

  return Object.freeze({
    labelRange: range,
    target,
    targetSpan,
    condition,
    conditionSpan,
    contentId,
    contentIdSpan,
    valid,
  });
}

function firstNestedChoice(items: readonly StoryItemAst[]): StoryChoiceAst | null {
  for (const item of items) {
    if (item.kind === 'choice') {
      return item;
    }
    if (item.kind === 'conditional') {
      const nested =
        firstNestedChoice(item.thenBranch) ??
        (item.elseBranch === null ? null : firstNestedChoice(item.elseBranch));
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

function normalizeChoice(context: NormalizationContext, node: SyntaxNode): StoryChoiceAst | null {
  const line = node.getChild('ChoiceLine');
  if (line === null) {
    throw new Error('Expected Choice to contain a ChoiceLine.');
  }
  const suffixes = parseChoiceSuffixes(context, significantLineRange(context, line, 1));
  const block = node.getChild('StoryBlock');
  const body = block === null ? [] : normalizeBlock(context, block);
  let valid = suffixes.valid;
  if (suffixes.target !== null && block !== null) {
    issue(
      context,
      'A shorthand choice target cannot be combined with an indented choice body.',
      line.from,
      line.to,
    );
    valid = false;
  }
  const nestedChoice = firstNestedChoice(body);
  if (nestedChoice !== null) {
    issue(
      context,
      'Choice bodies cannot contain a nested choice group in the v1 language.',
      nestedChoice.span.start.offset,
      nestedChoice.span.end.offset,
    );
    valid = false;
  }
  if (!valid) {
    return null;
  }
  return Object.freeze({
    kind: 'choice',
    label: context.source.slice(suffixes.labelRange.from, suffixes.labelRange.to),
    labelSpan: context.map.span(suffixes.labelRange.from, suffixes.labelRange.to),
    target: suffixes.target,
    targetSpan: suffixes.targetSpan,
    condition: suffixes.condition,
    conditionSpan: suffixes.conditionSpan,
    contentId: suffixes.contentId,
    contentIdSpan: suffixes.contentIdSpan,
    body: Object.freeze(body),
    headerSpan: context.map.span(line.from, line.to),
    span: context.map.span(node.from, node.to),
  });
}

function validateMarker(
  context: NormalizationContext,
  node: SyntaxNode,
  marker: '@else' | '@end',
): boolean {
  const range = significantLineRange(context, node, 0);
  if (context.source.slice(range.from, range.to) === marker) {
    return true;
  }
  issue(context, `${marker} does not accept arguments.`, range.from, range.to);
  return false;
}

function normalizeConditional(
  context: NormalizationContext,
  node: SyntaxNode,
): StoryConditionalAst | null {
  const header = node.getChild('IfLine');
  const thenBlock = node.getChild('StoryBlock');
  const end = node.getChild('EndLine');
  if (header === null || thenBlock === null || end === null) {
    throw new Error('Expected Conditional to contain @if, a body, and @end.');
  }
  const conditionRange = significantLineRange(context, header, '@if'.length);
  const condition = parseEmbeddedExpression(context, conditionRange);
  const thenBranch = normalizeBlock(context, thenBlock);
  const elseClause = node.getChild('ElseClause');
  let elseBranch: readonly StoryItemAst[] | null = null;
  let elseHeaderSpan: SourceSpan | null = null;
  let markersValid = validateMarker(context, end, '@end');
  if (elseClause !== null) {
    const elseHeader = elseClause.getChild('ElseLine');
    const elseBlock = elseClause.getChild('StoryBlock');
    if (elseHeader === null || elseBlock === null) {
      throw new Error('Expected ElseClause to contain @else and a body.');
    }
    markersValid = validateMarker(context, elseHeader, '@else') && markersValid;
    elseHeaderSpan = context.map.span(elseHeader.from, elseHeader.to);
    elseBranch = Object.freeze(normalizeBlock(context, elseBlock));
  }
  if (condition === null || !markersValid) {
    return null;
  }
  return Object.freeze({
    kind: 'conditional',
    condition,
    conditionSpan: context.map.span(conditionRange.from, conditionRange.to),
    thenBranch: Object.freeze(thenBranch),
    elseBranch,
    headerSpan: context.map.span(header.from, header.to),
    elseHeaderSpan,
    endSpan: context.map.span(end.from, end.to),
    span: context.map.span(node.from, node.to),
  });
}

function normalizeStoryItem(
  context: NormalizationContext,
  wrapper: SyntaxNode,
): StoryItemAst | null {
  const node = wrapper.name === 'SceneItem' ? onlyChild(wrapper) : wrapper;
  switch (node.name) {
    case 'StoryTrivia':
      return normalizeTrivia(context, node);
    case 'Conditional':
      return normalizeConditional(context, node);
    case 'Choice':
      return normalizeChoice(context, node);
    case 'CommandStatement':
      return normalizeCommand(context, node);
    case 'TextStatement':
      return normalizeText(context, node);
    default:
      throw new Error(`Cannot normalize unexpected story item ${node.name}.`);
  }
}

function normalizeItems(
  context: NormalizationContext,
  wrappers: readonly SyntaxNode[],
): StoryItemAst[] {
  const items: StoryItemAst[] = [];
  for (const wrapper of wrappers) {
    const item = normalizeStoryItem(context, wrapper);
    if (item !== null) {
      items.push(item);
    }
  }
  return items;
}

function normalizeBlock(context: NormalizationContext, node: SyntaxNode): StoryItemAst[] {
  return normalizeItems(context, node.getChildren('SceneItem'));
}

function normalizeScene(context: NormalizationContext, node: SyntaxNode): StorySceneAst | null {
  const header = node.getChild('SceneHeaderLine');
  if (header === null) {
    throw new Error('Expected Scene to contain a SceneHeaderLine.');
  }
  const idRange = significantLineRange(context, header, 2);
  const id = parseSceneId(context, idRange);
  const items = normalizeItems(context, node.getChildren('SceneItem'));
  if (id === null) {
    return null;
  }
  return Object.freeze({
    kind: 'scene',
    id,
    idSpan: context.map.span(idRange.from, idRange.to),
    headerSpan: context.map.span(header.from, header.to),
    items: Object.freeze(items),
    span: context.map.span(node.from, node.to),
  });
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

/** Parse a story into stable immutable objects without exposing generated Lezer node shapes. */
export function parseStoryAst(source: string): StoryAstParseResult {
  const syntax = parseStorySyntax(source);
  if (syntax.issues.length > 0) {
    return Object.freeze({ document: null, issues: syntax.issues });
  }

  const context: NormalizationContext = {
    source,
    map: createSourceSpanMap(source),
    issues: [],
  };
  const leadingTrivia = syntax.tree.topNode
    .getChildren('StoryTrivia')
    .map((node) => normalizeTrivia(context, node));
  const scenes: StorySceneAst[] = [];
  for (const node of syntax.tree.topNode.getChildren('Scene')) {
    const scene = normalizeScene(context, node);
    if (scene !== null) {
      scenes.push(scene);
    }
  }
  const issues = finalizeIssues(context.issues);
  if (issues.length > 0) {
    return Object.freeze({ document: null, issues });
  }
  return Object.freeze({
    document: Object.freeze({
      kind: 'story-document',
      hasByteOrderMark: source.charCodeAt(0) === 0xfeff,
      leadingTrivia: Object.freeze(leadingTrivia),
      scenes: Object.freeze(scenes),
      span: context.map.span(0, source.length),
    }),
    issues,
  });
}
