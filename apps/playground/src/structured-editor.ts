import {
  applyStorySourceEdit,
  parseEditableStory,
  StorySourceEditError,
  type StoryChoiceAst,
  type StoryCommandAst,
  type StoryConditionalAst,
  type StoryDocumentAst,
  type StoryItemAst,
  type StorySceneAst,
  type StoryTextAst,
} from '@rpgnarrativeengine/editor-source';

export interface StructuredEditorFile {
  readonly path: string;
  readonly content: string;
}

export interface StructuredEditorHost {
  readonly files: () => readonly StructuredEditorFile[];
  readonly updateFile: (path: string, source: string) => void;
  readonly selectFile: (path: string) => void;
  readonly openAdvancedSource: (path: string, from?: number, to?: number) => void;
  readonly preview: () => void;
}

export interface StructuredEditorElements {
  readonly sceneList: HTMLElement;
  readonly canvas: HTMLElement;
  readonly status: HTMLElement;
  readonly newScene: HTMLButtonElement;
  readonly addNarration: HTMLButtonElement;
  readonly addDialogue: HTMLButtonElement;
  readonly addChoice: HTMLButtonElement;
  readonly addState: HTMLButtonElement;
  readonly addEnding: HTMLButtonElement;
}

interface ParsedStoryFile {
  readonly file: StructuredEditorFile;
  readonly document: StoryDocumentAst | null;
  readonly issue: string | null;
}

interface SceneSelection {
  readonly path: string;
  readonly sceneId: string;
}

type EditableStoryItem = Exclude<StoryItemAst, { readonly kind: 'trivia' }>;
type NewItemKind = 'choice' | 'dialogue' | 'ending' | 'narration' | 'state';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className !== undefined) result.className = className;
  return result;
}

function textButton(label: string, className = 'scene-action'): HTMLButtonElement {
  const result = element('button', className);
  result.type = 'button';
  result.textContent = label;
  return result;
}

function newlineFor(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function lineTerminator(raw: string, fallback: '\n' | '\r\n'): string {
  if (raw.endsWith('\r\n')) return '\r\n';
  if (raw.endsWith('\n')) return '\n';
  return raw.length === 0 ? fallback : '';
}

function sourceValue(source: string, from: number, to: number): string {
  return source.slice(from, to);
}

function spanValue(
  source: string,
  span: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } },
): string {
  return sourceValue(source, span.start.offset, span.end.offset);
}

function field(
  labelText: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
) {
  const label = element('label', 'scene-field');
  const caption = element('span');
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function input(value = ''): HTMLInputElement {
  const result = element('input');
  result.type = 'text';
  result.value = value;
  return result;
}

function textarea(value: string): HTMLTextAreaElement {
  const result = element('textarea');
  result.rows = Math.max(3, Math.min(8, value.split(/\r\n|\r|\n/u).length + 1));
  result.value = value;
  return result;
}

function formLines(value: string): string[] {
  const lines = value
    .replace(/\r\n|\r/gu, '\n')
    .split('\n')
    .map((line) => line.trim());
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new StorySourceEditError('A text card cannot contain an empty line.');
  }
  return lines;
}

function escapeNarrationStart(value: string): string {
  return value.startsWith('::') ||
    value.startsWith('@') ||
    value.startsWith('*') ||
    value.startsWith('\\') ||
    /:[ \t]/u.test(value)
    ? `\\${value}`
    : value;
}

function textBody(source: string, item: StoryTextAst): string {
  if (item.mode === 'narration') return item.lines.map((line) => line.text).join('\n');
  return item.lines
    .map((line, index) => {
      const content = spanValue(source, line.contentSpan);
      if (index > 0) return content;
      const delimiter = content.indexOf(':');
      return delimiter === -1 ? content : content.slice(delimiter + 1).trimStart();
    })
    .join('\n');
}

function serializeText(
  source: string,
  item: StoryTextAst,
  mode: 'dialogue' | 'narration',
  speakerValue: string,
  variantValue: string,
  bodyValue: string,
  contentIdValue: string,
): string {
  const lines = formLines(bodyValue);
  if (mode === 'dialogue') {
    const speaker = speakerValue.trim();
    if (
      speaker.length === 0 ||
      /[\r\n]/u.test(speaker) ||
      speaker.includes(':') ||
      speaker.includes('[') ||
      speaker.includes(']')
    ) {
      throw new StorySourceEditError('Dialogue requires a speaker without colons or brackets.');
    }
    const variant = variantValue.trim();
    if (variant.length > 0 && !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(variant)) {
      throw new StorySourceEditError(
        'Dialogue variant IDs use lowercase letters, digits, dots, dashes, or underscores.',
      );
    }
    lines[0] = `${speaker}${variant.length === 0 ? '' : `[${variant}]`}: ${lines[0]}`;
  } else {
    lines[0] = escapeNarrationStart(lines[0]!);
  }

  const contentId = contentIdValue.trim();
  if (contentId.length > 0) lines[lines.length - 1] = `${lines.at(-1)} ^${contentId}`;
  const newline = newlineFor(source);
  const raw = spanValue(source, item.span);
  return `${lines.map((line, index) => (index === 0 ? line : `  ${line}`)).join(newline)}${lineTerminator(raw, newline)}`;
}

function choiceCondition(source: string, item: StoryChoiceAst): string {
  return item.conditionSpan === null ? '' : spanValue(source, item.conditionSpan);
}

function serializeChoiceHeader(
  item: StoryChoiceAst,
  labelValue: string,
  targetValue: string,
  conditionValue: string,
  contentIdValue: string,
): string {
  const label = labelValue.trim();
  if (label.length === 0 || /[\r\n]/u.test(label)) {
    throw new StorySourceEditError('A choice requires a one-line player-facing label.');
  }
  const target = targetValue.trim();
  if (item.body.length > 0 && target.length > 0) {
    throw new StorySourceEditError(
      'A choice with inline actions cannot also use a destination shortcut.',
    );
  }
  const condition = conditionValue.trim();
  const contentId = contentIdValue.trim();
  return `* ${label}${target.length === 0 ? '' : ` -> ${target}`}${condition.length === 0 ? '' : ` [when ${condition}]`}${contentId.length === 0 ? '' : ` ^${contentId}`}`;
}

function describeCommand(item: StoryCommandAst): string {
  switch (item.name) {
    case 'set':
      return 'State change';
    case 'goto':
      return 'Go to scene';
    case 'call':
      return 'Call scene';
    case 'ending':
      return 'Ending';
    default:
      return 'Action';
  }
}

export class StructuredSceneEditor {
  private parsedFiles: ParsedStoryFile[] = [];
  private selection: SceneSelection | null = null;

  constructor(
    private readonly host: StructuredEditorHost,
    private readonly elements: StructuredEditorElements,
  ) {
    elements.newScene.addEventListener('click', () => this.openNewSceneDialog());
    elements.addNarration.addEventListener('click', () => this.appendItem('narration'));
    elements.addDialogue.addEventListener('click', () => this.appendItem('dialogue'));
    elements.addChoice.addEventListener('click', () => this.appendItem('choice'));
    elements.addState.addEventListener('click', () => this.appendItem('state'));
    elements.addEnding.addEventListener('click', () => this.appendItem('ending'));
  }

  refresh(preferred: SceneSelection | null = this.selection): void {
    this.parsedFiles = this.host
      .files()
      .filter((file) => file.path.endsWith('.story'))
      .map((file) => {
        const parsed = parseEditableStory(file.content);
        return {
          file,
          document: parsed.document,
          issue: parsed.issues[0]?.message ?? null,
        };
      });

    const scenes = this.allScenes();
    this.selection =
      preferred !== null &&
      scenes.some(
        ({ record, scene }) =>
          record.file.path === preferred.path && String(scene.id) === preferred.sceneId,
      )
        ? preferred
        : scenes.length === 0
          ? null
          : { path: scenes[0]!.record.file.path, sceneId: String(scenes[0]!.scene.id) };
    this.renderSceneList();
    this.renderCanvas();
    this.setToolbarEnabled(this.selection !== null);
  }

  private allScenes(): { readonly record: ParsedStoryFile; readonly scene: StorySceneAst }[] {
    return this.parsedFiles.flatMap((record) =>
      (record.document?.scenes ?? []).map((scene) => ({ record, scene })),
    );
  }

  private selectedScene(): {
    readonly record: ParsedStoryFile;
    readonly scene: StorySceneAst;
  } | null {
    const selection = this.selection;
    if (selection === null) return null;
    return (
      this.allScenes().find(
        ({ record, scene }) =>
          record.file.path === selection.path && String(scene.id) === selection.sceneId,
      ) ?? null
    );
  }

  private setToolbarEnabled(enabled: boolean): void {
    this.elements.addNarration.disabled = !enabled;
    this.elements.addDialogue.disabled = !enabled;
    this.elements.addChoice.disabled = !enabled;
    this.elements.addState.disabled = !enabled;
    this.elements.addEnding.disabled = !enabled;
    this.elements.newScene.disabled = this.parsedFiles.length === 0;
  }

  private setStatus(message: string, error = false): void {
    this.elements.status.textContent = message;
    this.elements.status.className = error
      ? 'scene-builder-status scene-builder-error'
      : 'scene-builder-status';
  }

  private renderSceneList(): void {
    this.elements.sceneList.replaceChildren();
    for (const record of this.parsedFiles) {
      const group = element('section', 'scene-file-group');
      const heading = element('p', 'scene-file-name');
      heading.textContent = record.file.path;
      group.append(heading);
      if (record.document === null || record.issue !== null) {
        const issue = element('button', 'scene-parse-problem');
        issue.type = 'button';
        issue.textContent = record.issue ?? 'This file cannot be shown visually.';
        issue.addEventListener('click', () => this.host.openAdvancedSource(record.file.path));
        group.append(issue);
      } else {
        for (const scene of record.document.scenes) {
          const button = element('button', 'scene-nav-item');
          button.type = 'button';
          const selected =
            this.selection?.path === record.file.path &&
            this.selection.sceneId === String(scene.id);
          if (selected) button.classList.add('scene-nav-selected');
          button.setAttribute('aria-current', selected ? 'true' : 'false');
          const name = element('strong');
          name.textContent = String(scene.id);
          const count = scene.items.filter((item) => item.kind !== 'trivia').length;
          const metadata = element('span');
          metadata.textContent = `${count} ${count === 1 ? 'card' : 'cards'}`;
          button.append(name, metadata);
          button.addEventListener('click', () => {
            this.selection = { path: record.file.path, sceneId: String(scene.id) };
            this.host.selectFile(record.file.path);
            this.renderSceneList();
            this.renderCanvas();
          });
          group.append(button);
        }
      }
      this.elements.sceneList.append(group);
    }
  }

  private renderCanvas(): void {
    this.elements.canvas.replaceChildren();
    const selected = this.selectedScene();
    if (selected === null) {
      const empty = element('div', 'scene-empty');
      const title = element('h3');
      title.textContent = 'No editable scenes';
      const copy = element('p');
      copy.textContent =
        this.parsedFiles.length === 0
          ? 'Open a .story file or project to begin visually building scenes.'
          : 'Fix the source problem shown in the scene list, then return to the visual editor.';
      empty.append(title, copy);
      this.elements.canvas.append(empty);
      return;
    }

    const header = element('header', 'scene-canvas-header');
    const identity = element('div');
    const kicker = element('p', 'pane-kicker');
    kicker.textContent = selected.record.file.path;
    const title = element('h3');
    title.textContent = String(selected.scene.id);
    identity.append(kicker, title);
    const sourceButton = textButton('Advanced source', 'button button-subtle scene-source-button');
    sourceButton.addEventListener('click', () =>
      this.host.openAdvancedSource(
        selected.record.file.path,
        selected.scene.span.start.offset,
        selected.scene.span.end.offset,
      ),
    );
    header.append(identity, sourceButton);
    this.elements.canvas.append(header);

    const items = selected.scene.items.filter(
      (item): item is EditableStoryItem => item.kind !== 'trivia',
    );
    if (items.length === 0) {
      const empty = element('p', 'scene-card-empty');
      empty.textContent = 'This scene is empty. Add narration, dialogue, a choice, or an action.';
      this.elements.canvas.append(empty);
      return;
    }
    const stack = element('div', 'scene-card-stack');
    items.forEach((item, index) => {
      const card =
        item.kind === 'text'
          ? this.renderTextCard(selected.record, item, items, index)
          : item.kind === 'choice'
            ? this.renderChoiceCard(selected.record, item, items, index)
            : item.kind === 'command'
              ? this.renderCommandCard(selected.record, item, items, index)
              : this.renderConditionalCard(selected.record, item, items, index);
      stack.append(card);
    });
    this.elements.canvas.append(stack);
  }

  private cardShell(label: string, kind: string): HTMLElement {
    const card = element('article', `scene-card scene-card-${kind}`);
    const labelElement = element('p', 'scene-card-kind');
    labelElement.textContent = label;
    card.append(labelElement);
    return card;
  }

  private renderTextCard(
    record: ParsedStoryFile,
    item: StoryTextAst,
    items: readonly EditableStoryItem[],
    index: number,
  ): HTMLElement {
    const card = this.cardShell(item.mode === 'dialogue' ? 'Dialogue' : 'Narration', item.mode);
    const form = element('form', 'scene-card-form');
    const mode = element('select');
    for (const value of ['narration', 'dialogue'] as const) {
      const option = element('option');
      option.value = value;
      option.textContent = value === 'narration' ? 'Narration' : 'Dialogue';
      option.selected = item.mode === value;
      mode.append(option);
    }
    const speaker = input(item.speaker?.reference ?? '');
    const variant = input(
      item.speaker?.variant === null ? '' : String(item.speaker?.variant ?? ''),
    );
    const body = textarea(textBody(record.file.content, item));
    const contentId = input(item.contentId === null ? '' : String(item.contentId));
    const speakerFields = element('div', 'scene-field-row');
    speakerFields.append(field('Speaker', speaker), field('Variant', variant));
    const updateSpeakerVisibility = (): void => {
      speakerFields.hidden = mode.value !== 'dialogue';
    };
    mode.addEventListener('change', updateSpeakerVisibility);
    updateSpeakerVisibility();
    form.append(
      field('Card type', mode),
      speakerFields,
      field('Text', body),
      field('Content ID', contentId),
    );
    form.append(
      this.cardActions(record, item, items, index, () => {
        const insert = serializeText(
          record.file.content,
          item,
          mode.value === 'dialogue' ? 'dialogue' : 'narration',
          speaker.value,
          variant.value,
          body.value,
          contentId.value,
        );
        this.applyEdit(
          record.file.path,
          item.span.start.offset,
          item.span.end.offset,
          insert,
          'Text card updated.',
        );
      }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.querySelector<HTMLButtonElement>('[data-save-card="true"]')?.click();
    });
    card.append(form);
    return card;
  }

  private renderChoiceCard(
    record: ParsedStoryFile,
    item: StoryChoiceAst,
    items: readonly EditableStoryItem[],
    index: number,
  ): HTMLElement {
    const card = this.cardShell('Choice', 'choice');
    const form = element('form', 'scene-card-form');
    const label = input(item.label);
    const target = element('select');
    const inlineOption = element('option');
    inlineOption.value = '';
    inlineOption.textContent = item.body.length > 0 ? 'Inline actions' : 'No destination';
    target.append(inlineOption);
    for (const { scene } of this.allScenes()) {
      const option = element('option');
      option.value = String(scene.id);
      option.textContent = String(scene.id);
      option.selected = String(item.target ?? '') === String(scene.id);
      target.append(option);
    }
    target.value = item.target === null ? '' : String(item.target);
    target.disabled = item.body.length > 0;
    const condition = input(choiceCondition(record.file.content, item));
    condition.placeholder = 'Optional, for example trust >= 2';
    const contentId = input(item.contentId === null ? '' : String(item.contentId));
    form.append(
      field('Player-facing choice', label),
      field('Destination scene', target),
      field('Show when', condition),
      field('Content ID', contentId),
    );
    if (item.body.length > 0) {
      const note = element('p', 'scene-card-note');
      note.textContent = `${item.body.length} inline action${item.body.length === 1 ? '' : 's'} preserved below this choice.`;
      form.append(note);
    }
    form.append(
      this.cardActions(record, item, items, index, () => {
        const insert = serializeChoiceHeader(
          item,
          label.value,
          target.value,
          condition.value,
          contentId.value,
        );
        this.applyEdit(
          record.file.path,
          item.headerSpan.start.offset,
          item.headerSpan.end.offset,
          insert,
          'Choice updated.',
        );
      }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.querySelector<HTMLButtonElement>('[data-save-card="true"]')?.click();
    });
    card.append(form);
    return card;
  }

  private renderCommandCard(
    record: ParsedStoryFile,
    item: StoryCommandAst,
    items: readonly EditableStoryItem[],
    index: number,
  ): HTMLElement {
    const card = this.cardShell(describeCommand(item), 'command');
    const form = element('form', 'scene-card-form');
    const name = input(String(item.name));
    const argumentsInput = input(item.arguments);
    form.append(field('Action', name), field('Value', argumentsInput));
    form.append(
      this.cardActions(record, item, items, index, () => {
        const normalizedName = name.value.trim();
        if (!/^[a-z][a-z0-9-]*$/u.test(normalizedName)) {
          throw new StorySourceEditError('Action names use lowercase letters, digits, and dashes.');
        }
        const argumentsValue = argumentsInput.value.trim();
        const insert = `@${normalizedName}${argumentsValue.length === 0 ? '' : ` ${argumentsValue}`}`;
        this.applyEdit(
          record.file.path,
          item.headerSpan.start.offset,
          item.headerSpan.end.offset,
          insert,
          'Action updated.',
        );
      }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.querySelector<HTMLButtonElement>('[data-save-card="true"]')?.click();
    });
    card.append(form);
    return card;
  }

  private renderConditionalCard(
    record: ParsedStoryFile,
    item: StoryConditionalAst,
    items: readonly EditableStoryItem[],
    index: number,
  ): HTMLElement {
    const card = this.cardShell('Condition', 'conditional');
    const condition = element('p', 'condition-summary');
    condition.textContent = spanValue(record.file.content, item.conditionSpan);
    const detail = element('p', 'scene-card-note');
    const branchCount = item.thenBranch.length + (item.elseBranch?.length ?? 0);
    detail.textContent = `${branchCount} nested card${branchCount === 1 ? '' : 's'} preserved. Structured branch editing is the next condition-builder increment.`;
    card.append(condition, detail);
    card.append(this.cardActions(record, item, items, index));
    return card;
  }

  private cardActions(
    record: ParsedStoryFile,
    item: EditableStoryItem,
    items: readonly EditableStoryItem[],
    index: number,
    save?: () => void,
  ): HTMLElement {
    const actions = element('div', 'scene-card-actions');
    if (save !== undefined) {
      const saveButton = textButton('Save card', 'button button-primary scene-save-card');
      saveButton.dataset['saveCard'] = 'true';
      saveButton.addEventListener('click', () => this.guardEdit(save));
      actions.append(saveButton);
    }
    const up = textButton('Move up');
    up.disabled = index === 0;
    up.addEventListener('click', () =>
      this.guardEdit(() => this.moveItem(record, items, index, -1)),
    );
    const down = textButton('Move down');
    down.disabled = index === items.length - 1;
    down.addEventListener('click', () =>
      this.guardEdit(() => this.moveItem(record, items, index, 1)),
    );
    const duplicate = textButton('Duplicate');
    duplicate.addEventListener('click', () =>
      this.guardEdit(() => {
        const raw = spanValue(record.file.content, item.span);
        this.applyEdit(
          record.file.path,
          item.span.end.offset,
          item.span.end.offset,
          raw,
          'Card duplicated.',
        );
      }),
    );
    const source = textButton('Source');
    source.addEventListener('click', () =>
      this.host.openAdvancedSource(record.file.path, item.span.start.offset, item.span.end.offset),
    );
    const remove = textButton('Remove', 'scene-action scene-action-danger');
    remove.addEventListener('click', () => {
      if (!window.confirm('Remove this card from the scene?')) return;
      this.guardEdit(() =>
        this.applyEdit(
          record.file.path,
          item.span.start.offset,
          item.span.end.offset,
          '',
          'Card removed.',
        ),
      );
    });
    actions.append(up, down, duplicate, source, remove);
    return actions;
  }

  private moveItem(
    record: ParsedStoryFile,
    items: readonly EditableStoryItem[],
    index: number,
    direction: -1 | 1,
  ): void {
    const current = items[index];
    const other = items[index + direction];
    if (current === undefined || other === undefined) return;
    const first = direction === -1 ? other : current;
    const second = direction === -1 ? current : other;
    const between = sourceValue(
      record.file.content,
      first.span.end.offset,
      second.span.start.offset,
    );
    const insert = `${spanValue(record.file.content, second.span)}${between}${spanValue(record.file.content, first.span)}`;
    this.applyEdit(
      record.file.path,
      first.span.start.offset,
      second.span.end.offset,
      insert,
      direction === -1 ? 'Card moved up.' : 'Card moved down.',
    );
  }

  private guardEdit(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  private applyEdit(
    path: string,
    from: number,
    to: number,
    insert: string,
    message: string,
    nextSelection: SceneSelection | null = this.selection,
  ): void {
    const file = this.host.files().find((candidate) => candidate.path === path);
    if (file === undefined) throw new StorySourceEditError(`Story file ${path} is no longer open.`);
    const result = applyStorySourceEdit(file.content, { from, to, insert });
    this.host.updateFile(path, result.source);
    this.selection = nextSelection;
    this.refresh(nextSelection);
    this.host.preview();
    this.setStatus(message);
  }

  private appendItem(kind: NewItemKind): void {
    this.guardEdit(() => {
      const selected = this.selectedScene();
      if (selected === null) throw new StorySourceEditError('Select a scene before adding a card.');
      const source = selected.record.file.content;
      const newline = newlineFor(source);
      const lastContentItem = [...selected.scene.items]
        .reverse()
        .find((item) => item.kind !== 'trivia');
      const insertion =
        lastContentItem?.span.end.offset ?? selected.scene.headerSpan.end.offset + newline.length;
      const otherScene = this.allScenes().find(
        ({ scene }) => String(scene.id) !== String(selected.scene.id),
      )?.scene;
      const target = String(otherScene?.id ?? selected.scene.id);
      const value =
        kind === 'narration'
          ? `New narration.${newline}`
          : kind === 'dialogue'
            ? `Speaker: New dialogue.${newline}`
            : kind === 'choice'
              ? `* Continue -> ${target}${newline}`
              : kind === 'state'
                ? `@set state.value = 0${newline}`
                : `@ending ending "Ending"${newline}`;
      this.applyEdit(
        selected.record.file.path,
        insertion,
        insertion,
        value,
        `${kind[0]!.toUpperCase()}${kind.slice(1)} card added.`,
      );
    });
  }

  private openNewSceneDialog(): void {
    if (this.parsedFiles.length === 0) return;
    const dialog = element('dialog', 'new-scene-dialog');
    const form = element('form', 'new-scene-form');
    const title = element('h2');
    title.textContent = 'Create a scene';
    const path = element('select');
    for (const record of this.parsedFiles) {
      const option = element('option');
      option.value = record.file.path;
      option.textContent = record.file.path;
      option.selected = record.file.path === this.selection?.path;
      path.append(option);
    }
    const sceneId = input('scene.new');
    sceneId.autocomplete = 'off';
    const actions = element('div', 'new-scene-actions');
    const cancel = textButton('Cancel', 'button button-subtle');
    const create = element('button', 'button button-primary');
    create.type = 'submit';
    create.textContent = 'Create scene';
    actions.append(cancel, create);
    form.append(title, field('Story file', path), field('Scene ID', sceneId), actions);
    dialog.append(form);
    document.body.append(dialog);
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.guardEdit(() => {
        const id = sceneId.value.trim();
        if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id)) {
          throw new StorySourceEditError(
            'Scene IDs use lowercase letters, digits, dots, dashes, or underscores.',
          );
        }
        if (this.allScenes().some(({ scene }) => String(scene.id) === id)) {
          throw new StorySourceEditError(`Scene ${id} already exists.`);
        }
        const record = this.parsedFiles.find((candidate) => candidate.file.path === path.value);
        if (record === undefined) throw new StorySourceEditError('Select a story file.');
        const source = record.file.content;
        const newline = newlineFor(source);
        const separator =
          source.length === 0
            ? ''
            : source.endsWith(`${newline}${newline}`)
              ? ''
              : source.endsWith(newline)
                ? newline
                : `${newline}${newline}`;
        dialog.close();
        this.applyEdit(
          record.file.path,
          source.length,
          source.length,
          `${separator}:: ${id}${newline}${newline}New scene.${newline}`,
          `Scene ${id} created.`,
          { path: record.file.path, sceneId: id },
        );
      });
    });
    dialog.showModal();
    sceneId.focus();
    sceneId.select();
  }
}
