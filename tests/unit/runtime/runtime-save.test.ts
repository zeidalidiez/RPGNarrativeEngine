import { describe, expect, it } from 'vitest';

import type { CompiledGame, CompiledInstruction } from '../../../packages/ir/src/index.js';
import { NarrativeRuntime } from '../../../packages/runtime/src/index.js';

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
    runtime.continue();
    expect(runtime.view).toMatchObject({ kind: 'text', sceneId: 'aside' });
    expect(effects).toEqual(['sound']);
    const asideSave = runtime.serializeSave();

    runtime.continue();
    expect(runtime.view).toMatchObject({ kind: 'choice' });
    const choiceSave = runtime.serializeSave();
    runtime.choose('take');
    expect(runtime.view).toMatchObject({ kind: 'text', plainText: 'Score 3' });

    runtime.loadSave(asideSave);
    expect(runtime.view).toMatchObject({ kind: 'text', sceneId: 'aside' });
    expect(runtime.snapshotVariables()).toEqual({ score: 1 });
    expect(effects).toEqual(['sound']);

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
});
