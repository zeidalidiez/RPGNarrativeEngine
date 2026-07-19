import type {
  CompiledChoiceOption,
  CompiledExpression,
  CompiledGame,
  CompiledInline,
  CompiledInstruction,
  CompiledScene,
} from '@rpgnarrativeengine/ir';
import {
  parseExpressionAst,
  parseStoryAst,
  parseStoryQuotedString,
  type ExpressionAst,
  type StoryChoiceAst,
  type StoryCommandAst,
  type StoryInlineAst,
  type StoryItemAst,
} from '@rpgnarrativeengine/language';

export interface CompileIssue {
  readonly code: string;
  readonly message: string;
  readonly from: number;
  readonly to: number;
  readonly path?: string;
}

export class StoryCompileError extends Error {
  readonly issues: readonly CompileIssue[];

  constructor(issues: readonly CompileIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path === undefined ? '' : `${issue.path}: `}${issue.message}`)
        .join('\n'),
    );
    this.name = 'StoryCompileError';
    this.issues = issues;
  }
}

export interface CompileStoryOptions {
  readonly title?: string;
  readonly startSceneId?: string;
}

export interface CompileStorySource {
  readonly path: string;
  readonly source: string;
}

interface CompileSequence {
  value: number;
}

interface CompileContext {
  readonly issues: CompileIssue[];
  readonly references: Array<{
    readonly sceneId: string;
    readonly from: number;
    readonly to: number;
    readonly path: string | null;
  }>;
  readonly sequence: CompileSequence;
  readonly path: string | null;
}

function compileExpression(expression: ExpressionAst): CompiledExpression {
  switch (expression.kind) {
    case 'boolean-literal':
    case 'number-literal':
    case 'string-literal':
      return { kind: 'literal', value: expression.value };
    case 'variable':
      return { kind: 'variable', path: expression.path };
    case 'group':
      return compileExpression(expression.expression);
    case 'unary':
      return {
        kind: 'unary',
        operator: expression.operator,
        operand: compileExpression(expression.operand),
      };
    case 'binary':
      return {
        kind: 'binary',
        operator: expression.operator,
        left: compileExpression(expression.left),
        right: compileExpression(expression.right),
      };
    case 'call':
      return {
        kind: 'call',
        name: expression.callee,
        arguments: expression.arguments.map(compileExpression),
      };
  }
}

function compileInline(node: StoryInlineAst): CompiledInline {
  switch (node.kind) {
    case 'text':
      return { kind: 'text', value: node.value };
    case 'line-break':
      return { kind: 'line-break' };
    case 'interpolation':
      return { kind: 'interpolation', expression: compileExpression(node.expression) };
    case 'emphasis':
    case 'strong':
      return { kind: node.kind, children: node.children.map(compileInline) };
    case 'language':
      return {
        kind: 'language',
        languageTag: node.languageTag,
        children: node.children.map(compileInline),
      };
    case 'pronunciation':
      return {
        kind: 'pronunciation',
        hint: node.hint,
        children: node.children.map(compileInline),
      };
  }
}

function addIssue(
  context: CompileContext,
  message: string,
  from: number,
  to: number,
  code = 'invalid-command',
): void {
  context.issues.push(
    context.path === null
      ? { code, message, from, to }
      : { code, message, from, to, path: context.path },
  );
}

function parseCommandExpression(
  command: StoryCommandAst,
  source: string,
  context: CompileContext,
): CompiledExpression | null {
  const result = parseExpressionAst(source);
  if (result.expression !== null) {
    return compileExpression(result.expression);
  }
  const base = command.argumentsSpan?.start.offset ?? command.headerSpan.start.offset;
  for (const issue of result.issues) {
    addIssue(context, issue.message, base + issue.from, base + issue.to, issue.code);
  }
  return null;
}

function referenceInstruction(
  kind: 'call' | 'goto',
  command: StoryCommandAst,
  context: CompileContext,
): CompiledInstruction[] {
  const sceneId = command.arguments.trim();
  if (sceneId.length === 0 || /\s/u.test(sceneId)) {
    addIssue(
      context,
      `@${kind} expects exactly one scene ID.`,
      command.headerSpan.start.offset,
      command.headerSpan.end.offset,
    );
    return [];
  }
  context.references.push({
    sceneId,
    from: command.argumentsSpan?.start.offset ?? command.headerSpan.start.offset,
    to: command.argumentsSpan?.end.offset ?? command.headerSpan.end.offset,
    path: context.path,
  });
  return [{ kind, sceneId }];
}

function compileCommand(command: StoryCommandAst, context: CompileContext): CompiledInstruction[] {
  const name = String(command.name);
  if (name === 'goto' || name === 'call') {
    return referenceInstruction(name, command, context);
  }
  if (name === 'return') {
    if (command.arguments.length > 0) {
      addIssue(
        context,
        '@return does not accept arguments.',
        command.headerSpan.start.offset,
        command.headerSpan.end.offset,
      );
    }
    return [{ kind: 'return' }];
  }
  if (name === 'set') {
    const match = /^([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/u.exec(
      command.arguments,
    );
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined
    ) {
      addIssue(
        context,
        '@set expects: variable.path = expression (also +=, -=, *=, /=).',
        command.headerSpan.start.offset,
        command.headerSpan.end.offset,
      );
      return [];
    }
    const value = parseCommandExpression(command, match[3], context);
    if (value === null) {
      return [];
    }
    return [
      {
        kind: 'set',
        path: match[1],
        operator: match[2] as '=' | '+=' | '-=' | '*=' | '/=',
        value,
      },
    ];
  }
  if (name === 'ending') {
    const match = /^([^\s]+)(?:\s+("(?:[^"\\]|\\.)*"))?$/u.exec(command.arguments);
    if (match === null || match[1] === undefined) {
      addIssue(
        context,
        '@ending expects: ending-id "Player-facing title".',
        command.headerSpan.start.offset,
        command.headerSpan.end.offset,
      );
      return [];
    }
    let title = match[1];
    if (match[2] !== undefined) {
      try {
        title = parseStoryQuotedString(match[2]);
      } catch (error) {
        addIssue(
          context,
          error instanceof Error ? error.message : 'The ending title is invalid.',
          command.headerSpan.start.offset,
          command.headerSpan.end.offset,
        );
        return [];
      }
    }
    return [{ kind: 'ending', id: match[1], title }];
  }
  return [{ kind: 'effect', name, arguments: command.arguments }];
}

function compileChoice(choice: StoryChoiceAst, context: CompileContext): CompiledChoiceOption {
  const id =
    choice.contentId === null ? `choice-${++context.sequence.value}` : String(choice.contentId);
  const instructions = compileItems(choice.body, context);
  if (choice.target !== null) {
    const sceneId = String(choice.target);
    context.references.push({
      sceneId,
      from: choice.targetSpan?.start.offset ?? choice.headerSpan.start.offset,
      to: choice.targetSpan?.end.offset ?? choice.headerSpan.end.offset,
      path: context.path,
    });
    instructions.push({ kind: 'goto', sceneId });
  }
  return {
    id,
    label: choice.label,
    contentId: choice.contentId === null ? null : String(choice.contentId),
    condition: choice.condition === null ? null : compileExpression(choice.condition),
    instructions,
  };
}

function compileItems(
  items: readonly StoryItemAst[],
  context: CompileContext,
): CompiledInstruction[] {
  const instructions: CompiledInstruction[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined || item.kind === 'trivia') {
      continue;
    }
    if (item.kind === 'choice') {
      const options: CompiledChoiceOption[] = [compileChoice(item, context)];
      let next = index + 1;
      while (next < items.length) {
        const candidate = items[next];
        if (candidate?.kind === 'trivia') {
          next += 1;
          continue;
        }
        if (candidate?.kind !== 'choice') {
          break;
        }
        options.push(compileChoice(candidate, context));
        next += 1;
      }
      instructions.push({ kind: 'choices', options });
      index = next - 1;
      continue;
    }
    if (item.kind === 'text') {
      instructions.push({
        kind: 'say',
        speaker:
          item.speaker === null
            ? null
            : { reference: item.speaker.reference, variant: item.speaker.variant },
        contentId: item.contentId === null ? null : String(item.contentId),
        content: item.inline.map(compileInline),
      });
      continue;
    }
    if (item.kind === 'conditional') {
      instructions.push({
        kind: 'branch',
        condition: compileExpression(item.condition),
        then: compileItems(item.thenBranch, context),
        otherwise: item.elseBranch === null ? [] : compileItems(item.elseBranch, context),
      });
      continue;
    }
    instructions.push(...compileCommand(item, context));
  }
  return instructions;
}

interface InternalStorySource {
  readonly path: string | null;
  readonly source: string;
}

function compileSources(
  sources: readonly InternalStorySource[],
  options: CompileStoryOptions,
): CompiledGame {
  const issues: CompileIssue[] = [];
  const references: CompileContext['references'] = [];
  const sequence: CompileSequence = { value: 0 };
  const documents: Array<{
    readonly path: string | null;
    readonly document: NonNullable<ReturnType<typeof parseStoryAst>['document']>;
  }> = [];
  const paths = new Set<string>();
  for (const input of sources) {
    if (input.path !== null) {
      if (input.path.length === 0) {
        issues.push({
          code: 'invalid-source-path',
          message: 'Compiled story source paths cannot be empty.',
          from: 0,
          to: 0,
        });
        continue;
      }
      if (paths.has(input.path)) {
        issues.push({
          code: 'duplicate-source-path',
          message: `Story source path ${JSON.stringify(input.path)} was provided more than once.`,
          from: 0,
          to: 0,
          path: input.path,
        });
        continue;
      }
      paths.add(input.path);
    }
    const parsed = parseStoryAst(input.source);
    if (parsed.document === null) {
      issues.push(
        ...parsed.issues.map((current): CompileIssue =>
          input.path === null ? { ...current } : { ...current, path: input.path },
        ),
      );
    } else {
      documents.push({ path: input.path, document: parsed.document });
    }
  }
  if (issues.length > 0) throw new StoryCompileError(issues);

  const scenes: Record<string, CompiledScene> = {};
  let firstSceneId = '';
  for (const entry of documents) {
    const context: CompileContext = {
      issues,
      references,
      sequence,
      path: entry.path,
    };
    for (const scene of entry.document.scenes) {
      const id = String(scene.id);
      if (firstSceneId.length === 0) firstSceneId = id;
      if (scenes[id] !== undefined) {
        addIssue(
          context,
          `Scene ${JSON.stringify(id)} is declared more than once across the project.`,
          scene.idSpan.start.offset,
          scene.idSpan.end.offset,
          'duplicate-scene',
        );
        continue;
      }
      scenes[id] = { id, instructions: compileItems(scene.items, context) };
    }
  }

  const startSceneId = options.startSceneId ?? firstSceneId;
  if (startSceneId.length === 0 || scenes[startSceneId] === undefined) {
    issues.push({
      code: 'missing-scene',
      message: `Start scene ${JSON.stringify(startSceneId)} does not exist.`,
      to: 0,
      from: 0,
    });
  }
  for (const reference of references) {
    if (scenes[reference.sceneId] === undefined) {
      issues.push({
        code: 'missing-scene',
        message: `Referenced scene ${JSON.stringify(reference.sceneId)} does not exist.`,
        from: reference.from,
        to: reference.to,
        ...(reference.path === null ? {} : { path: reference.path }),
      });
    }
  }
  if (issues.length > 0) {
    throw new StoryCompileError(issues);
  }

  return {
    format: 'rpg-narrative-engine',
    formatVersion: 1,
    title: options.title ?? 'Untitled Story',
    startSceneId,
    scenes,
  };
}

/** Compile one prose-first `.story` source into the engine's serializable runtime format. */
export function compileStory(source: string, options: CompileStoryOptions = {}): CompiledGame {
  return compileSources([{ path: null, source }], options);
}

/** Compile canonically ordered story files into one project-global scene graph and game payload. */
export function compileStoryProject(
  sources: readonly CompileStorySource[],
  options: CompileStoryOptions = {},
): CompiledGame {
  return compileSources(sources, options);
}
