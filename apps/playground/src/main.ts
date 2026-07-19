import {
  buildWebProject,
  configuredWebBuildTargets,
  type BuildOutputFile,
  type BuildProjectResult,
  type WebBuildTarget,
} from '@rpgnarrativeengine/build';
import {
  compileStory,
  compileStoryProject,
  StoryCompileError,
  type CompileIssue,
} from '@rpgnarrativeengine/compiler';
import {
  deleteStoryScene,
  duplicateStoryScene,
  renameStoryScene,
} from '@rpgnarrativeengine/editor-source';
import { mountNarrativePlayer, type NarrativePlayerController } from '@rpgnarrativeengine/player';
import {
  loadNarrativeProject,
  ProjectLoadError,
  type ProjectFileInput,
} from '@rpgnarrativeengine/project';

import {
  EDITOR_METADATA_PATH,
  parseStoryMapLayout,
  serializeStoryMapLayout,
  type StoryMapPosition,
} from './editor-metadata.js';
import { renameProjectEntryScene } from './project-source.js';
import starterStory from './starter.story?raw';
import { StoryMapEditor, type StoryMapElements } from './story-map.js';
import { StructuredSceneEditor, type StructuredEditorElements } from './structured-editor.js';
import './style.css';

const STORAGE_KEY = 'rpgnarrativeengine.playground.story';
const LAYOUT_STORAGE_KEY = 'rpgnarrativeengine.playground.story-map';

interface EditorFile {
  path: string;
  content: string;
}

interface ScratchSession {
  readonly kind: 'scratch';
  name: string;
  readonly files: EditorFile[];
}

interface ProjectSession {
  readonly kind: 'project';
  name: string;
  readonly rootName: string | null;
  readonly files: EditorFile[];
}

type EditorSession = ProjectSession | ScratchSession;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing playground element ${selector}.`);
  return element;
}

const editor = required<HTMLTextAreaElement>('#story-source');
const player = required<HTMLElement>('#player');
const diagnostics = required<HTMLElement>('#diagnostics');
const compileStatus = required<HTMLElement>('#compile-status');
const sourceStats = required<HTMLElement>('#source-stats');
const editorHint = required<HTMLElement>('#editor-hint');
const projectName = required<HTMLElement>('#project-name');
const sourceFile = required<HTMLSelectElement>('#source-file');
const runButton = required<HTMLButtonElement>('#run-button');
const resetButton = required<HTMLButtonElement>('#reset-button');
const openButton = required<HTMLButtonElement>('#open-button');
const projectButton = required<HTMLButtonElement>('#project-button');
const downloadButton = required<HTMLButtonElement>('#download-button');
const buildButton = required<HTMLButtonElement>('#build-button');
const fileInput = required<HTMLInputElement>('#file-input');
const projectInput = required<HTMLInputElement>('#project-input');
const buildDialog = required<HTMLDialogElement>('#build-dialog');
const buildTargets = required<HTMLFieldSetElement>('#build-targets');
const targetWebZip = required<HTMLInputElement>('#target-web-zip');
const targetWebSingle = required<HTMLInputElement>('#target-web-single');
const startBuildButton = required<HTMLButtonElement>('#start-build-button');
const buildProgress = required<HTMLElement>('#build-progress');
const buildResults = required<HTMLElement>('#build-results');
const buildHash = required<HTMLElement>('#build-hash');
const artifactList = required<HTMLElement>('#artifact-list');
const visualModeButton = required<HTMLButtonElement>('#visual-mode-button');
const storyMapModeButton = required<HTMLButtonElement>('#story-map-mode-button');
const sourceModeButton = required<HTMLButtonElement>('#source-mode-button');
const sceneBuilderRoot = required<HTMLElement>('#scene-builder');
const storyMapRoot = required<HTMLElement>('#story-map');
const sourceEditorWrap = required<HTMLElement>('#source-editor-wrap');
const structuredEditorElements: StructuredEditorElements = {
  sceneList: required<HTMLElement>('#scene-list'),
  canvas: required<HTMLElement>('#scene-canvas'),
  status: required<HTMLElement>('#scene-builder-status'),
  newScene: required<HTMLButtonElement>('#new-scene-button'),
  addNarration: required<HTMLButtonElement>('#add-narration-button'),
  addDialogue: required<HTMLButtonElement>('#add-dialogue-button'),
  addChoice: required<HTMLButtonElement>('#add-choice-button'),
  addCondition: required<HTMLButtonElement>('#add-condition-button'),
  addState: required<HTMLButtonElement>('#add-state-button'),
  addEnding: required<HTMLButtonElement>('#add-ending-button'),
};
const storyMapElements: StoryMapElements = {
  canvas: required<HTMLElement>('#story-map-canvas'),
  downloadLayout: required<HTMLButtonElement>('#story-map-download-layout-button'),
  newScene: required<HTMLButtonElement>('#story-map-new-scene-button'),
  resetLayout: required<HTMLButtonElement>('#story-map-reset-layout-button'),
  status: required<HTMLElement>('#story-map-status'),
  summary: required<HTMLElement>('#story-map-summary'),
  viewport: required<HTMLElement>('.story-map-viewport'),
};

let controller: NarrativePlayerController | null = null;
let session: EditorSession;
let activePath = '';
let structuredEditor: StructuredSceneEditor | null = null;
let storyMap: StoryMapEditor | null = null;
let authoringMode: 'map' | 'source' | 'visual' = 'visual';

function savedSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? starterStory;
  } catch {
    return starterStory;
  }
}

function saveScratchSource(source: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // The playground remains usable when storage is blocked or full.
  }
}

function scratchLayoutSource(): string | null {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function editorMetadataFile(): EditorFile | undefined {
  return session.files.find((file) => file.path === EDITOR_METADATA_PATH);
}

function editorMetadataSource(): string | null {
  return session.kind === 'scratch'
    ? scratchLayoutSource()
    : (editorMetadataFile()?.content ?? null);
}

function storyMapLayout(): {
  readonly positions: Readonly<Record<string, StoryMapPosition>>;
  readonly issue: string | null;
} {
  try {
    return { positions: parseStoryMapLayout(editorMetadataSource()).positions, issue: null };
  } catch (error) {
    return {
      positions: Object.freeze({}),
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

function saveStoryMapLayout(
  positions: Readonly<Record<string, StoryMapPosition>>,
  replaceInvalid = false,
): void {
  const source = serializeStoryMapLayout(replaceInvalid ? null : editorMetadataSource(), positions);
  if (session.kind === 'scratch') {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, source);
    } catch {
      throw new Error('The Story Map layout could not be stored in this browser.');
    }
    return;
  }
  const current = editorMetadataFile();
  if (current === undefined) session.files.push({ path: EDITOR_METADATA_PATH, content: source });
  else current.content = source;
}

function clearStoryMapLayout(): void {
  saveStoryMapLayout(Object.freeze({}), true);
}

function updateLifecycleLayout(
  mutator: (positions: Record<string, StoryMapPosition>) => void,
): string {
  const layout = storyMapLayout();
  if (layout.issue !== null) return ` Layout metadata was not updated: ${layout.issue}`;
  try {
    const positions = { ...layout.positions };
    mutator(positions);
    saveStoryMapLayout(positions);
    return '';
  } catch (error) {
    return ` Layout metadata was not updated: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function currentFile(): EditorFile {
  const file = session.files.find((candidate) => candidate.path === activePath);
  if (file === undefined)
    throw new Error(`The active source file ${JSON.stringify(activePath)} is missing.`);
  return file;
}

function sourcePosition(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split(/\r\n|\n/u);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function updateStats(): void {
  const lineCount = editor.value.length === 0 ? 0 : editor.value.split(/\r\n|\n/u).length;
  const fileCount = session.files.filter((file) => file.path !== EDITOR_METADATA_PATH).length;
  sourceStats.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} \u00b7 ${editor.value.length} characters${fileCount > 1 ? ` \u00b7 ${fileCount} files` : ''}`;
}

function setAuthoringMode(mode: 'map' | 'source' | 'visual'): void {
  authoringMode = mode;
  const visual = mode === 'visual';
  const map = mode === 'map';
  const source = mode === 'source';
  sceneBuilderRoot.hidden = !visual;
  storyMapRoot.hidden = !map;
  sourceEditorWrap.hidden = !source;
  visualModeButton.classList.toggle('authoring-tab-active', visual);
  storyMapModeButton.classList.toggle('authoring-tab-active', map);
  sourceModeButton.classList.toggle('authoring-tab-active', source);
  visualModeButton.setAttribute('aria-selected', String(visual));
  storyMapModeButton.setAttribute('aria-selected', String(map));
  sourceModeButton.setAttribute('aria-selected', String(source));
  editorHint.textContent = visual
    ? 'Visual changes update the same portable story files.'
    : map
      ? 'Connections and scene refactors update the same portable story files.'
      : 'Ctrl/⌘ + Enter runs the current project.';
  if (visual) structuredEditor?.refresh();
  if (map) storyMap?.refresh();
}

function markBuildStale(): void {
  if (session.kind === 'project' && !buildResults.hidden) {
    buildResults.hidden = true;
    buildProgress.textContent = 'Project changed. Build again to refresh the artifacts.';
  }
}

function refreshFileSelector(): void {
  sourceFile.replaceChildren();
  for (const file of session.files.filter((candidate) => candidate.path !== EDITOR_METADATA_PATH)) {
    const option = document.createElement('option');
    option.value = file.path;
    option.textContent = file.path;
    sourceFile.append(option);
  }
  sourceFile.value = activePath;
  projectName.textContent =
    session.kind === 'project'
      ? `${session.name}${session.rootName === null ? '' : ` \u00b7 ${session.rootName}`}`
      : session.name;
  buildButton.disabled = session.kind !== 'project';
  buildButton.title =
    session.kind === 'project' ? 'Package this project' : 'Open a project directory to build it';
}

function activateFile(path: string, focus = false): void {
  const file = session.files.find((candidate) => candidate.path === path);
  if (file === undefined) return;
  activePath = path;
  sourceFile.value = path;
  editor.value = file.content;
  editor.scrollTop = 0;
  updateStats();
  structuredEditor?.refresh();
  storyMap?.refresh();
  if (focus) editor.focus();
}

function updateStructuredFile(path: string, source: string): void {
  updateStructuredFiles([{ path, source }], path);
}

function updateStructuredFiles(
  updates: readonly { readonly path: string; readonly source: string }[],
  preferredPath = activePath,
): void {
  const files = updates.map((update) => {
    const file = session.files.find((candidate) => candidate.path === update.path);
    if (file === undefined) {
      throw new Error(`Source file ${JSON.stringify(update.path)} is not open.`);
    }
    return { file, source: update.source };
  });
  for (const update of files) update.file.content = update.source;
  if (session.kind === 'scratch') saveScratchSource(session.files[0]?.content ?? '');
  const selected = session.files.find((file) => file.path === preferredPath) ?? currentFile();
  activePath = selected.path;
  sourceFile.value = selected.path;
  editor.value = selected.content;
  markBuildStale();
  updateStats();
}

function renameProjectScene(from: string, to: string): string {
  const storyUpdates = renameStoryScene(
    session.files
      .filter((file) => file.path.endsWith('.story'))
      .map((file) => ({ path: file.path, source: file.content })),
    from,
    to,
  );
  const updates = [...storyUpdates];
  const manifest = session.files.find((file) => file.path === 'project.toml');
  if (manifest !== undefined) {
    const source = renameProjectEntryScene(manifest.content, from, to);
    if (source !== manifest.content) updates.push({ path: manifest.path, source });
  }
  updateStructuredFiles(updates);
  return updateLifecycleLayout((positions) => {
    const current = positions[from];
    delete positions[from];
    if (current !== undefined) positions[to] = current;
  });
}

function duplicateProjectScene(
  from: string,
  to: string,
  targetPath: string,
  retargetSelfReferences: boolean,
): string {
  const updates = duplicateStoryScene(
    session.files
      .filter((file) => file.path.endsWith('.story'))
      .map((file) => ({ path: file.path, source: file.content })),
    { from, to, targetPath, retargetSelfReferences },
  );
  updateStructuredFiles(updates, targetPath);
  return updateLifecycleLayout((positions) => {
    const current = positions[from];
    if (current !== undefined) positions[to] = { x: current.x + 36, y: current.y + 36 };
  });
}

function deleteProjectScene(sceneId: string, replacementId: string): string {
  const storyUpdates = deleteStoryScene(
    session.files
      .filter((file) => file.path.endsWith('.story'))
      .map((file) => ({ path: file.path, source: file.content })),
    sceneId,
    replacementId,
  );
  const updates = [...storyUpdates];
  const manifest = session.files.find((file) => file.path === 'project.toml');
  if (manifest !== undefined) {
    const source = renameProjectEntryScene(manifest.content, sceneId, replacementId);
    if (source !== manifest.content) updates.push({ path: manifest.path, source });
  }
  const replacementPath = session.files.find(
    (file) => file.path.endsWith('.story') && storyFileDeclaresScene(file.content, replacementId),
  )?.path;
  updateStructuredFiles(updates, replacementPath ?? activePath);
  return updateLifecycleLayout((positions) => {
    delete positions[sceneId];
  });
}

function openAdvancedSource(path: string, from = 0, to = from): void {
  setAuthoringMode('source');
  activateFile(path);
  const start = Math.min(Math.max(0, from), editor.value.length);
  const end = Math.min(Math.max(start, to), editor.value.length);
  editor.focus();
  editor.setSelectionRange(start, end);
}

function setSession(next: EditorSession, preferredPath?: string): void {
  session = next;
  structuredEditorElements.status.textContent = '';
  storyMapElements.status.textContent = '';
  activePath =
    preferredPath !== undefined && next.files.some((file) => file.path === preferredPath)
      ? preferredPath
      : (next.files[0]?.path ?? '');
  refreshFileSelector();
  activateFile(activePath);
}

function sourceForIssue(issue: CompileIssue): string {
  if (issue.path !== undefined) {
    const file = session.files.find((candidate) => candidate.path === issue.path);
    if (file !== undefined) return file.content;
  }
  return currentFile().content;
}

function focusIssue(issue: CompileIssue): void {
  setAuthoringMode('source');
  if (issue.path !== undefined) activateFile(issue.path);
  const source = editor.value;
  const start = Math.min(Math.max(0, issue.from), source.length);
  const end = Math.min(source.length, Math.max(start + 1, issue.to));
  editor.focus();
  editor.setSelectionRange(start, end);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
  const position = sourcePosition(source, start);
  editor.scrollTop = Math.max(0, (position.line - 4) * lineHeight);
}

function showIssues(issues: readonly CompileIssue[]): void {
  diagnostics.replaceChildren();
  diagnostics.hidden = false;
  const heading = document.createElement('p');
  heading.className = 'diagnostic-heading';
  heading.textContent = `${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} to fix`;
  const list = document.createElement('ul');
  for (const current of issues) {
    const position = sourcePosition(sourceForIssue(current), current.from);
    const item = document.createElement('li');
    const issueButton = document.createElement('button');
    issueButton.type = 'button';
    issueButton.className = 'diagnostic';
    const location = document.createElement('span');
    location.className = 'diagnostic-location';
    location.textContent = `${current.path === undefined ? '' : `${current.path}:`}${position.line}:${position.column}`;
    location.title = location.textContent;
    const message = document.createElement('span');
    message.textContent = current.message;
    issueButton.append(location, message);
    issueButton.addEventListener('click', () => focusIssue(current));
    item.append(issueButton);
    list.append(item);
  }
  diagnostics.append(heading, list);
}

function projectCompileIssues(error: ProjectLoadError): readonly CompileIssue[] {
  return error.issues.map((current) => ({
    code: current.code,
    message: current.message,
    from: 0,
    to: 0,
    path: current.path ?? 'project.toml',
  }));
}

function clearPlayer(): void {
  controller?.destroy();
  controller = null;
  player.replaceChildren();
}

function prepareRun(): void {
  clearPlayer();
  diagnostics.replaceChildren();
  diagnostics.hidden = true;
}

function showUnexpectedError(error: unknown): void {
  showIssues([
    {
      code: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
      from: 0,
      to: 0,
      ...(session.kind === 'project' ? { path: 'project.toml' } : {}),
    },
  ]);
}

function runStory(): void {
  prepareRun();
  try {
    if (session.kind === 'project') {
      const project = loadNarrativeProject(session.files);
      session.name = project.manifest.project.title;
      refreshFileSelector();
      const game = compileStoryProject(
        project.storyFiles.map(({ path, source }) => ({ path, source })),
        {
          title: project.manifest.project.title,
          startSceneId: project.manifest.project.entryScene,
        },
      );
      controller = mountNarrativePlayer(player, game);
      compileStatus.className = 'compile-status compile-success';
      compileStatus.textContent = `Ready \u00b7 ${Object.keys(game.scenes).length} scenes \u00b7 ${project.storyFiles.length} story files`;
      return;
    }

    const source = currentFile().content;
    saveScratchSource(source);
    const game = compileStory(source, { title: session.name });
    controller = mountNarrativePlayer(player, game);
    compileStatus.className = 'compile-status compile-success';
    compileStatus.textContent = `Ready \u00b7 ${Object.keys(game.scenes).length} scenes`;
  } catch (error) {
    compileStatus.className = 'compile-status compile-error';
    compileStatus.textContent = 'Could not run';
    if (error instanceof StoryCompileError) {
      showIssues(error.issues);
    } else if (error instanceof ProjectLoadError) {
      showIssues(projectCompileIssues(error));
    } else {
      showUnexpectedError(error);
    }
  }
}

function blobPart(content: string | Uint8Array): BlobPart {
  if (typeof content === 'string') return content;
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  return buffer;
}

function downloadFile(filename: string, mimeType: string, content: string | Uint8Array): void {
  const blob = new Blob([blobPart(content)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadSource(): void {
  const file = currentFile();
  downloadFile(
    file.path.split('/').at(-1) ?? 'main.story',
    'text/plain;charset=utf-8',
    file.content,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function artifactCard(
  label: string,
  description: string,
  buttonLabel: string,
  file: BuildOutputFile,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'artifact-card';
  const copy = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'artifact-name';
  name.textContent = label;
  const metadata = document.createElement('p');
  metadata.className = 'artifact-meta';
  metadata.textContent = `${description} \u00b7 ${formatBytes(file.size)}`;
  copy.append(name, metadata);
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'button button-subtle';
  download.textContent = buttonLabel;
  download.addEventListener('click', () => {
    downloadFile(file.path.split('/').at(-1) ?? file.path, file.mimeType, file.content);
  });
  card.append(copy, download);
  return card;
}

function renderBuildResult(result: BuildProjectResult): void {
  artifactList.replaceChildren();
  for (const artifact of result.artifacts) {
    if (artifact.kind !== 'file') continue;
    if (artifact.target === 'web-zip') {
      artifactList.append(
        artifactCard(
          'Static web ZIP',
          'Extract and upload to an ordinary static host',
          'Download ZIP',
          artifact.file,
        ),
      );
    } else if (artifact.target === 'web-single') {
      artifactList.append(
        artifactCard(
          'Single HTML',
          'Self-contained and directly runnable',
          'Download HTML',
          artifact.file,
        ),
      );
    }
  }
  const manifest = result.outputFiles.find((file) => file.path === 'artifact-manifest.json');
  if (manifest !== undefined) {
    artifactList.append(
      artifactCard(
        'Artifact manifest',
        'Checksums and build identity for the generated files',
        'Download JSON',
        manifest,
      ),
    );
  }
  buildHash.textContent = `Bundle ${result.gameBundleHash}`;
  buildHash.title = result.gameBundleHash;
  buildResults.hidden = false;
}

function buildFailure(error: unknown): void {
  buildProgress.className = 'build-progress build-error';
  buildProgress.textContent = error instanceof Error ? error.message : String(error);
  compileStatus.className = 'compile-status compile-error';
  compileStatus.textContent = 'Build failed';
  if (error instanceof StoryCompileError) showIssues(error.issues);
  else if (error instanceof ProjectLoadError) showIssues(projectCompileIssues(error));
}

function openBuildDialog(): void {
  if (session.kind !== 'project') return;
  buildResults.hidden = true;
  artifactList.replaceChildren();
  buildProgress.className = 'build-progress';
  try {
    const project = loadNarrativeProject(session.files);
    const targets = configuredWebBuildTargets(project.manifest);
    targetWebZip.checked = targets.includes('web') || targets.includes('web-zip');
    targetWebSingle.checked = targets.includes('web-single');
    buildProgress.textContent = `${project.manifest.project.title} \u00b7 ${project.manifest.build.profile} profile`;
  } catch (error) {
    targetWebZip.checked = false;
    targetWebSingle.checked = false;
    buildFailure(error);
  }
  buildDialog.showModal();
}

async function startBuild(): Promise<void> {
  if (session.kind !== 'project') return;
  const targets: WebBuildTarget[] = [];
  if (targetWebZip.checked) targets.push('web-zip');
  if (targetWebSingle.checked) targets.push('web-single');
  if (targets.length === 0) {
    buildProgress.className = 'build-progress build-error';
    buildProgress.textContent = 'Select at least one output.';
    return;
  }

  startBuildButton.disabled = true;
  buildTargets.disabled = true;
  buildResults.hidden = true;
  buildProgress.className = 'build-progress';
  try {
    const result = await buildWebProject({
      files: session.files,
      targets,
      onProgress(event) {
        buildProgress.textContent = event.message;
      },
    });
    renderBuildResult(result);
    buildProgress.textContent = `${result.artifacts.length - 1} distributable outputs created`;
  } catch (error) {
    buildFailure(error);
  } finally {
    startBuildButton.disabled = false;
    buildTargets.disabled = false;
  }
}

function selectedPath(file: File): string {
  return file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;
}

function storyFileDeclaresScene(source: string, sceneId: string): boolean {
  return source.split(/\r\n|\n/u).some((line) => {
    const header = line.trim();
    return header.startsWith('::') && header.slice(2).trim() === sceneId;
  });
}

async function openProjectSelection(fileList: FileList): Promise<void> {
  const readable = [...fileList].filter((file) => {
    const path = selectedPath(file);
    return (
      path.endsWith('/project.toml') ||
      path === 'project.toml' ||
      path.endsWith('.story') ||
      path.endsWith(`/${EDITOR_METADATA_PATH}`) ||
      path === EDITOR_METADATA_PATH
    );
  });
  const files: ProjectFileInput[] = await Promise.all(
    readable.map(async (file) => ({ path: selectedPath(file), content: await file.text() })),
  );
  const project = loadNarrativeProject(files);
  const next: ProjectSession = {
    kind: 'project',
    name: project.manifest.project.title,
    rootName: project.rootName,
    files: project.files.map(({ path, content }) => ({ path, content })),
  };
  const entryFile = project.storyFiles.find(({ source }) =>
    storyFileDeclaresScene(source, project.manifest.project.entryScene),
  );
  setSession(next, entryFile?.path ?? project.storyFiles[0]?.path ?? 'project.toml');
  runStory();
}

function showOpenError(error: unknown, status: string): void {
  prepareRun();
  compileStatus.className = 'compile-status compile-error';
  compileStatus.textContent = status;
  if (error instanceof ProjectLoadError) showIssues(projectCompileIssues(error));
  else showUnexpectedError(error);
}

function showOpenStoryError(error: unknown): void {
  showOpenError(error, 'Could not open file');
}

function showOpenProjectError(error: unknown): void {
  showOpenError(error, 'Could not open project');
}

setSession({
  kind: 'scratch',
  name: 'Scratch story',
  files: [{ path: 'main.story', content: savedSource() }],
});
structuredEditor = new StructuredSceneEditor(
  {
    files: () => session.files,
    updateFile: updateStructuredFile,
    deleteScene: deleteProjectScene,
    duplicateScene: duplicateProjectScene,
    renameScene: renameProjectScene,
    selectFile(path) {
      const file = session.files.find((candidate) => candidate.path === path);
      if (file === undefined) return;
      activePath = path;
      sourceFile.value = path;
      editor.value = file.content;
      updateStats();
    },
    openAdvancedSource,
    preview: runStory,
  },
  structuredEditorElements,
);
storyMap = new StoryMapEditor(
  {
    files: () => session.files,
    clearLayout: clearStoryMapLayout,
    deleteScene: deleteProjectScene,
    downloadLayout() {
      const source = serializeStoryMapLayout(editorMetadataSource(), storyMapLayout().positions);
      downloadFile('editor.json', 'application/json;charset=utf-8', source);
    },
    duplicateScene: duplicateProjectScene,
    layout: storyMapLayout,
    updateFile: updateStructuredFile,
    updateLayout: saveStoryMapLayout,
    renameScene: renameProjectScene,
    openScene(path, sceneId) {
      setAuthoringMode('visual');
      structuredEditor.selectScene(path, sceneId);
    },
    preview: runStory,
  },
  storyMapElements,
);
setAuthoringMode('visual');
runStory();

editor.addEventListener('input', () => {
  currentFile().content = editor.value;
  if (session.kind === 'scratch') saveScratchSource(editor.value);
  markBuildStale();
  updateStats();
  structuredEditor.refresh();
  storyMap.refresh();
});
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runStory();
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('  ', start, end, 'end');
    currentFile().content = editor.value;
    if (session.kind === 'scratch') saveScratchSource(editor.value);
    markBuildStale();
    updateStats();
    structuredEditor.refresh();
    storyMap.refresh();
  }
});
visualModeButton.addEventListener('click', () => setAuthoringMode('visual'));
storyMapModeButton.addEventListener('click', () => setAuthoringMode('map'));
sourceModeButton.addEventListener('click', () => setAuthoringMode('source'));
sourceFile.addEventListener('change', () => {
  const path = sourceFile.value;
  if (!path.endsWith('.story')) setAuthoringMode('source');
  activateFile(path, authoringMode === 'source');
});
runButton.addEventListener('click', runStory);
downloadButton.addEventListener('click', downloadSource);
buildButton.addEventListener('click', openBuildDialog);
startBuildButton.addEventListener('click', () => void startBuild());
openButton.addEventListener('click', () => fileInput.click());
projectButton.addEventListener('click', () => projectInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  void file
    .text()
    .then((source) => {
      setSession({
        kind: 'scratch',
        name: file.name,
        files: [{ path: file.name, content: source }],
      });
      runStory();
    })
    .catch(showOpenStoryError)
    .finally(() => {
      fileInput.value = '';
    });
});
projectInput.addEventListener('change', () => {
  const files = projectInput.files;
  if (files === null || files.length === 0) return;
  void openProjectSelection(files)
    .catch(showOpenProjectError)
    .finally(() => {
      projectInput.value = '';
    });
});
resetButton.addEventListener('click', () => {
  const alreadyStarter =
    session.kind === 'scratch' &&
    session.files.length === 1 &&
    currentFile().content === starterStory;
  if (!alreadyStarter && !window.confirm('Replace the current workspace with the example story?')) {
    return;
  }
  saveScratchSource(starterStory);
  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // Resetting the story still works when browser storage is unavailable.
  }
  setSession({
    kind: 'scratch',
    name: 'Scratch story',
    files: [{ path: 'main.story', content: starterStory }],
  });
  runStory();
});
