import { parseStableId } from '@rpgnarrativeengine/contracts';
import {
  parseStoryAst,
  type StoryAstParseResult,
  type StoryCommandAst,
  type StoryDocumentAst,
  type StoryItemAst,
} from '@rpgnarrativeengine/language';

export type {
  ExpressionAst,
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

export interface EditableStorySourceFile {
  readonly path: string;
  readonly source: string;
}

export interface StorySourceFileUpdate {
  readonly path: string;
  readonly source: string;
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
  return applyStorySourceEdits(source, [edit]);
}

/** Apply ordered, non-overlapping replacements as one validated source transaction. */
export function applyStorySourceEdits(
  source: string,
  edits: readonly StorySourceEdit[],
): StorySourceEditResult {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousEnd = -1;
  for (const edit of ordered) {
    if (
      !validOffset(edit.from, source.length) ||
      !validOffset(edit.to, source.length) ||
      edit.to < edit.from ||
      edit.from < previousEnd
    ) {
      throw new StorySourceEditError(
        'The visual edit contains an invalid or overlapping source range.',
      );
    }
    previousEnd = edit.to;
  }

  let nextSource = source;
  for (const edit of ordered.reverse()) {
    nextSource = nextSource.slice(0, edit.from) + edit.insert + nextSource.slice(edit.to);
  }
  const parsed = parseStoryAst(nextSource);
  if (parsed.document === null || parsed.issues.length > 0) {
    throw new StorySourceEditError(
      parsed.issues[0]?.message ?? 'The visual edit would create invalid story source.',
      parsed.issues,
    );
  }
  return Object.freeze({ source: nextSource, document: parsed.document });
}

function collectSceneReferenceEdits(
  items: readonly StoryItemAst[],
  from: string,
  to: string,
  edits: StorySourceEdit[],
): void {
  for (const item of items) {
    if (item.kind === 'choice') {
      if (String(item.target ?? '') === from && item.targetSpan !== null) {
        edits.push({
          from: item.targetSpan.start.offset,
          to: item.targetSpan.end.offset,
          insert: to,
        });
      }
      collectSceneReferenceEdits(item.body, from, to, edits);
    } else if (item.kind === 'conditional') {
      collectSceneReferenceEdits(item.thenBranch, from, to, edits);
      if (item.elseBranch !== null) collectSceneReferenceEdits(item.elseBranch, from, to, edits);
    } else if (item.kind === 'command') {
      collectCommandReferenceEdit(item, from, to, edits);
    }
  }
}

function collectCommandReferenceEdit(
  item: StoryCommandAst,
  from: string,
  to: string,
  edits: StorySourceEdit[],
): void {
  const command = String(item.name);
  if (
    (command === 'goto' || command === 'call') &&
    item.arguments.trim() === from &&
    item.argumentsSpan !== null
  ) {
    edits.push({
      from: item.argumentsSpan.start.offset,
      to: item.argumentsSpan.end.offset,
      insert: to,
    });
  }
}

/**
 * Rename one declared scene and every story-language reference to it across open files. All files
 * are parsed and transformed before any result is returned, so callers can commit the updates as
 * one project transaction. Project-manifest entry-scene replacement remains a host responsibility.
 */
export function renameStoryScene(
  files: readonly EditableStorySourceFile[],
  from: string,
  to: string,
): readonly StorySourceFileUpdate[] {
  if (from === to) return Object.freeze([]);
  try {
    parseStableId<'scene'>(to);
  } catch (error) {
    throw new StorySourceEditError(
      error instanceof Error ? error.message : 'The new scene ID is invalid.',
    );
  }

  const parsed = files.map((file) => {
    const result = parseStoryAst(file.source);
    if (result.document === null || result.issues.length > 0) {
      throw new StorySourceEditError(
        `Cannot rename scenes while ${file.path} has a source problem: ${result.issues[0]?.message ?? 'invalid story source'}`,
        result.issues,
      );
    }
    return { file, document: result.document };
  });
  const declarations = parsed.flatMap(({ file, document }) =>
    document.scenes.filter((scene) => String(scene.id) === from).map((scene) => ({ file, scene })),
  );
  if (declarations.length !== 1) {
    throw new StorySourceEditError(
      declarations.length === 0
        ? `Scene ${from} does not exist.`
        : `Scene ${from} is declared more than once. Resolve the duplicate before renaming it.`,
    );
  }
  if (parsed.some(({ document }) => document.scenes.some((scene) => String(scene.id) === to))) {
    throw new StorySourceEditError(`Scene ${to} already exists.`);
  }

  const updates: StorySourceFileUpdate[] = [];
  for (const { file, document } of parsed) {
    const edits: StorySourceEdit[] = [];
    for (const scene of document.scenes) {
      if (String(scene.id) === from) {
        edits.push({ from: scene.idSpan.start.offset, to: scene.idSpan.end.offset, insert: to });
      }
      collectSceneReferenceEdits(scene.items, from, to, edits);
    }
    if (edits.length > 0) {
      updates.push({ path: file.path, source: applyStorySourceEdits(file.source, edits).source });
    }
  }
  return Object.freeze(updates.map((update) => Object.freeze(update)));
}
