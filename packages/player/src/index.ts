import type { CompiledGame, EffectInstruction, NarrativeValue } from '@rpgnarrativeengine/ir';
import {
  NarrativeRuntime,
  type NarrativeSaveMigration,
  type ResolvedInline,
  type RuntimeTranscriptEntry,
  type RuntimeView,
} from '@rpgnarrativeengine/runtime';

export interface NarrativePlayerOptions {
  readonly initialVariables?: Readonly<Record<string, NarrativeValue>>;
  readonly onEffect?: (effect: EffectInstruction) => void;
  readonly randomSeed?: string;
  readonly save?: NarrativePlayerSaveOptions;
  readonly saveMigrations?: readonly NarrativeSaveMigration[];
}

export interface NarrativeSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type NarrativeSaveSlotId = 'auto' | 'quick' | `manual-${number}`;

export interface NarrativeSaveSlotSummary {
  readonly id: NarrativeSaveSlotId;
  readonly kind: 'auto' | 'manual' | 'quick';
  readonly label: string;
  readonly exists: boolean;
  readonly compatible: boolean;
  readonly sceneId?: string;
  readonly description?: string;
}

export interface NarrativePlayerSaveOptions {
  /** Canonical SHA-256 identity of the game bundle being played. */
  readonly buildIdentity: string;
  /** Stable project-scoped slot name. */
  readonly key: string;
  readonly storage: NarrativeSaveStorage;
  /** Number of visible manual slots. Defaults to 3 and is bounded to 1-10. */
  readonly manualSlots?: number;
  /** Save after each successful story action. Defaults to true. */
  readonly autoSave?: boolean;
  /** Expose the dedicated quick-save slot. Defaults to true. */
  readonly quickSave?: boolean;
}

export interface NarrativePlayerController {
  readonly runtime: NarrativeRuntime;
  render(): void;
  hasSave(slot?: NarrativeSaveSlotId): boolean;
  listSaveSlots(): readonly NarrativeSaveSlotSummary[];
  save(slot?: NarrativeSaveSlotId): void;
  load(slot?: NarrativeSaveSlotId): RuntimeView;
  exportSave(slot?: NarrativeSaveSlotId): string;
  importSave(input: unknown, slot?: NarrativeSaveSlotId): NarrativeSaveSlotSummary;
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

const DEFAULT_MANUAL_SAVE_SLOTS = 3;
const MAX_MANUAL_SAVE_SLOTS = 10;
const MAX_IMPORTED_SAVE_BYTES = 8 * 1024 * 1024;
const MAX_RENDERED_TRANSCRIPT_ENTRIES = 250;
const MAX_RETAINED_STAGE_BEATS = 3;
const SPEAKER_VISUAL_TONES = 6;
const SCENE_VISUAL_TONES = 6;

function stableVisualTone(reference: string, toneCount: number): number {
  let hash = 5381;
  for (const character of reference) {
    hash = (Math.imul(hash, 33) ^ (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % toneCount;
}

/** Stable presentation variety for unconfigured voices; never used as narrative identity. */
function speakerVisualTone(reference: string): number {
  return stableVisualTone(reference, SPEAKER_VISUAL_TONES);
}

/** Stable ambient palette variety; never used as scene identity or game state. */
function sceneVisualTone(reference: string): number {
  return stableVisualTone(reference, SCENE_VISUAL_TONES);
}

function manualSlotCount(options: NarrativePlayerSaveOptions | undefined): number {
  const requested = options?.manualSlots ?? DEFAULT_MANUAL_SAVE_SLOTS;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > MAX_MANUAL_SAVE_SLOTS) {
    throw new Error(`manualSlots must be an integer from 1 to ${MAX_MANUAL_SAVE_SLOTS}.`);
  }
  return requested;
}

function transcriptLabel(entry: RuntimeTranscriptEntry): string {
  if (entry.kind === 'choice') return `Choice: ${entry.label}`;
  if (entry.kind === 'ending') return `Ending: ${entry.title}`;
  return entry.speaker === null
    ? entry.plainText
    : `${entry.speaker.reference}: ${entry.plainText}`;
}

function saveDescription(view: RuntimeView): string {
  if (view.kind === 'choice') return `${view.options.length} available choices`;
  if (view.kind === 'ending') return `Ending: ${view.title}`;
  const prefix = view.speaker === null ? '' : `${view.speaker.reference}: `;
  const text = `${prefix}${view.plainText}`.replaceAll(/\s+/gu, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
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

  const playerTools = document.createElement('div');
  playerTools.className = 'nre-player-tools';
  const historyPanel = document.createElement('details');
  historyPanel.className = 'nre-tool-panel nre-history-panel';
  const historySummary = document.createElement('summary');
  historySummary.textContent = 'History';
  const historyCount = document.createElement('span');
  historyCount.className = 'nre-history-count';
  historyCount.setAttribute('aria-hidden', 'true');
  historySummary.append(' ', historyCount);
  const transcriptList = document.createElement('ol');
  transcriptList.className = 'nre-transcript';
  historyPanel.append(historySummary, transcriptList);
  playerTools.append(historyPanel);

  const configuredManualSlots = manualSlotCount(options.save);
  const autoSaveEnabled = options.save !== undefined && options.save.autoSave !== false;
  const quickSaveEnabled = options.save !== undefined && options.save.quickSave !== false;
  let saveStatus: HTMLElement | null = null;
  let savePanel: HTMLDetailsElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let loadButton: HTMLButtonElement | null = null;
  let exportButton: HTMLButtonElement | null = null;
  let importButton: HTMLButtonElement | null = null;
  let importInput: HTMLInputElement | null = null;
  let manualSlotSelect: HTMLSelectElement | null = null;
  let quickSaveButton: HTMLButtonElement | null = null;
  let quickLoadButton: HTMLButtonElement | null = null;
  let autoLoadButton: HTMLButtonElement | null = null;
  if (options.save !== undefined) {
    const saveTools = document.createElement('details');
    savePanel = saveTools;
    saveTools.className = 'nre-tool-panel nre-save-tools';
    const saveSummary = document.createElement('summary');
    saveSummary.textContent = 'Save & load';
    const saveBody = document.createElement('div');
    saveBody.className = 'nre-save-body';
    const slotLabel = document.createElement('label');
    slotLabel.className = 'nre-save-slot-label';
    slotLabel.textContent = 'Manual slot';
    manualSlotSelect = document.createElement('select');
    manualSlotSelect.className = 'nre-save-slot';
    for (let slot = 1; slot <= configuredManualSlots; slot += 1) {
      const option = document.createElement('option');
      option.value = `manual-${slot}`;
      option.textContent = `Slot ${slot}`;
      manualSlotSelect.append(option);
    }
    slotLabel.append(manualSlotSelect);
    const manualActions = document.createElement('div');
    manualActions.className = 'nre-save-actions';
    saveButton = button(document, 'Save game', 'nre-button nre-save');
    loadButton = button(document, 'Load game', 'nre-button nre-load');
    exportButton = button(document, 'Export save', 'nre-button nre-export-save');
    importButton = button(document, 'Import save', 'nre-button nre-import-save');
    importInput = document.createElement('input');
    importInput.className = 'nre-save-file-input';
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.setAttribute('aria-label', 'Choose a save file to import');
    manualActions.append(saveButton, loadButton, exportButton, importButton, importInput);
    saveBody.append(slotLabel, manualActions);

    if (quickSaveEnabled) {
      const quickActions = document.createElement('div');
      quickActions.className = 'nre-save-actions nre-quick-save-actions';
      quickSaveButton = button(document, 'Quick save', 'nre-button nre-quick-save');
      quickLoadButton = button(document, 'Quick load', 'nre-button nre-quick-load');
      quickActions.append(quickSaveButton, quickLoadButton);
      saveBody.append(quickActions);
    }
    if (autoSaveEnabled) {
      const autoActions = document.createElement('div');
      autoActions.className = 'nre-save-actions nre-auto-save-actions';
      const autoLabel = document.createElement('span');
      autoLabel.className = 'nre-auto-save-label';
      autoLabel.textContent = 'Progress autosaves after each action.';
      autoLoadButton = button(document, 'Load autosave', 'nre-button nre-auto-load');
      autoActions.append(autoLabel, autoLoadButton);
      saveBody.append(autoActions);
    }
    saveStatus = document.createElement('p');
    saveStatus.className = 'nre-save-status';
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    saveBody.append(saveStatus);
    saveTools.append(saveSummary, saveBody);
    playerTools.append(saveTools);
  }
  root.append(playerTools, stage);
  container.replaceChildren(root);

  const runtimeOptions = {
    ...(options.initialVariables === undefined
      ? {}
      : { initialVariables: options.initialVariables }),
    ...(options.onEffect === undefined ? {} : { onEffect: options.onEffect }),
    ...(options.randomSeed === undefined ? {} : { randomSeed: options.randomSeed }),
    ...(options.save === undefined ? {} : { buildIdentity: options.save.buildIdentity }),
    ...(options.saveMigrations === undefined ? {} : { saveMigrations: options.saveMigrations }),
  };
  const runtime = new NarrativeRuntime(game, runtimeOptions);

  const configuredSlotIds: readonly NarrativeSaveSlotId[] = Object.freeze([
    ...Array.from({ length: configuredManualSlots }, (_, index) => `manual-${index + 1}` as const),
    ...(quickSaveEnabled ? (['quick'] as const) : []),
    ...(autoSaveEnabled ? (['auto'] as const) : []),
  ]);

  function selectedManualSlot(): NarrativeSaveSlotId {
    return (manualSlotSelect?.value ?? 'manual-1') as NarrativeSaveSlotId;
  }

  function requireConfiguredSlot(slot: NarrativeSaveSlotId): NarrativeSaveSlotId {
    if (!configuredSlotIds.includes(slot)) {
      throw new Error(`Save slot ${JSON.stringify(slot)} is not enabled for this player.`);
    }
    return slot;
  }

  function slotKind(slot: NarrativeSaveSlotId): 'auto' | 'manual' | 'quick' {
    if (slot === 'auto') return 'auto';
    if (slot === 'quick') return 'quick';
    return 'manual';
  }

  function slotLabel(slot: NarrativeSaveSlotId): string {
    if (slot === 'auto') return 'Autosave';
    if (slot === 'quick') return 'Quick save';
    return `Slot ${slot.slice('manual-'.length)}`;
  }

  function storageKey(slot: NarrativeSaveSlotId): string {
    if (options.save === undefined) throw new Error('Saving is not enabled for this game.');
    if (slot === 'manual-1') return options.save.key;
    return `${options.save.key}.${slot}`;
  }

  function storedSave(slot: NarrativeSaveSlotId): string | null {
    if (options.save === undefined) return null;
    return options.save.storage.getItem(storageKey(requireConfiguredSlot(slot)));
  }

  function hasSave(slot: NarrativeSaveSlotId = 'manual-1'): boolean {
    if (options.save === undefined) return false;
    try {
      return storedSave(slot) !== null;
    } catch {
      return false;
    }
  }

  function summarizeSlot(slot: NarrativeSaveSlotId): NarrativeSaveSlotSummary {
    const base = {
      id: slot,
      kind: slotKind(slot),
      label: slotLabel(slot),
    } as const;
    let saved: string | null;
    try {
      saved = storedSave(slot);
    } catch (error) {
      return Object.freeze({
        ...base,
        exists: false,
        compatible: false,
        description: error instanceof Error ? error.message : 'Storage is unavailable.',
      });
    }
    if (saved === null) return Object.freeze({ ...base, exists: false, compatible: true });
    try {
      const prepared = runtime.prepareSave(saved);
      return Object.freeze({
        ...base,
        exists: true,
        compatible: true,
        sceneId: prepared.state.sceneId,
        description: saveDescription(prepared.state.view),
      });
    } catch (error) {
      return Object.freeze({
        ...base,
        exists: true,
        compatible: false,
        description: error instanceof Error ? error.message : 'This save is not compatible.',
      });
    }
  }

  function listSaveSlots(): readonly NarrativeSaveSlotSummary[] {
    if (options.save === undefined) return Object.freeze([]);
    return Object.freeze(configuredSlotIds.map((slot) => summarizeSlot(slot)));
  }

  function refreshSaveAvailability(): void {
    const summaries = new Map(listSaveSlots().map((summary) => [summary.id, summary]));
    const selected = summaries.get(selectedManualSlot());
    if (loadButton !== null)
      loadButton.disabled = selected?.compatible !== true || !selected.exists;
    if (exportButton !== null) {
      exportButton.disabled = selected?.compatible !== true || !selected.exists;
    }
    if (quickLoadButton !== null) {
      const quick = summaries.get('quick');
      quickLoadButton.disabled = quick?.compatible !== true || !quick.exists;
    }
    if (autoLoadButton !== null) {
      const auto = summaries.get('auto');
      autoLoadButton.disabled = auto?.compatible !== true || !auto.exists;
    }
    if (manualSlotSelect !== null) {
      for (const option of manualSlotSelect.options) {
        const summary = summaries.get(option.value as NarrativeSaveSlotId);
        option.textContent = `${summary?.label ?? option.value}${summary?.exists ? ' — saved' : ' — empty'}`;
      }
    }
  }

  function saveGame(slot: NarrativeSaveSlotId = 'manual-1'): void {
    if (options.save === undefined) throw new Error('Saving is not enabled for this game.');
    options.save.storage.setItem(storageKey(requireConfiguredSlot(slot)), runtime.serializeSave());
    refreshSaveAvailability();
  }

  function loadGame(slot: NarrativeSaveSlotId = 'manual-1'): RuntimeView {
    if (options.save === undefined) throw new Error('Loading is not enabled for this game.');
    const key = storageKey(requireConfiguredSlot(slot));
    const saved = options.save.storage.getItem(key);
    if (saved === null) throw new Error('No saved game is available.');
    const view = runtime.loadSave(saved);
    const canonical = runtime.serializeSave();
    if (canonical !== saved) {
      try {
        options.save.storage.setItem(key, canonical);
      } catch {
        // Loading remains successful when storage cannot rewrite a migrated legacy save.
      }
    }
    render();
    refreshSaveAvailability();
    return view;
  }

  function exportSave(slot: NarrativeSaveSlotId = 'manual-1'): string {
    const saved = storedSave(requireConfiguredSlot(slot));
    if (saved === null) throw new Error('No saved game is available.');
    return `${JSON.stringify(runtime.prepareSave(saved))}\n`;
  }

  function importSave(
    input: unknown,
    slot: NarrativeSaveSlotId = 'manual-1',
  ): NarrativeSaveSlotSummary {
    if (options.save === undefined) throw new Error('Saving is not enabled for this game.');
    const target = requireConfiguredSlot(slot);
    const prepared = runtime.prepareSave(input);
    options.save.storage.setItem(storageKey(target), `${JSON.stringify(prepared)}\n`);
    refreshSaveAvailability();
    return summarizeSlot(target);
  }

  function setSaveStatus(message: string): void {
    if (saveStatus !== null) saveStatus.textContent = message;
  }

  function errorMessage(action: string, error: unknown): string {
    return error instanceof Error ? `${action}: ${error.message}` : `${action}.`;
  }

  function tryAutoSave(): void {
    if (!autoSaveEnabled) return;
    try {
      saveGame('auto');
    } catch (error) {
      setSaveStatus(errorMessage('Progress continued, but autosave failed', error));
    }
  }

  function run(action: () => RuntimeView): void {
    try {
      action();
      render();
      tryAutoSave();
    } catch (error) {
      stage.replaceChildren();
      const message = document.createElement('p');
      message.className = 'nre-error';
      message.textContent =
        error instanceof Error ? error.message : 'The story could not continue.';
      stage.append(message);
    }
  }

  function renderTranscript(): void {
    transcriptList.replaceChildren();
    const transcript = runtime.transcript;
    historyCount.textContent = `(${transcript.length})`;
    if (transcript.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'nre-transcript-empty';
      empty.textContent = 'No story history yet.';
      transcriptList.append(empty);
      return;
    }
    const firstVisible = Math.max(0, transcript.length - MAX_RENDERED_TRANSCRIPT_ENTRIES);
    if (firstVisible > 0) {
      const omitted = document.createElement('li');
      omitted.className = 'nre-transcript-omitted';
      omitted.textContent = `${firstVisible} earlier entries are retained in the save but hidden here for performance.`;
      transcriptList.append(omitted);
    }
    for (const entry of transcript.slice(firstVisible)) {
      const item = document.createElement('li');
      item.className = `nre-transcript-entry nre-transcript-${entry.kind}`;
      item.textContent = transcriptLabel(entry);
      transcriptList.append(item);
    }
  }

  function recentTextEntries(
    limit: number,
  ): readonly Extract<RuntimeTranscriptEntry, { readonly kind: 'text' }>[] {
    return runtime.transcript
      .filter(
        (entry): entry is Extract<RuntimeTranscriptEntry, { readonly kind: 'text' }> =>
          entry.kind === 'text',
      )
      .slice(-limit);
  }

  function createTextBeat(
    view: Extract<RuntimeView, { readonly kind: 'text' }>,
    state: 'current' | 'receded',
    depth: number,
  ): HTMLElement {
    const beat = document.createElement('article');
    beat.className = view.speaker === null ? 'nre-beat nre-narration' : 'nre-beat nre-dialogue';
    beat.dataset['stageState'] = state;
    beat.dataset['stageDepth'] = String(depth);
    if (state === 'receded') beat.setAttribute('aria-hidden', 'true');
    if (view.speaker !== null) {
      const tone = speakerVisualTone(view.speaker.reference);
      beat.dataset['speakerTone'] = String(tone);
      beat.dataset['speakerSide'] = tone % 2 === 0 ? 'left' : 'right';
      const speaker = document.createElement('p');
      speaker.className = 'nre-speaker';
      speaker.textContent = view.speaker.reference;
      if (view.speaker.variant !== null) {
        beat.dataset['variant'] = view.speaker.variant;
        speaker.dataset['variant'] = view.speaker.variant;
      }
      beat.append(speaker);
    }
    const prose = document.createElement('div');
    prose.className = 'nre-prose';
    appendInline(document, prose, view.content);
    beat.append(prose);
    return beat;
  }

  function createConversationStack(
    entries: readonly Extract<RuntimeTranscriptEntry, { readonly kind: 'text' }>[],
    current: boolean,
    className = '',
  ): HTMLElement {
    const stack = document.createElement('div');
    stack.className = `nre-conversation-stack${className === '' ? '' : ` ${className}`}`;
    const previous = entries.at(-2);
    const latest = entries.at(-1);
    if (
      current &&
      previous !== undefined &&
      latest !== undefined &&
      previous.speaker !== null &&
      latest.speaker !== null
    ) {
      stack.dataset['composition'] = 'duet';
    }
    for (const [index, entry] of entries.entries()) {
      const isCurrent = current && index === entries.length - 1;
      stack.append(
        createTextBeat(entry, isCurrent ? 'current' : 'receded', entries.length - index - 1),
      );
    }
    return stack;
  }

  function renderText(view: Extract<RuntimeView, { readonly kind: 'text' }>): void {
    const recent = recentTextEntries(MAX_RETAINED_STAGE_BEATS);
    const entries = [...recent.slice(0, -1), view];
    const stack = createConversationStack(entries, true);
    const controls = document.createElement('div');
    controls.className = 'nre-controls';
    const continueButton = button(document, 'Continue', 'nre-button nre-continue');
    continueButton.addEventListener('click', () => run(() => runtime.continue()));
    controls.append(continueButton);
    stage.append(stack, controls);
    continueButton.focus({ preventScroll: true });
  }

  function renderChoices(view: Extract<RuntimeView, { readonly kind: 'choice' }>): void {
    const context = recentTextEntries(MAX_RETAINED_STAGE_BEATS);
    if (context.length > 0) {
      stage.append(createConversationStack(context, false, 'nre-choice-context'));
    }
    const decision = document.createElement('section');
    decision.className = 'nre-decision';
    decision.setAttribute('aria-labelledby', 'nre-choice-prompt');
    const heading = document.createElement('h2');
    heading.className = 'nre-prompt';
    heading.id = 'nre-choice-prompt';
    heading.textContent = 'What do you do?';
    const list = document.createElement('div');
    list.className = 'nre-choices';
    for (const option of view.options) {
      const choiceButton = button(document, option.label, 'nre-button nre-choice');
      choiceButton.addEventListener('click', () => run(() => runtime.choose(option.id)));
      list.append(choiceButton);
    }
    decision.append(heading, list);
    stage.append(decision);
    list.querySelector('button')?.focus({ preventScroll: true });
  }

  function renderEnding(view: Extract<RuntimeView, { readonly kind: 'ending' }>): void {
    const context = recentTextEntries(2);
    if (context.length > 0) {
      stage.append(createConversationStack(context, false, 'nre-ending-context'));
    }
    const ending = document.createElement('div');
    ending.className = 'nre-ending';
    ending.dataset['ending'] = view.id;
    ending.dataset['endingTone'] = String(stableVisualTone(view.id, SCENE_VISUAL_TONES));
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
    stage.dataset['sceneTone'] = String(sceneVisualTone(runtime.sceneId));
    stage.dataset['viewKind'] = view.kind;
    if (view.kind === 'text') renderText(view);
    else if (view.kind === 'choice') renderChoices(view);
    else renderEnding(view);
    renderTranscript();
  }

  function downloadSave(slot: NarrativeSaveSlotId): void {
    const content = exportSave(slot);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.hidden = true;
    link.href = url;
    link.download = `${game.title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-') || 'game'}-${slot}.save.json`;
    root.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importSelectedFile(): Promise<void> {
    const file = importInput?.files?.item(0);
    if (file === null || file === undefined) return;
    try {
      if (file.size > MAX_IMPORTED_SAVE_BYTES) {
        throw new Error('The selected save is larger than 8 MiB.');
      }
      importSave(await file.text(), selectedManualSlot());
      setSaveStatus(`${slotLabel(selectedManualSlot())} imported. Load it when ready.`);
    } catch (error) {
      setSaveStatus(errorMessage('Could not import save', error));
    } finally {
      if (importInput !== null) importInput.value = '';
    }
  }

  saveButton?.addEventListener('click', () => {
    try {
      const slot = selectedManualSlot();
      saveGame(slot);
      setSaveStatus(`${slotLabel(slot)} saved.`);
    } catch (error) {
      setSaveStatus(errorMessage('Could not save', error));
    }
  });
  loadButton?.addEventListener('click', () => {
    try {
      const slot = selectedManualSlot();
      loadGame(slot);
      if (savePanel !== null) savePanel.open = false;
      setSaveStatus(`${slotLabel(slot)} loaded.`);
    } catch (error) {
      setSaveStatus(errorMessage('Could not load', error));
    }
  });
  exportButton?.addEventListener('click', () => {
    try {
      const slot = selectedManualSlot();
      downloadSave(slot);
      setSaveStatus(`${slotLabel(slot)} exported.`);
    } catch (error) {
      setSaveStatus(errorMessage('Could not export save', error));
    }
  });
  importButton?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => void importSelectedFile());
  manualSlotSelect?.addEventListener('change', refreshSaveAvailability);
  quickSaveButton?.addEventListener('click', () => {
    try {
      saveGame('quick');
      setSaveStatus('Quick save created.');
    } catch (error) {
      setSaveStatus(errorMessage('Could not quick-save', error));
    }
  });
  quickLoadButton?.addEventListener('click', () => {
    try {
      loadGame('quick');
      if (savePanel !== null) savePanel.open = false;
      setSaveStatus('Quick save loaded.');
    } catch (error) {
      setSaveStatus(errorMessage('Could not quick-load', error));
    }
  });
  autoLoadButton?.addEventListener('click', () => {
    try {
      loadGame('auto');
      if (savePanel !== null) savePanel.open = false;
      setSaveStatus('Autosave loaded.');
    } catch (error) {
      setSaveStatus(errorMessage('Could not load autosave', error));
    }
  });
  historyPanel.addEventListener('toggle', () => {
    if (historyPanel.open && savePanel !== null) savePanel.open = false;
  });
  if (savePanel !== null) {
    const activeSavePanel = savePanel;
    activeSavePanel.addEventListener('toggle', () => {
      if (activeSavePanel.open) historyPanel.open = false;
    });
  }
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    historyPanel.open = false;
    if (savePanel !== null) savePanel.open = false;
  });

  render();
  refreshSaveAvailability();
  return {
    runtime,
    render,
    hasSave,
    listSaveSlots,
    save: saveGame,
    load: loadGame,
    exportSave,
    importSave,
    destroy() {
      root.remove();
    },
  };
}
