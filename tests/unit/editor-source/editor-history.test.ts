import { describe, expect, it } from 'vitest';

import { EditorHistory } from '../../../apps/playground/src/editor-history.js';

interface WorkspaceState {
  readonly files: Readonly<Record<string, string>>;
}

function workspace(files: Record<string, string>): WorkspaceState {
  return Object.freeze({ files: Object.freeze({ ...files }) });
}

function sameWorkspace(left: WorkspaceState, right: WorkspaceState): boolean {
  return JSON.stringify(left.files) === JSON.stringify(right.files);
}

describe('creator undo and redo history', () => {
  it('restores a story, manifest, and editor metadata change as one workspace transaction', () => {
    const before = workspace({
      'project.toml': 'entry_scene = "opening"',
      'story/main.story': ':: opening\n@goto ending\n',
      '.rpgne/editor.json': '{"opening":{"x":10,"y":20}}',
    });
    const after = workspace({
      'project.toml': 'entry_scene = "arrival"',
      'story/main.story': ':: arrival\n@goto ending\n',
      '.rpgne/editor.json': '{"arrival":{"x":10,"y":20}}',
    });
    const history = new EditorHistory(before, { equals: sameWorkspace });

    history.record(after, { label: 'Rename scene opening to arrival' });

    expect(history.undo()).toEqual({
      label: 'Rename scene opening to arrival',
      state: before,
    });
    expect(history.redo()).toEqual({
      label: 'Rename scene opening to arrival',
      state: after,
    });
  });

  it('coalesces a typing burst without coalescing through a saved clean boundary', () => {
    const history = new EditorHistory('A', { coalesceWindowMs: 800 });
    history.record('AB', {
      coalesceKey: 'advanced-source:main.story',
      label: 'Edit main.story',
      timestampMs: 1_000,
    });
    history.record('ABC', {
      coalesceKey: 'advanced-source:main.story',
      label: 'Edit main.story',
      timestampMs: 1_500,
    });

    expect(history.undo()?.state).toBe('A');
    expect(history.redo()?.state).toBe('ABC');
    history.markClean();
    expect(history.isClean).toBe(true);

    history.record('ABCD', {
      coalesceKey: 'advanced-source:main.story',
      label: 'Edit main.story',
      timestampMs: 1_700,
    });
    expect(history.isClean).toBe(false);
    expect(history.undo()?.state).toBe('ABC');
    expect(history.isClean).toBe(true);
  });

  it('keeps redo after marking an undone state as the saved state', () => {
    const history = new EditorHistory('initial');
    history.record('first', { label: 'First edit' });
    history.record('second', { label: 'Second edit' });

    expect(history.undo()?.state).toBe('first');
    history.markClean();
    expect(history.canRedo).toBe(true);
    expect(history.isClean).toBe(true);

    expect(history.redo()?.state).toBe('second');
    expect(history.isClean).toBe(false);
    expect(history.undo()?.state).toBe('first');
    expect(history.isClean).toBe(true);
  });
});
