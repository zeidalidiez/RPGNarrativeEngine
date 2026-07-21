import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'examples/showcase/build/web/folder');

/**
 * @param {boolean} condition
 * @param {string} message
 */
function invariant(condition, message) {
  if (!condition) throw new Error(`Showcase Pages verification failed: ${message}`);
}

/**
 * @param {string} directory
 * @param {string} [relativeDirectory]
 * @returns {Promise<string[]>}
 */
async function listFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath =
      relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

const requiredFiles = [
  'assets/player.css',
  'assets/player.js',
  'assets/pwa.js',
  'game-bundle.json',
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
];
const files = await listFiles(root);
for (const required of requiredFiles) {
  invariant(files.includes(required), `missing ${required}`);
}
invariant(
  files.every(
    (file) =>
      !file.endsWith('.story') &&
      !file.endsWith('.ts') &&
      !file.endsWith('.toml') &&
      !file.startsWith('.env'),
  ),
  'source or environment files leaked into the deployable folder',
);

const index = await readFile(path.join(root, 'index.html'), 'utf8');
const documentUrl = new URL('https://example.invalid/RPGNarrativeEngine/index.html');
const references = [...index.matchAll(/(?:href|src)="([^"]+)"/gu)].flatMap((match) => {
  const reference = match[1];
  return reference === undefined ? [] : [reference];
});
for (const reference of references) {
  if (reference.startsWith('data:')) continue;
  const resolved = new URL(reference, documentUrl);
  invariant(resolved.origin === documentUrl.origin, `external page dependency ${reference}`);
  invariant(
    resolved.pathname.startsWith('/RPGNarrativeEngine/'),
    `root-relative reference breaks repository-subpath hosting: ${reference}`,
  );
  const relative = resolved.pathname.slice('/RPGNarrativeEngine/'.length);
  invariant(files.includes(relative), `page references missing file ${relative}`);
}

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
invariant(manifest.start_url === './', 'manifest start_url must remain repository-relative');
invariant(manifest.scope === './', 'manifest scope must remain repository-relative');
invariant(manifest.display === 'standalone', 'manifest must request standalone display');

const gameBundle = await readFile(path.join(root, 'game-bundle.json'));
const game = JSON.parse(gameBundle.toString('utf8'));
invariant(game.format === 'rpg-narrative-engine', 'game bundle format is missing or invalid');
const gameBundleHash = createHash('sha256').update(gameBundle).digest('hex');
const serviceWorker = await readFile(path.join(root, 'service-worker.js'), 'utf8');
invariant(serviceWorker.includes(gameBundleHash), 'service-worker cache is not tied to this build');
invariant(serviceWorker.includes('RPGNE_ACTIVATE_UPDATE'), 'explicit update activation is missing');

console.log(`Verified GitHub Pages showcase: ${files.length} files, bundle ${gameBundleHash}.`);
