import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT_DIRECTORY = path.join(ROOT, 'build', 'reports');

/**
 * @typedef {object} InstalledPackage
 * @property {string} name
 * @property {string} version
 * @property {string[]} licenses
 */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeLicenses(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((license) => normalizeLicenses(license));
  }
  if (value !== null && typeof value === 'object' && 'type' in value) {
    return normalizeLicenses(value.type);
  }
  return ['UNKNOWN'];
}

/**
 * @param {string} manifestPath
 * @returns {Promise<InstalledPackage | undefined>}
 */
async function readInstalledPackage(manifestPath) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      return undefined;
    }
    return {
      name: manifest.name,
      version: manifest.version,
      licenses: [...new Set(normalizeLicenses(manifest.license ?? manifest.licenses))].sort(),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** @returns {Promise<InstalledPackage[]>} */
async function collectInstalledPackages() {
  const virtualStore = path.join(ROOT, 'node_modules', '.pnpm');
  let entries;
  try {
    entries = await readdir(virtualStore, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        'Dependency inventory requires an installed workspace. Run pnpm install first.',
        { cause: error },
      );
    }
    throw error;
  }

  /** @type {Map<string, InstalledPackage>} */
  const packages = new Map();

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const nodeModules = path.join(virtualStore, entry.name, 'node_modules');
    let packageEntries;
    try {
      packageEntries = await readdir(nodeModules, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const packageEntry of packageEntries.filter((candidate) => candidate.isDirectory())) {
      if (packageEntry.name.startsWith('@')) {
        const scopeDirectory = path.join(nodeModules, packageEntry.name);
        const scopedEntries = await readdir(scopeDirectory, { withFileTypes: true });
        for (const scopedEntry of scopedEntries.filter((candidate) => candidate.isDirectory())) {
          const installedPackage = await readInstalledPackage(
            path.join(scopeDirectory, scopedEntry.name, 'package.json'),
          );
          if (installedPackage !== undefined) {
            packages.set(`${installedPackage.name}@${installedPackage.version}`, installedPackage);
          }
        }
      } else {
        const installedPackage = await readInstalledPackage(
          path.join(nodeModules, packageEntry.name, 'package.json'),
        );
        if (installedPackage !== undefined) {
          packages.set(`${installedPackage.name}@${installedPackage.version}`, installedPackage);
        }
      }
    }
  }

  return [...packages.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

/**
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const [scope = '', packageName = ''] = name.split('/');
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

/** @returns {Promise<string>} */
async function serialNumber() {
  const lockfile = await readFile(path.join(ROOT, 'pnpm-lock.yaml'));
  const hash = createHash('sha256').update(lockfile).digest('hex');
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return `urn:uuid:${uuid}`;
}

/**
 * @param {string} fileName
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeReport(fileName, value) {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const destination = path.join(REPORT_DIRECTORY, fileName);
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, destination)}.`);
}

const mode = process.argv[2];
if (mode !== 'licenses' && mode !== 'sbom') {
  throw new Error('Usage: node scripts/dependency-inventory.mjs <licenses|sbom>');
}

const packages = await collectInstalledPackages();

if (mode === 'licenses') {
  await writeReport('dependency-licenses.json', {
    generatedAt: new Date().toISOString(),
    packageCount: packages.length,
    packages,
  });
} else {
  await writeReport('sbom.cdx.json', {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: await serialNumber(),
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: 'application',
        'bom-ref': 'pkg:generic/rpg-narrative-engine@0.0.0',
        name: 'rpg-narrative-engine',
        version: '0.0.0',
      },
    },
    components: packages.map((installedPackage) => ({
      type: 'library',
      'bom-ref': npmPurl(installedPackage.name, installedPackage.version),
      name: installedPackage.name,
      version: installedPackage.version,
      scope: 'required',
      licenses: installedPackage.licenses.map((license) => ({ license: { name: license } })),
      purl: npmPurl(installedPackage.name, installedPackage.version),
    })),
  });
}
