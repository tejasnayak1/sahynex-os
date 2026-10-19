import { existsSync, readFileSync } from 'node:fs';

/** Minimal .env loader for CLI scripts (Next.js loads .env itself). Never overrides existing vars. */
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, k, raw] = m;
    const v = raw.trim();
    // Quoted values are taken literally; unquoted values drop an inline " # comment" (like dotenv).
    const value = /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v.replace(/\s+#.*$/, '').trim();
    if (process.env[k] === undefined) process.env[k] = value;
  }
}
