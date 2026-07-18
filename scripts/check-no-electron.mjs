import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_PARENTS = ['apps', 'examples', 'modules', 'packages', 'templates'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

/**
 * @param {string} packageName
 * @returns {boolean}
 */
export function isForbiddenElectronPackage(packageName) {
  return (
    packageName === 'electron' ||
    packageName.startsWith('@electron/') ||
    /^electron(?:-|$)/u.test(packageName)
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingPathError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectFiles(directory) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    if (['build', 'dist', 'node_modules'].includes(entry.name)) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (
      entry.isFile() &&
      (entry.name === 'package.json' || SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    ) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function extractImportedPackages(source) {
  const pattern =
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  /** @type {string[]} */
  const packages = [];
  for (const match of source.matchAll(pattern)) {
    const packageName = match[1] ?? match[2] ?? match[3];
    if (packageName !== undefined) {
      packages.push(packageName);
    }
  }
  return packages;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function forbiddenManifestDependencies(source) {
  const manifest = JSON.parse(source);
  const dependencyGroups = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];
  return dependencyGroups
    .flatMap((dependencies) =>
      dependencies !== null && typeof dependencies === 'object' ? Object.keys(dependencies) : [],
    )
    .filter(isForbiddenElectronPackage)
    .sort();
}

/** @returns {Promise<void>} */
async function main() {
  /** @type {string[]} */
  const errors = [];
  const files = [path.join(ROOT, 'package.json')];

  for (const parent of WORKSPACE_PARENTS) {
    files.push(...(await collectFiles(path.join(ROOT, parent))));
  }

  for (const file of files) {
    if (/electron[^/\\]*\.(?:c?js|mjs|json|ts)$/iu.test(path.basename(file))) {
      errors.push(`${path.relative(ROOT, file)} is an Electron-specific configuration file.`);
    }

    const source = await readFile(file, 'utf8');
    if (path.basename(file) === 'package.json') {
      for (const dependency of forbiddenManifestDependencies(source)) {
        errors.push(`${path.relative(ROOT, file)} declares forbidden dependency ${dependency}.`);
      }
      continue;
    }

    for (const importedPackage of extractImportedPackages(source)) {
      const parts = importedPackage.split('/');
      const packageName = importedPackage.startsWith('@')
        ? parts.slice(0, 2).join('/')
        : (parts[0] ?? importedPackage);
      if (isForbiddenElectronPackage(packageName)) {
        errors.push(`${path.relative(ROOT, file)} imports forbidden package ${packageName}.`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`No-Electron policy failed:\n- ${errors.join('\n- ')}`);
  }

  console.log(`No-Electron policy passed across ${files.length} source and manifest files.`);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main();
}
