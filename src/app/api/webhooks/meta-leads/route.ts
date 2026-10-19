import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { systemActor } from '@/server/actor';
import { apiFetch } from '@/server/integrations/http';
import { ingestLead } from '@/server/services/leads';

/**
 * Meta Lead Ads webhook (Page object, `leadgen` field).
 * GET  — subscription verification (hub.mode / hub.verify_token / hub.challenge).
 * POST — verifies X-Hub-Signature-256 with META_APP_SECRET, fetches each lead from the Graph API
 *        with META_PAGE_ACCESS_TOKEN, and ingests it idempotently (external ID = meta:<leadgen_id>).
 * Returns 5xx on transient failures so Meta retries delivery.
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && u.get('hub.mode') === 'subscribe' && u.get('hub.verify_token') === token)
    return new NextResponse(u.get('hub.challenge') ?? '', { status: 200 });
  return new NextResponse('Forbidden', { status: 403 });
}

type LeadgenChange = {
  field: string;
  value: { leadgen_id: string; page_id: string; form_id?: string; ad_id?: string; campaign_id?: string };
};

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_VERSION;
  if (!secret || !pageToken || !version)
    return NextResponse.json({ error: 'Meta Lead Ads is not configured on this server.' }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return new NextResponse('Invalid signature', { status: 401 });
  const body = JSON.parse(raw) as { object?: string; entry?: Array<{ changes?: LeadgenChange[] }> };
  const orgSlug = process.env.ORG_SLUG ?? 'sahynex';
  const [org] = await db.select().from(schema.organisations).where(eq(schema.organisations.slug, orgSlug));
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 500 });
  const [conn] = await db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.orgId, org.id),
        eq(schema.integrationConnections.provider, 'meta_lead_ads'),
      ),
    );
  if (!conn || conn.mode !== 'live')
    return NextResponse.json({ ignored: 'Meta Lead Ads connection is not set to Live.' }, { status: 200 });
  const pageClient = new Map(
    (conn.config.pageClientMap ?? '')
      .split(',')
      .map((p) => p.trim().split(':'))
      .filter((p) => p.length === 2) as [string, string][],
  );
  const actor = systemActor(org.id, 'Meta Lead Ads webhook');
  let processed = 0;
  try {
    for (const entry of body.entry ?? [])
      for (const ch of entry.changes ?? []) {
        if (ch.field !== 'leadgen') continue;
        const lead = (await apiFetch(
          `https://graph.facebook.com/${version}/${ch.value.leadgen_id}?fields=field_data,created_time,campaign_id,ad_id,form_id`,
          { headers: { Authorization: `Bearer ${pageToken}` } },
        )) as { field_data?: Array<{ name: string; values: string[] }>; campaign_id?: string };
        const f = (n: string[]) => lead.field_data?.find((x) => n.includes(x.name))?.values?.[0];
        const clientId = pageClient.get(ch.value.page_id);
        let campaignId: string | undefined;
        const extCampaign = lead.campaign_id ?? ch.value.campaign_id;
        if (extCampaign) {
          const [c] = await db
            .select({ id: schema.campaigns.id })
            .from(schema.campaigns)
            .where(
              and(
                eq(schema.campaigns.orgId, org.id),
                eq(schema.campaigns.platform, 'meta'),
                eq(schema.campaigns.externalId, extCampaign),
              ),
            );
          campaignId = c?.id;
        }
        await ingestLead(
          actor,
          {
            name:
              f(['full_name', 'name']) ??
              ([f(['first_name']), f(['last_name'])].filter(Boolean).join(' ') || 'Meta lead'),
            email: f(['email']),
            phone: f(['phone_number', 'phone']),
            city: f(['city']),
            interest: f(['course', 'programme', 'program', 'interest']),
            clientId,
            campaignId,
            externalId: `meta:${ch.value.leadgen_id}`,
            leadType: clientId ? 'admission_enquiry' : 'client_prospect',
            sourceKey: 'meta_lead_ads',
            utmSource: 'facebook',
            utmMedium: 'paid_social',
          },
          'meta_lead_ads',
        );
        processed++;
      }
    await db
      .update(schema.integrationConnections)
      .set({ status: 'healthy', lastSuccessSyncAt: new Date(), lastError: null })
      .where(eq(schema.integrationConnections.id, conn.id));
    return NextResponse.json({ processed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.integrationConnections)
      .set({ status: 'error', lastError: msg.slice(0, 1000) })
      .where(eq(schema.integrationConnections.id, conn.id));
    console.error('[meta-leads webhook]', msg);
    return NextResponse.json({ error: 'Processing failed; Meta will retry.' }, { status: 500 });
  }
}
