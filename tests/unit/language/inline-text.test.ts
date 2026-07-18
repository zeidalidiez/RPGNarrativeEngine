import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseStoryAst,
  type StoryInlineInterpolationAst,
  type StoryInlineLanguageAst,
  type StoryInlineLineBreakAst,
  type StoryInlinePronunciationAst,
  type StoryTextAst,
} from '../../../packages/language/src/index.js';

async function readMultilineFixture(): Promise<string> {
  return readFile(new URL('../../fixtures/language/multiline.story', import.meta.url), 'utf8');
}

function storyTexts(source: string): readonly StoryTextAst[] {
  const result = parseStoryAst(source);
  expect(result.issues).toEqual([]);
  return (
    result.document?.scenes.flatMap((scene) =>
      scene.items.filter((item): item is StoryTextAst => item.kind === 'text'),
    ) ?? []
  );
}

describe('safe inline story text', () => {
  it('normalizes dialogue heads, explicit breaks, emphasis, and interpolation', async () => {
    const source = await readMultilineFixture();
    const texts = storyTexts(source);
    expect(texts[0]).toMatchObject({ mode: 'narration', speaker: null });
    expect(texts[0]?.inline.map((node) => node.kind)).toEqual([
      'text',
      'line-break',
      'text',
      'emphasis',
      'text',
    ]);

    const dialogue = texts[1];
    expect(dialogue).toMatchObject({
      mode: 'dialogue',
      speaker: { reference: 'Mara', variant: 'quiet' },
    });
    expect(
      source.slice(
        dialogue?.speaker?.referenceSpan.start.offset,
        dialogue?.speaker?.referenceSpan.end.offset,
      ),
    ).toBe('Mara');
    const interpolation = dialogue?.inline.find(
      (node): node is StoryInlineInterpolationAst => node.kind === 'interpolation',
    );
    expect(interpolation?.expression).toMatchObject({ kind: 'variable', path: 'player.name' });
    expect(
      source.slice(
        interpolation?.expression.span.start.offset,
        interpolation?.expression.span.end.offset,
      ),
    ).toBe('player.name');
    const lineBreak = dialogue?.inline.find(
      (node): node is StoryInlineLineBreakAst => node.kind === 'line-break',
    );
    expect(source.slice(lineBreak?.span.start.offset, lineBreak?.span.end.offset)).toBe('\n  ');
  });

  it('keeps forced structural markers as literal narration text', async () => {
    const texts = storyTexts(await readMultilineFixture());
    expect(texts[2]).toMatchObject({
      mode: 'narration',
      escapedLeadingMarker: true,
      inline: [{ kind: 'text', value: '* This begins with a literal star rather than a choice.' }],
    });
    expect(texts[3]?.inline).toMatchObject([
      { kind: 'text', value: '@ This begins with a literal at sign rather than a command.' },
    ]);
    expect(texts[4]?.inline).toMatchObject([
      { kind: 'text', value: ':: This begins with literal colons rather than a scene.' },
    ]);
  });

  it('normalizes language and pronunciation spans across one logical beat', async () => {
    const source = await readMultilineFixture();
    const richText = storyTexts(source)[5];
    const language = richText?.inline.find(
      (node): node is StoryInlineLanguageAst => node.kind === 'language',
    );
    expect(language).toMatchObject({
      languageTag: 'ja',
      children: [{ kind: 'text', value: '東京' }],
    });
    const pronunciation = richText?.inline.find(
      (node): node is StoryInlinePronunciationAst => node.kind === 'pronunciation',
    );
    expect(pronunciation).toMatchObject({
      hint: 'toh-kyoh',
      children: [{ kind: 'text', value: '東京' }],
    });
    expect(Object.isFrozen(pronunciation?.children)).toBe(true);

    const crossLine = storyTexts(':: start\n[lang=ja]first line\n  second line[/lang]\n')[0]
      ?.inline[0] as StoryInlineLanguageAst;
    expect(crossLine.children.map((node) => node.kind)).toEqual(['text', 'line-break', 'text']);
  });

  it('decodes escaped markup, comment, content, and interpolation delimiters', () => {
    const text = storyTexts(
      String.raw`:: start
Literal \*star\*, \//slashes, \^identity, and \{{ braces.
`,
    )[0];
    expect(text?.inline).toMatchObject([
      {
        kind: 'text',
        value: 'Literal *star*, //slashes, ^identity, and {{ braces.',
      },
    ]);
  });

  it('rejects unsafe, malformed, or nested markup and malformed dialogue', () => {
    const cases = [
      ':: start\n<script>alert(1)</script>\n',
      ':: start\n[link]not allowed[/link]\n',
      ':: start\n[lang=en][pronounce="hint"]nested[/pronounce][/lang]\n',
      ':: start\n[pronounce="\\x20"]bad hint[/pronounce]\n',
      ':: start\nMara[quiet: missing bracket\n',
      ':: start\nMara[ quiet ]: spaced variant\n',
      ':: start\nMara[first][second]: duplicate variant\n',
      ':: start\nValue {{ score + }}\n',
    ];
    for (const source of cases) {
      const result = parseStoryAst(source);
      expect(result.document, source).toBeNull();
      expect(result.issues.length, source).toBeGreaterThan(0);
    }
  });
});
