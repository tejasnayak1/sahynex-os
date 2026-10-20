import { afterEach, describe, expect, it } from 'vitest';
import { appUrl } from '@/lib/app-url';

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('appUrl (redirects behind a hosting proxy)', () => {
  const saved = process.env.APP_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  });

  it('uses APP_URL instead of the internal listen address', () => {
    process.env.APP_URL = 'https://sahynex-os.onrender.com/';
    expect(appUrl('/home?google=connected', req('http://localhost:10000/api/google/callback')).href).toBe(
      'https://sahynex-os.onrender.com/home?google=connected',
    );
  });

  it('falls back to forwarded headers, then the request URL', () => {
    delete process.env.APP_URL;
    expect(
      appUrl(
        '/login',
        req('http://localhost:10000/x', {
          'x-forwarded-host': 'os.example.com',
          'x-forwarded-proto': 'https',
        }),
      ).href,
    ).toBe('https://os.example.com/login');
    expect(appUrl('/login', req('http://localhost:3000/x')).href).toBe('http://localhost:3000/login');
  });
});
