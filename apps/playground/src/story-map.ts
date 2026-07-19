import {
  applyStorySourceEdit,
  parseEditableStory,
  StorySourceEditError,
  type StoryItemAst,
  type StorySceneAst,
} from '@rpgnarrativeengine/editor-source';

export interface StoryMapFile {
  readonly path: string;
  readonly content: string;
}

export interface StoryMapHost {
  readonly files: () => readonly StoryMapFile[];
  readonly updateFile: (path: string, source: string) => void;
  readonly renameScene: (from: string, to: string) => void;
  readonly openScene: (path: string, sceneId: string) => void;
  readonly preview: () => void;
}

export interface StoryMapElements {
  readonly canvas: HTMLElement;
  readonly newScene: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly summary: HTMLElement;
}

interface StoryMapRecord {
  readonly file: StoryMapFile;
  readonly scenes: readonly StorySceneAst[];
  readonly issue: string | null;
}

interface StoryMapNode {
  readonly record: StoryMapRecord;
  readonly scene: StorySceneAst;
  readonly id: string;
}

interface StoryMapEdge {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly targetId: string;
  readonly kind: 'call' | 'choice' | 'goto';
  readonly label: string;
  readonly targetFrom: number;
  readonly targetTo: number;
  readonly itemFrom: number;
  readonly itemTo: number;
  readonly nested: boolean;
}

interface PositionedNode extends StoryMapNode {
  readonly x: number;
  readonly y: number;
}

const NODE_WIDTH = 292;
const NODE_HEIGHT = 268;
const COLUMN_GAP = 86;
const ROW_GAP = 44;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className !== undefined) result.className = className;
  return result;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function textButton(label: string, className = 'map-button'): HTMLButtonElement {
  const result = element('button', className);
  result.type = 'button';
  result.textContent = label;
  return result;
}

function input(value = ''): HTMLInputElement {
  const result = element('input');
  result.type = 'text';
  result.value = value;
  return result;
}

function field(labelText: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  const label = element('label', 'scene-field');
  const caption = element('span');
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function newlineFor(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function editableItems(items: readonly StoryItemAst[]): readonly StoryItemAst[] {
  return items.filter((item) => item.kind !== 'trivia');
}

function itemLineStart(item: StoryItemAst): number {
  return item.span.start.offset - Math.max(0, item.span.start.column - 1);
}

function collectEdges(
  path: string,
  sourceId: string,
  items: readonly StoryItemAst[],
  edges: StoryMapEdge[],
): void {
  for (const item of items) {
    if (item.kind === 'choice') {
      if (item.target !== null && item.targetSpan !== null) {
        edges.push({
          sourceId,
          sourcePath: path,
          targetId: String(item.target),
          kind: 'choice',
          label: item.label,
          targetFrom: item.targetSpan.start.offset,
          targetTo: item.targetSpan.end.offset,
          itemFrom: itemLineStart(item),
          itemTo: item.span.end.offset,
          nested: item.span.start.column > 1,
        });
      }
      collectEdges(path, sourceId, item.body, edges);
    } else if (item.kind === 'conditional') {
      collectEdges(path, sourceId, item.thenBranch, edges);
      if (item.elseBranch !== null) collectEdges(path, sourceId, item.elseBranch, edges);
    } else if (
      item.kind === 'command' &&
      (String(item.name) === 'goto' || String(item.name) === 'call') &&
      item.argumentsSpan !== null &&
      item.arguments.length > 0 &&
      !/\s/u.test(item.arguments.trim())
    ) {
      edges.push({
        sourceId,
        sourcePath: path,
        targetId: item.arguments.trim(),
        kind: String(item.name) === 'call' ? 'call' : 'goto',
        label: `@${String(item.name)}`,
        targetFrom: item.argumentsSpan.start.offset,
        targetTo: item.argumentsSpan.end.offset,
        itemFrom: itemLineStart(item),
        itemTo: item.span.end.offset,
        nested: item.span.start.column > 1,
      });
    }
  }
}

function layoutNodes(
  nodes: readonly StoryMapNode[],
  edges: readonly StoryMapEdge[],
): PositionedNode[] {
  if (nodes.length === 0) return [];
  const known = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!known.has(edge.targetId)) continue;
    const targets = outgoing.get(edge.sourceId) ?? [];
    if (!targets.includes(edge.targetId)) targets.push(edge.targetId);
    outgoing.set(edge.sourceId, targets);
  }
  const levels = new Map<string, number>([[nodes[0]!.id, 0]]);
  const queue = [nodes[0]!.id];
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    const nextLevel = (levels.get(source) ?? 0) + 1;
    for (const target of outgoing.get(source) ?? []) {
      if (levels.has(target)) continue;
      levels.set(target, nextLevel);
      queue.push(target);
    }
  }
  const reachableMaximum = Math.max(0, ...levels.values());
  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, reachableMaximum + 1);
  }
  const rows = new Map<number, number>();
  return nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    return {
      ...node,
      x: 36 + level * (NODE_WIDTH + COLUMN_GAP),
      y: 36 + row * (NODE_HEIGHT + ROW_GAP),
    };
  });
}

export class StoryMapEditor {
  private records: StoryMapRecord[] = [];
  private nodes: StoryMapNode[] = [];
  private edges: StoryMapEdge[] = [];

  constructor(
    private readonly host: StoryMapHost,
    private readonly elements: StoryMapElements,
  ) {
    elements.newScene.addEventListener('click', () => this.openNewSceneDialog());
  }

  refresh(): void {
    this.records = this.host
      .files()
      .filter((file) => file.path.endsWith('.story'))
      .map((file) => {
        const parsed = parseEditableStory(file.content);
        return {
          file,
          scenes: parsed.document?.scenes ?? [],
          issue:
            parsed.issues[0]?.message ??
            (parsed.document === null ? 'Invalid story source.' : null),
        };
      });
    this.nodes = this.records.flatMap((record) =>
      record.scenes.map((scene) => ({ record, scene, id: String(scene.id) })),
    );
    this.edges = [];
    for (const node of this.nodes) {
      collectEdges(node.record.file.path, node.id, node.scene.items, this.edges);
    }
    const missing = this.edges.filter(
      (edge) => !this.nodes.some((node) => node.id === edge.targetId),
    ).length;
    this.elements.summary.textContent = `${this.nodes.length} scene${this.nodes.length === 1 ? '' : 's'} · ${this.edges.length} connection${this.edges.length === 1 ? '' : 's'}${missing === 0 ? '' : ` · ${missing} missing target${missing === 1 ? '' : 's'}`}`;
    this.elements.newScene.disabled = this.records.length === 0;
    this.render();
  }

  private setStatus(message: string, error = false): void {
    this.elements.status.textContent = message;
    this.elements.status.className = error
      ? 'story-map-status story-map-error'
      : 'story-map-status';
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  private render(): void {
    this.elements.canvas.replaceChildren();
    const issue = this.records.find((record) => record.issue !== null);
    if (issue !== undefined) {
      const problem = element('div', 'story-map-empty');
      const title = element('h3');
      title.textContent = 'Story Map needs valid story source';
      const copy = element('p');
      copy.textContent = `${issue.file.path}: ${issue.issue}`;
      problem.append(title, copy);
      this.elements.canvas.append(problem);
      return;
    }
    if (this.nodes.length === 0) {
      const empty = element('div', 'story-map-empty');
      const title = element('h3');
      title.textContent = 'No scenes yet';
      const copy = element('p');
      copy.textContent = 'Create the first scene to begin mapping the story.';
      empty.append(title, copy);
      this.elements.canvas.append(empty);
      return;
    }

    const positioned = layoutNodes(this.nodes, this.edges);
    const maximumX = Math.max(...positioned.map((node) => node.x)) + NODE_WIDTH + 40;
    const maximumY = Math.max(...positioned.map((node) => node.y)) + NODE_HEIGHT + 40;
    this.elements.canvas.style.width = `${maximumX}px`;
    this.elements.canvas.style.height = `${maximumY}px`;
    const positions = new Map(positioned.map((node) => [node.id, node]));
    this.elements.canvas.append(this.renderEdges(positions, maximumX, maximumY));
    for (const node of positioned) this.elements.canvas.append(this.renderNode(node));
  }

  private renderEdges(
    positions: ReadonlyMap<string, PositionedNode>,
    width: number,
    height: number,
  ): SVGSVGElement {
    const svg = svgElement('svg');
    svg.classList.add('story-map-links');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-hidden', 'true');
    const definitions = svgElement('defs');
    const marker = svgElement('marker');
    marker.id = 'story-map-arrow';
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const arrow = svgElement('path');
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    marker.append(arrow);
    definitions.append(marker);
    svg.append(definitions);
    for (const edge of this.edges) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      if (source === undefined || target === undefined) continue;
      const startX = source.x + NODE_WIDTH;
      const startY = source.y + 74;
      const endX = target.x;
      const endY = target.y + 74;
      const bend = Math.max(48, Math.abs(endX - startX) * 0.42);
      const path = svgElement('path');
      path.classList.add('story-map-link', `story-map-link-${edge.kind}`);
      path.setAttribute(
        'd',
        `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
      );
      path.setAttribute('marker-end', 'url(#story-map-arrow)');
      svg.append(path);
    }
    return svg;
  }

  private renderNode(node: PositionedNode): HTMLElement {
    const article = element('article', 'story-map-node');
    article.style.left = `${node.x}px`;
    article.style.top = `${node.y}px`;
    article.style.width = `${NODE_WIDTH}px`;
    article.style.height = `${NODE_HEIGHT}px`;
    const header = element('header', 'story-map-node-header');
    const identity = element('div');
    const file = element('p');
    file.textContent = node.record.file.path;
    const title = element('h3');
    title.textContent = node.id;
    identity.append(file, title);
    const open = textButton('Open', 'map-button map-button-primary');
    open.addEventListener('click', () => this.host.openScene(node.record.file.path, node.id));
    header.append(identity, open);
    article.append(header);

    const outgoing = this.edges.filter((edge) => edge.sourceId === node.id);
    const metadata = element('p', 'story-map-node-meta');
    const cardCount = editableItems(node.scene.items).length;
    metadata.textContent = `${cardCount} card${cardCount === 1 ? '' : 's'} · ${outgoing.length} outgoing`;
    article.append(metadata);
    const actions = element('div', 'story-map-node-actions');
    const connect = textButton('+ Connection');
    connect.addEventListener('click', () => this.openConnectionDialog(node));
    const rename = textButton('Rename');
    rename.addEventListener('click', () => this.openRenameDialog(node.id));
    actions.append(connect, rename);
    article.append(actions);

    const edgeList = element('div', 'story-map-edge-list');
    if (outgoing.length === 0) {
      const empty = element('p', 'story-map-no-edges');
      empty.textContent = 'No outgoing connections';
      edgeList.append(empty);
    } else {
      for (const edge of outgoing) edgeList.append(this.renderEdgeControl(edge));
    }
    article.append(edgeList);
    return article;
  }

  private renderEdgeControl(edge: StoryMapEdge): HTMLElement {
    const row = element('div', 'story-map-edge-control');
    const description = element('span');
    description.className = `story-map-edge-kind story-map-edge-kind-${edge.kind}`;
    description.textContent = edge.label;
    const target = element('select');
    if (!this.nodes.some((node) => node.id === edge.targetId)) {
      const missing = element('option');
      missing.value = edge.targetId;
      missing.textContent = `Missing: ${edge.targetId}`;
      target.append(missing);
    }
    for (const node of this.nodes) {
      const option = element('option');
      option.value = node.id;
      option.textContent = node.id;
      option.selected = node.id === edge.targetId;
      target.append(option);
    }
    target.value = edge.targetId;
    target.setAttribute('aria-label', `Destination for ${edge.label}`);
    target.addEventListener('change', () =>
      this.guard(() => this.retargetEdge(edge, target.value)),
    );
    const remove = textButton('×', 'map-edge-remove');
    remove.setAttribute('aria-label', `Remove ${edge.label} connection`);
    remove.disabled = edge.nested;
    if (edge.nested) remove.title = 'Open the scene to remove a connection inside a branch.';
    remove.addEventListener('click', () => {
      if (edge.nested || !window.confirm(`Remove the ${edge.label} connection?`)) return;
      this.guard(() => this.removeEdge(edge));
    });
    row.append(description, target, remove);
    return row;
  }

  private retargetEdge(edge: StoryMapEdge, target: string): void {
    const file = this.host.files().find((candidate) => candidate.path === edge.sourcePath);
    if (file === undefined) throw new StorySourceEditError('The connection source file is closed.');
    const result = applyStorySourceEdit(file.content, {
      from: edge.targetFrom,
      to: edge.targetTo,
      insert: target,
    });
    this.host.updateFile(file.path, result.source);
    this.refresh();
    this.host.preview();
    this.setStatus(`${edge.sourceId} now connects to ${target}.`);
  }

  private removeEdge(edge: StoryMapEdge): void {
    const file = this.host.files().find((candidate) => candidate.path === edge.sourcePath);
    if (file === undefined) throw new StorySourceEditError('The connection source file is closed.');
    const result = applyStorySourceEdit(file.content, {
      from: edge.itemFrom,
      to: edge.itemTo,
      insert: '',
    });
    this.host.updateFile(file.path, result.source);
    this.refresh();
    this.host.preview();
    this.setStatus(`${edge.label} connection removed from ${edge.sourceId}.`);
  }

  private openConnectionDialog(node: StoryMapNode): void {
    if (this.nodes.length === 0) return;
    const dialog = element('dialog', 'new-scene-dialog');
    const form = element('form', 'new-scene-form');
    const title = element('h2');
    title.textContent = `Connect ${node.id}`;
    const type = element('select');
    for (const descriptor of [
      { value: 'choice', label: 'Player choice' },
      { value: 'goto', label: 'Automatic jump' },
      { value: 'call', label: 'Call and return' },
    ]) {
      const option = element('option');
      option.value = descriptor.value;
      option.textContent = descriptor.label;
      type.append(option);
    }
    const target = element('select');
    for (const candidate of this.nodes) {
      const option = element('option');
      option.value = candidate.id;
      option.textContent = candidate.id;
      target.append(option);
    }
    target.value = this.nodes.find((candidate) => candidate.id !== node.id)?.id ?? node.id;
    const label = input('Continue');
    const labelField = field('Player-facing choice', label);
    const refresh = (): void => {
      labelField.hidden = type.value !== 'choice';
    };
    type.addEventListener('change', refresh);
    const actions = element('div', 'new-scene-actions');
    const cancel = textButton('Cancel', 'button button-subtle');
    const create = element('button', 'button button-primary');
    create.type = 'submit';
    create.textContent = 'Add connection';
    actions.append(cancel, create);
    form.append(
      title,
      field('Connection type', type),
      field('Destination', target),
      labelField,
      actions,
    );
    dialog.append(form);
    document.body.append(dialog);
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.guard(() => {
        const destination = target.value;
        if (destination.length === 0) throw new StorySourceEditError('Choose a destination scene.');
        const choiceLabel = label.value.trim();
        if (type.value === 'choice' && (choiceLabel.length === 0 || /[\r\n]/u.test(choiceLabel))) {
          throw new StorySourceEditError('A player choice needs a one-line label.');
        }
        const source = node.record.file.content;
        const newline = newlineFor(source);
        const content = editableItems(node.scene.items);
        const ending = [...content]
          .reverse()
          .find((item) => item.kind === 'command' && String(item.name) === 'ending');
        const last = content.at(-1);
        const insertion =
          ending !== undefined
            ? itemLineStart(ending)
            : (last?.span.end.offset ?? node.scene.headerSpan.end.offset + newline.length);
        const insert =
          type.value === 'choice'
            ? `* ${choiceLabel} -> ${destination}${newline}`
            : `@${type.value} ${destination}${newline}`;
        const result = applyStorySourceEdit(source, { from: insertion, to: insertion, insert });
        this.host.updateFile(node.record.file.path, result.source);
        dialog.close();
        this.refresh();
        this.host.preview();
        this.setStatus(`${node.id} connected to ${destination}.`);
      });
    });
    refresh();
    dialog.showModal();
  }

  private openRenameDialog(currentId: string): void {
    const dialog = element('dialog', 'new-scene-dialog');
    const form = element('form', 'new-scene-form');
    const title = element('h2');
    title.textContent = 'Rename scene';
    const sceneId = input(currentId);
    const copy = element('p', 'scene-dialog-copy');
    copy.textContent = 'Every choice, jump, call, and project entry reference updates together.';
    const actions = element('div', 'new-scene-actions');
    const cancel = textButton('Cancel', 'button button-subtle');
    const rename = element('button', 'button button-primary');
    rename.type = 'submit';
    rename.textContent = 'Rename scene';
    actions.append(cancel, rename);
    form.append(title, copy, field('New scene ID', sceneId), actions);
    dialog.append(form);
    document.body.append(dialog);
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.guard(() => {
        const next = sceneId.value.trim();
        this.host.renameScene(currentId, next);
        dialog.close();
        this.refresh();
        this.host.preview();
        this.setStatus(`Scene ${currentId} renamed to ${next}.`);
      });
    });
    dialog.showModal();
    sceneId.focus();
    sceneId.select();
  }

  private openNewSceneDialog(): void {
    if (this.records.length === 0) return;
    const dialog = element('dialog', 'new-scene-dialog');
    const form = element('form', 'new-scene-form');
    const title = element('h2');
    title.textContent = 'Create a scene';
    const path = element('select');
    for (const record of this.records) {
      const option = element('option');
      option.value = record.file.path;
      option.textContent = record.file.path;
      path.append(option);
    }
    const sceneId = input('scene.new');
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
      this.guard(() => {
        const id = sceneId.value.trim();
        if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id)) {
          throw new StorySourceEditError(
            'Scene IDs use lowercase letters, digits, dots, dashes, or underscores.',
          );
        }
        if (this.nodes.some((node) => node.id === id)) {
          throw new StorySourceEditError(`Scene ${id} already exists.`);
        }
        const record = this.records.find((candidate) => candidate.file.path === path.value);
        if (record === undefined) throw new StorySourceEditError('Choose a story file.');
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
        const result = applyStorySourceEdit(source, {
          from: source.length,
          to: source.length,
          insert: `${separator}:: ${id}${newline}${newline}New scene.${newline}`,
        });
        this.host.updateFile(record.file.path, result.source);
        dialog.close();
        this.refresh();
        this.host.preview();
        this.setStatus(`Scene ${id} created.`);
      });
    });
    dialog.showModal();
    sceneId.focus();
    sceneId.select();
  }
}
