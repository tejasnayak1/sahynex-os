import { describe, expect, it } from 'vitest';
import { conflicts, normalizeEmail, normalizePhone, scoreQualification } from '@/lib/normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims valid emails', () =>
    expect(normalizeEmail('  Asha.Rao@Example.COM ')).toBe('asha.rao@example.com'));
  it('rejects invalid emails', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('assumes +91 for 10-digit numbers', () => expect(normalizePhone('98450 12345')).toBe('+919845012345'));
  it('strips a trunk 0', () => expect(normalizePhone('09845012345')).toBe('+919845012345'));
  it('keeps explicit international numbers', () =>
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100'));
  it('handles 00 prefix', () => expect(normalizePhone('0091 98450 12345')).toBe('+919845012345'));
  it('treats the same number in different formats as equal', () =>
    expect(normalizePhone('+91-98450-12345')).toBe(normalizePhone('9845012345')));
  it('rejects junk', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('conflicts', () => {
  it('ignores case and whitespace', () => expect(conflicts('Asha  Rao', 'asha rao')).toBe(false));
  it('never conflicts with an empty value', () => expect(conflicts('Asha', null)).toBe(false));
  it('detects different values', () => expect(conflicts('Asha', 'Neha')).toBe(true));
});

describe('scoreQualification', () => {
  const w = { a: 30, b: 50, c: 40 };
  it('sums weights of true answers only', () =>
    expect(scoreQualification({ a: true, b: false, c: 'yes' }, w)).toBe(30));
  it('caps at 100', () => expect(scoreQualification({ a: true, b: true, c: true }, w)).toBe(100));
  it('is 0 with no answers', () => expect(scoreQualification({}, w)).toBe(0));
});
