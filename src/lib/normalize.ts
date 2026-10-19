/** Pure normalisation helpers used for duplicate detection. Unit-tested in tests/unit. */

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Normalises phone numbers to E.164-like form. Defaults to India (+91) for 10-digit national numbers,
 * which is configurable via `defaultCountryCode`. Returns null for anything that is not plausibly a phone.
 */
export function normalizePhone(phone: string | null | undefined, defaultCountryCode = '91'): string | null {
  if (!phone) return null;
  const hasPlus = phone.trim().startsWith('+');
  let d = phone.replace(/\D/g, '');
  if (!d) return null;
  if (hasPlus) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return `+${defaultCountryCode}${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return null;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Two non-empty values conflict when they differ after normalisation. Empty never conflicts. */
export function conflicts(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeName(a) !== normalizeName(b);
}

export function scoreQualification(
  answers: Record<string, unknown>,
  weights: Record<string, number>,
): number {
  let s = 0;
  for (const [k, w] of Object.entries(weights)) if (answers[k] === true) s += w;
  return Math.max(0, Math.min(100, Math.round(s)));
}
