import { describe, expect, it } from 'vitest';

import {
  applyStorySourceEdit,
  parseEditableStory,
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
});
