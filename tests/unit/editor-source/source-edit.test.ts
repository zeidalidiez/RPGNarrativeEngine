import { describe, expect, it } from 'vitest';

import {
  applyStorySourceEdit,
  applyStorySourceEdits,
  parseEditableStory,
  renameStoryScene,
  StorySourceEditError,
} from '../../../packages/editor-source/src/index.js';

describe('visual story source transactions', () => {
  it('applies a valid minimal replacement and rejects an invalid one atomically', () => {
    const source = ':: start\nOriginal narration.\n@ending done "Done"\n';
    const parsed = parseEditableStory(source);
    const text = parsed.document?.scenes[0]?.items.find((item) => item.kind === 'text');
    expect(text).toBeDefined();

    const edited = applyStorySourceEdit(source, {
      from: text!.span.start.offset,
      to: text!.span.end.offset,
      insert: 'Changed through a card.\n',
    });
    expect(edited.source).toContain('Changed through a card.');
    expect(edited.document.scenes[0]?.items.some((item) => item.kind === 'text')).toBe(true);

    expect(() =>
      applyStorySourceEdit(source, {
        from: text!.span.start.offset,
        to: text!.span.end.offset,
        insert: '@if true\n',
      }),
    ).toThrow(StorySourceEditError);
    expect(source).toContain('Original narration.');
  });

  it('applies multiple non-overlapping edits as one validated transaction', () => {
    const source = ':: start\nFirst.\nSecond.\n@ending done "Done"\n';
    const edited = applyStorySourceEdits(source, [
      { from: source.indexOf('First'), to: source.indexOf('First') + 5, insert: 'Opening' },
      { from: source.indexOf('Second'), to: source.indexOf('Second') + 6, insert: 'Closing' },
    ]);
    expect(edited.source).toContain('Opening.\nClosing.');
    expect(() =>
      applyStorySourceEdits(source, [
        { from: 3, to: 8, insert: 'one' },
        { from: 7, to: 10, insert: 'two' },
      ]),
    ).toThrow(StorySourceEditError);
  });

  it('renames a scene and all choice, goto, call, and nested references across files', () => {
    const files = [
      {
        path: 'story/opening.story',
        source:
          ':: opening\n* Direct -> destination\n@if unlocked\n  @goto destination\n@else\n  @call destination\n@end\n',
      },
      {
        path: 'story/destination.story',
        source: ':: destination\nDestination.\n@ending done "Done"\n',
      },
    ];
    const updates = renameStoryScene(files, 'destination', 'destination.renamed');
    expect(updates).toHaveLength(2);
    expect(updates.find((update) => update.path === 'story/opening.story')?.source).toContain(
      '* Direct -> destination.renamed',
    );
    expect(updates.find((update) => update.path === 'story/opening.story')?.source).toContain(
      '@goto destination.renamed',
    );
    expect(updates.find((update) => update.path === 'story/opening.story')?.source).toContain(
      '@call destination.renamed',
    );
    expect(updates.find((update) => update.path === 'story/destination.story')?.source).toContain(
      ':: destination.renamed',
    );
    expect(files[1]?.source).toContain(':: destination\n');
  });

  it('rejects a scene rename that would collide with another declaration', () => {
    expect(() =>
      renameStoryScene(
        [
          {
            path: 'main.story',
            source: ':: first\n@goto second\n:: second\n@ending done "Done"\n',
          },
        ],
        'first',
        'second',
      ),
    ).toThrow('Scene second already exists.');
  });
});
