import { ContextTracker, ExternalTokenizer, type InputStream, type Stack } from '@lezer/lr';

import {
  blankLine,
  commentLine,
  dedent,
  ElseLine,
  EndLine,
  IfLine,
  indent,
  invalidIndent,
} from './story-parser.generated.terms.js';

const CHARACTER_EOF = -1;
const CHARACTER_CARRIAGE_RETURN = 13;
const CHARACTER_LINE_FEED = 10;
const CHARACTER_SLASH = 47;
const CHARACTER_SPACE = 32;
const CHARACTER_TAB = 9;

class IndentLevel {
  readonly parent: IndentLevel | null;
  readonly depth: number;
  readonly hash: number;

  constructor(parent: IndentLevel | null, depth: number) {
    this.parent = parent;
    this.depth = depth;
    this.hash = ((parent?.hash ?? 0) * 33 + depth) | 0;
  }
}

export const trackIndent = new ContextTracker<IndentLevel>({
  start: new IndentLevel(null, 0),
  shift(context, term, stack, input) {
    if (term === indent || term === invalidIndent) {
      return new IndentLevel(context, stack.pos - input.pos);
    }
    if (term === dedent) {
      return context.parent ?? context;
    }
    return context;
  },
  hash: (context) => context.hash,
});

function isPhysicalLineStart(previous: number): boolean {
  return previous === CHARACTER_EOF || previous === CHARACTER_LINE_FEED;
}

function scanToPhysicalLineEnd(input: InputStream): void {
  while (
    input.next !== CHARACTER_EOF &&
    input.next !== CHARACTER_CARRIAGE_RETURN &&
    input.next !== CHARACTER_LINE_FEED
  ) {
    input.advance();
  }
}

export const indentation = new ExternalTokenizer((input, stack) => {
  if (!isPhysicalLineStart(input.peek(-1))) {
    return;
  }

  let spaces = 0;
  let containsTab = false;
  while (input.next === CHARACTER_SPACE || input.next === CHARACTER_TAB) {
    containsTab ||= input.next === CHARACTER_TAB;
    spaces += 1;
    input.advance();
  }

  const startsComment = input.next === CHARACTER_SLASH && input.peek(1) === CHARACTER_SLASH;
  const isBlank = input.next === CHARACTER_CARRIAGE_RETURN || input.next === CHARACTER_LINE_FEED;

  if (startsComment && stack.canShift(commentLine)) {
    scanToPhysicalLineEnd(input);
    input.acceptToken(commentLine);
    return;
  }
  if (isBlank && stack.canShift(blankLine)) {
    input.acceptToken(blankLine);
    return;
  }
  if (input.next === CHARACTER_EOF) {
    if (spaces > 0 && stack.canShift(blankLine)) {
      input.acceptToken(blankLine);
    }
    return;
  }

  const context = stack.context as IndentLevel;
  if (spaces > context.depth) {
    const valid = !containsTab && spaces === context.depth + 2;
    const term = valid ? indent : invalidIndent;
    if (stack.canShift(term)) {
      input.acceptToken(term);
    }
  } else if (spaces < context.depth && stack.canShift(dedent)) {
    input.acceptToken(dedent, -spaces);
  }
});

export function specializeCommand(value: string, stack: Stack): number {
  void stack;
  if (/^@if(?:[ \t]|$)/u.test(value)) {
    return IfLine;
  }
  if (/^@else(?:[ \t]|$)/u.test(value)) {
    return ElseLine;
  }
  if (/^@end(?:[ \t]|$)/u.test(value)) {
    return EndLine;
  }
  return -1;
}
