import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  return s;
}

export function hmac(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/*
 * Authenticated encryption for third-party tokens stored in the database (e.g. a person's Google
 * refresh token). AES-256-GCM with a key derived from TOKEN_ENCRYPTION_KEY, falling back to
 * SESSION_SECRET. Rotating that secret makes stored tokens unreadable — people simply reconnect.
 */
function tokenKey(): Buffer {
  const base = process.env.TOKEN_ENCRYPTION_KEY || secret();
  return Buffer.from(hkdfSync('sha256', base, 'sahynex-os', 'token-encryption-v1', 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, data] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable encrypted value.');
  const d = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
