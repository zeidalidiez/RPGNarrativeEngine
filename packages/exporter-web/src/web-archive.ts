const encoder = new TextEncoder();

export type WebFileContent = string | Uint8Array;

export function contentBytes(content: WebFileContent): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

async function sha256(content: WebFileContent): Promise<Uint8Array> {
  const bytes = contentBytes(content);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(content: WebFileContent): Promise<string> {
  const digest = await sha256(content);
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64(content: WebFileContent): Promise<string> {
  const digest = await sha256(content);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < digest.length; index += 3) {
    const first = digest[index] ?? 0;
    const second = digest[index + 1] ?? 0;
    const third = digest[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    result += alphabet[(value >>> 18) & 63];
    result += alphabet[(value >>> 12) & 63];
    result += index + 1 < digest.length ? alphabet[(value >>> 6) & 63] : '=';
    result += index + 2 < digest.length ? alphabet[value & 63] : '=';
  }
  return result;
}

const crcTable = new Uint32Array(256);
for (let value = 0; value < crcTable.length; value += 1) {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  crcTable[value] = current >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function validateArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    [...path].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid web archive path ${JSON.stringify(path)}.`);
  }
}

export interface WebArchiveEntry {
  readonly path: string;
  readonly content: WebFileContent;
}

interface PreparedEntry {
  readonly path: Uint8Array;
  readonly content: Uint8Array;
  readonly checksum: number;
  readonly offset: number;
}

/** Create a deterministic, uncompressed UTF-8 ZIP with a fixed 1980-01-01 timestamp. */
export function createDeterministicWebZip(entries: readonly WebArchiveEntry[]): Uint8Array {
  const ordered = [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const paths = new Set<string>();
  const localParts: Uint8Array[] = [];
  const prepared: PreparedEntry[] = [];
  let localOffset = 0;

  for (const entry of ordered) {
    validateArchivePath(entry.path);
    if (paths.has(entry.path)) {
      throw new Error(`Duplicate web archive path ${JSON.stringify(entry.path)}.`);
    }
    paths.add(entry.path);
    const path = encoder.encode(entry.path);
    const content = contentBytes(entry.content);
    if (path.length > 0xffff || content.length > 0xffffffff) {
      throw new Error(`Web archive entry ${JSON.stringify(entry.path)} exceeds ZIP32 limits.`);
    }
    const checksum = crc32(content);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    write32(view, 0, 0x04034b50);
    write16(view, 4, 20);
    write16(view, 6, 0x0800);
    write16(view, 8, 0);
    write16(view, 10, 0);
    write16(view, 12, 0x0021);
    write32(view, 14, checksum);
    write32(view, 18, content.length);
    write32(view, 22, content.length);
    write16(view, 26, path.length);
    write16(view, 28, 0);
    localParts.push(header, path, content);
    prepared.push({ path, content, checksum, offset: localOffset });
    localOffset += header.length + path.length + content.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of prepared) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    write32(view, 0, 0x02014b50);
    write16(view, 4, 20);
    write16(view, 6, 20);
    write16(view, 8, 0x0800);
    write16(view, 10, 0);
    write16(view, 12, 0);
    write16(view, 14, 0x0021);
    write32(view, 16, entry.checksum);
    write32(view, 20, entry.content.length);
    write32(view, 24, entry.content.length);
    write16(view, 28, entry.path.length);
    write16(view, 30, 0);
    write16(view, 32, 0);
    write16(view, 34, 0);
    write16(view, 36, 0);
    write32(view, 38, 0);
    write32(view, 42, entry.offset);
    centralParts.push(header, entry.path);
    centralSize += header.length + entry.path.length;
  }

  if (prepared.length > 0xffff || localOffset > 0xffffffff || centralSize > 0xffffffff) {
    throw new Error('The generated web archive exceeds ZIP32 limits.');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, prepared.length);
  write16(endView, 10, prepared.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);
  return joinBytes([...localParts, ...centralParts, end]);
}
