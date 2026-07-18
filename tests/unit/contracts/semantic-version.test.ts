import { readFile } from 'node:fs/promises';

import type { AnySchema } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  InvalidSemanticVersionError,
  InvalidSemanticVersionRangeError,
  compareSemanticVersions,
  compatibleSemanticVersionRange,
  createSemanticVersionRange,
  haveEqualSemanticVersionPrecedence,
  parseSemanticVersion,
  satisfiesSemanticVersionRange,
  semanticVersionParts,
  type SemanticCompatibilityPolicy,
} from '../../../packages/contracts/src/index.js';

interface CompatibilityFixture {
  readonly minimum: string;
  readonly policy: SemanticCompatibilityPolicy;
  readonly before: string;
  readonly accepts: readonly string[];
  readonly rejects: readonly string[];
}

async function readJsonFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`../../fixtures/contracts/${name}`, import.meta.url), 'utf8'),
  ) as unknown;
}

describe('semantic version contract', () => {
  it('keeps the TypeScript parser and published schema in agreement', async () => {
    const valid = (await readJsonFixture('semantic-versions.valid.json')) as readonly string[];
    const invalid = (await readJsonFixture('semantic-versions.invalid.json')) as readonly string[];
    const schema = await readJsonFixture('../../../schemas/semantic-version.schema.json');
    const validateSchema = new Ajv2020({ strict: true }).compile(schema as AnySchema);

    for (const value of valid) {
      expect(parseSemanticVersion(value)).toBe(value);
      expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    }
    for (const value of invalid) {
      expect(() => parseSemanticVersion(value)).toThrow(InvalidSemanticVersionError);
      expect(validateSchema(value)).toBe(false);
    }
  });

  it('implements SemVer precedence including prereleases and build metadata', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ].map(parseSemanticVersion);

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(compareSemanticVersions(previous!, current!)).toBeLessThan(0);
    }

    expect(
      haveEqualSemanticVersionPrecedence(
        parseSemanticVersion('1.2.3+linux'),
        parseSemanticVersion('1.2.3+windows'),
      ),
    ).toBe(true);
    expect(
      compareSemanticVersions(
        parseSemanticVersion('999999999999999999999.0.0'),
        parseSemanticVersion('1000000000000000000000.0.0'),
      ),
    ).toBeLessThan(0);
    expect(semanticVersionParts(parseSemanticVersion('10.20.30-rc.1+build.9'))).toMatchObject({
      major: '10',
      minor: '20',
      patch: '30',
      prerelease: ['rc', '1'],
      build: ['build', '9'],
    });
  });

  it('matches the compatibility fixture for stable and pre-1.0 versions', async () => {
    const fixtures = (await readJsonFixture(
      'semantic-version-compatibility.json',
    )) as readonly CompatibilityFixture[];

    for (const fixture of fixtures) {
      const range = compatibleSemanticVersionRange(
        parseSemanticVersion(fixture.minimum),
        fixture.policy,
      );
      expect(range.before).toBe(fixture.before);
      for (const accepted of fixture.accepts) {
        expect(satisfiesSemanticVersionRange(parseSemanticVersion(accepted), range)).toBe(true);
      }
      for (const rejected of fixture.rejects) {
        expect(satisfiesSemanticVersionRange(parseSemanticVersion(rejected), range)).toBe(false);
      }
    }
  });

  it('supports explicit open bounds and rejects empty or reversed intervals', () => {
    const beforeTwo = createSemanticVersionRange({ before: parseSemanticVersion('2.0.0') });
    expect(satisfiesSemanticVersionRange(parseSemanticVersion('1.0.0'), beforeTwo)).toBe(true);
    expect(satisfiesSemanticVersionRange(parseSemanticVersion('2.0.0'), beforeTwo)).toBe(false);
    expect(satisfiesSemanticVersionRange(parseSemanticVersion('1.5.0-beta.1'), beforeTwo)).toBe(
      false,
    );
    expect(() =>
      createSemanticVersionRange({
        minimum: parseSemanticVersion('2.0.0'),
        before: parseSemanticVersion('2.0.0'),
      }),
    ).toThrow(InvalidSemanticVersionRangeError);
    expect(() =>
      compatibleSemanticVersionRange(
        parseSemanticVersion('1.0.0'),
        'caret' as SemanticCompatibilityPolicy,
      ),
    ).toThrow(TypeError);
  });
});
