/**
 * Absolute URL for a redirect back into the app.
 *
 * Behind a hosting proxy (Render, etc.) `req.url` is the internal address the server listens on
 * (e.g. http://localhost:10000), so redirects built from it send people somewhere unreachable.
 * Prefer APP_URL, then the proxy's forwarded host, and only fall back to `req.url` locally.
 */
export function appUrl(path: string, req: Request): URL {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(path, configured.replace(/\/$/, '') + '/');
    } catch {
      // fall through to header-based detection
    }
  }
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', ''))
      .split(',')[0]
      .trim();
    return new URL(path, `${proto}://${host.split(',')[0].trim()}`);
  }
  return new URL(path, req.url);
}
