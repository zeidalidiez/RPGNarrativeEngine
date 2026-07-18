import { gzipSync } from 'node:zlib';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_PARENTS = ['apps', 'examples', 'modules', 'packages'];

/**
 * @typedef {object} SizeEntry
 * @property {number} bytes
 * @property {number} gzipBytes
 * @property {string} path
 */

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
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (
      entry.isFile() &&
      !entry.name.endsWith('.map') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.tsbuildinfo')
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

/** @type {SizeEntry[]} */
const entries = [];

for (const parent of WORKSPACE_PARENTS) {
  const parentDirectory = path.join(ROOT, parent);
  let workspaces;
  try {
    workspaces = await readdir(parentDirectory, { withFileTypes: true });
  } catch {
    continue;
  }

  for (const workspace of workspaces.filter((candidate) => candidate.isDirectory())) {
    const distDirectory = path.join(parentDirectory, workspace.name, 'dist');
    for (const file of await collectFiles(distDirectory)) {
      const contents = await readFile(file);
      const fileStats = await stat(file);
      entries.push({
        path: path.relative(ROOT, file).replaceAll(path.sep, '/'),
        bytes: fileStats.size,
        gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
      });
    }
  }
}

entries.sort((left, right) => left.path.localeCompare(right.path));
const report = {
  generatedAt: new Date().toISOString(),
  files: entries,
  totals: {
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    gzipBytes: entries.reduce((total, entry) => total + entry.gzipBytes, 0),
  },
};

const reportDirectory = path.join(ROOT, 'build', 'reports');
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  path.join(reportDirectory, 'size-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(
  `Measured ${entries.length} built files: ${report.totals.bytes} bytes raw, ${report.totals.gzipBytes} bytes gzip.`,
);
