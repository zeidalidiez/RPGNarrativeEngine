import { describe, expect, it } from 'vitest';

import type { CompiledGame, CompiledInstruction } from '../../../packages/ir/src/index.js';
import {
  NARRATIVE_SAVE_FORMAT_VERSION,
  NarrativeRuntime,
  parseNarrativeSave,
} from '../../../packages/runtime/src/index.js';

const BUILD_A = 'a'.repeat(64);
const BUILD_B = 'b'.repeat(64);

function literal(value: boolean | number | string) {
  return { kind: 'literal' as const, value };
}

function game(): CompiledGame {
  const start: readonly CompiledInstruction[] = [
    { kind: 'set', path: 'score', operator: '=', value: literal(1) },
    {
      kind: 'say',
      speaker: null,
      contentId: 'opening',
      content: [{ kind: 'text', value: 'Opening' }],
    },
    { kind: 'effect', name: 'sound', arguments: 'bell' },
    { kind: 'call', sceneId: 'aside' },
    {
      kind: 'choices',
      options: [
        {
          id: 'take',
          label: 'Take it',
          contentId: null,
          condition: null,
          instructions: [
            { kind: 'set', path: 'score', operator: '+=', value: literal(2) },
            {
              kind: 'say',
              speaker: null,
              contentId: 'score',
              content: [
                { kind: 'text', value: 'Score ' },
                { kind: 'interpolation', expression: { kind: 'variable', path: 'score' } },
              ],
            },
            { kind: 'ending', id: 'done', title: 'Done' },
          ],
        },
        {
          id: 'leave',
          label: 'Leave it',
          contentId: null,
          condition: null,
          instructions: [{ kind: 'ending', id: 'left', title: 'Left' }],
        },
      ],
    },
  ];
  return {
    format: 'rpg-narrative-engine',
    formatVersion: 1,
    title: 'Save fixture',
    startSceneId: 'start',
    scenes: {
      start: { id: 'start', instructions: start },
      aside: {
        id: 'aside',
        instructions: [
          {
            kind: 'say',
            speaker: { reference: 'guide', variant: null },
            contentId: 'aside',
            content: [{ kind: 'text', value: 'A brief aside.' }],
          },
          { kind: 'return' },
        ],
      },
    },
  };
}

describe('runtime saves', () => {
  it('restores nested call and choice suspensions without replaying committed effects', () => {
    const effects: string[] = [];
    const runtime = new NarrativeRuntime(game(), {
      buildIdentity: BUILD_A,
      onEffect: (effect) => effects.push(effect.name),
    });

    expect(runtime.view).toMatchObject({ kind: 'text', plainText: 'Opening' });
    expect(runtime.transcript).toMatchObject([{ kind: 'text', contentId: 'opening' }]);
    expect(runtime.hasRead('opening')).toBe(true);
    runtime.continue();
    expect(runtime.view).toMatchObject({ kind: 'text', sceneId: 'aside' });
    expect(effects).toEqual(['sound']);
    const asideSave = runtime.serializeSave();

    runtime.continue();
    expect(runtime.view).toMatchObject({ kind: 'choice' });
    const choiceSave = runtime.serializeSave();
    runtime.choose('take');
    expect(runtime.view).toMatchObject({ kind: 'text', plainText: 'Score 3' });
    expect(runtime.transcript.map((entry) => entry.kind)).toEqual([
      'text',
      'text',
      'choice',
      'text',
    ]);

    runtime.loadSave(asideSave);
    expect(runtime.view).toMatchObject({ kind: 'text', sceneId: 'aside' });
    expect(runtime.snapshotVariables()).toEqual({ score: 1 });
    expect(effects).toEqual(['sound']);
    expect(runtime.transcript.map((entry) => entry.kind)).toEqual(['text', 'text']);
    expect(runtime.snapshotReadContentIds()).toEqual(['aside', 'opening']);

    runtime.continue();
    expect(runtime.view).toMatchObject({ kind: 'choice' });
    runtime.loadSave(choiceSave);
    runtime.choose('take');
    expect(runtime.view).toMatchObject({ kind: 'text', plainText: 'Score 3' });
  });

  it('rejects another build and malformed execution locations without changing live state', () => {
    const source = new NarrativeRuntime(game(), { buildIdentity: BUILD_A });
    source.continue();
    const serialized = source.serializeSave();

    const target = new NarrativeRuntime(game(), { buildIdentity: BUILD_B });
    expect(() => target.loadSave(serialized)).toThrow(/different build/u);
    expect(target.view).toMatchObject({ kind: 'text', plainText: 'Opening' });

    const malformed = JSON.parse(serialized) as {
      state: { frames: Array<{ index: number }> };
    };
    malformed.state.frames[0]!.index = 99_999;
    const matching = new NarrativeRuntime(game(), { buildIdentity: BUILD_A });
    expect(() => matching.loadSave(malformed)).toThrow(/outside its instruction block/u);
    expect(matching.view).toMatchObject({ kind: 'text', plainText: 'Opening' });
  });

  it('restores named random streams at the exact next draw', () => {
    const runtime = new NarrativeRuntime(game(), {
      buildIdentity: BUILD_A,
      randomSeed: '00000001000000020000000300000004',
    });
    runtime.random.nextUint32('story');
    runtime.random.nextUint32('combat');
    const save = runtime.serializeSave();
    const expectedStory = Array.from({ length: 5 }, () => runtime.random.nextUint32('story'));
    const expectedCombat = Array.from({ length: 5 }, () => runtime.random.nextUint32('combat'));

    runtime.loadSave(save);
    expect(Array.from({ length: 5 }, () => runtime.random.nextUint32('story'))).toEqual(
      expectedStory,
    );
    expect(Array.from({ length: 5 }, () => runtime.random.nextUint32('combat'))).toEqual(
      expectedCombat,
    );
  });

  it('migrates schema-1 saves into transcript-aware schema-2 saves', () => {
    const runtime = new NarrativeRuntime(game(), { buildIdentity: BUILD_A });
    runtime.continue();
    const current = JSON.parse(runtime.serializeSave()) as Record<string, unknown> & {
      state: Record<string, unknown>;
    };
    current['formatVersion'] = 1;
    delete current.state['transcript'];
    delete current.state['readContentIds'];

    const migrated = parseNarrativeSave(current);
    expect(migrated.formatVersion).toBe(NARRATIVE_SAVE_FORMAT_VERSION);
    expect(migrated.state.transcript).toMatchObject([
      { kind: 'text', sceneId: 'aside', contentId: 'aside' },
    ]);
    expect(migrated.state.readContentIds).toEqual(['aside']);

    const restored = new NarrativeRuntime(game(), { buildIdentity: BUILD_A });
    restored.loadSave(current);
    expect(restored.view).toMatchObject({ kind: 'text', contentId: 'aside' });
    expect(restored.transcript).toEqual(migrated.state.transcript);
  });

  it('runs declared build migrations before validating and mutating live state', () => {
    const oldRuntime = new NarrativeRuntime(game(), { buildIdentity: BUILD_B });
    oldRuntime.continue();
    const oldSave = oldRuntime.serializeSave();
    const runtime = new NarrativeRuntime(game(), {
      buildIdentity: BUILD_A,
      saveMigrations: [
        {
          fromBuildIdentity: BUILD_B,
          toBuildIdentity: BUILD_A,
          migrate: (save) => ({
            ...save,
            game: { ...save.game, buildIdentity: BUILD_A },
          }),
        },
      ],
    });

    const prepared = runtime.prepareSave(oldSave);
    expect(prepared.game.buildIdentity).toBe(BUILD_A);
    expect(runtime.view).toMatchObject({ kind: 'text', contentId: 'opening' });

    runtime.loadSave(oldSave);
    expect(runtime.view).toMatchObject({ kind: 'text', contentId: 'aside' });
    expect(runtime.transcript).toHaveLength(2);
  });
});
