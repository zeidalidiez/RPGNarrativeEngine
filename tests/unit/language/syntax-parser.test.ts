import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseExpressionSyntax,
  parseStorySyntax,
  syntaxTreeHasErrors,
  type SyntaxParseResult,
} from '../../../packages/language/src/index.js';

async function readStoryFixture(name: string): Promise<string> {
  return readFile(new URL(`../../fixtures/language/${name}`, import.meta.url), 'utf8');
}

function rangesFor(
  tree: SyntaxParseResult['tree'],
  nodeName: string,
): readonly { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === nodeName) {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
}

describe('Lezer story parser', () => {
  it('parses the complete and multiline contract fixtures without recovery nodes', async () => {
    const completeSource = await readStoryFixture('complete.story');
    const complete = parseStorySyntax(completeSource);
    expect(complete.issues).toEqual([]);
    expect(complete.tree.length).toBe(completeSource.length);
    expect(rangesFor(complete.tree, 'Scene')).toHaveLength(8);
    const firstHeader = rangesFor(complete.tree, 'SceneHeaderLine')[0];
    expect(firstHeader).toBeDefined();
    expect(completeSource.slice(firstHeader?.from, firstHeader?.to)).toBe(':: station.arrival');

    const multilineSource = await readStoryFixture('multiline.story');
    const multiline = parseStorySyntax(multilineSource);
    expect(multiline.issues).toEqual([]);
    expect(rangesFor(multiline.tree, 'TextContinuation')).toHaveLength(3);
  });

  it('recovers through malformed structure and reports exact indentation ranges', async () => {
    const source = await readStoryFixture('malformed.story');
    const result = parseStorySyntax(source);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-indentation', from: source.indexOf('   @set') }),
    );
    expect(rangesFor(result.tree, 'Scene')).toHaveLength(1);
    expect(rangesFor(result.tree, 'CommandLine').length).toBeGreaterThan(1);
  });

  it('diagnoses noncanonical line characters independently of recovery', () => {
    const source = '\ufeff:: start\rNarration\n\t@goto end\n';
    const codes = parseStorySyntax(source).issues.map((current) => current.code);
    expect(codes).toContain('lone-carriage-return');
    expect(codes).toContain('tab-character');
  });

  it('diagnoses an indentation jump even when its width is an even number', () => {
    const source = ':: start\n@if true\n    @goto end\n@end\n';
    expect(parseStorySyntax(source).issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-indentation',
        from: source.indexOf('    @goto'),
        to: source.indexOf('@goto'),
      }),
    );
  });
});

describe('Lezer expression parser', () => {
  it('builds precedence-correct ranges and recognizes calls and booleans', () => {
    const source = '1 + 2 * 3';
    const result = parseExpressionSyntax(source);
    expect(result.issues).toEqual([]);
    const multiplicative = rangesFor(result.tree, 'MultiplicativeExpression').find(
      (range) => source.slice(range.from, range.to) === '2 * 3',
    );
    expect(multiplicative).toBeDefined();

    const call = parseExpressionSyntax('clamp(trust + 1, 0, 5)');
    expect(call.issues).toEqual([]);
    expect(rangesFor(call.tree, 'CallExpression')).toHaveLength(1);
    expect(rangesFor(parseExpressionSyntax('!false').tree, 'BooleanLiteral')).toHaveLength(1);
  });

  it('returns stable recovery ranges for malformed expressions', () => {
    const result = parseExpressionSyntax('1 +');
    expect(syntaxTreeHasErrors(result.tree)).toBe(true);
    expect(result.issues).toEqual([
      {
        code: 'parse-error',
        message: 'The source does not match the story language grammar at this position.',
        from: 3,
        to: 3,
      },
    ]);
  });
});
