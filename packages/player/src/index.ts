import type { CompiledGame, EffectInstruction, NarrativeValue } from '@rpgnarrativeengine/ir';
import {
  NarrativeRuntime,
  type ResolvedInline,
  type RuntimeView,
} from '@rpgnarrativeengine/runtime';

export interface NarrativePlayerOptions {
  readonly initialVariables?: Readonly<Record<string, NarrativeValue>>;
  readonly onEffect?: (effect: EffectInstruction) => void;
  readonly save?: NarrativePlayerSaveOptions;
}

export interface NarrativeSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NarrativePlayerSaveOptions {
  /** Canonical SHA-256 identity of the game bundle being played. */
  readonly buildIdentity: string;
  /** Stable project-scoped slot name. */
  readonly key: string;
  readonly storage: NarrativeSaveStorage;
}

export interface NarrativePlayerController {
  readonly runtime: NarrativeRuntime;
  render(): void;
  hasSave(): boolean;
  save(): void;
  load(): RuntimeView;
  destroy(): void;
}

function appendInline(
  document: Document,
  parent: HTMLElement,
  nodes: readonly ResolvedInline[],
): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      parent.append(document.createTextNode(node.value));
      continue;
    }
    if (node.kind === 'line-break') {
      parent.append(document.createElement('br'));
      continue;
    }
    const element = document.createElement(
      node.kind === 'emphasis' ? 'em' : node.kind === 'strong' ? 'strong' : 'span',
    );
    if (node.kind === 'language') {
      element.lang = node.languageTag;
    } else if (node.kind === 'pronunciation') {
      element.className = 'nre-pronunciation';
      element.title = `Pronounced ${node.hint}`;
      element.dataset['pronunciation'] = node.hint;
    }
    appendInline(document, element, node.children);
    parent.append(element);
  }
}

function button(document: Document, label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

/** Mount a safe, dependency-free DOM player for a compiled narrative game. */
export function mountNarrativePlayer(
  container: HTMLElement,
  game: CompiledGame,
  options: NarrativePlayerOptions = {},
): NarrativePlayerController {
  const document = container.ownerDocument;
  const root = document.createElement('section');
  root.className = 'nre-player';
  root.setAttribute('aria-label', game.title);
  const stage = document.createElement('div');
  stage.className = 'nre-stage';
  stage.setAttribute('aria-live', 'polite');
  let saveStatus: HTMLElement | null = null;
  let loadButton: HTMLButtonElement | null = null;
  if (options.save !== undefined) {
    const saveTools = document.createElement('div');
    saveTools.className = 'nre-save-tools';
    saveTools.setAttribute('aria-label', 'Saved game controls');
    const saveButton = button(document, 'Save game', 'nre-button nre-save');
    loadButton = button(document, 'Load game', 'nre-button nre-load');
    saveStatus = document.createElement('p');
    saveStatus.className = 'nre-save-status';
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    saveTools.append(saveButton, loadButton, saveStatus);
    root.append(saveTools);
    saveButton.addEventListener('click', () => {
      try {
        saveGame();
        if (saveStatus !== null) saveStatus.textContent = 'Game saved.';
      } catch (error) {
        if (saveStatus !== null) {
          saveStatus.textContent =
            error instanceof Error
              ? `Could not save: ${error.message}`
              : 'Could not save the game.';
        }
      }
    });
    loadButton.addEventListener('click', () => {
      try {
        loadGame();
        if (saveStatus !== null) saveStatus.textContent = 'Game loaded.';
      } catch (error) {
        if (saveStatus !== null) {
          saveStatus.textContent =
            error instanceof Error
              ? `Could not load: ${error.message}`
              : 'Could not load the game.';
        }
      }
    });
  }
  root.append(stage);
  container.replaceChildren(root);

  const runtimeOptions = {
    ...(options.initialVariables === undefined
      ? {}
      : { initialVariables: options.initialVariables }),
    ...(options.onEffect === undefined ? {} : { onEffect: options.onEffect }),
    ...(options.save === undefined ? {} : { buildIdentity: options.save.buildIdentity }),
  };
  const runtime = new NarrativeRuntime(game, runtimeOptions);

  function hasSave(): boolean {
    if (options.save === undefined) return false;
    try {
      return options.save.storage.getItem(options.save.key) !== null;
    } catch {
      return false;
    }
  }

  function refreshLoadAvailability(): void {
    if (loadButton !== null) loadButton.disabled = !hasSave();
  }

  function saveGame(): void {
    if (options.save === undefined) throw new Error('Saving is not enabled for this game.');
    options.save.storage.setItem(options.save.key, runtime.serializeSave());
    refreshLoadAvailability();
  }

  function loadGame(): RuntimeView {
    if (options.save === undefined) throw new Error('Loading is not enabled for this game.');
    const saved = options.save.storage.getItem(options.save.key);
    if (saved === null) throw new Error('No saved game is available.');
    const view = runtime.loadSave(saved);
    render();
    return view;
  }

  function run(action: () => RuntimeView): void {
    try {
      action();
      render();
    } catch (error) {
      stage.replaceChildren();
      const message = document.createElement('p');
      message.className = 'nre-error';
      message.textContent =
        error instanceof Error ? error.message : 'The story could not continue.';
      stage.append(message);
    }
  }

  function renderText(view: Extract<RuntimeView, { readonly kind: 'text' }>): void {
    const beat = document.createElement('article');
    beat.className = view.speaker === null ? 'nre-beat nre-narration' : 'nre-beat nre-dialogue';
    if (view.speaker !== null) {
      const speaker = document.createElement('p');
      speaker.className = 'nre-speaker';
      speaker.textContent = view.speaker.reference;
      if (view.speaker.variant !== null) speaker.dataset['variant'] = view.speaker.variant;
      beat.append(speaker);
    }
    const prose = document.createElement('div');
    prose.className = 'nre-prose';
    appendInline(document, prose, view.content);
    beat.append(prose);
    const controls = document.createElement('div');
    controls.className = 'nre-controls';
    const continueButton = button(document, 'Continue', 'nre-button nre-continue');
    continueButton.addEventListener('click', () => run(() => runtime.continue()));
    controls.append(continueButton);
    stage.append(beat, controls);
    continueButton.focus({ preventScroll: true });
  }

  function renderChoices(view: Extract<RuntimeView, { readonly kind: 'choice' }>): void {
    const heading = document.createElement('h2');
    heading.className = 'nre-prompt';
    heading.textContent = 'What do you do?';
    const list = document.createElement('div');
    list.className = 'nre-choices';
    for (const option of view.options) {
      const choiceButton = button(document, option.label, 'nre-button nre-choice');
      choiceButton.addEventListener('click', () => run(() => runtime.choose(option.id)));
      list.append(choiceButton);
    }
    stage.append(heading, list);
    list.querySelector('button')?.focus({ preventScroll: true });
  }

  function renderEnding(view: Extract<RuntimeView, { readonly kind: 'ending' }>): void {
    const ending = document.createElement('div');
    ending.className = 'nre-ending';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'nre-ending-label';
    eyebrow.textContent = 'Ending reached';
    const title = document.createElement('h2');
    title.textContent = view.title;
    const restartButton = button(document, 'Begin again', 'nre-button nre-restart');
    restartButton.addEventListener('click', () => run(() => runtime.restart()));
    ending.append(eyebrow, title, restartButton);
    stage.append(ending);
    restartButton.focus({ preventScroll: true });
  }

  function render(): void {
    stage.replaceChildren();
    stage.dataset['scene'] = runtime.sceneId;
    const view = runtime.view;
    if (view.kind === 'text') renderText(view);
    else if (view.kind === 'choice') renderChoices(view);
    else renderEnding(view);
  }

  render();
  refreshLoadAvailability();
  return {
    runtime,
    render,
    hasSave,
    save: saveGame,
    load: loadGame,
    destroy() {
      root.remove();
    },
  };
}
