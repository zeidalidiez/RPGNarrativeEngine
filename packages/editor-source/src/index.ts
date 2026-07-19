import {
  parseStoryAst,
  type StoryAstParseResult,
  type StoryDocumentAst,
} from '@rpgnarrativeengine/language';

export type {
  StoryChoiceAst,
  StoryCommandAst,
  StoryConditionalAst,
  StoryDocumentAst,
  StoryItemAst,
  StorySceneAst,
  StoryTextAst,
} from '@rpgnarrativeengine/language';

export interface StorySourceEdit {
  /** Inclusive UTF-16 offset in the current source. */
  readonly from: number;
  /** Exclusive UTF-16 offset in the current source. */
  readonly to: number;
  readonly insert: string;
}

export interface StorySourceEditResult {
  readonly source: string;
  readonly document: StoryDocumentAst;
}

export class StorySourceEditError extends Error {
  readonly issues: StoryAstParseResult['issues'];

  constructor(message: string, issues: StoryAstParseResult['issues'] = []) {
    super(message);
    this.name = 'StorySourceEditError';
    this.issues = issues;
  }
}

function validOffset(value: number, sourceLength: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= sourceLength;
}

/** Parse the canonical source used to populate structured editor controls. */
export function parseEditableStory(source: string): StoryAstParseResult {
  return parseStoryAst(source);
}

/**
 * Apply one minimal source replacement and reject it atomically if the resulting story cannot be
 * normalized. Callers keep the old source when this throws, so a failed visual edit cannot corrupt
 * the in-memory project.
 */
export function applyStorySourceEdit(source: string, edit: StorySourceEdit): StorySourceEditResult {
  if (
    !validOffset(edit.from, source.length) ||
    !validOffset(edit.to, source.length) ||
    edit.to < edit.from
  ) {
    throw new StorySourceEditError('The visual edit refers to an invalid source range.');
  }

  const nextSource = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
  const parsed = parseStoryAst(nextSource);
  if (parsed.document === null || parsed.issues.length > 0) {
    throw new StorySourceEditError(
      parsed.issues[0]?.message ?? 'The visual edit would create invalid story source.',
      parsed.issues,
    );
  }
  return Object.freeze({ source: nextSource, document: parsed.document });
}
