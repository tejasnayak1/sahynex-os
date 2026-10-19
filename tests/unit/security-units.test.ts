import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, PERMISSIONS } from '@/lib/permissions';
import { passwordPolicyError } from '@/server/auth/password';
import { _test as mon } from '@/server/services/monitoring';
import { sanitizeFileName, signedFileUrl, sniffType, verifyFileSignature } from '@/server/storage';

describe('default roles', () => {
  it('employees have no company-wide finance, CRM-wide or admin permissions', () => {
    const p = DEFAULT_ROLES.employee.permissions;
    for (const k of [
      'finance.read',
      'leads.read.all',
      'deals.read.all',
      'settings.users',
      'settings.roles',
      'tasks.read.all',
      'clients.read.all',
    ])
      expect(p).not.toContain(k);
  });
  it('client reviewers only get approval, reports and content viewing', () => {
    expect([...DEFAULT_ROLES.client_reviewer.permissions].sort()).toEqual([
      'approvals.client',
      'content.read',
      'reports.read',
    ]);
  });
  it('every granted permission exists in the catalogue', () => {
    for (const r of Object.values(DEFAULT_ROLES))
      for (const p of r.permissions) expect(PERMISSIONS).toHaveProperty(p);
  });
  it('only the super admin can edit roles', () => {
    for (const [k, r] of Object.entries(DEFAULT_ROLES))
      if (k !== 'ceo') expect(r.permissions).not.toContain('settings.roles');
  });
});

describe('password policy', () => {
  it('rejects short or single-class passwords', () => {
    expect(passwordPolicyError('short')).not.toBeNull();
    expect(passwordPolicyError('alllowercaseletters')).not.toBeNull();
    expect(passwordPolicyError('Reasonable-Pass-2026')).toBeNull();
  });
});

describe('uploads', () => {
  it('detects real file types from content, not the name', () => {
    expect(sniffType(Buffer.from('%PDF-1.7 ...'))?.mime).toBe('application/pdf');
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe(
      'image/png',
    );
    expect(sniffType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffType(Buffer.from('<html><script>'))).toBeNull();
  });
  it('sanitises file names (no paths, no control characters)', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\evil\\a"b.png')).toBe('a_b.png');
  });
  it('signed URLs are bound to user and expire', () => {
    const url = new URL(signedFileUrl('asset-1', 'user-1', 60), 'http://x');
    const exp = url.searchParams.get('exp');
    const sig = url.searchParams.get('sig');
    expect(verifyFileSignature('asset-1', 'user-1', exp, sig)).toBe(true);
    expect(verifyFileSignature('asset-1', 'user-2', exp, sig)).toBe(false);
    expect(verifyFileSignature('asset-2', 'user-1', exp, sig)).toBe(false);
    expect(verifyFileSignature('asset-1', 'user-1', String(Math.floor(Date.now() / 1000) - 5), sig)).toBe(
      false,
    );
  });
});

describe('SSRF guard', () => {
  it('blocks private and loopback ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.16.0.5',
      '169.254.169.254',
      '::1',
      'fd00::1',
    ])
      expect(mon.isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '104.16.1.1']) expect(mon.isPrivateAddress(ip)).toBe(false);
  });
});
