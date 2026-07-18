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

export interface RuntimeOptions {
  readonly initialVariables?: Readonly<Record<string, NarrativeValue>>;
  readonly onEffect?: (effect: EffectInstruction) => void;
  readonly stepBudget?: number;
}

interface Frame {
  readonly instructions: readonly CompiledInstruction[];
  index: number;
}

interface CallContinuation {
  readonly sceneId: string;
  readonly frames: Frame[];
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

function callFunction(name: string, values: readonly NarrativeValue[]): NarrativeValue {
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

/** Deterministic, UI-independent interpreter for compiled narrative games. */
export class NarrativeRuntime {
  readonly game: CompiledGame;
  readonly variables: Record<string, NarrativeValue>;

  private readonly initialVariables: Readonly<Record<string, NarrativeValue>>;
  private readonly onEffect: ((effect: EffectInstruction) => void) | undefined;
  private readonly stepBudget: number;
  private frames: Frame[] = [];
  private calls: CallContinuation[] = [];
  private currentSceneId = '';
  private currentView: RuntimeView | null = null;
  private pendingChoices: readonly CompiledChoiceOption[] = [];

  constructor(game: CompiledGame, options: RuntimeOptions = {}) {
    this.game = game;
    this.initialVariables = { ...options.initialVariables };
    this.variables = {};
    this.onEffect = options.onEffect;
    this.stepBudget = options.stepBudget ?? 10_000;
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
    this.currentSceneId = '';
    for (const key of Object.keys(this.variables)) {
      delete this.variables[key];
    }
    Object.assign(this.variables, this.initialVariables);
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
    if (option.instructions.length > 0) {
      this.frames.push({ instructions: option.instructions, index: 0 });
    }
    this.advance();
    return this.view;
  }

  snapshotVariables(): Readonly<Record<string, NarrativeValue>> {
    return Object.freeze({ ...this.variables });
  }

  private enterScene(sceneId: string): void {
    const scene = this.game.scenes[sceneId];
    if (scene === undefined) {
      throw new NarrativeRuntimeError(`Scene ${JSON.stringify(sceneId)} does not exist.`);
    }
    this.currentSceneId = sceneId;
    this.frames = [{ instructions: scene.instructions, index: 0 }];
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
      const instruction = frame.instructions[frame.index];
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
          if (selected.length > 0) this.frames.push({ instructions: selected, index: 0 });
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
