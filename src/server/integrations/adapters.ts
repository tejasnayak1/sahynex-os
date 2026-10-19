/**
 * Advertising / analytics adapters using official, documented APIs:
 *  - Meta Marketing API — Insights edge:  GET /{version}/act_{ad_account_id}/insights
 *  - Google Ads API — GoogleAdsService.Search: POST /{version}/customers/{customer_id}/googleAds:search
 *  - Google Analytics Data API — runReport:    POST /v1beta/properties/{property_id}:runReport
 *
 * API versions are configuration (META_GRAPH_VERSION, GOOGLE_ADS_API_VERSION) because both platforms
 * retire versions on a schedule; set them to a currently supported version from the platform changelog.
 *
 * Status: these adapters are implemented against the public documentation but have NOT been exercised
 * against live accounts from this build environment (no credentials, outbound access restricted).
 * Connect them in Settings → Integrations and run "Test connection" before relying on them.
 */
import { createHash } from 'node:crypto';
import { eachDayOfInterval, parseISO } from 'date-fns';
import { PermanentError } from '../automation/types';
import { apiFetch } from './http';
import type { AdsAdapter, Connection, NormalizedDailyMetric } from './types';

const env = (k: string) => process.env[k]?.trim() || '';
const missingEnv = (keys: string[]) => keys.filter((k) => !env(k));

/* ----------------------------------------------------------------- Meta */

type MetaInsightRow = {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

const actionValue = (row: MetaInsightRow, types: string[]) => {
  const hit = row.actions?.find((a) => types.includes(a.action_type));
  return hit ? Number(hit.value) : null;
};

export const metaAdsAdapter: AdsAdapter = {
  provider: 'meta_ads',
  label: 'Meta Ads (Facebook & Instagram)',
  requiredEnv: ['META_ACCESS_TOKEN', 'META_GRAPH_VERSION'],
  requiredConfig: [
    {
      key: 'adAccountId',
      label: 'Ad account ID',
      help: 'Numeric ID without the act_ prefix, from Meta Ads Manager.',
    },
  ],
  setupSteps: [
    'Create a Meta app (Business type) and add the Marketing API product.',
    'Generate a System User access token with ads_read for the client ad accounts in Business Manager.',
    'Set META_ACCESS_TOKEN and META_GRAPH_VERSION (e.g. the current version from the Graph API changelog) in the server environment / secret manager.',
    'Enter the ad account ID here, choose "Live", and press Test connection.',
  ],
  checkConfig(conn) {
    const missing = missingEnv(this.requiredEnv);
    if (!conn.config.adAccountId) missing.push('adAccountId');
    return { ok: missing.length === 0, missing };
  },
  async healthCheck(conn) {
    const id = conn.config.adAccountId?.replace(/^act_/, '');
    const body = (await apiFetch(
      `https://graph.facebook.com/${env('META_GRAPH_VERSION')}/act_${id}?fields=name,account_status,currency`,
      {
        headers: { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` },
      },
    )) as { name?: string; currency?: string };
    return {
      ok: true,
      message: `Connected to ad account "${body.name ?? id}" (${body.currency ?? 'unknown currency'}).`,
    };
  },
  async fetchDailyMetrics(conn, from, to) {
    const id = conn.config.adAccountId?.replace(/^act_/, '');
    const params = new URLSearchParams({
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,actions',
      limit: '500',
    });
    let url: string | null =
      `https://graph.facebook.com/${env('META_GRAPH_VERSION')}/act_${id}/insights?${params}`;
    const out: NormalizedDailyMetric[] = [];
    for (let page = 0; url && page < 50; page++) {
      const body = (await apiFetch(url, {
        headers: { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` },
      })) as { data: MetaInsightRow[]; paging?: { next?: string } };
      for (const r of body.data ?? []) {
        out.push({
          externalCampaignId: r.campaign_id,
          campaignName: r.campaign_name,
          date: r.date_start,
          spendMinor: Math.round(Number(r.spend ?? 0) * 100),
          impressions: Number(r.impressions ?? 0),
          reach: r.reach != null ? Number(r.reach) : null,
          clicks: Number(r.clicks ?? 0),
          platformLeads: actionValue(r, [
            'lead',
            'onsite_conversion.lead_grouped',
            'offsite_conversion.fb_pixel_lead',
          ]),
          landingPageViews: actionValue(r, ['landing_page_view']),
        });
      }
      url = body.paging?.next ?? null;
    }
    return out;
  },
};

/* ----------------------------------------------------------- Google Ads */

async function googleAccessToken(refreshEnv: string): Promise<string> {
  const body = (await apiFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: env(refreshEnv),
      grant_type: 'refresh_token',
    }),
  })) as { access_token?: string };
  if (!body.access_token) throw new PermanentError('Google OAuth did not return an access token.');
  return body.access_token;
}

type GadsRow = {
  campaign?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number };
};

export const googleAdsAdapter: AdsAdapter = {
  provider: 'google_ads',
  label: 'Google Ads',
  requiredEnv: [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_API_VERSION',
  ],
  requiredConfig: [
    { key: 'customerId', label: 'Customer ID', help: '10-digit account ID without dashes.' },
    {
      key: 'loginCustomerId',
      label: 'Manager (MCC) ID',
      help: 'Optional. Required when accessing the account through a manager account.',
    },
  ],
  setupSteps: [
    'Apply for a Google Ads API developer token in your manager account (API Center).',
    'Create an OAuth client (Desktop or Web) in Google Cloud and generate a refresh token with the https://www.googleapis.com/auth/adwords scope.',
    'Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_API_VERSION.',
    'Enter the customer ID (and manager ID if applicable), choose "Live", and press Test connection.',
  ],
  checkConfig(conn) {
    const missing = missingEnv(this.requiredEnv);
    if (!conn.config.customerId) missing.push('customerId');
    return { ok: missing.length === 0, missing };
  },
  async healthCheck(conn) {
    const rows = await gadsSearch(
      conn,
      'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
    );
    const c = (rows[0] as { customer?: { descriptiveName?: string; currencyCode?: string } } | undefined)
      ?.customer;
    return {
      ok: true,
      message: `Connected to "${c?.descriptiveName ?? conn.config.customerId}" (${c?.currencyCode ?? 'unknown currency'}).`,
    };
  },
  async fetchDailyMetrics(conn, from, to) {
    const q = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
      FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
    const rows = (await gadsSearch(conn, q)) as GadsRow[];
    return rows.map((r) => ({
      externalCampaignId: String(r.campaign?.id ?? ''),
      campaignName: r.campaign?.name ?? '',
      date: r.segments?.date ?? from,
      // cost_micros is 1/1,000,000 of the account currency; minor units are 1/100.
      spendMinor: Math.round(Number(r.metrics?.costMicros ?? 0) / 10_000),
      impressions: Number(r.metrics?.impressions ?? 0),
      reach: null,
      clicks: Number(r.metrics?.clicks ?? 0),
      platformLeads: r.metrics?.conversions != null ? Math.round(Number(r.metrics.conversions)) : null,
      landingPageViews: null,
    }));
  },
};

async function gadsSearch(conn: Connection, query: string): Promise<unknown[]> {
  if (!/^\d{10}$/.test(conn.config.customerId ?? ''))
    throw new PermanentError('Google Ads customer ID must be 10 digits without dashes.');
  const token = await googleAccessToken('GOOGLE_ADS_REFRESH_TOKEN');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'Content-Type': 'application/json',
  };
  if (conn.config.loginCustomerId)
    headers['login-customer-id'] = conn.config.loginCustomerId.replace(/-/g, '');
  const out: unknown[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 50; i++) {
    const body = (await apiFetch(
      `https://googleads.googleapis.com/${env('GOOGLE_ADS_API_VERSION')}/customers/${conn.config.customerId}/googleAds:search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      },
    )) as { results?: unknown[]; nextPageToken?: string };
    out.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/* ------------------------------------------------------------------ GA4 */

export const ga4Adapter = {
  provider: 'ga4' as const,
  label: 'Google Analytics 4',
  requiredEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GA4_REFRESH_TOKEN'],
  requiredConfig: [
    { key: 'propertyId', label: 'Property ID', help: 'Numeric GA4 property ID (Admin → Property details).' },
  ],
  setupSteps: [
    'Enable the Google Analytics Data API in your Google Cloud project.',
    'Generate a refresh token for a user with Viewer access to the property, using the https://www.googleapis.com/auth/analytics.readonly scope.',
    'Set GA4_REFRESH_TOKEN (and the shared GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).',
    'Enter the property ID, choose "Live", and press Test connection.',
  ],
  checkConfig(conn: Connection) {
    const missing = missingEnv(this.requiredEnv);
    if (!conn.config.propertyId) missing.push('propertyId');
    return { ok: missing.length === 0, missing };
  },
  async runReport(conn: Connection, body: Record<string, unknown>) {
    if (!/^\d+$/.test(conn.config.propertyId ?? ''))
      throw new PermanentError('GA4 property ID must be numeric.');
    const token = await googleAccessToken('GA4_REFRESH_TOKEN');
    return (await apiFetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${conn.config.propertyId}:runReport`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )) as { rows?: Array<{ dimensionValues: { value: string }[]; metricValues: { value: string }[] }> };
  },
  async healthCheck(conn: Connection) {
    await this.runReport(conn, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
    });
    return { ok: true, message: `Connected to GA4 property ${conn.config.propertyId}.` };
  },
  /** Count of a key event (e.g. generate_lead) today and yesterday — used for conversion monitoring. */
  async eventCounts(conn: Connection, eventName: string) {
    const r = await this.runReport(conn, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: eventName } } },
    });
    return (r.rows ?? []).map((row) => ({
      date: row.dimensionValues[0].value,
      count: Number(row.metricValues[0].value),
    }));
  },
};

/* ------------------------------------------------------------ demo mode */

/** Deterministic pseudo-random generator so demo data is stable across refreshes. */
function seeded(seed: string) {
  let h = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

/**
 * DEMO adapter — generates clearly-labelled synthetic metrics (source = 'demo') for campaigns that
 * belong to the demo dataset. Used only when a connection is explicitly set to "Demo" mode.
 */
export function demoMetrics(
  campaigns: Array<{ externalId: string | null; name: string; budgetMinor: number | null }>,
  from: string,
  to: string,
): NormalizedDailyMetric[] {
  const out: NormalizedDailyMetric[] = [];
  for (const c of campaigns) {
    if (!c.externalId) continue;
    for (const day of eachDayOfInterval({ start: parseISO(from), end: parseISO(to) })) {
      const date = day.toISOString().slice(0, 10);
      const rnd = seeded(`${c.externalId}:${date}`);
      // Demo assumes a 90-day flight; CPM ≈ ₹170–330, CTR 1–2.5%, click→lead 1–2.2%.
      const dailyBudget = (c.budgetMinor ?? 27_000_000) / 90;
      const spend = Math.round(dailyBudget * (0.7 + rnd() * 0.5));
      const impressions = Math.round((spend / 100) * (3 + rnd() * 3));
      const clicks = Math.round(impressions * (0.01 + rnd() * 0.015));
      const leads = Math.round(clicks * (0.01 + rnd() * 0.012));
      out.push({
        externalCampaignId: c.externalId,
        campaignName: c.name,
        date,
        spendMinor: spend,
        impressions,
        reach: Math.round(impressions * (0.55 + rnd() * 0.2)),
        clicks,
        platformLeads: leads,
        landingPageViews: Math.round(clicks * (0.7 + rnd() * 0.2)),
      });
    }
  }
  return out;
}

export const ADS_ADAPTERS: Record<'meta_ads' | 'google_ads', AdsAdapter> = {
  meta_ads: metaAdsAdapter,
  google_ads: googleAdsAdapter,
};

export const PLATFORM_PROVIDER: Record<string, 'meta_ads' | 'google_ads' | undefined> = {
  meta: 'meta_ads',
  google_ads: 'google_ads',
};
