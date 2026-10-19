import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { invalid } from './errors';
import { hmac, safeEqual } from './crypto';

/**
 * Object storage. The `local` driver writes to STORAGE_DIR (suitable for a single server with a
 * persistent, backed-up volume). Files are never served from a public path: downloads go through
 * /api/files/[id], which checks a short-lived HMAC signature bound to the viewer AND re-checks
 * the viewer's permission on the asset.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  {
    mime: 'video/mp4',
    ext: 'mp4',
    test: (b) =>
      b.subarray(4, 8).toString('ascii') === 'ftyp' && !b.subarray(8, 12).toString('ascii').startsWith('qt'),
  },
  {
    mime: 'video/quicktime',
    ext: 'mov',
    test: (b) =>
      b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii').startsWith('qt'),
  },
  {
    mime: 'application/zip',
    ext: 'zip',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

/** Determines the real file type from its content (never trusts the browser-supplied type). */
export function sniffType(buf: Buffer): { mime: string; ext: string } | null {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()]+/g, '_').slice(0, 150) || 'file';
}

function root() {
  return resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? './storage');
}

export async function putObject(orgId: string, data: Buffer, originalName: string) {
  if (data.length === 0) throw invalid('The file is empty.');
  if (data.length > MAX_UPLOAD_BYTES)
    throw invalid(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`);
  const type = sniffType(data);
  if (!type) throw invalid('Unsupported file type. Upload PNG, JPEG, WebP, GIF, PDF, MP4, MOV or ZIP.');
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver !== 'local')
    throw new Error(`Storage driver "${driver}" is not implemented. See docs/DEPLOYMENT.md.`);
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${type.ext}`;
  const path = join(root(), key);
  if (!path.startsWith(root())) throw invalid('Invalid storage path.');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { mode: 0o600 });
  return {
    storageKey: key,
    mimeType: type.mime,
    sizeBytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    fileName: sanitizeFileName(originalName),
  };
}

export async function getObject(storageKey: string): Promise<Buffer> {
  const path = resolve(/* turbopackIgnore: true */ root(), storageKey);
  if (!path.startsWith(root() + '/')) throw new Error('Invalid storage key');
  return readFile(path);
}

/** Time-limited download URL bound to a specific user. */
export function signedFileUrl(assetId: string, userId: string, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${assetId}?exp=${exp}&sig=${hmac(`${assetId}:${userId}:${exp}`)}`;
}

export function verifyFileSignature(
  assetId: string,
  userId: string,
  exp: string | null,
  sig: string | null,
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`${assetId}:${userId}:${exp}`), sig);
}
