/** Values that can be stored in narrative state or produced by an expression. */
export type NarrativeValue = boolean | number | string;

export type ExpressionOperator =
  '!=' | '%' | '&&' | '*' | '+' | '-' | '/' | '<' | '<=' | '==' | '>' | '>=' | '||';

export type CompiledExpression =
  | { readonly kind: 'literal'; readonly value: NarrativeValue }
  | { readonly kind: 'variable'; readonly path: string }
  | {
      readonly kind: 'unary';
      readonly operator: '!' | '-';
      readonly operand: CompiledExpression;
    }
  | {
      readonly kind: 'binary';
      readonly operator: ExpressionOperator;
      readonly left: CompiledExpression;
      readonly right: CompiledExpression;
    }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly arguments: readonly CompiledExpression[];
    };

export type CompiledInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'line-break' }
  | { readonly kind: 'emphasis'; readonly children: readonly CompiledInline[] }
  | { readonly kind: 'strong'; readonly children: readonly CompiledInline[] }
  | {
      readonly kind: 'language';
      readonly languageTag: string;
      readonly children: readonly CompiledInline[];
    }
  | {
      readonly kind: 'pronunciation';
      readonly hint: string;
      readonly children: readonly CompiledInline[];
    }
  | { readonly kind: 'interpolation'; readonly expression: CompiledExpression };

export interface CompiledSpeaker {
  readonly reference: string;
  readonly variant: string | null;
}

export interface SayInstruction {
  readonly kind: 'say';
  readonly speaker: CompiledSpeaker | null;
  readonly contentId: string | null;
  readonly content: readonly CompiledInline[];
}

export interface BranchInstruction {
  readonly kind: 'branch';
  readonly condition: CompiledExpression;
  readonly then: readonly CompiledInstruction[];
  readonly otherwise: readonly CompiledInstruction[];
}

export interface CompiledChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly contentId: string | null;
  readonly condition: CompiledExpression | null;
  readonly instructions: readonly CompiledInstruction[];
}

export interface ChoicesInstruction {
  readonly kind: 'choices';
  readonly options: readonly CompiledChoiceOption[];
}

export interface SetInstruction {
  readonly kind: 'set';
  readonly path: string;
  readonly operator: '=' | '+=' | '-=' | '*=' | '/=';
  readonly value: CompiledExpression;
}

export interface GotoInstruction {
  readonly kind: 'goto';
  readonly sceneId: string;
}

export interface CallInstruction {
  readonly kind: 'call';
  readonly sceneId: string;
}

export interface ReturnInstruction {
  readonly kind: 'return';
}

export interface EndingInstruction {
  readonly kind: 'ending';
  readonly id: string;
  readonly title: string;
}

/** Engine- or game-specific commands are preserved for host adapters. */
export interface EffectInstruction {
  readonly kind: 'effect';
  readonly name: string;
  readonly arguments: string;
}

export type CompiledInstruction =
  | BranchInstruction
  | CallInstruction
  | ChoicesInstruction
  | EffectInstruction
  | EndingInstruction
  | GotoInstruction
  | ReturnInstruction
  | SayInstruction
  | SetInstruction;

export interface CompiledScene {
  readonly id: string;
  readonly instructions: readonly CompiledInstruction[];
}

/** Serializable, platform-neutral output produced by the story compiler. */
export interface CompiledGame {
  readonly format: 'rpg-narrative-engine';
  readonly formatVersion: 1;
  readonly title: string;
  readonly startSceneId: string;
  readonly scenes: Readonly<Record<string, CompiledScene>>;
}
