import { describe, expect, it } from 'vitest';

import { extractModuleSpecifiers, findDependencyCycles } from '../../scripts/check-boundaries.mjs';
import {
  forbiddenManifestDependencies,
  isForbiddenElectronPackage,
} from '../../scripts/check-no-electron.mjs';

describe('workspace boundary policy', () => {
  it('detects a package dependency cycle', () => {
    const graph = new Map([
      ['@rpgnarrativeengine/a', new Set(['@rpgnarrativeengine/b'])],
      ['@rpgnarrativeengine/b', new Set(['@rpgnarrativeengine/c'])],
      ['@rpgnarrativeengine/c', new Set(['@rpgnarrativeengine/a'])],
    ]);

    expect(findDependencyCycles(graph)).toEqual([
      [
        '@rpgnarrativeengine/a',
        '@rpgnarrativeengine/b',
        '@rpgnarrativeengine/c',
        '@rpgnarrativeengine/a',
      ],
    ]);
  });

  it('extracts static, dynamic, and CommonJS module specifiers', () => {
    const source = [
      "import value from '@rpgnarrativeengine/a';",
      "export { other } from '@rpgnarrativeengine/b';",
      "await import('@rpgnarrativeengine/c');",
      "require('@rpgnarrativeengine/d');",
    ].join('\n');

    expect(extractModuleSpecifiers(source)).toEqual([
      '@rpgnarrativeengine/a',
      '@rpgnarrativeengine/b',
      '@rpgnarrativeengine/c',
      '@rpgnarrativeengine/d',
    ]);
  });
});

describe('no-Electron policy', () => {
  it('rejects Electron runtime and tooling packages', () => {
    expect(isForbiddenElectronPackage('electron')).toBe(true);
    expect(isForbiddenElectronPackage('@electron/packager')).toBe(true);
    expect(isForbiddenElectronPackage('electron-builder')).toBe(true);
    expect(isForbiddenElectronPackage('@tauri-apps/api')).toBe(false);
  });

  it('detects a forbidden manifest dependency', () => {
    const manifest = JSON.stringify({
      dependencies: { electron: '1.0.0' },
      devDependencies: { typescript: '6.0.3' },
    });

    expect(forbiddenManifestDependencies(manifest)).toEqual(['electron']);
  });
});
