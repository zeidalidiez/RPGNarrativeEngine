import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseStoryAst,
  type StoryChoiceAst,
  type StoryCommandAst,
  type StoryConditionalAst,
  type StoryTextAst,
} from '../../../packages/language/src/index.js';

async function readStoryFixture(name: string): Promise<string> {
  return readFile(new URL(`../../fixtures/language/${name}`, import.meta.url), 'utf8');
}

describe('normalized story AST', () => {
  it('normalizes the complete fixture without exposing concrete parser nodes', async () => {
    const source = await readStoryFixture('complete.story');
    const result = parseStoryAst(source);
    expect(result.issues).toEqual([]);
    const document = result.document;
    expect(document).not.toBeNull();
    expect(document?.scenes).toHaveLength(8);
    expect(document?.scenes.map((scene) => scene.id)).toEqual([
      'station.arrival',
      'station.letter',
      'station.apology',
      'station.together',
      'station.decision',
      'shared.train-rumble',
      'ending.departed',
      'ending.waiting',
    ]);
    expect(document?.leadingTrivia.map((trivia) => trivia.triviaKind)).toEqual([
      'comment',
      'blank-line',
    ]);

    const arrival = document?.scenes[0];
    expect(source.slice(arrival?.idSpan.start.offset, arrival?.idSpan.end.offset)).toBe(
      'station.arrival',
    );
    const commands = arrival?.items.filter(
      (item): item is StoryCommandAst => item.kind === 'command',
    );
    expect(commands?.[0]).toMatchObject({
      name: 'music',
      arguments: 'night-train loop fade=2s',
    });
    const texts = arrival?.items.filter((item): item is StoryTextAst => item.kind === 'text');
    expect(texts?.[0]).toMatchObject({
      contentId: 'arrival.narration.last-train',
      lines: [{ text: 'The last train has already gone.' }],
    });
    expect(texts?.[1]).toMatchObject({
      contentId: 'arrival.mara.you-came',
      lines: [{ text: 'Mara[distant]: You came.' }],
    });

    const conditional = arrival?.items.find(
      (item): item is StoryConditionalAst => item.kind === 'conditional',
    );
    expect(conditional?.condition).toMatchObject({
      kind: 'variable',
      path: 'memory.mara_met',
    });
    expect(
      source.slice(conditional?.conditionSpan.start.offset, conditional?.conditionSpan.end.offset),
    ).toBe('memory.mara_met');
    expect(conditional?.thenBranch.some((item) => item.kind === 'text')).toBe(true);
    expect(conditional?.elseBranch?.some((item) => item.kind === 'text')).toBe(true);

    const choices = arrival?.items.filter((item): item is StoryChoiceAst => item.kind === 'choice');
    expect(choices).toHaveLength(4);
    expect(choices?.[0]).toMatchObject({
      label: 'Ask about the letter',
      target: 'station.letter',
      contentId: 'arrival.choice.letter',
      condition: null,
    });
    expect(choices?.[1]?.condition).toMatchObject({ kind: 'binary', operator: '>=' });
    expect(choices?.[2]).toMatchObject({
      label: 'Take her hand',
      target: null,
      contentId: 'arrival.choice.hand',
    });
    expect(choices?.[2]?.body.filter((item) => item.kind === 'command')).toHaveLength(3);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document?.scenes)).toBe(true);
    expect(Object.isFrozen(conditional?.condition)).toBe(true);
  });

  it('preserves multiline beats and normalizes only documented leading escapes', async () => {
    const source = await readStoryFixture('multiline.story');
    const result = parseStoryAst(source);
    expect(result.issues).toEqual([]);
    const texts = result.document?.scenes[0]?.items.filter(
      (item): item is StoryTextAst => item.kind === 'text',
    );
    expect(texts?.[0]?.lines.map((line) => line.text)).toEqual([
      'This is one narration paragraph',
      'with an explicit line break and *literal markers*.',
    ]);
    expect(texts?.[1]?.lines).toHaveLength(2);
    expect(texts?.[2]).toMatchObject({
      escapedLeadingMarker: true,
      lines: [{ text: '* This begins with a literal star rather than a choice.' }],
    });
    expect(texts?.[3]?.lines[0]?.text).toBe(
      '@ This begins with a literal at sign rather than a command.',
    );
    expect(texts?.[4]?.lines[0]?.text).toBe(
      ':: This begins with literal colons rather than a scene.',
    );
  });

  it('separates inline comments and content identity from rendered text', () => {
    const source =
      ':: start\nNarration survives. ^story.start.line // author note\n@ending done "Done"\n';
    const result = parseStoryAst(source);
    expect(result.issues).toEqual([]);
    const text = result.document?.scenes[0]?.items.find(
      (item): item is StoryTextAst => item.kind === 'text',
    );
    expect(text).toMatchObject({
      contentId: 'story.start.line',
      lines: [
        {
          raw: 'Narration survives. ^story.start.line // author note',
          text: 'Narration survives.',
        },
      ],
    });
  });

  it('keeps escaped dialogue-shaped text as narration for visual authoring', () => {
    const result = parseStoryAst(':: start\n\\Mara: This is narration, not dialogue.\n');
    expect(result.issues).toEqual([]);
    const text = result.document?.scenes[0]?.items.find(
      (item): item is StoryTextAst => item.kind === 'text',
    );
    expect(text).toMatchObject({
      mode: 'narration',
      escapedLeadingMarker: true,
      lines: [{ text: 'Mara: This is narration, not dialogue.' }],
      inline: [{ kind: 'text', value: 'Mara: This is narration, not dialogue.' }],
    });
  });

  it('rejects source that is structurally parseable but not lexically valid', () => {
    const invalidScene = parseStoryAst(':: Invalid Scene\n@ending end "End"\n');
    expect(invalidScene.document).toBeNull();
    expect(invalidScene.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-token', from: 3, to: 16 }),
    );

    const invalidConditionSource = ':: start\n@if trust >\n  @goto end\n@end\n';
    const invalidCondition = parseStoryAst(invalidConditionSource);
    expect(invalidCondition.document).toBeNull();
    expect(invalidCondition.issues).toContainEqual(
      expect.objectContaining({
        code: 'parse-error',
        from: invalidConditionSource.indexOf('trust >') + 'trust >'.length,
      }),
    );

    const earlyContentId = parseStoryAst(
      ':: start\nNarration ^story.line\n  continued afterward\n',
    );
    expect(earlyContentId.document).toBeNull();
    expect(earlyContentId.issues[0]?.message).toContain('final physical line');
  });

  it('rejects choice target/body conflicts and arguments on block markers', () => {
    const targetAndBody = parseStoryAst(':: start\n* Go -> next\n  @goto next\n');
    expect(targetAndBody.document).toBeNull();
    expect(
      targetAndBody.issues.some(
        (current) =>
          current.code === 'invalid-token' && current.message.includes('cannot be combined'),
      ),
    ).toBe(true);

    const markerArguments = parseStoryAst(
      ':: start\n@if true\n  @goto end\n@else extra\n  @goto end\n@end nope\n',
    );
    expect(markerArguments.document).toBeNull();
    expect(markerArguments.issues.map((current) => current.message)).toEqual(
      expect.arrayContaining([
        '@else does not accept arguments.',
        '@end does not accept arguments.',
      ]),
    );

    const strayMarker = parseStoryAst(':: start\n@end\n');
    expect(strayMarker.document).toBeNull();
    expect(strayMarker.issues[0]?.code).toBe('parse-error');

    const nestedChoice = parseStoryAst(
      ':: start\n* Outer choice\n  @if true\n    * Nested choice -> end\n  @end\n',
    );
    expect(nestedChoice.document).toBeNull();
    expect(nestedChoice.issues.some((current) => current.message.includes('nested choice'))).toBe(
      true,
    );
  });

  it('leaves malformed concrete syntax to the recovery diagnostics', async () => {
    const malformed = parseStoryAst(await readStoryFixture('malformed.story'));
    expect(malformed.document).toBeNull();
    expect(malformed.issues.length).toBeGreaterThan(0);
  });
});
