import type {
  CompiledChoiceOption,
  CompiledExpression,
  CompiledGame,
  CompiledInline,
  CompiledInstruction,
  CompiledSpeaker,
  EffectInstruction,
  NarrativeValue,
} from '@rpgnarrativeengine/ir';

import {
  DEFAULT_RANDOM_SEED,
  NamedRandom,
  parseNamedRandomSnapshot,
  parseRandomSeed,
  type NamedRandomSnapshot,
  type RandomSeed,
} from './random.js';

export {
  DEFAULT_RANDOM_SEED,
  RANDOM_ALGORITHM,
  RANDOM_ALGORITHM_VERSION,
  RANDOM_SNAPSHOT_FORMAT,
  RANDOM_SNAPSHOT_VERSION,
  DeterministicRandomError,
  NamedRandom,
  isRandomStreamName,
  parseNamedRandomSnapshot,
  parseRandomSeed,
  type NamedRandomSnapshot,
  type RandomSeed,
  type RandomStreamSnapshot,
} from './random.js';

export type ResolvedInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'line-break' }
  | { readonly kind: 'emphasis'; readonly children: readonly ResolvedInline[] }
  | { readonly kind: 'strong'; readonly children: readonly ResolvedInline[] }
  | {
      readonly kind: 'language';
      readonly languageTag: string;
      readonly children: readonly ResolvedInline[];
    }
  | {
      readonly kind: 'pronunciation';
      readonly hint: string;
      readonly children: readonly ResolvedInline[];
    };

export interface RuntimeTextView {
  readonly kind: 'text';
  readonly sceneId: string;
  readonly speaker: CompiledSpeaker | null;
  readonly contentId: string | null;
  readonly content: readonly ResolvedInline[];
  readonly plainText: string;
}

export interface RuntimeChoiceView {
  readonly kind: 'choice';
  readonly sceneId: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

export interface RuntimeEndingView {
  readonly kind: 'ending';
  readonly sceneId: string;
  readonly id: string;
  readonly title: string;
}

export type RuntimeView = RuntimeChoiceView | RuntimeEndingView | RuntimeTextView;

export type RuntimeInstructionBlockStep =
  | {
      readonly kind: 'branch';
      readonly instructionIndex: number;
      readonly arm: 'otherwise' | 'then';
    }
  | {
      readonly kind: 'choice';
      readonly instructionIndex: number;
      readonly optionId: string;
    };

export interface RuntimeInstructionBlockReference {
  readonly sceneId: string;
  readonly path: readonly RuntimeInstructionBlockStep[];
}

export interface RuntimeFrameSave {
  readonly block: RuntimeInstructionBlockReference;
  readonly index: number;
}

export interface RuntimeCallSave {
  readonly sceneId: string;
  readonly frames: readonly RuntimeFrameSave[];
}

/** Versioned, host-neutral state captured only while the runtime is suspended at a player view. */
export interface NarrativeSave {
  readonly format: 'rpg-narrative-engine-save';
  readonly formatVersion: 1;
  readonly game: {
    readonly buildIdentity: string;
    readonly formatVersion: 1;
  };
  readonly state: {
    readonly sceneId: string;
    readonly variables: Readonly<Record<string, NarrativeValue>>;
    readonly frames: readonly RuntimeFrameSave[];
    readonly calls: readonly RuntimeCallSave[];
    readonly view: RuntimeView;
    readonly pendingChoiceIds: readonly string[];
    readonly random: NamedRandomSnapshot;
  };
}

export interface RuntimeOptions {
  readonly initialVariables?: Readonly<Record<string, NarrativeValue>>;
  readonly onEffect?: (effect: EffectInstruction) => void;
  readonly stepBudget?: number;
  /** Exact canonical game-bundle hash used to reject saves from another build. */
  readonly buildIdentity?: string;
  /** Canonical 128-bit seed; hosts may generate one once at the start of a new playthrough. */
  readonly randomSeed?: string;
}

interface Frame {
  readonly instructions: readonly CompiledInstruction[];
  readonly block: RuntimeInstructionBlockReference;
  index: number;
}

interface CallContinuation {
  readonly sceneId: string;
  readonly frames: Frame[];
}

interface PendingChoiceContext {
  readonly block: RuntimeInstructionBlockReference;
  readonly instructionIndex: number;
}

export class NarrativeRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrativeRuntimeError';
  }
}

function requireBoolean(value: NarrativeValue, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new NarrativeRuntimeError(`${context} requires a boolean; received ${typeof value}.`);
  }
  return value;
}

function requireNumber(value: NarrativeValue, context: string): number {
  if (typeof value !== 'number') {
    throw new NarrativeRuntimeError(`${context} requires a number; received ${typeof value}.`);
  }
  return value;
}

function callFunction(
  name: string,
  values: readonly NarrativeValue[],
  random: NamedRandom,
): NarrativeValue {
  const numbers = (): number[] => values.map((value) => requireNumber(value, `Function ${name}`));
  if (name === 'min' || name === 'max') {
    const operands = numbers();
    if (operands.length === 0) {
      throw new NarrativeRuntimeError(`Function ${name} expects at least one argument.`);
    }
    return name === 'min' ? Math.min(...operands) : Math.max(...operands);
  }
  if (name === 'round') {
    if (values.length !== 1) {
      throw new NarrativeRuntimeError('Function round expects one argument.');
    }
    return Math.round(requireNumber(values[0]!, 'Function round'));
  }
  if (name === 'clamp') {
    if (values.length !== 3) {
      throw new NarrativeRuntimeError('Function clamp expects three arguments.');
    }
    const [value, minimum, maximum] = numbers();
    if (
      value === undefined ||
      minimum === undefined ||
      maximum === undefined ||
      minimum > maximum
    ) {
      throw new NarrativeRuntimeError(
        'Function clamp expects value, minimum, maximum with minimum <= maximum.',
      );
    }
    return Math.min(Math.max(value, minimum), maximum);
  }
  if (name === 'length') {
    if (values.length !== 1 || typeof values[0] !== 'string') {
      throw new NarrativeRuntimeError('Function length expects one string argument.');
    }
    return [...values[0]].length;
  }
  if (name === 'random') {
    if (values.length === 0) return random.nextFloat('story');
    if (values.length !== 2) {
      throw new NarrativeRuntimeError('Function random expects zero or two arguments.');
    }
    const minimum = requireNumber(values[0]!, 'Function random');
    const maximum = requireNumber(values[1]!, 'Function random');
    const span = maximum - minimum;
    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum >= maximum ||
      !Number.isFinite(span)
    ) {
      throw new NarrativeRuntimeError(
        'Function random expects finite minimum and before values with minimum < before.',
      );
    }
    return random.range('story', minimum, maximum);
  }
  throw new NarrativeRuntimeError(`Unknown expression function ${JSON.stringify(name)}.`);
}

function plainText(nodes: readonly ResolvedInline[]): string {
  let value = '';
  for (const node of nodes) {
    value +=
      node.kind === 'text'
        ? node.value
        : node.kind === 'line-break'
          ? '\n'
          : plainText(node.children);
  }
  return value;
}

const BUILD_IDENTITY_PATTERN = /^[a-f0-9]{64}$/u;
const VARIABLE_PATH_PATTERN = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*$/u;
const MAX_SAVE_JSON_LENGTH = 8 * 1024 * 1024;
const MAX_SAVE_COLLECTION_LENGTH = 10_000;
const MAX_SAVE_STACK_DEPTH = 256;
const MAX_SAVE_STRING_LENGTH = 1_000_000;
const MAX_INLINE_DEPTH = 64;

function invalidSave(message: string): never {
  throw new NarrativeRuntimeError(`Invalid save: ${message}`);
}

function saveRecord(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidSave(`${context} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function saveArray(value: unknown, context: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) return invalidSave(`${context} must be an array.`);
  if (value.length > maximum) return invalidSave(`${context} is too large.`);
  return value;
}

function saveString(value: unknown, context: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    return invalidSave(`${context} must be ${allowEmpty ? 'a string' : 'a nonempty string'}.`);
  }
  if (value.length > MAX_SAVE_STRING_LENGTH) return invalidSave(`${context} is too long.`);
  return value;
}

function nullableSaveString(value: unknown, context: string): string | null {
  return value === null ? null : saveString(value, context, true);
}

function saveInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidSave(`${context} must be a nonnegative safe integer.`);
  }
  return value;
}

function saveNarrativeValue(value: unknown, context: string): NarrativeValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidSave(`${context} must be finite.`);
    return value;
  }
  return saveString(value, context, true);
}

function parseSaveVariables(value: unknown): Readonly<Record<string, NarrativeValue>> {
  const record = saveRecord(value, 'state.variables');
  const keys = Object.keys(record);
  if (keys.length > MAX_SAVE_COLLECTION_LENGTH) return invalidSave('state.variables is too large.');
  const variables = Object.create(null) as Record<string, NarrativeValue>;
  for (const key of keys) {
    if (!VARIABLE_PATH_PATTERN.test(key)) {
      return invalidSave(`state variable ${JSON.stringify(key)} is not a valid variable path.`);
    }
    variables[key] = saveNarrativeValue(record[key], `state.variables.${key}`);
  }
  return Object.freeze(variables);
}

function parseBlockStep(value: unknown, context: string): RuntimeInstructionBlockStep {
  const record = saveRecord(value, context);
  const kind = record['kind'];
  const instructionIndex = saveInteger(record['instructionIndex'], `${context}.instructionIndex`);
  if (kind === 'branch') {
    const arm = record['arm'];
    if (arm !== 'then' && arm !== 'otherwise') {
      return invalidSave(`${context}.arm must be "then" or "otherwise".`);
    }
    return Object.freeze({ kind, instructionIndex, arm });
  }
  if (kind === 'choice') {
    return Object.freeze({
      kind,
      instructionIndex,
      optionId: saveString(record['optionId'], `${context}.optionId`),
    });
  }
  return invalidSave(`${context}.kind is unsupported.`);
}

function parseBlockReference(value: unknown, context: string): RuntimeInstructionBlockReference {
  const record = saveRecord(value, context);
  const path = saveArray(record['path'], `${context}.path`, MAX_SAVE_STACK_DEPTH).map(
    (step, index) => parseBlockStep(step, `${context}.path[${index}]`),
  );
  return Object.freeze({
    sceneId: saveString(record['sceneId'], `${context}.sceneId`),
    path: Object.freeze(path),
  });
}

function parseFrameSave(value: unknown, context: string): RuntimeFrameSave {
  const record = saveRecord(value, context);
  return Object.freeze({
    block: parseBlockReference(record['block'], `${context}.block`),
    index: saveInteger(record['index'], `${context}.index`),
  });
}

function parseFrameSaves(value: unknown, context: string): readonly RuntimeFrameSave[] {
  return Object.freeze(
    saveArray(value, context, MAX_SAVE_STACK_DEPTH).map((frame, index) =>
      parseFrameSave(frame, `${context}[${index}]`),
    ),
  );
}

function parseResolvedInline(value: unknown, context: string, depth: number): ResolvedInline {
  if (depth > MAX_INLINE_DEPTH) return invalidSave(`${context} is nested too deeply.`);
  const record = saveRecord(value, context);
  const kind = record['kind'];
  if (kind === 'text') {
    return Object.freeze({ kind, value: saveString(record['value'], `${context}.value`, true) });
  }
  if (kind === 'line-break') return Object.freeze({ kind });
  const children = Object.freeze(
    saveArray(record['children'], `${context}.children`, MAX_SAVE_COLLECTION_LENGTH).map(
      (child, index) => parseResolvedInline(child, `${context}.children[${index}]`, depth + 1),
    ),
  );
  if (kind === 'emphasis' || kind === 'strong') return Object.freeze({ kind, children });
  if (kind === 'language') {
    return Object.freeze({
      kind,
      languageTag: saveString(record['languageTag'], `${context}.languageTag`),
      children,
    });
  }
  if (kind === 'pronunciation') {
    return Object.freeze({
      kind,
      hint: saveString(record['hint'], `${context}.hint`),
      children,
    });
  }
  return invalidSave(`${context}.kind is unsupported.`);
}

function parseSaveView(value: unknown): RuntimeView {
  const record = saveRecord(value, 'state.view');
  const kind = record['kind'];
  const sceneId = saveString(record['sceneId'], 'state.view.sceneId');
  if (kind === 'text') {
    const speakerValue = record['speaker'];
    let speaker: CompiledSpeaker | null = null;
    if (speakerValue !== null) {
      const speakerRecord = saveRecord(speakerValue, 'state.view.speaker');
      speaker = Object.freeze({
        reference: saveString(speakerRecord['reference'], 'state.view.speaker.reference'),
        variant: nullableSaveString(speakerRecord['variant'], 'state.view.speaker.variant'),
      });
    }
    const content = Object.freeze(
      saveArray(record['content'], 'state.view.content', MAX_SAVE_COLLECTION_LENGTH).map(
        (node, index) => parseResolvedInline(node, `state.view.content[${index}]`, 0),
      ),
    );
    const expectedPlainText = plainText(content);
    const savedPlainText = saveString(record['plainText'], 'state.view.plainText', true);
    if (savedPlainText !== expectedPlainText) {
      return invalidSave('state.view.plainText does not match its resolved content.');
    }
    return Object.freeze({
      kind,
      sceneId,
      speaker,
      contentId: nullableSaveString(record['contentId'], 'state.view.contentId'),
      content,
      plainText: savedPlainText,
    });
  }
  if (kind === 'choice') {
    const seen = new Set<string>();
    const options = Object.freeze(
      saveArray(record['options'], 'state.view.options', MAX_SAVE_COLLECTION_LENGTH).map(
        (option, index) => {
          const optionRecord = saveRecord(option, `state.view.options[${index}]`);
          const id = saveString(optionRecord['id'], `state.view.options[${index}].id`);
          if (seen.has(id)) return invalidSave(`state.view contains duplicate choice ${id}.`);
          seen.add(id);
          return Object.freeze({
            id,
            label: saveString(optionRecord['label'], `state.view.options[${index}].label`, true),
          });
        },
      ),
    );
    return Object.freeze({ kind, sceneId, options });
  }
  if (kind === 'ending') {
    return Object.freeze({
      kind,
      sceneId,
      id: saveString(record['id'], 'state.view.id'),
      title: saveString(record['title'], 'state.view.title', true),
    });
  }
  return invalidSave('state.view.kind is unsupported.');
}

/** Parse and bound-check imported JSON before it is allowed near live runtime state. */
export function parseNarrativeSave(input: unknown): NarrativeSave {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > MAX_SAVE_JSON_LENGTH) return invalidSave('JSON input is too large.');
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return invalidSave('input is not valid JSON.');
    }
  }
  const root = saveRecord(value, 'save');
  if (root['format'] !== 'rpg-narrative-engine-save') {
    return invalidSave('format is unsupported.');
  }
  if (root['formatVersion'] !== 1) return invalidSave('formatVersion is unsupported.');
  const game = saveRecord(root['game'], 'game');
  const buildIdentity = saveString(game['buildIdentity'], 'game.buildIdentity');
  if (!BUILD_IDENTITY_PATTERN.test(buildIdentity)) {
    return invalidSave('game.buildIdentity must be a lowercase SHA-256 hash.');
  }
  if (game['formatVersion'] !== 1) return invalidSave('game.formatVersion is unsupported.');
  const state = saveRecord(root['state'], 'state');
  const calls = Object.freeze(
    saveArray(state['calls'], 'state.calls', MAX_SAVE_STACK_DEPTH).map((call, index) => {
      const record = saveRecord(call, `state.calls[${index}]`);
      return Object.freeze({
        sceneId: saveString(record['sceneId'], `state.calls[${index}].sceneId`),
        frames: parseFrameSaves(record['frames'], `state.calls[${index}].frames`),
      });
    }),
  );
  const pendingChoiceIds = Object.freeze(
    saveArray(state['pendingChoiceIds'], 'state.pendingChoiceIds', MAX_SAVE_COLLECTION_LENGTH).map(
      (id, index) => saveString(id, `state.pendingChoiceIds[${index}]`),
    ),
  );
  return Object.freeze({
    format: 'rpg-narrative-engine-save',
    formatVersion: 1,
    game: Object.freeze({ buildIdentity, formatVersion: 1 }),
    state: Object.freeze({
      sceneId: saveString(state['sceneId'], 'state.sceneId'),
      variables: parseSaveVariables(state['variables']),
      frames: parseFrameSaves(state['frames'], 'state.frames'),
      calls,
      view: parseSaveView(state['view']),
      pendingChoiceIds,
      random:
        state['random'] === undefined
          ? new NamedRandom(buildIdentity.slice(0, 32)).snapshot()
          : parseNamedRandomSnapshot(state['random']),
    }),
  });
}

/** Deterministic, UI-independent interpreter for compiled narrative games. */
export class NarrativeRuntime {
  readonly game: CompiledGame;
  readonly variables: Record<string, NarrativeValue>;
  readonly random: NamedRandom;

  private readonly initialVariables: Readonly<Record<string, NarrativeValue>>;
  private readonly initialRandomSeed: RandomSeed;
  private readonly onEffect: ((effect: EffectInstruction) => void) | undefined;
  private readonly stepBudget: number;
  private readonly buildIdentity: string | undefined;
  private frames: Frame[] = [];
  private calls: CallContinuation[] = [];
  private currentSceneId = '';
  private currentView: RuntimeView | null = null;
  private pendingChoices: readonly CompiledChoiceOption[] = [];
  private pendingChoiceContext: PendingChoiceContext | null = null;

  constructor(game: CompiledGame, options: RuntimeOptions = {}) {
    this.game = game;
    this.initialVariables = { ...options.initialVariables };
    this.variables = Object.create(null) as Record<string, NarrativeValue>;
    this.onEffect = options.onEffect;
    this.stepBudget = options.stepBudget ?? 10_000;
    if (
      options.buildIdentity !== undefined &&
      !BUILD_IDENTITY_PATTERN.test(options.buildIdentity)
    ) {
      throw new NarrativeRuntimeError('Runtime buildIdentity must be a lowercase SHA-256 hash.');
    }
    this.buildIdentity = options.buildIdentity;
    this.initialRandomSeed = parseRandomSeed(
      options.randomSeed ?? options.buildIdentity?.slice(0, 32) ?? DEFAULT_RANDOM_SEED,
    );
    this.random = new NamedRandom(this.initialRandomSeed);
    this.restart();
  }

  get view(): RuntimeView {
    if (this.currentView === null) {
      throw new NarrativeRuntimeError('The runtime has no player-facing view.');
    }
    return this.currentView;
  }

  get sceneId(): string {
    return this.currentSceneId;
  }

  restart(): RuntimeView {
    this.frames = [];
    this.calls = [];
    this.currentView = null;
    this.pendingChoices = [];
    this.pendingChoiceContext = null;
    this.currentSceneId = '';
    for (const key of Object.keys(this.variables)) {
      delete this.variables[key];
    }
    Object.assign(this.variables, this.initialVariables);
    this.random.reset(this.initialRandomSeed);
    this.enterScene(this.game.startSceneId);
    this.advance();
    return this.view;
  }

  continue(): RuntimeView {
    if (this.currentView?.kind !== 'text') {
      throw new NarrativeRuntimeError('The story can only continue while a text beat is visible.');
    }
    this.currentView = null;
    this.advance();
    return this.view;
  }

  choose(optionId: string): RuntimeView {
    if (this.currentView?.kind !== 'choice') {
      throw new NarrativeRuntimeError('A choice can only be selected while choices are visible.');
    }
    const option = this.pendingChoices.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      throw new NarrativeRuntimeError(
        `Choice ${JSON.stringify(optionId)} is not currently available.`,
      );
    }
    this.currentView = null;
    this.pendingChoices = [];
    const context = this.pendingChoiceContext;
    this.pendingChoiceContext = null;
    if (option.instructions.length > 0) {
      if (context === null) {
        throw new NarrativeRuntimeError('The active choice has no execution location.');
      }
      this.frames.push({
        instructions: option.instructions,
        block: Object.freeze({
          sceneId: context.block.sceneId,
          path: Object.freeze([
            ...context.block.path,
            Object.freeze({
              kind: 'choice' as const,
              instructionIndex: context.instructionIndex,
              optionId: option.id,
            }),
          ]),
        }),
        index: 0,
      });
    }
    this.advance();
    return this.view;
  }

  snapshotVariables(): Readonly<Record<string, NarrativeValue>> {
    return Object.freeze({ ...this.variables });
  }

  createSave(): NarrativeSave {
    if (this.buildIdentity === undefined) {
      throw new NarrativeRuntimeError(
        'This runtime has no canonical build identity, so it cannot create a compatible save.',
      );
    }
    const frameSave = (frame: Frame): RuntimeFrameSave => ({
      block: frame.block,
      index: frame.index,
    });
    return parseNarrativeSave({
      format: 'rpg-narrative-engine-save',
      formatVersion: 1,
      game: { buildIdentity: this.buildIdentity, formatVersion: this.game.formatVersion },
      state: {
        sceneId: this.currentSceneId,
        variables: this.variables,
        frames: this.frames.map(frameSave),
        calls: this.calls.map((call) => ({
          sceneId: call.sceneId,
          frames: call.frames.map(frameSave),
        })),
        view: this.view,
        pendingChoiceIds: this.pendingChoices.map((choice) => choice.id),
        random: this.random.snapshot(),
      },
    });
  }

  serializeSave(): string {
    return `${JSON.stringify(this.createSave())}\n`;
  }

  loadSave(input: unknown): RuntimeView {
    if (this.buildIdentity === undefined) {
      throw new NarrativeRuntimeError(
        'This runtime has no canonical build identity, so it cannot load a compatible save.',
      );
    }
    const save = parseNarrativeSave(input);
    if (save.game.buildIdentity !== this.buildIdentity) {
      throw new NarrativeRuntimeError(
        'This save belongs to a different build of the game and cannot be loaded safely.',
      );
    }
    const state = save.state;
    if (this.game.scenes[state.sceneId] === undefined) {
      return invalidSave(`scene ${JSON.stringify(state.sceneId)} does not exist in this build.`);
    }
    if (state.view.sceneId !== state.sceneId) {
      return invalidSave('state.view.sceneId does not match state.sceneId.');
    }
    const frames = state.frames.map((frame, index) =>
      this.resolveFrameSave(frame, state.sceneId, `state.frames[${index}]`),
    );
    const calls = state.calls.map((call, callIndex): CallContinuation => {
      if (this.game.scenes[call.sceneId] === undefined) {
        return invalidSave(`state.calls[${callIndex}].sceneId does not exist in this build.`);
      }
      return {
        sceneId: call.sceneId,
        frames: call.frames.map((frame, frameIndex) =>
          this.resolveFrameSave(
            frame,
            call.sceneId,
            `state.calls[${callIndex}].frames[${frameIndex}]`,
          ),
        ),
      };
    });

    let pendingChoices: readonly CompiledChoiceOption[] = [];
    let pendingChoiceContext: PendingChoiceContext | null = null;
    if (state.view.kind === 'choice') {
      const frame = frames.at(-1);
      if (frame === undefined || frame.index === 0) {
        return invalidSave('a choice view requires an active instruction frame.');
      }
      const instructionIndex = frame.index - 1;
      const instruction = frame.instructions[instructionIndex];
      if (instruction?.kind !== 'choices') {
        return invalidSave('the active frame is not suspended at a choice instruction.');
      }
      const seen = new Set<string>();
      pendingChoices = state.pendingChoiceIds.map((id) => {
        if (seen.has(id)) return invalidSave(`pending choice ${JSON.stringify(id)} is duplicated.`);
        seen.add(id);
        const option = instruction.options.find((candidate) => candidate.id === id);
        if (option === undefined) {
          return invalidSave(`pending choice ${JSON.stringify(id)} does not exist in this build.`);
        }
        return option;
      });
      const visibleOptions = state.view.options;
      if (
        pendingChoices.length !== visibleOptions.length ||
        pendingChoices.some((option, index) => {
          const visible = visibleOptions[index];
          return (
            visible === undefined || option.id !== visible.id || option.label !== visible.label
          );
        })
      ) {
        return invalidSave('the visible choices do not match the saved execution state.');
      }
      pendingChoiceContext = Object.freeze({ block: frame.block, instructionIndex });
    } else {
      if (state.pendingChoiceIds.length > 0) {
        return invalidSave('pending choices are present without a choice view.');
      }
      const frame = frames.at(-1);
      const instruction =
        frame === undefined || frame.index === 0 ? undefined : frame.instructions[frame.index - 1];
      if (state.view.kind === 'text') {
        if (instruction?.kind !== 'say') {
          return invalidSave('the active frame is not suspended at a text instruction.');
        }
        if (
          instruction.contentId !== state.view.contentId ||
          instruction.speaker?.reference !== state.view.speaker?.reference ||
          instruction.speaker?.variant !== state.view.speaker?.variant ||
          (instruction.speaker === null) !== (state.view.speaker === null)
        ) {
          return invalidSave('the visible text metadata does not match its instruction.');
        }
      } else if (instruction === undefined) {
        if (calls.length > 0 || state.view.id !== 'complete' || state.view.title !== 'The End') {
          return invalidSave('the natural ending does not match completed execution state.');
        }
      } else if (
        instruction.kind !== 'ending' ||
        instruction.id !== state.view.id ||
        instruction.title !== state.view.title
      ) {
        return invalidSave('the visible ending does not match its instruction.');
      }
    }

    this.random.restore(state.random);
    this.frames = frames;
    this.calls = calls;
    this.currentSceneId = state.sceneId;
    this.currentView = state.view;
    this.pendingChoices = pendingChoices;
    this.pendingChoiceContext = pendingChoiceContext;
    for (const key of Object.keys(this.variables)) delete this.variables[key];
    Object.assign(this.variables, state.variables);
    return this.view;
  }

  private enterScene(sceneId: string): void {
    const scene = this.game.scenes[sceneId];
    if (scene === undefined) {
      throw new NarrativeRuntimeError(`Scene ${JSON.stringify(sceneId)} does not exist.`);
    }
    this.currentSceneId = sceneId;
    this.frames = [
      {
        instructions: scene.instructions,
        block: Object.freeze({ sceneId, path: Object.freeze([]) }),
        index: 0,
      },
    ];
  }

  private resolveFrameSave(save: RuntimeFrameSave, sceneId: string, context: string): Frame {
    if (save.block.sceneId !== sceneId) {
      return invalidSave(`${context}.block.sceneId does not match its stack scene.`);
    }
    const instructions = this.resolveInstructionBlock(save.block, context);
    if (save.index > instructions.length) {
      return invalidSave(`${context}.index is outside its instruction block.`);
    }
    return { instructions, block: save.block, index: save.index };
  }

  private resolveInstructionBlock(
    block: RuntimeInstructionBlockReference,
    context: string,
  ): readonly CompiledInstruction[] {
    const scene = this.game.scenes[block.sceneId];
    if (scene === undefined) {
      return invalidSave(`${context}.block.sceneId does not exist in this build.`);
    }
    let instructions = scene.instructions;
    for (const [index, step] of block.path.entries()) {
      const instruction = instructions[step.instructionIndex];
      if (step.kind === 'branch') {
        if (instruction?.kind !== 'branch') {
          return invalidSave(`${context}.block.path[${index}] does not reference a branch.`);
        }
        instructions = step.arm === 'then' ? instruction.then : instruction.otherwise;
      } else {
        if (instruction?.kind !== 'choices') {
          return invalidSave(`${context}.block.path[${index}] does not reference choices.`);
        }
        const option = instruction.options.find((candidate) => candidate.id === step.optionId);
        if (option === undefined) {
          return invalidSave(`${context}.block.path[${index}] references a missing choice option.`);
        }
        instructions = option.instructions;
      }
    }
    return instructions;
  }

  private evaluate(expression: CompiledExpression): NarrativeValue {
    switch (expression.kind) {
      case 'literal':
        return expression.value;
      case 'variable': {
        const value = this.variables[expression.path];
        if (value === undefined) {
          throw new NarrativeRuntimeError(
            `Variable ${JSON.stringify(expression.path)} has not been set.`,
          );
        }
        return value;
      }
      case 'unary': {
        const operand = this.evaluate(expression.operand);
        return expression.operator === '!'
          ? !requireBoolean(operand, 'Logical negation')
          : -requireNumber(operand, 'Unary minus');
      }
      case 'call':
        return callFunction(
          expression.name,
          expression.arguments.map((argument) => this.evaluate(argument)),
          this.random,
        );
      case 'binary': {
        const left = this.evaluate(expression.left);
        if (expression.operator === '&&') {
          return (
            requireBoolean(left, 'Operator &&') &&
            requireBoolean(this.evaluate(expression.right), 'Operator &&')
          );
        }
        if (expression.operator === '||') {
          return (
            requireBoolean(left, 'Operator ||') ||
            requireBoolean(this.evaluate(expression.right), 'Operator ||')
          );
        }
        const right = this.evaluate(expression.right);
        if (expression.operator === '==' || expression.operator === '!=') {
          if (typeof left !== typeof right) {
            throw new NarrativeRuntimeError(
              `Operator ${expression.operator} requires operands of the same type.`,
            );
          }
          return expression.operator === '==' ? left === right : left !== right;
        }
        if (expression.operator === '+' && typeof left === 'string' && typeof right === 'string') {
          return left + right;
        }
        const leftNumber = requireNumber(left, `Operator ${expression.operator}`);
        const rightNumber = requireNumber(right, `Operator ${expression.operator}`);
        switch (expression.operator) {
          case '+':
            return leftNumber + rightNumber;
          case '-':
            return leftNumber - rightNumber;
          case '*':
            return leftNumber * rightNumber;
          case '/':
            if (rightNumber === 0)
              throw new NarrativeRuntimeError('Division by zero is not allowed.');
            return leftNumber / rightNumber;
          case '%':
            if (rightNumber === 0)
              throw new NarrativeRuntimeError('Modulo by zero is not allowed.');
            return leftNumber % rightNumber;
          case '<':
            return leftNumber < rightNumber;
          case '<=':
            return leftNumber <= rightNumber;
          case '>':
            return leftNumber > rightNumber;
          case '>=':
            return leftNumber >= rightNumber;
        }
      }
    }
  }

  private resolveInline(nodes: readonly CompiledInline[]): readonly ResolvedInline[] {
    return nodes.map((node): ResolvedInline => {
      if (node.kind === 'text' || node.kind === 'line-break') {
        return node;
      }
      if (node.kind === 'interpolation') {
        return { kind: 'text', value: String(this.evaluate(node.expression)) };
      }
      if (node.kind === 'language') {
        return {
          kind: node.kind,
          languageTag: node.languageTag,
          children: this.resolveInline(node.children),
        };
      }
      if (node.kind === 'pronunciation') {
        return { kind: node.kind, hint: node.hint, children: this.resolveInline(node.children) };
      }
      return { kind: node.kind, children: this.resolveInline(node.children) };
    });
  }

  private applySet(instruction: Extract<CompiledInstruction, { readonly kind: 'set' }>): void {
    const value = this.evaluate(instruction.value);
    if (instruction.operator === '=') {
      this.variables[instruction.path] = value;
      return;
    }
    const current = this.variables[instruction.path];
    if (current === undefined) {
      throw new NarrativeRuntimeError(
        `Variable ${JSON.stringify(instruction.path)} must be set before ${instruction.operator}.`,
      );
    }
    if (instruction.operator === '+=' && typeof current === 'string' && typeof value === 'string') {
      this.variables[instruction.path] = current + value;
      return;
    }
    const left = requireNumber(current, `Operator ${instruction.operator}`);
    const right = requireNumber(value, `Operator ${instruction.operator}`);
    if (instruction.operator === '/=' && right === 0) {
      throw new NarrativeRuntimeError('Division by zero is not allowed.');
    }
    this.variables[instruction.path] =
      instruction.operator === '+='
        ? left + right
        : instruction.operator === '-='
          ? left - right
          : instruction.operator === '*='
            ? left * right
            : left / right;
  }

  private advance(): void {
    for (let steps = 0; steps < this.stepBudget; steps += 1) {
      const frame = this.frames.at(-1);
      if (frame === undefined) {
        const continuation = this.calls.pop();
        if (continuation !== undefined) {
          this.currentSceneId = continuation.sceneId;
          this.frames = continuation.frames;
          continue;
        }
        this.currentView = {
          kind: 'ending',
          sceneId: this.currentSceneId,
          id: 'complete',
          title: 'The End',
        };
        return;
      }
      const instructionIndex = frame.index;
      const instruction = frame.instructions[instructionIndex];
      if (instruction === undefined) {
        this.frames.pop();
        continue;
      }
      frame.index += 1;
      switch (instruction.kind) {
        case 'say': {
          const content = this.resolveInline(instruction.content);
          this.currentView = {
            kind: 'text',
            sceneId: this.currentSceneId,
            speaker: instruction.speaker,
            contentId: instruction.contentId,
            content,
            plainText: plainText(content),
          };
          return;
        }
        case 'branch': {
          const selected = requireBoolean(this.evaluate(instruction.condition), 'Branch condition')
            ? instruction.then
            : instruction.otherwise;
          if (selected.length > 0) {
            this.frames.push({
              instructions: selected,
              block: Object.freeze({
                sceneId: frame.block.sceneId,
                path: Object.freeze([
                  ...frame.block.path,
                  Object.freeze({
                    kind: 'branch' as const,
                    instructionIndex,
                    arm: selected === instruction.then ? ('then' as const) : ('otherwise' as const),
                  }),
                ]),
              }),
              index: 0,
            });
          }
          break;
        }
        case 'choices': {
          const options = instruction.options.filter(
            (option) =>
              option.condition === null ||
              requireBoolean(this.evaluate(option.condition), 'Choice condition'),
          );
          if (options.length === 0) break;
          this.pendingChoices = options;
          this.pendingChoiceContext = Object.freeze({ block: frame.block, instructionIndex });
          this.currentView = {
            kind: 'choice',
            sceneId: this.currentSceneId,
            options: options.map((option) => ({ id: option.id, label: option.label })),
          };
          return;
        }
        case 'set':
          this.applySet(instruction);
          break;
        case 'goto':
          this.enterScene(instruction.sceneId);
          break;
        case 'call':
          this.calls.push({
            sceneId: this.currentSceneId,
            frames: this.frames.map((current) => ({ ...current })),
          });
          this.enterScene(instruction.sceneId);
          break;
        case 'return': {
          const continuation = this.calls.pop();
          if (continuation === undefined) {
            this.frames = [];
          } else {
            this.currentSceneId = continuation.sceneId;
            this.frames = continuation.frames;
          }
          break;
        }
        case 'effect':
          this.onEffect?.(instruction);
          break;
        case 'ending':
          this.currentView = {
            kind: 'ending',
            sceneId: this.currentSceneId,
            id: instruction.id,
            title: instruction.title,
          };
          return;
      }
    }
    throw new NarrativeRuntimeError(
      `Execution exceeded ${this.stepBudget} instructions without reaching text, choices, or an ending.`,
    );
  }
}
