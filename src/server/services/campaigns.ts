import Papa from 'papaparse';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { deriveCampaignMetrics, type CampaignTotals } from '@/lib/metrics';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { campaignScope, clientScope } from '../access';
import { audit, diff } from '../audit';
import { forbidden, invalid, notFound } from '../errors';
import { ADS_ADAPTERS, demoMetrics } from '../integrations/adapters';
import type { NormalizedDailyMetric } from '../integrations/types';
import { optDate, optInt, optMoney, optStr, optUuid, parse, reqStr, type PageParams } from '../validation';
import { getOrg } from './org';

const { campaigns, campaignMetrics, leads, clients, users, conversionEvents, integrationConnections } =
  schema;
export type Campaign = typeof campaigns.$inferSelect;

const campaignSchema = z.object({
  clientId: z.string().uuid('Choose a client'),
  projectId: optUuid,
  name: reqStr(200),
  platform: z.enum(['meta', 'google_ads', 'ga4', 'other']),
  externalId: optStr(100),
  accountExternalId: optStr(100),
  objective: optStr(200),
  status: z.enum(['active', 'paused', 'ended']).default('active'),
  startDate: optDate,
  endDate: optDate,
  budget: optMoney,
  cplThreshold: optMoney,
  dailySpendThreshold: optMoney,
  minLeadsForAlert: optInt(1, 10000),
  attributionWindow: optStr(100),
  ownerId: optUuid,
});

export async function createCampaign(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'campaigns.write');
  const input = parse(campaignSchema, raw);
  if (
    (input.cplThreshold !== undefined || input.dailySpendThreshold !== undefined) &&
    !can(actor, 'campaigns.thresholds')
  )
    throw forbidden('You cannot set alert thresholds.');
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), clientScope(actor)));
    if (!c) throw invalid('Unknown client.', { clientId: 'Unknown client' });
    const [row] = await tx
      .insert(campaigns)
      .values({
        orgId: actor.orgId,
        clientId: input.clientId,
        projectId: input.projectId ?? null,
        name: input.name,
        platform: input.platform,
        externalId: input.externalId ?? null,
        accountExternalId: input.accountExternalId ?? null,
        objective: input.objective ?? null,
        status: input.status,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        budgetMinor: input.budget ?? null,
        cplThresholdMinor: input.cplThreshold ?? null,
        dailySpendThresholdMinor: input.dailySpendThreshold ?? null,
        minLeadsForAlert: input.minLeadsForAlert ?? 10,
        attributionWindow: input.attributionWindow ?? null,
        ownerId: input.ownerId ?? actorUserId(actor),
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw invalid('A campaign with this platform ID already exists.', { externalId: 'Already exists' });
    await audit(tx, actor, 'campaign.created', 'campaign', row.id, {
      after: { name: row.name, platform: row.platform },
    });
    return row;
  });
}

export async function updateCampaign(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'campaigns.write');
  const input = parse(campaignSchema.partial().omit({ clientId: true }), raw);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), campaignScope(actor)))
      .for('update');
    if (!c) throw notFound('Campaign');
    const map: Record<string, keyof Campaign> = {
      budget: 'budgetMinor',
      cplThreshold: 'cplThresholdMinor',
      dailySpendThreshold: 'dailySpendThresholdMinor',
    };
    const patch: Partial<Campaign> = {};
    for (const k of Object.keys(input))
      if (k in raw)
        (patch as Record<string, unknown>)[map[k] ?? k] = (input as Record<string, unknown>)[k] ?? null;
    if (
      ('cplThresholdMinor' in patch || 'dailySpendThresholdMinor' in patch || 'minLeadsForAlert' in patch) &&
      !can(actor, 'campaigns.thresholds')
    )
      throw forbidden('You cannot change alert thresholds.');
    if ('minLeadsForAlert' in patch && patch.minLeadsForAlert == null) patch.minLeadsForAlert = 10;
    const d = diff(c as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!d.changed) return c;
    const [u] = await tx.update(campaigns).set(patch).where(eq(campaigns.id, id)).returning();
    await audit(tx, actor, 'campaign.updated', 'campaign', id, { before: d.before, after: d.after });
    return u;
  });
}

/* --------------------------------------------------------- totals */

/** Aggregates platform metrics and CRM outcomes for a set of campaigns over [from, to] (dates inclusive). */
export async function campaignTotals(
  tx: DBOrTx,
  campaignIds: string[],
  from: string,
  to: string,
  tz = 'UTC',
): Promise<Map<string, CampaignTotals>> {
  const out = new Map<string, CampaignTotals>();
  if (!campaignIds.length) return out;
  const plat = await tx
    .select({
      campaignId: campaignMetrics.campaignId,
      spend: sql<number | null>`sum(${campaignMetrics.spendMinor})::bigint`,
      impressions: sql<number | null>`sum(${campaignMetrics.impressions})::bigint`,
      reach: sql<number | null>`sum(${campaignMetrics.reach})::bigint`,
      clicks: sql<number | null>`sum(${campaignMetrics.clicks})::bigint`,
      platformLeads: sql<number | null>`sum(${campaignMetrics.platformLeads})::bigint`,
      lpv: sql<number | null>`sum(${campaignMetrics.landingPageViews})::bigint`,
      days: sql<number>`count(*)::int`,
    })
    .from(campaignMetrics)
    .where(
      and(
        inArray(campaignMetrics.campaignId, campaignIds),
        gte(campaignMetrics.date, from),
        lte(campaignMetrics.date, to),
      ),
    )
    .groupBy(campaignMetrics.campaignId);
  const crm = await tx
    .select({
      campaignId: leads.campaignId,
      total: sql<number>`count(*)::int`,
      qualified: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
    })
    .from(leads)
    .where(
      and(
        inArray(leads.campaignId, campaignIds),
        eq(leads.isTest, false),
        isNull(leads.deletedAt),
        sql`(${leads.createdAt} at time zone ${tz})::date between ${from}::date and ${to}::date`,
      ),
    )
    .groupBy(leads.campaignId);
  const n = (v: number | string | null) => (v == null ? null : Number(v));
  for (const id of campaignIds)
    out.set(id, {
      spendMinor: null,
      impressions: null,
      reach: null,
      clicks: null,
      platformLeads: null,
      landingPageViews: null,
      crmLeads: 0,
      qualifiedLeads: 0,
      daysWithData: 0,
    });
  for (const p of plat)
    Object.assign(out.get(p.campaignId)!, {
      spendMinor: n(p.spend),
      impressions: n(p.impressions),
      reach: n(p.reach),
      clicks: n(p.clicks),
      platformLeads: n(p.platformLeads),
      landingPageViews: n(p.lpv),
      daysWithData: p.days,
    });
  for (const c of crm)
    if (c.campaignId)
      Object.assign(out.get(c.campaignId)!, { crmLeads: c.total, qualifiedLeads: c.qualified });
  return out;
}

export function sumTotals(list: CampaignTotals[]): CampaignTotals {
  const add = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : a + b);
  return list.reduce<CampaignTotals>(
    (acc, t) => ({
      spendMinor: add(acc.spendMinor, t.spendMinor),
      impressions: add(acc.impressions, t.impressions),
      reach: add(acc.reach, t.reach),
      clicks: add(acc.clicks, t.clicks),
      platformLeads: add(acc.platformLeads, t.platformLeads),
      landingPageViews: add(acc.landingPageViews, t.landingPageViews),
      crmLeads: acc.crmLeads + t.crmLeads,
      qualifiedLeads: acc.qualifiedLeads + t.qualifiedLeads,
      daysWithData: Math.max(acc.daysWithData, t.daysWithData),
    }),
    {
      spendMinor: null,
      impressions: null,
      reach: null,
      clicks: null,
      platformLeads: null,
      landingPageViews: null,
      crmLeads: 0,
      qualifiedLeads: 0,
      daysWithData: 0,
    },
  );
}

export function freshness(
  c: Pick<Campaign, 'lastSyncedAt' | 'status'>,
  staleAfterHours: number,
  now = new Date(),
) {
  if (!c.lastSyncedAt) return { state: 'never' as const, label: 'Never synced' };
  const ageH = (now.getTime() - c.lastSyncedAt.getTime()) / 3_600_000;
  if (ageH > staleAfterHours && c.status === 'active')
    return { state: 'stale' as const, label: `Stale — last synced ${Math.round(ageH)}h ago` };
  return {
    state: 'fresh' as const,
    label: `Synced ${ageH < 1 ? `${Math.round(ageH * 60)}m` : `${Math.round(ageH)}h`} ago`,
  };
}

/* ---------------------------------------------------------- queries */

export async function listCampaigns(
  actor: Actor,
  f: PageParams & { clientId?: string; platform?: string; status?: string },
  from: string,
  to: string,
) {
  const conds: (SQL | undefined)[] = [campaignScope(actor)];
  if (f.q)
    conds.push(
      or(
        ilike(campaigns.name, `%${f.q.replace(/[%_]/g, '')}%`),
        ilike(campaigns.externalId, `%${f.q.replace(/[%_]/g, '')}%`),
      ),
    );
  if (f.clientId) conds.push(eq(campaigns.clientId, f.clientId));
  if (f.platform) conds.push(eq(campaigns.platform, f.platform as Campaign['platform']));
  if (f.status) conds.push(eq(campaigns.status, f.status));
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ c: campaigns, clientName: clients.name, ownerName: users.name })
      .from(campaigns)
      .innerJoin(clients, eq(clients.id, campaigns.clientId))
      .leftJoin(users, eq(users.id, campaigns.ownerId))
      .where(where)
      .orderBy(asc(clients.name), asc(campaigns.name))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(where),
  ]);
  const org = await getOrg(db, actor.orgId);
  const totals = await campaignTotals(
    db,
    rows.map((r) => r.c.id),
    from,
    to,
    org.timezone,
  );
  return {
    rows: rows.map((r) => ({
      ...r.c,
      clientName: r.clientName,
      ownerName: r.ownerName,
      metrics: deriveCampaignMetrics(totals.get(r.c.id)!),
      freshness: freshness(r.c, org.parsedSettings.campaigns.staleAfterHours),
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getCampaign(actor: Actor, id: string, from: string, to: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Campaign');
  const [r] = await db
    .select({ c: campaigns, clientName: clients.name, ownerName: users.name })
    .from(campaigns)
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .leftJoin(users, eq(users.id, campaigns.ownerId))
    .where(and(eq(campaigns.id, id), campaignScope(actor)));
  if (!r) throw notFound('Campaign');
  const org = await getOrg(db, actor.orgId);
  const tz = org.timezone;
  const [daily, crmDaily, totals, conversions] = await Promise.all([
    db
      .select()
      .from(campaignMetrics)
      .where(
        and(
          eq(campaignMetrics.campaignId, id),
          gte(campaignMetrics.date, from),
          lte(campaignMetrics.date, to),
        ),
      )
      .orderBy(asc(campaignMetrics.date)),
    db
      .select({
        date: sql<string>`(${leads.createdAt} at time zone ${tz})::date::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, id),
          eq(leads.isTest, false),
          isNull(leads.deletedAt),
          sql`(${leads.createdAt} at time zone ${tz})::date between ${from}::date and ${to}::date`,
        ),
      )
      .groupBy(sql`1`),
    campaignTotals(db, [id], from, to, tz),
    db
      .select({
        type: conversionEvents.type,
        verified: sql<number>`count(*) filter (where ${conversionEvents.verified})::int`,
        unverified: sql<number>`count(*) filter (where not ${conversionEvents.verified})::int`,
      })
      .from(conversionEvents)
      .where(
        and(
          eq(conversionEvents.campaignId, id),
          sql`(${conversionEvents.occurredAt} at time zone ${tz})::date between ${from}::date and ${to}::date`,
        ),
      )
      .groupBy(conversionEvents.type),
  ]);
  const crmByDate = new Map(crmDaily.map((d) => [d.date, d.n]));
  const reconciliation = daily.map((d) => ({
    date: d.date,
    platformLeads: d.platformLeads,
    crmLeads: crmByDate.get(d.date) ?? 0,
    gap: d.platformLeads == null ? null : d.platformLeads - (crmByDate.get(d.date) ?? 0),
  }));
  return {
    campaign: r.c,
    clientName: r.clientName,
    ownerName: r.ownerName,
    daily,
    reconciliation,
    metrics: deriveCampaignMetrics(totals.get(id)!),
    conversions,
    freshness: freshness(r.c, org.parsedSettings.campaigns.staleAfterHours),
    dataSources: [...new Set(daily.map((d) => d.source))],
  };
}

/* ------------------------------------------------------ metrics write */

export async function upsertMetrics(
  tx: DBOrTx,
  orgId: string,
  campaignId: string,
  rows: Omit<NormalizedDailyMetric, 'externalCampaignId' | 'campaignName'>[],
  source: 'api' | 'csv' | 'manual' | 'demo',
) {
  for (const m of rows) {
    await tx
      .insert(campaignMetrics)
      .values({
        orgId,
        campaignId,
        date: m.date,
        spendMinor: m.spendMinor,
        impressions: m.impressions,
        reach: m.reach,
        clicks: m.clicks,
        platformLeads: m.platformLeads,
        landingPageViews: m.landingPageViews,
        source,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [campaignMetrics.campaignId, campaignMetrics.date],
        set: {
          spendMinor: m.spendMinor,
          impressions: m.impressions,
          reach: m.reach,
          clicks: m.clicks,
          platformLeads: m.platformLeads,
          landingPageViews: m.landingPageViews,
          source,
          syncedAt: new Date(),
        },
      });
  }
}

const csvRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  spend: z.coerce.number().min(0),
  impressions: z.coerce.number().int().min(0),
  clicks: z.coerce.number().int().min(0),
  reach: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).nullable()),
  leads: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(0).nullable()),
  landing_page_views: z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.number().int().min(0).nullable(),
  ),
});

/** CSV import of platform exports (for platforms without a live connection). Validates every row first. */
export async function importMetricsCsv(actor: Actor, campaignId: string, csv: string) {
  assertCan(actor, 'campaigns.write');
  const [c] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), campaignScope(actor)));
  if (!c) throw notFound('Campaign');
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });
  if (parsed.data.length === 0) throw invalid('The file has no rows.');
  if (parsed.data.length > 1000) throw invalid('Import at most 1,000 rows at a time.');
  const errors: string[] = [];
  const rows: Omit<NormalizedDailyMetric, 'externalCampaignId' | 'campaignName'>[] = [];
  parsed.data.forEach((r, i) => {
    const p = csvRow.safeParse(r);
    if (!p.success)
      errors.push(
        `Row ${i + 2}: ${p.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join(', ')}`,
      );
    else
      rows.push({
        date: p.data.date,
        spendMinor: Math.round(p.data.spend * 100),
        impressions: p.data.impressions,
        clicks: p.data.clicks,
        reach: p.data.reach,
        platformLeads: p.data.leads,
        landingPageViews: p.data.landing_page_views,
      });
  });
  if (errors.length)
    throw invalid(
      `Nothing imported — fix these rows first:\n${errors.slice(0, 20).join('\n')}${errors.length > 20 ? `\n…and ${errors.length - 20} more` : ''}`,
    );
  await db.transaction(async (tx) => {
    await upsertMetrics(tx, actor.orgId, campaignId, rows, 'csv');
    await tx
      .update(campaigns)
      .set({ lastSyncedAt: new Date(), lastSyncError: null })
      .where(eq(campaigns.id, campaignId));
    await audit(tx, actor, 'campaign.metrics_imported', 'campaign', campaignId, {
      after: { rows: rows.length, from: rows[0]?.date, to: rows.at(-1)?.date },
    });
  });
  return { imported: rows.length };
}

/**
 * Pulls metrics from a provider for every mapped campaign. Never fabricates data: disconnected
 * providers are skipped with a reason; demo mode only touches demo campaigns and is labelled 'demo'.
 */
export async function syncProviderMetrics(
  orgId: string,
  provider: 'meta_ads' | 'google_ads',
  from: string,
  to: string,
  log: (m: string, d?: unknown) => void,
) {
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.orgId, orgId), eq(integrationConnections.provider, provider)));
  if (!conn || conn.mode === 'disconnected')
    return { status: 'skipped' as const, reason: `${provider} is not connected` };
  const platform = provider === 'meta_ads' ? 'meta' : 'google_ads';
  const mapped = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.orgId, orgId),
        eq(campaigns.platform, platform),
        sql`${campaigns.externalId} is not null`,
      ),
    );
  let fetched: NormalizedDailyMetric[];
  if (conn.mode === 'demo') {
    fetched = demoMetrics(
      mapped.filter((c) => c.isDemo),
      from,
      to,
    );
    log(
      `DEMO mode: generated synthetic metrics for ${mapped.filter((c) => c.isDemo).length} demo campaigns.`,
    );
  } else {
    const adapter = ADS_ADAPTERS[provider];
    const cfg = adapter.checkConfig(conn);
    if (!cfg.ok) {
      await db
        .update(integrationConnections)
        .set({ status: 'error', lastError: `Missing configuration: ${cfg.missing.join(', ')}` })
        .where(eq(integrationConnections.id, conn.id));
      return { status: 'skipped' as const, reason: `Missing configuration: ${cfg.missing.join(', ')}` };
    }
    try {
      fetched = await adapter.fetchDailyMetrics(conn, from, to);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(integrationConnections)
        .set({ status: 'error', lastError: msg.slice(0, 1000), lastHealthCheckAt: new Date() })
        .where(eq(integrationConnections.id, conn.id));
      await db
        .update(campaigns)
        .set({ lastSyncError: msg.slice(0, 500) })
        .where(
          inArray(
            campaigns.id,
            mapped.map((m) => m.id).length
              ? mapped.map((m) => m.id)
              : ['00000000-0000-0000-0000-000000000000'],
          ),
        );
      throw e;
    }
  }
  const byExt = new Map(mapped.map((c) => [c.externalId!, c]));
  const unmatched = new Set<string>();
  const grouped = new Map<string, NormalizedDailyMetric[]>();
  for (const m of fetched) {
    const c = byExt.get(m.externalCampaignId);
    if (!c) {
      unmatched.add(`${m.campaignName} (${m.externalCampaignId})`);
      continue;
    }
    if (!grouped.has(c.id)) grouped.set(c.id, []);
    grouped.get(c.id)!.push(m);
  }
  await db.transaction(async (tx) => {
    for (const [campaignId, rows] of grouped)
      await upsertMetrics(tx, orgId, campaignId, rows, conn.mode === 'demo' ? 'demo' : 'api');
    const touched = [...grouped.keys()];
    if (touched.length)
      await tx
        .update(campaigns)
        .set({ lastSyncedAt: new Date(), lastSyncError: null })
        .where(inArray(campaigns.id, touched));
    await tx
      .update(integrationConnections)
      .set({
        status: 'healthy',
        lastError: null,
        lastSuccessSyncAt: new Date(),
        lastHealthCheckAt: new Date(),
      })
      .where(eq(integrationConnections.id, conn.id));
  });
  if (unmatched.size)
    log(
      `Platform campaigns not mapped to a client campaign (add the platform ID to a campaign to include them): ${[...unmatched].slice(0, 10).join('; ')}`,
    );
  return {
    status: 'synced' as const,
    rows: fetched.length - [...unmatched].length,
    campaigns: grouped.size,
    unmatched: unmatched.size,
    mode: conn.mode,
  };
}

/* -------------------------------------------------------- conversions */

const conversionSchema = z.object({
  clientId: z.string().uuid(),
  campaignId: optUuid,
  leadId: optUuid,
  type: z.enum(['form_submit', 'application', 'admission', 'sale']),
  occurredAt: z.coerce.date(),
  value: optMoney,
  source: reqStr(100),
  notes: optStr(2000),
});

export async function recordConversion(actor: Actor, raw: Record<string, unknown>, verified = false) {
  assertCan(actor, 'campaigns.write');
  const input = parse(conversionSchema, raw);
  const [c] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), clientScope(actor)));
  if (!c) throw invalid('Unknown client.');
  const [row] = await db
    .insert(conversionEvents)
    .values({
      orgId: actor.orgId,
      clientId: input.clientId,
      campaignId: input.campaignId ?? null,
      leadId: input.leadId ?? null,
      type: input.type,
      occurredAt: input.occurredAt,
      valueMinor: input.value ?? null,
      source: input.source,
      notes: input.notes ?? null,
      verified,
      verifiedById: verified ? actorUserId(actor) : null,
    })
    .returning();
  await audit(db, actor, 'conversion.recorded', 'conversion', row.id, {
    after: { type: row.type, verified },
  });
  return row;
}

export async function verifyConversion(actor: Actor, id: string) {
  assertCan(actor, 'campaigns.write');
  const [row] = await db
    .update(conversionEvents)
    .set({ verified: true, verifiedById: actorUserId(actor) })
    .where(and(eq(conversionEvents.id, id), eq(conversionEvents.orgId, actor.orgId)))
    .returning();
  if (!row) throw notFound('Conversion');
  await audit(db, actor, 'conversion.verified', 'conversion', id);
}

export async function listConversions(actor: Actor, clientId?: string) {
  return db
    .select({ e: conversionEvents, clientName: clients.name, campaignName: campaigns.name })
    .from(conversionEvents)
    .innerJoin(clients, eq(clients.id, conversionEvents.clientId))
    .leftJoin(campaigns, eq(campaigns.id, conversionEvents.campaignId))
    .where(
      and(
        eq(conversionEvents.orgId, actor.orgId),
        sql`${conversionEvents.clientId} in (select id from clients where ${clientScope(actor)})`,
        clientId ? eq(conversionEvents.clientId, clientId) : undefined,
      ),
    )
    .orderBy(desc(conversionEvents.occurredAt))
    .limit(200);
}

export async function campaignOptions(actor: Actor) {
  return db
    .select({ id: campaigns.id, name: campaigns.name, clientId: campaigns.clientId })
    .from(campaigns)
    .where(campaignScope(actor))
    .orderBy(asc(campaigns.name))
    .limit(500);
}
