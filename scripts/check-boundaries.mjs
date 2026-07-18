import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_PARENTS = ['apps', 'examples', 'modules', 'packages'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

/**
 * @typedef {object} PackageManifest
 * @property {string} name
 * @property {Record<string, string> | undefined} [dependencies]
 * @property {Record<string, string> | undefined} [devDependencies]
 * @property {Record<string, string> | undefined} [optionalDependencies]
 * @property {Record<string, string> | undefined} [peerDependencies]
 * @property {Record<string, unknown> | string | undefined} [exports]
 */

/**
 * @typedef {object} WorkspacePackage
 * @property {string} directory
 * @property {PackageManifest} manifest
 */

/**
 * Return dependency cycles in deterministic traversal order.
 *
 * @param {Map<string, Set<string>>} graph
 * @returns {string[][]}
 */
export function findDependencyCycles(graph) {
  /** @type {Map<string, 'visiting' | 'visited'>} */
  const states = new Map();
  /** @type {string[]} */
  const stack = [];
  /** @type {string[][]} */
  const cycles = [];
  const seenCycles = new Set();

  /** @param {string} node */
  function visit(node) {
    states.set(node, 'visiting');
    stack.push(node);

    const dependencies = [...(graph.get(node) ?? [])].sort();
    for (const dependency of dependencies) {
      const state = states.get(dependency);
      if (state === 'visiting') {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = normalizeCycle(cycle).join(' -> ');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (state !== 'visited') {
        visit(dependency);
      }
    }

    stack.pop();
    states.set(node, 'visited');
  }

  for (const node of [...graph.keys()].sort()) {
    if (!states.has(node)) {
      visit(node);
    }
  }

  return cycles;
}

/**
 * @param {string[]} cycle
 * @returns {string[]}
 */
function normalizeCycle(cycle) {
  const body = cycle.slice(0, -1);
  if (body.length === 0) {
    return cycle;
  }

  let lowestIndex = 0;
  for (let index = 1; index < body.length; index += 1) {
    if ((body[index] ?? '') < (body[lowestIndex] ?? '')) {
      lowestIndex = index;
    }
  }

  const rotated = [...body.slice(lowestIndex), ...body.slice(0, lowestIndex)];
  return [...rotated, rotated[0] ?? ''];
}

/** @returns {Promise<WorkspacePackage[]>} */
async function collectWorkspacePackages() {
  /** @type {WorkspacePackage[]} */
  const packages = [];

  for (const parent of WORKSPACE_PARENTS) {
    const parentDirectory = path.join(ROOT, parent);
    let entries;
    try {
      entries = await readdir(parentDirectory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }

    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const directory = path.join(parentDirectory, entry.name);
      const manifestPath = path.join(directory, 'package.json');
      let source;
      try {
        source = await readFile(manifestPath, 'utf8');
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }
        throw error;
      }

      /** @type {PackageManifest} */
      const manifest = JSON.parse(source);
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        throw new Error(`${path.relative(ROOT, manifestPath)} must declare a package name.`);
      }
      packages.push({ directory, manifest });
    }
  }

  return packages;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingPathError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * @param {PackageManifest} manifest
 * @returns {Set<string>}
 */
function declaredDependencies(manifest) {
  return new Set(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].sort(),
  );
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectSourceFiles(directory) {
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
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function extractModuleSpecifiers(source) {
  const pattern =
    /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  /** @type {string[]} */
  const specifiers = [];

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

/**
 * @param {PackageManifest} targetManifest
 * @param {string[]} subpathParts
 * @returns {boolean}
 */
function exportsSubpath(targetManifest, subpathParts) {
  if (subpathParts.length === 0) {
    return true;
  }
  if (typeof targetManifest.exports !== 'object' || targetManifest.exports === null) {
    return false;
  }
  return Object.hasOwn(targetManifest.exports, `./${subpathParts.join('/')}`);
}

/** @returns {Promise<void>} */
async function main() {
  const workspacePackages = await collectWorkspacePackages();
  const packagesByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.manifest.name, workspacePackage]),
  );

  if (packagesByName.size !== workspacePackages.length) {
    throw new Error('Workspace package names must be unique.');
  }

  /** @type {Map<string, Set<string>>} */
  const graph = new Map();
  /** @type {string[]} */
  const errors = [];

  for (const workspacePackage of workspacePackages) {
    const dependencies = declaredDependencies(workspacePackage.manifest);
    graph.set(
      workspacePackage.manifest.name,
      new Set([...dependencies].filter((dependency) => packagesByName.has(dependency))),
    );

    const files = await collectSourceFiles(path.join(workspacePackage.directory, 'src'));
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of extractModuleSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), specifier);
          const relative = path.relative(workspacePackage.directory, resolved);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            errors.push(
              `${path.relative(ROOT, file)} crosses its package boundary through ${specifier}.`,
            );
          }
          continue;
        }

        if (!specifier.startsWith('@rpgnarrativeengine/')) {
          continue;
        }

        const parts = specifier.split('/');
        const targetName = parts.slice(0, 2).join('/');
        const targetPackage = packagesByName.get(targetName);
        if (targetPackage === undefined) {
          errors.push(
            `${path.relative(ROOT, file)} imports unknown workspace package ${targetName}.`,
          );
          continue;
        }
        if (targetName !== workspacePackage.manifest.name && !dependencies.has(targetName)) {
          errors.push(
            `${path.relative(ROOT, file)} imports undeclared workspace dependency ${targetName}.`,
          );
        }
        if (!exportsSubpath(targetPackage.manifest, parts.slice(2))) {
          errors.push(
            `${path.relative(ROOT, file)} imports undocumented internal path ${specifier}.`,
          );
        }
      }
    }
  }

  for (const cycle of findDependencyCycles(graph)) {
    errors.push(`Workspace dependency cycle: ${cycle.join(' -> ')}.`);
  }

  if (errors.length > 0) {
    throw new Error(`Package boundary policy failed:\n- ${errors.join('\n- ')}`);
  }

  console.log(`Package boundary policy passed for ${workspacePackages.length} workspaces.`);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  await main();
}
