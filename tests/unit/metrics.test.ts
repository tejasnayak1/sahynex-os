import { describe, expect, it } from 'vitest';
import { deriveCampaignMetrics, pctChange, ratio } from '@/lib/metrics';
import { freshness, sumTotals } from '@/server/services/campaigns';

const empty = {
  spendMinor: null,
  impressions: null,
  reach: null,
  clicks: null,
  platformLeads: null,
  landingPageViews: null,
  crmLeads: 0,
  qualifiedLeads: 0,
  daysWithData: 0,
};

describe('derived metrics never treat missing data as zero', () => {
  it('returns null for every ratio when there is no platform data', () => {
    const m = deriveCampaignMetrics(empty);
    expect(m.ctr).toBeNull();
    expect(m.cpcMinor).toBeNull();
    expect(m.cplMinor).toBeNull();
    expect(m.cpqlMinor).toBeNull();
    expect(m.lpConversion).toBeNull();
  });
  it('returns null CPL when there are zero leads (not infinity, not zero)', () => {
    expect(deriveCampaignMetrics({ ...empty, spendMinor: 100_000, crmLeads: 0 }).cplMinor).toBeNull();
  });
  it('computes CTR, CPC and CPL', () => {
    const m = deriveCampaignMetrics({
      ...empty,
      spendMinor: 100_000,
      impressions: 10_000,
      clicks: 200,
      crmLeads: 10,
      qualifiedLeads: 4,
    });
    expect(m.ctr).toBeCloseTo(0.02);
    expect(m.cpcMinor).toBe(500);
    expect(m.cplMinor).toBe(10_000);
    expect(m.cpqlMinor).toBe(25_000);
  });
  it('ratio/pctChange handle nulls and zero denominators', () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(null, 5)).toBeNull();
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(15, 10)).toBeCloseTo(0.5);
  });
  it('sumTotals keeps unknowns as null instead of 0', () => {
    const s = sumTotals([empty, { ...empty, spendMinor: 500 }]);
    expect(s.spendMinor).toBe(500);
    expect(s.impressions).toBeNull();
  });
});

describe('freshness', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  it('flags never-synced campaigns', () =>
    expect(freshness({ lastSyncedAt: null, status: 'active' }, 36, now).state).toBe('never'));
  it('flags stale active campaigns', () =>
    expect(
      freshness({ lastSyncedAt: new Date('2026-10-17T00:00:00Z'), status: 'active' }, 36, now).state,
    ).toBe('stale'));
  it('does not flag ended campaigns as stale', () =>
    expect(
      freshness({ lastSyncedAt: new Date('2026-10-01T00:00:00Z'), status: 'ended' }, 36, now).state,
    ).toBe('fresh'));
  it('treats recent sync as fresh', () =>
    expect(
      freshness({ lastSyncedAt: new Date('2026-10-19T10:00:00Z'), status: 'active' }, 36, now).state,
    ).toBe('fresh'));
});
