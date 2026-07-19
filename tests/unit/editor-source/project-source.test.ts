import { describe, expect, it } from 'vitest';

import { renameProjectEntryScene } from '../../../apps/playground/src/project-source.js';

const manifest = `schema = 1

[project]
id = "org.example.story"
title = "Example Story"
version = "0.1.0"
entry_scene = 'opening.old' # keep this comment

[story]
files = ["story/**/*.story"]
`;

describe('creator project source transactions', () => {
  it('renames the entry scene while preserving TOML formatting and comments', () => {
    const updated = renameProjectEntryScene(manifest, 'opening.old', 'opening.new');

    expect(updated).toContain("entry_scene = 'opening.new' # keep this comment");
    expect(updated).toContain('[story]\nfiles = ["story/**/*.story"]');
    expect(updated.replace('opening.new', 'opening.old')).toBe(manifest);
  });

  it('leaves a manifest unchanged when another scene is renamed', () => {
    expect(renameProjectEntryScene(manifest, 'side.scene', 'side.renamed')).toBe(manifest);
  });
});
