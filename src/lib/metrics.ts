/**
 * Metric definitions. Every derived metric returns null (shown as "Unavailable") when an input is
 * missing or the denominator is zero — missing data is never treated as zero.
 */
export const METRIC_DEFINITIONS: Record<
  string,
  { label: string; definition: string; unit: 'money' | 'percent' | 'count' | 'ratio' }
> = {
  spend: {
    label: 'Spend',
    definition: 'Platform-reported amount spent in the period (account currency).',
    unit: 'money',
  },
  impressions: { label: 'Impressions', definition: 'Platform-reported impressions.', unit: 'count' },
  reach: {
    label: 'Reach',
    definition:
      'Platform-reported unique accounts reached (Meta only; not summable across days — shown as sum of daily reach).',
    unit: 'count',
  },
  clicks: {
    label: 'Clicks',
    definition: 'Platform-reported clicks (Meta: all clicks; Google Ads: clicks).',
    unit: 'count',
  },
  ctr: { label: 'CTR', definition: 'Clicks ÷ impressions.', unit: 'percent' },
  cpc: { label: 'CPC', definition: 'Spend ÷ clicks.', unit: 'money' },
  platformLeads: {
    label: 'Platform leads',
    definition: 'Leads/conversions reported by the ad platform under its own attribution window.',
    unit: 'count',
  },
  platformCpl: { label: 'Platform CPL', definition: 'Spend ÷ platform-reported leads.', unit: 'money' },
  crmLeads: {
    label: 'CRM leads',
    definition:
      'Leads stored in Sahynex OS and attributed to the campaign (campaign ID or UTM), excluding test leads.',
    unit: 'count',
  },
  cpl: {
    label: 'CPL (CRM)',
    definition: 'Spend ÷ CRM leads attributed to the campaign in the same period.',
    unit: 'money',
  },
  qualifiedLeads: {
    label: 'Qualified leads',
    definition: 'CRM leads attributed to the campaign whose qualification status is “qualified”.',
    unit: 'count',
  },
  cpql: { label: 'Cost per qualified lead', definition: 'Spend ÷ qualified CRM leads.', unit: 'money' },
  lpConversion: {
    label: 'Landing-page conversion',
    definition: 'CRM leads ÷ landing-page views (Meta landing_page_view action).',
    unit: 'percent',
  },
  applications: {
    label: 'Applications (verified)',
    definition: 'Conversion events of type “application” marked verified by staff.',
    unit: 'count',
  },
  admissions: {
    label: 'Admissions (verified)',
    definition: 'Conversion events of type “admission” marked verified by staff.',
    unit: 'count',
  },
  weightedPipeline: {
    label: 'Weighted pipeline',
    definition: 'Σ (open deal value × stage probability).',
    unit: 'money',
  },
};

export const ratio = (num: number | null | undefined, den: number | null | undefined): number | null =>
  num == null || den == null || den === 0 ? null : num / den;

export type CampaignTotals = {
  spendMinor: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  platformLeads: number | null;
  landingPageViews: number | null;
  crmLeads: number;
  qualifiedLeads: number;
  daysWithData: number;
};

export function deriveCampaignMetrics(t: CampaignTotals) {
  return {
    ...t,
    ctr: ratio(t.clicks, t.impressions),
    cpcMinor: ratio(t.spendMinor, t.clicks),
    platformCplMinor: ratio(t.spendMinor, t.platformLeads),
    cplMinor: ratio(t.spendMinor, t.crmLeads),
    cpqlMinor: ratio(t.spendMinor, t.qualifiedLeads),
    lpConversion: ratio(t.crmLeads, t.landingPageViews),
  };
}

/** Percent change vs previous period; null when previous is missing or zero. */
export const pctChange = (cur: number | null, prev: number | null) =>
  cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev);
