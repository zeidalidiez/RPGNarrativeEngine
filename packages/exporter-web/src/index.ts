import type { CompiledGame } from '@rpgnarrativeengine/ir';

import { webPlayerJavaScript } from './web-player-bundle.generated.js';
import {
  contentBytes,
  createDeterministicWebZip,
  sha256Base64,
  sha256Hex,
  type WebFileContent,
} from './web-archive.js';
import { webPlayerStyles } from './web-player-styles.js';

export type { WebFileContent } from './web-archive.js';
export { createDeterministicWebZip, sha256Hex } from './web-archive.js';

export interface WebExportMetadata {
  readonly projectId: string;
  readonly title: string;
  readonly version: string;
  readonly slug: string;
  readonly language: string;
  readonly saves: boolean;
}

export interface WebExportRequest {
  readonly game: CompiledGame;
  readonly metadata: WebExportMetadata;
  readonly basePath?: string;
}

export interface WebExportFile {
  readonly path: string;
  readonly mimeType: string;
  readonly content: WebFileContent;
  readonly size: number;
  readonly sha256: string;
}

export interface WebFolderExport {
  readonly target: 'web';
  readonly contentHash: string;
  readonly files: readonly WebExportFile[];
  readonly size: number;
}

export interface WebFileExport {
  readonly target: 'web-single' | 'web-zip';
  readonly contentHash: string;
  readonly file: WebExportFile;
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const comparison =
      (leftPoints[index]?.codePointAt(0) ?? 0) - (rightPoints[index]?.codePointAt(0) ?? 0);
    if (comparison !== 0) return comparison;
  }
  return leftPoints.length - rightPoints.length;
}

/** Serialize JSON with recursively sorted object keys for a host-independent content hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Canonical game data cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort(compareUnicodeCodePoints)
      .map((key) => {
        const child = record[key];
        if (child === undefined)
          throw new Error('Canonical game data cannot contain undefined values.');
        return `${JSON.stringify(key)}:${canonicalJson(child)}`;
      });
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Canonical game data cannot contain ${typeof value} values.`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function embeddedJson(value: string): string {
  return value
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function inlineScript(value: string): string {
  return value.replace(/<\/script/giu, '<\\/script');
}

function inlineStyle(value: string): string {
  return value.replace(/<\/style/giu, '<\\/style');
}

function normalizedBasePath(value: string | undefined): string {
  const basePath = value ?? './';
  if (
    basePath === './' ||
    (basePath.startsWith('/') &&
      !basePath.startsWith('//') &&
      basePath.endsWith('/') &&
      !basePath.includes('\\') &&
      !basePath.includes('?') &&
      !basePath.includes('#') &&
      !basePath.split('/').some((segment) => segment === '..'))
  ) {
    return basePath;
  }
  throw new Error(
    `Web base path ${JSON.stringify(basePath)} must be "./" or an absolute URL path ending in "/".`,
  );
}

async function exportedFile(
  path: string,
  mimeType: string,
  content: WebFileContent,
): Promise<WebExportFile> {
  return Object.freeze({
    path,
    mimeType,
    content,
    size: contentBytes(content).length,
    sha256: await sha256Hex(content),
  });
}

function pageBody(
  metadata: WebExportMetadata,
  gameBundleHash: string,
  playerAttributes = '',
): string {
  return `<main class="rpgne-shell">
      <header class="rpgne-header">
        <p class="rpgne-brand">RPG Narrative Engine</p>
        <p class="rpgne-version">Version ${escapeHtml(metadata.version)}</p>
      </header>
      <h1 class="rpgne-title">${escapeHtml(metadata.title)}</h1>
      <div id="player" class="rpgne-player-frame" data-project-id="${escapeHtml(metadata.projectId)}" data-game-bundle-hash="${gameBundleHash}" data-saves="${String(metadata.saves)}"${playerAttributes}></div>
      <footer class="rpgne-footer">Created with RPG Narrative Engine</footer>
    </main>`;
}

function folderHtml(request: WebExportRequest, gameBundleHash: string): string {
  const basePath = normalizedBasePath(request.basePath);
  const title = escapeHtml(request.metadata.title);
  const bundleUrl = `${basePath}game-bundle.json`;
  return `<!doctype html>
<html lang="${escapeHtml(request.metadata.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; media-src 'self' data: blob:; base-uri 'none'; form-action 'none'" />
    <meta name="application-name" content="${title}" />
    <meta name="generator" content="RPG Narrative Engine" />
    <title>${title}</title>
    <link rel="stylesheet" href="${escapeHtml(`${basePath}assets/player.css`)}" />
  </head>
  <body>
    ${pageBody(request.metadata, gameBundleHash, ` data-game-bundle="${escapeHtml(bundleUrl)}"`)}
    <script src="${escapeHtml(`${basePath}assets/player.js`)}"></script>
  </body>
</html>
`;
}

async function singleHtml(
  request: WebExportRequest,
  gameJson: string,
  gameBundleHash: string,
): Promise<string> {
  const styles = inlineStyle(webPlayerStyles.trim());
  const script = inlineScript(webPlayerJavaScript.trim());
  const styleHash = await sha256Base64(styles);
  const scriptHash = await sha256Base64(script);
  const title = escapeHtml(request.metadata.title);
  return `<!doctype html>
<html lang="${escapeHtml(request.metadata.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src data:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'" />
    <meta name="application-name" content="${title}" />
    <meta name="generator" content="RPG Narrative Engine" />
    <title>${title}</title>
    <style>${styles}</style>
  </head>
  <body>
    ${pageBody(request.metadata, gameBundleHash)}
    <script id="rpgne-game" type="application/json">${embeddedJson(gameJson)}</script>
    <script>${script}</script>
  </body>
</html>
`;
}

export async function createWebFolderExport(request: WebExportRequest): Promise<WebFolderExport> {
  const gameJson = `${canonicalJson(request.game)}\n`;
  const contentHash = await sha256Hex(gameJson);
  const files = await Promise.all([
    exportedFile('index.html', 'text/html;charset=utf-8', folderHtml(request, contentHash)),
    exportedFile('game-bundle.json', 'application/json;charset=utf-8', gameJson),
    exportedFile('assets/player.css', 'text/css;charset=utf-8', `${webPlayerStyles.trim()}\n`),
    exportedFile(
      'assets/player.js',
      'text/javascript;charset=utf-8',
      `${webPlayerJavaScript.trim()}\n`,
    ),
  ]);
  return Object.freeze({
    target: 'web',
    contentHash,
    files: Object.freeze(files),
    size: files.reduce((total, file) => total + file.size, 0),
  });
}

export async function createWebZipExport(
  folder: WebFolderExport,
  filename: string,
): Promise<WebFileExport> {
  const content = createDeterministicWebZip(folder.files);
  return Object.freeze({
    target: 'web-zip',
    contentHash: folder.contentHash,
    file: await exportedFile(filename, 'application/zip', content),
  });
}

export async function createWebSingleExport(request: WebExportRequest): Promise<WebFileExport> {
  const gameJson = `${canonicalJson(request.game)}\n`;
  const contentHash = await sha256Hex(gameJson);
  return Object.freeze({
    target: 'web-single',
    contentHash,
    file: await exportedFile(
      `${request.metadata.slug}-${request.metadata.version}.html`,
      'text/html;charset=utf-8',
      await singleHtml(request, gameJson, contentHash),
    ),
  });
}
