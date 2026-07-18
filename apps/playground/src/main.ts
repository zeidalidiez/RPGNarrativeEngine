import { compileStory, StoryCompileError, type CompileIssue } from '@rpgnarrativeengine/compiler';
import { mountNarrativePlayer, type NarrativePlayerController } from '@rpgnarrativeengine/player';

import starterStory from './starter.story?raw';
import './style.css';

const STORAGE_KEY = 'rpgnarrativeengine.playground.story';

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
const runButton = required<HTMLButtonElement>('#run-button');
const resetButton = required<HTMLButtonElement>('#reset-button');
const openButton = required<HTMLButtonElement>('#open-button');
const downloadButton = required<HTMLButtonElement>('#download-button');
const fileInput = required<HTMLInputElement>('#file-input');

let controller: NarrativePlayerController | null = null;

function savedSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? starterStory;
  } catch {
    return starterStory;
  }
}

function saveSource(source: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // The playground remains usable when storage is blocked or full.
  }
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
  sourceStats.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} · ${editor.value.length} characters`;
}

function focusIssue(issue: CompileIssue): void {
  editor.focus();
  editor.setSelectionRange(issue.from, Math.max(issue.from + 1, issue.to));
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
  const position = sourcePosition(editor.value, issue.from);
  editor.scrollTop = Math.max(0, (position.line - 4) * lineHeight);
}

function showIssues(issues: readonly CompileIssue[]): void {
  diagnostics.replaceChildren();
  diagnostics.hidden = false;
  const heading = document.createElement('p');
  heading.className = 'diagnostic-heading';
  heading.textContent = `${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} to fix`;
  const list = document.createElement('ul');
  for (const issue of issues) {
    const position = sourcePosition(editor.value, issue.from);
    const item = document.createElement('li');
    const issueButton = document.createElement('button');
    issueButton.type = 'button';
    issueButton.className = 'diagnostic';
    const location = document.createElement('span');
    location.className = 'diagnostic-location';
    location.textContent = `${position.line}:${position.column}`;
    const message = document.createElement('span');
    message.textContent = issue.message;
    issueButton.append(location, message);
    issueButton.addEventListener('click', () => focusIssue(issue));
    item.append(issueButton);
    list.append(item);
  }
  diagnostics.append(heading, list);
}

function clearPlayer(): void {
  controller?.destroy();
  controller = null;
  player.replaceChildren();
}

function runStory(): void {
  const source = editor.value;
  saveSource(source);
  clearPlayer();
  diagnostics.replaceChildren();
  diagnostics.hidden = true;
  try {
    const game = compileStory(source, { title: 'Playground Story' });
    controller = mountNarrativePlayer(player, game);
    compileStatus.className = 'compile-status compile-success';
    compileStatus.textContent = `Ready · ${Object.keys(game.scenes).length} scenes`;
  } catch (error) {
    compileStatus.className = 'compile-status compile-error';
    compileStatus.textContent = 'Could not run';
    if (error instanceof StoryCompileError) {
      showIssues(error.issues);
      return;
    }
    const issue: CompileIssue = {
      code: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
      from: 0,
      to: 0,
    };
    showIssues([issue]);
  }
}

function downloadSource(): void {
  const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'main.story';
  link.click();
  URL.revokeObjectURL(url);
}

editor.value = savedSource();
updateStats();
runStory();

editor.addEventListener('input', updateStats);
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
    updateStats();
  }
});
runButton.addEventListener('click', runStory);
downloadButton.addEventListener('click', downloadSource);
openButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  void file.text().then((source) => {
    editor.value = source;
    updateStats();
    runStory();
    fileInput.value = '';
  });
});
resetButton.addEventListener('click', () => {
  if (
    editor.value !== starterStory &&
    !window.confirm('Replace the current source with the example story?')
  ) {
    return;
  }
  editor.value = starterStory;
  updateStats();
  runStory();
});
