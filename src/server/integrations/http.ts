import { PermanentError, TransientError } from '../automation/types';

/**
 * fetch wrapper for third-party APIs: timeout, and maps failures to Transient (retry) vs Permanent
 * (dead-letter) errors. Response bodies in errors are truncated and never include request secrets.
 */
export async function apiFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new TransientError(
      `Network error calling ${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (res.ok) return body;
  const detail =
    typeof body === 'object' && body ? JSON.stringify(body).slice(0, 500) : String(text).slice(0, 300);
  const host = new URL(url).host;
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    throw new TransientError(`${host} rate limit (429). ${detail}`, Number.isFinite(ra) && ra > 0 ? ra : 120);
  }
  if (res.status >= 500) throw new TransientError(`${host} returned ${res.status}. ${detail}`);
  throw new PermanentError(`${host} returned ${res.status}. ${detail}`);
}
