import { describe, expect, it } from 'vitest';

import {
  EditorMetadataError,
  parseStoryMapLayout,
  serializeStoryMapLayout,
} from '../../../apps/playground/src/editor-metadata.js';

describe('creator editor metadata', () => {
  it('round-trips map positions while preserving unrelated editor-owned fields', () => {
    const source = `${JSON.stringify({ schema: 1, future: { collapsed: true } }, null, 2)}\n`;
    const updated = serializeStoryMapLayout(source, {
      'scene.second': { x: 420, y: 120 },
      'scene.first': { x: 36, y: 48 },
    });

    expect(updated).toContain('"future": {\n    "collapsed": true');
    expect(updated.indexOf('"scene.first"')).toBeLessThan(updated.indexOf('"scene.second"'));
    expect(parseStoryMapLayout(updated).positions['scene.second']).toEqual({ x: 420, y: 120 });
  });

  it('rejects malformed coordinates instead of silently overwriting metadata', () => {
    expect(() =>
      parseStoryMapLayout(
        JSON.stringify({ schema: 1, storyMap: { positions: { broken: { x: -1, y: 20 } } } }),
      ),
    ).toThrow(EditorMetadataError);
  });
});
