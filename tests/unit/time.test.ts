import { describe, expect, it } from 'vitest';
import { fromDateTimeLocal, toDateTimeLocal, todayIn } from '@/lib/format';
import { backoffDelaySeconds, nextCronRun } from '@/server/automation/engine';
import { reportPeriods } from '@/server/services/reports';

describe('timezone-aware scheduling', () => {
  it('computes the next run in the organisation timezone', () => {
    // 07:55 IST daily = 02:25 UTC
    expect(nextCronRun('55 7 * * *', 'Asia/Kolkata', new Date('2026-10-19T10:00:00Z')).toISOString()).toBe(
      '2026-10-20T02:25:00.000Z',
    );
  });
  it('handles daylight-saving transitions (America/New_York, Nov 1 2026 fall back)', () => {
    const before = nextCronRun('0 9 * * *', 'America/New_York', new Date('2026-10-31T14:00:00Z'));
    const after = nextCronRun('0 9 * * *', 'America/New_York', new Date('2026-11-01T14:30:00Z'));
    expect(before.toISOString()).toBe('2026-11-01T14:00:00.000Z'); // 09:00 EST (UTC-5) on the transition day
    expect(after.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
  it('round-trips datetime-local values through the org timezone', () => {
    const d = fromDateTimeLocal('2026-10-19T18:30', 'Asia/Kolkata');
    expect(d.toISOString()).toBe('2026-10-19T13:00:00.000Z');
    expect(toDateTimeLocal(d, 'Asia/Kolkata')).toBe('2026-10-19T18:30');
  });
  it('interprets local times across a DST change correctly', () => {
    expect(fromDateTimeLocal('2026-03-08T12:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T16:00:00.000Z',
    ); // EDT
    expect(fromDateTimeLocal('2026-03-07T12:00', 'America/New_York').toISOString()).toBe(
      '2026-03-07T17:00:00.000Z',
    ); // EST
  });
  it('uses the org-local calendar day', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-10-19T20:00:00Z'))).toBe('2026-10-20');
  });
});

describe('report periods', () => {
  const now = new Date('2026-10-19T03:00:00Z'); // Monday 08:30 IST
  it('yesterday', () =>
    expect(reportPeriods.yesterday('Asia/Kolkata', now)).toEqual({ start: '2026-10-18', end: '2026-10-18' }));
  it('last full week (Mon–Sun)', () =>
    expect(reportPeriods.lastWeek('Asia/Kolkata', now)).toEqual({ start: '2026-10-12', end: '2026-10-18' }));
  it('last full month', () =>
    expect(reportPeriods.lastMonth('Asia/Kolkata', now)).toEqual({ start: '2026-09-01', end: '2026-09-30' }));
  it('month boundaries in the org timezone, not UTC', () => {
    // 1 Nov 00:30 IST is still 31 Oct in UTC; last month must be October.
    expect(reportPeriods.lastMonth('Asia/Kolkata', new Date('2026-10-31T19:00:00Z'))).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });
});

describe('retry backoff', () => {
  it('grows exponentially and respects Retry-After', () => {
    expect(backoffDelaySeconds(30, 1)).toBeGreaterThanOrEqual(30);
    expect(backoffDelaySeconds(30, 3)).toBeGreaterThanOrEqual(120);
    expect(backoffDelaySeconds(30, 1, 600)).toBeGreaterThanOrEqual(600);
    expect(backoffDelaySeconds(30, 30)).toBeLessThanOrEqual(6 * 3600);
  });
});
