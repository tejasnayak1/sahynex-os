import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}

/** Minimum policy: 10+ chars, not all one character class. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 2) return 'Use at least two of: lowercase, uppercase, numbers, symbols.';
  return null;
}
