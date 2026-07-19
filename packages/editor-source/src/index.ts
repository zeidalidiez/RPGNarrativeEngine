import { parseStableId, STABLE_ID_MAX_LENGTH } from '@rpgnarrativeengine/contracts';
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

export interface DuplicateStorySceneOptions {
  readonly from: string;
  readonly to: string;
  readonly targetPath: string;
  readonly retargetSelfReferences?: boolean;
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

function collectContentIds(items: readonly StoryItemAst[], ids: Set<string>): void {
  for (const item of items) {
    if (item.kind === 'text') {
      if (item.contentId !== null) ids.add(String(item.contentId));
    } else if (item.kind === 'choice') {
      if (item.contentId !== null) ids.add(String(item.contentId));
      collectContentIds(item.body, ids);
    } else if (item.kind === 'conditional') {
      collectContentIds(item.thenBranch, ids);
      if (item.elseBranch !== null) collectContentIds(item.elseBranch, ids);
    }
  }
}

function copiedContentId(original: string, used: Set<string>): string {
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? '.copy' : `.copy-${index}`;
    const maximumBaseLength = STABLE_ID_MAX_LENGTH - suffix.length;
    const base = original.slice(0, maximumBaseLength).replace(/[._-]+$/u, '') || 'content';
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) {
      parseStableId<'content'>(candidate);
      used.add(candidate);
      return candidate;
    }
  }
}

function collectCopiedContentIdEdits(
  items: readonly StoryItemAst[],
  used: Set<string>,
  edits: StorySourceEdit[],
): void {
  for (const item of items) {
    if (item.kind === 'text') {
      if (item.contentId !== null && item.contentIdSpan !== null) {
        edits.push({
          from: item.contentIdSpan.start.offset,
          to: item.contentIdSpan.end.offset,
          insert: copiedContentId(String(item.contentId), used),
        });
      }
    } else if (item.kind === 'choice') {
      if (item.contentId !== null && item.contentIdSpan !== null) {
        edits.push({
          from: item.contentIdSpan.start.offset,
          to: item.contentIdSpan.end.offset,
          insert: copiedContentId(String(item.contentId), used),
        });
      }
      collectCopiedContentIdEdits(item.body, used, edits);
    } else if (item.kind === 'conditional') {
      collectCopiedContentIdEdits(item.thenBranch, used, edits);
      if (item.elseBranch !== null) collectCopiedContentIdEdits(item.elseBranch, used, edits);
    }
  }
}

function newlineFor(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function appendSeparator(source: string): string {
  if (source.length === 0) return '';
  const newline = newlineFor(source);
  if (source.endsWith(`${newline}${newline}`)) return '';
  return source.endsWith(newline) ? newline : `${newline}${newline}`;
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

/**
 * Copy a complete scene into a selected story file. Content IDs receive deterministic unique copy
 * suffixes. Self-references can optionally follow the duplicate while all other references remain
 * unchanged.
 */
export function duplicateStoryScene(
  files: readonly EditableStorySourceFile[],
  options: DuplicateStorySceneOptions,
): readonly StorySourceFileUpdate[] {
  try {
    parseStableId<'scene'>(options.to);
  } catch (error) {
    throw new StorySourceEditError(
      error instanceof Error ? error.message : 'The duplicate scene ID is invalid.',
    );
  }

  const parsed = files.map((file) => {
    const result = parseStoryAst(file.source);
    if (result.document === null || result.issues.length > 0) {
      throw new StorySourceEditError(
        `Cannot duplicate scenes while ${file.path} has a source problem: ${result.issues[0]?.message ?? 'invalid story source'}`,
        result.issues,
      );
    }
    return { file, document: result.document };
  });
  const declarations = parsed.flatMap(({ file, document }) =>
    document.scenes
      .filter((scene) => String(scene.id) === options.from)
      .map((scene) => ({ file, scene })),
  );
  if (declarations.length !== 1) {
    throw new StorySourceEditError(
      declarations.length === 0
        ? `Scene ${options.from} does not exist.`
        : `Scene ${options.from} is declared more than once. Resolve the duplicate before copying it.`,
    );
  }
  if (
    parsed.some(({ document }) => document.scenes.some((scene) => String(scene.id) === options.to))
  ) {
    throw new StorySourceEditError(`Scene ${options.to} already exists.`);
  }
  const target = parsed.find(({ file }) => file.path === options.targetPath);
  if (target === undefined) {
    throw new StorySourceEditError(`Story file ${options.targetPath} is not open.`);
  }

  const declaration = declarations[0]!;
  const scene = declaration.scene;
  const edits: StorySourceEdit[] = [
    { from: scene.idSpan.start.offset, to: scene.idSpan.end.offset, insert: options.to },
  ];
  if (options.retargetSelfReferences !== false) {
    collectSceneReferenceEdits(scene.items, options.from, options.to, edits);
  }
  const usedContentIds = new Set<string>();
  for (const { document } of parsed) {
    for (const current of document.scenes) collectContentIds(current.items, usedContentIds);
  }
  collectCopiedContentIdEdits(scene.items, usedContentIds, edits);

  const sceneStart = scene.span.start.offset;
  const rawScene = declaration.file.source.slice(sceneStart, scene.span.end.offset);
  const duplicate = applyStorySourceEdits(
    rawScene,
    edits.map((edit) => ({
      from: edit.from - sceneStart,
      to: edit.to - sceneStart,
      insert: edit.insert,
    })),
  ).source;
  const source = `${target.file.source}${appendSeparator(target.file.source)}${duplicate}`;
  const validated = parseStoryAst(source);
  if (validated.document === null || validated.issues.length > 0) {
    throw new StorySourceEditError(
      validated.issues[0]?.message ?? 'The duplicate scene would create invalid story source.',
      validated.issues,
    );
  }
  return Object.freeze([Object.freeze({ path: target.file.path, source })]);
}

/** Remove one scene and redirect every surviving reference to a declared replacement scene. */
export function deleteStoryScene(
  files: readonly EditableStorySourceFile[],
  sceneId: string,
  replacementId: string,
): readonly StorySourceFileUpdate[] {
  if (sceneId === replacementId) {
    throw new StorySourceEditError('Choose a different scene as the replacement destination.');
  }
  const parsed = files.map((file) => {
    const result = parseStoryAst(file.source);
    if (result.document === null || result.issues.length > 0) {
      throw new StorySourceEditError(
        `Cannot delete scenes while ${file.path} has a source problem: ${result.issues[0]?.message ?? 'invalid story source'}`,
        result.issues,
      );
    }
    return { file, document: result.document };
  });
  const sceneCount = parsed.reduce(
    (count, { document }) =>
      count + document.scenes.filter((scene) => String(scene.id) === sceneId).length,
    0,
  );
  const replacementCount = parsed.reduce(
    (count, { document }) =>
      count + document.scenes.filter((scene) => String(scene.id) === replacementId).length,
    0,
  );
  if (sceneCount !== 1) {
    throw new StorySourceEditError(
      sceneCount === 0
        ? `Scene ${sceneId} does not exist.`
        : `Scene ${sceneId} is declared more than once. Resolve the duplicate before deleting it.`,
    );
  }
  if (replacementCount !== 1) {
    throw new StorySourceEditError(
      replacementCount === 0
        ? `Replacement scene ${replacementId} does not exist.`
        : `Replacement scene ${replacementId} is declared more than once.`,
    );
  }

  const updates: StorySourceFileUpdate[] = [];
  for (const { file, document } of parsed) {
    const edits: StorySourceEdit[] = [];
    for (const scene of document.scenes) {
      if (String(scene.id) === sceneId) {
        edits.push({ from: scene.span.start.offset, to: scene.span.end.offset, insert: '' });
      } else {
        collectSceneReferenceEdits(scene.items, sceneId, replacementId, edits);
      }
    }
    if (edits.length > 0) {
      updates.push({ path: file.path, source: applyStorySourceEdits(file.source, edits).source });
    }
  }
  return Object.freeze(updates.map((update) => Object.freeze(update)));
}
