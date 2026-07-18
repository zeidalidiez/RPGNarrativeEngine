import { readFile } from 'node:fs/promises';

import type { AnySchema } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  applyDiagnosticPolicy,
  createDiagnostic,
  createDiagnosticCode,
  createDiagnosticFix,
  createSourceLocation,
  createSourceTextEdit,
  diagnosticDomain,
  parseDiagnosticCode,
  serializeDiagnostic,
  sourceSpanFromOffsets,
  type DiagnosticFixApplicability,
  type DiagnosticTag,
} from '../../../packages/contracts/src/index.js';

async function readJsonFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../../fixtures/contracts/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

function createInvalidSceneIdDiagnostic() {
  const source = ':: Start\r\nMara: Hi';
  const span = sourceSpanFromOffsets(source, 3, 8);
  const file = 'story/main.story';
  return createDiagnostic({
    code: createDiagnosticCode('language', 1004),
    severity: 'error',
    message: 'Scene ID "Start" must use lowercase ASCII.',
    location: createSourceLocation(file, span),
    fixes: [
      createDiagnosticFix('Change the scene ID to start', 'automatic', [
        createSourceTextEdit({
          file,
          span,
          expectedText: 'Start',
          replacement: 'start',
        }),
      ]),
    ],
  });
}

describe('diagnostic contract', () => {
  it('assigns codes only inside their owning domain', () => {
    const code = createDiagnosticCode('compiler', 3007);
    expect(code).toBe('RPGNE3007');
    expect(parseDiagnosticCode(code)).toBe(code);
    expect(diagnosticDomain(code)).toBe('compiler');
    expect(() => createDiagnosticCode('compiler', 2007)).toThrow(RangeError);
    expect(() => parseDiagnosticCode('RPGNE007')).toThrow(TypeError);
  });

  it('serializes deterministically and validates against the published schema', async () => {
    const diagnostic = createInvalidSceneIdDiagnostic();
    const expected = await readJsonFixture('diagnostic.valid.json');
    const serialized = serializeDiagnostic(diagnostic);
    expect(JSON.parse(serialized) as unknown).toEqual(expected);
    expect(serialized.endsWith('\n')).toBe(true);

    const schema = await readJsonFixture('../../../schemas/diagnostic.schema.json');
    const validateSchema = new Ajv2020({ strict: true }).compile(schema as AnySchema);
    expect(validateSchema(JSON.parse(serialized)), JSON.stringify(validateSchema.errors)).toBe(
      true,
    );
    expect(validateSchema(await readJsonFixture('diagnostic.invalid.json'))).toBe(false);
  });

  it('rejects stale-length and overlapping edits', () => {
    const span = sourceSpanFromOffsets('abcdef', 1, 4);
    expect(() =>
      createSourceTextEdit({
        file: 'story/main.story',
        span,
        expectedText: 'wrong length',
        replacement: 'x',
      }),
    ).toThrow(RangeError);

    expect(() =>
      createDiagnosticFix('Conflicting fix', 'automatic', [
        createSourceTextEdit({
          file: 'story/main.story',
          span,
          expectedText: 'bcd',
          replacement: 'x',
        }),
        createSourceTextEdit({
          file: 'story/main.story',
          span: sourceSpanFromOffsets('abcdef', 3, 5),
          expectedText: 'de',
          replacement: 'y',
        }),
      ]),
    ).toThrow(RangeError);
  });

  it('validates string enums at runtime for untyped callers', () => {
    const base = createInvalidSceneIdDiagnostic();
    expect(() =>
      createDiagnosticFix(
        'Invalid applicability',
        'unsafe' as DiagnosticFixApplicability,
        base.fixes[0]?.edits ?? [],
      ),
    ).toThrow(TypeError);
    expect(() => createDiagnostic({ ...base, tags: ['unknown' as DiagnosticTag] })).toThrow(
      TypeError,
    );
  });

  it('applies release severity policy without changing diagnostic identity', () => {
    const base = createInvalidSceneIdDiagnostic();
    const warning = createDiagnostic({ ...base, severity: 'warning' });
    const promoted = applyDiagnosticPolicy(warning, { warningsAsErrors: true });
    expect(promoted.severity).toBe('error');
    expect(promoted.code).toBe(warning.code);
    expect(applyDiagnosticPolicy(base, {})).toBe(base);
  });
});
