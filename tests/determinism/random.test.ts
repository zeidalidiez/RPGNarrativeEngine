import { describe, expect, it } from 'vitest';

import { compileStory } from '../../packages/compiler/src/index.js';
import {
  DeterministicRandomError,
  NamedRandom,
  NarrativeRuntime,
} from '../../packages/runtime/src/index.js';

const VECTOR_SEED = '00000001000000020000000300000004';

describe('named deterministic random streams', () => {
  it('matches the published xoshiro128** stream vectors and draw counts', () => {
    const random = new NamedRandom(VECTOR_SEED);

    expect(Array.from({ length: 8 }, () => random.nextUint32('story'))).toEqual([
      235_697_881, 3_712_348_551, 1_552_270_467, 854_609_166, 132_570_262, 3_552_158_216,
      3_704_706_210, 1_508_618_563,
    ]);
    expect(Array.from({ length: 4 }, () => random.nextUint32('combat'))).toEqual([
      558_032_249, 2_730_809_746, 4_236_169_865, 557_425_759,
    ]);

    const snapshot = random.snapshot();
    expect(snapshot.streams['story']).toMatchObject({
      algorithm: 'xoshiro128**',
      algorithmVersion: 1,
      state: [14_493_431, 850_169_018, 357_900_317, 1_419_783_302],
      drawCount: 8,
    });
    expect(snapshot.streams['combat']).toMatchObject({
      state: [2_017_244_402, 2_988_222_653, 3_943_854_755, 2_118_169_424],
      drawCount: 4,
    });
  });

  it('keeps streams isolated and resumes byte-for-byte from serialized state', () => {
    const storyFirst = new NamedRandom(VECTOR_SEED);
    const story = Array.from({ length: 6 }, () => storyFirst.nextUint32('story'));
    const combat = Array.from({ length: 6 }, () => storyFirst.nextUint32('combat'));

    const combatFirst = new NamedRandom(VECTOR_SEED);
    const reversedCombat = Array.from({ length: 6 }, () => combatFirst.nextUint32('combat'));
    const reversedStory = Array.from({ length: 6 }, () => combatFirst.nextUint32('story'));
    expect(reversedStory).toEqual(story);
    expect(reversedCombat).toEqual(combat);

    const checkpoint = storyFirst.snapshot();
    const expected = Array.from({ length: 8 }, () => storyFirst.nextUint32('story'));
    const restored = new NamedRandom();
    restored.restore(JSON.parse(JSON.stringify(checkpoint)) as unknown);
    expect(Array.from({ length: 8 }, () => restored.nextUint32('story'))).toEqual(expected);
  });

  it('validates helper inputs before consuming a stream', () => {
    const random = new NamedRandom(VECTOR_SEED);
    expect(() => random.integer('story', 2, 2)).toThrow(DeterministicRandomError);
    expect(() => random.weightedIndex('story', [1, 0, 2])).toThrow(DeterministicRandomError);
    expect(() => random.nextUint32('Story')).toThrow(DeterministicRandomError);
    expect(random.snapshot().streams).toEqual({});

    expect(random.integer('story', -3, 4)).toBeGreaterThanOrEqual(-3);
    expect(random.integer('story', -3, 4)).toBeLessThan(4);
    expect(random.weightedIndex('story', [1, 2, 3])).toBeGreaterThanOrEqual(0);
    expect(random.snapshot().streams['story']?.drawCount).toBe(3);
  });

  it('executes story random expressions through the serialized story stream', () => {
    const game = compileStory(`:: start
@set roll = random()
First draw: {{ roll }}
@set ranged = random(10, 20)
Second draw: {{ ranged }}
`);
    const expected = new NamedRandom(VECTOR_SEED);
    const first = expected.nextFloat('story');
    const second = 10 + expected.nextFloat('story') * 10;
    const runtime = new NarrativeRuntime(game, { randomSeed: VECTOR_SEED });

    expect(runtime.snapshotVariables()).toEqual({ roll: first });
    runtime.continue();
    expect(runtime.snapshotVariables()).toEqual({ roll: first, ranged: second });
    expect(runtime.random.snapshot().streams['story']?.drawCount).toBe(2);
  });
});
