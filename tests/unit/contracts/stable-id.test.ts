import { readFile } from 'node:fs/promises';

import type { AnySchema } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  InvalidStableIdError,
  InvalidStableIdMigrationError,
  isOwnedByStableIdNamespace,
  parseStableId,
  resolveStableIdMigration,
  stableIdNamespace,
  suggestStableId,
  validateStableId,
  validateStableIdMigrations,
  type StableIdIssueCode,
} from '../../../packages/contracts/src/index.js';

interface InvalidIdFixture {
  readonly input: string;
  readonly codes: readonly StableIdIssueCode[];
}

async function readJsonFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../../fixtures/contracts/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

describe('stable ID contract', () => {
  it('accepts every canonical fixture and published schema agrees', async () => {
    const values = (await readJsonFixture('stable-ids.valid.json')) as readonly string[];
    const schema = await readJsonFixture('../../../schemas/stable-id.schema.json');
    const validateSchema = new Ajv2020({ strict: true }).compile(schema as AnySchema);

    for (const value of values) {
      expect(parseStableId(value)).toBe(value);
      expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    }
  });

  it('returns stable issue codes for malformed fixtures', async () => {
    const fixtures = (await readJsonFixture(
      'stable-ids.invalid.json',
    )) as readonly InvalidIdFixture[];
    const schema = await readJsonFixture('../../../schemas/stable-id.schema.json');
    const validateSchema = new Ajv2020({ strict: true }).compile(schema as AnySchema);

    for (const fixture of fixtures) {
      expect(validateStableId(fixture.input).map((issue) => issue.code)).toEqual(fixture.codes);
      expect(() => parseStableId(fixture.input)).toThrow(InvalidStableIdError);
      expect(validateSchema(fixture.input)).toBe(false);
    }
  });

  it('reserves the rpgne namespace unless core ownership is explicit', () => {
    expect(validateStableId('rpgne.world')[0]?.code).toBe('reserved-namespace');
    expect(parseStableId('rpgne.world', { allowReservedNamespace: true })).toBe('rpgne.world');
  });

  it('creates visible editor suggestions without changing compiler validation', () => {
    expect(suggestStableId('Mára at the Last Station')).toBe('mara-at-the-last-station');
    expect(suggestStableId('東京')).toBeUndefined();
    expect(() => parseStableId<'scene'>('Mára at the Last Station')).toThrow(InvalidStableIdError);
  });

  it('checks exact namespace ownership', () => {
    const plugin = parseStableId<'plugin'>('org.example.weather');
    expect(isOwnedByStableIdNamespace(parseStableId('org.example.weather.thunder'), plugin)).toBe(
      true,
    );
    expect(isOwnedByStableIdNamespace(parseStableId('org.example.weathered'), plugin)).toBe(false);
    expect(stableIdNamespace(parseStableId('org.example.weather.thunder'))).toBe(
      'org.example.weather',
    );
  });

  it('resolves valid rename chains and rejects ambiguous or cyclic mappings', () => {
    const oldId = parseStableId<'scene'>('station.old');
    const middleId = parseStableId<'scene'>('station.middle');
    const currentId = parseStableId<'scene'>('station.current');
    const chain = [
      { from: oldId, to: middleId },
      { from: middleId, to: currentId },
    ] as const;

    expect(resolveStableIdMigration(oldId, chain)).toBe(currentId);
    expect(validateStableIdMigrations(chain)).toEqual([]);

    const cycle = [
      { from: oldId, to: middleId },
      { from: middleId, to: oldId },
    ] as const;
    expect(validateStableIdMigrations(cycle)[0]?.code).toBe('cycle');
    expect(() => resolveStableIdMigration(oldId, cycle)).toThrow(InvalidStableIdMigrationError);

    expect(
      validateStableIdMigrations([
        { from: oldId, to: middleId },
        { from: oldId, to: currentId },
      ])[0]?.code,
    ).toBe('duplicate-source');
  });
});
