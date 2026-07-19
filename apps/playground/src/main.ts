import {
  compileStory,
  compileStoryProject,
  StoryCompileError,
  type CompileIssue,
} from '@rpgnarrativeengine/compiler';
import { mountNarrativePlayer, type NarrativePlayerController } from '@rpgnarrativeengine/player';
import {
  loadNarrativeProject,
  ProjectLoadError,
  type ProjectFileInput,
} from '@rpgnarrativeengine/project';

import starterStory from './starter.story?raw';
import './style.css';

const STORAGE_KEY = 'rpgnarrativeengine.playground.story';

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
const projectName = required<HTMLElement>('#project-name');
const sourceFile = required<HTMLSelectElement>('#source-file');
const runButton = required<HTMLButtonElement>('#run-button');
const resetButton = required<HTMLButtonElement>('#reset-button');
const openButton = required<HTMLButtonElement>('#open-button');
const projectButton = required<HTMLButtonElement>('#project-button');
const downloadButton = required<HTMLButtonElement>('#download-button');
const fileInput = required<HTMLInputElement>('#file-input');
const projectInput = required<HTMLInputElement>('#project-input');

let controller: NarrativePlayerController | null = null;
let session: EditorSession;
let activePath = '';

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
  const fileCount = session.files.length;
  sourceStats.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} \u00b7 ${editor.value.length} characters${fileCount > 1 ? ` \u00b7 ${fileCount} files` : ''}`;
}

function refreshFileSelector(): void {
  sourceFile.replaceChildren();
  for (const file of session.files) {
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
}

function activateFile(path: string, focus = false): void {
  const file = session.files.find((candidate) => candidate.path === path);
  if (file === undefined) return;
  activePath = path;
  sourceFile.value = path;
  editor.value = file.content;
  editor.scrollTop = 0;
  updateStats();
  if (focus) editor.focus();
}

function setSession(next: EditorSession, preferredPath?: string): void {
  session = next;
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

function downloadSource(): void {
  const file = currentFile();
  const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.path.split('/').at(-1) ?? 'main.story';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
    return path.endsWith('/project.toml') || path === 'project.toml' || path.endsWith('.story');
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
runStory();

editor.addEventListener('input', () => {
  currentFile().content = editor.value;
  if (session.kind === 'scratch') saveScratchSource(editor.value);
  updateStats();
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
    updateStats();
  }
});
sourceFile.addEventListener('change', () => activateFile(sourceFile.value, true));
runButton.addEventListener('click', runStory);
downloadButton.addEventListener('click', downloadSource);
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
  setSession({
    kind: 'scratch',
    name: 'Scratch story',
    files: [{ path: 'main.story', content: starterStory }],
  });
  runStory();
});
