import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { assertCan, type Actor } from '../actor';
import { visibleClientIds } from '../access';
import { audit } from '../audit';
import { invalid, notFound, precondition } from '../errors';
import { optInt, optStr, optUuid, parse, reqStr } from '../validation';
import { notify, usersWithRoles } from './notifications';

const { monitoredPages, pageChecks, incidents, campaigns, campaignMetrics, leads, clients, users } = schema;

/* ------------------------------------------------------------- SSRF guard */

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe80') ||
      v.startsWith('::ffff:127.') ||
      v.startsWith('::ffff:10.') ||
      v.startsWith('::ffff:192.168.')
    );
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Monitors may only reach public internet hosts (prevents server-side request forgery). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('Enter a full URL (https://…).');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw invalid('Only http(s) URLs can be monitored.');
  if (url.username || url.password) throw invalid('URLs with credentials are not allowed.');
  if (process.env.MONITOR_ALLOW_PRIVATE === 'true') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw invalid(`Could not resolve ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address)))
    throw invalid('Internal or private network addresses cannot be monitored.');
  return url;
}

/* ----------------------------------------------------------------- CRUD */

const pageSchema = z.object({
  name: reqStr(200),
  url: reqStr(1000),
  clientId: optUuid,
  campaignId: optUuid,
  expectedStatus: optInt(100, 599),
  expectedText: optStr(300),
  conversionGapHours: optInt(1, 720),
  ownerId: optUuid,
});

export async function createMonitor(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'monitoring.manage');
  const input = parse(pageSchema, raw);
  await assertPublicUrl(input.url);
  const [p] = await db
    .insert(monitoredPages)
    .values({
      orgId: actor.orgId,
      name: input.name,
      url: input.url,
      clientId: input.clientId ?? null,
      campaignId: input.campaignId ?? null,
      expectedStatus: input.expectedStatus ?? 200,
      expectedText: input.expectedText ?? null,
      conversionGapHours: input.conversionGapHours ?? null,
      ownerId: input.ownerId ?? (actor.kind === 'user' ? actor.id : null),
    })
    .returning();
  await audit(db, actor, 'monitor.created', 'monitored_page', p.id, { after: { url: p.url } });
  return p;
}

export async function setMonitorActive(actor: Actor, id: string, isActive: boolean) {
  assertCan(actor, 'monitoring.manage');
  const [p] = await db
    .update(monitoredPages)
    .set({ isActive })
    .where(and(eq(monitoredPages.id, id), eq(monitoredPages.orgId, actor.orgId)))
    .returning();
  if (!p) throw notFound('Monitor');
  await audit(db, actor, isActive ? 'monitor.enabled' : 'monitor.disabled', 'monitored_page', id);
}

export async function listMonitors(actor: Actor) {
  return db
    .select({ p: monitoredPages, clientName: clients.name, ownerName: users.name })
    .from(monitoredPages)
    .leftJoin(clients, eq(clients.id, monitoredPages.clientId))
    .leftJoin(users, eq(users.id, monitoredPages.ownerId))
    .where(
      and(
        eq(monitoredPages.orgId, actor.orgId),
        sql`(${monitoredPages.clientId} is null or ${monitoredPages.clientId} in ${visibleClientIds(actor)})`,
      ),
    )
    .orderBy(monitoredPages.name);
}

export async function listIncidents(actor: Actor, openOnly = true) {
  return db
    .select({
      i: incidents,
      pageName: monitoredPages.name,
      pageUrl: monitoredPages.url,
      ownerName: users.name,
      campaignName: campaigns.name,
    })
    .from(incidents)
    .leftJoin(monitoredPages, eq(monitoredPages.id, incidents.pageId))
    .leftJoin(campaigns, eq(campaigns.id, incidents.campaignId))
    .leftJoin(users, eq(users.id, incidents.ownerId))
    .where(
      and(
        eq(incidents.orgId, actor.orgId),
        openOnly ? inArray(incidents.status, ['open', 'acknowledged', 'resolved']) : undefined,
      ),
    )
    .orderBy(desc(incidents.openedAt))
    .limit(200);
}

export async function recentChecks(pageId: string, limit = 20) {
  return db
    .select()
    .from(pageChecks)
    .where(eq(pageChecks.pageId, pageId))
    .orderBy(desc(pageChecks.checkedAt))
    .limit(limit);
}

/** Owner actions. "Resolved" means a fix was applied; the next successful check verifies and closes it. */
export async function updateIncident(
  actor: Actor,
  id: string,
  action: 'acknowledge' | 'resolve',
  notes?: string | null,
) {
  assertCan(actor, 'monitoring.manage');
  const [i] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, id), eq(incidents.orgId, actor.orgId)));
  if (!i) throw notFound('Incident');
  if (i.status === 'closed') throw precondition('Incident is already closed.');
  const set =
    action === 'acknowledge'
      ? { status: 'acknowledged' as const, acknowledgedAt: new Date() }
      : {
          status: 'resolved' as const,
          resolvedAt: new Date(),
          notes: [i.notes, notes].filter(Boolean).join('\n') || null,
        };
  if (action === 'resolve' && i.type === 'conversion_missing')
    Object.assign(set, { status: 'closed', closedAt: new Date(), verifiedAt: null });
  await db.update(incidents).set(set).where(eq(incidents.id, id));
  await audit(db, actor, `incident.${action}`, 'incident', id, { after: { notes } });
}

/* ---------------------------------------------------------------- checks */

export type CheckResult = {
  ok: boolean;
  statusCode: number | null;
  responseMs: number;
  error: string | null;
};

export async function checkUrl(
  url: string,
  expectedStatus: number,
  expectedText: string | null,
  timeoutMs = 15_000,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    let current = (await assertPublicUrl(url)).toString();
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        res = await fetch(current, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'SahynexOS-Monitor/1.0' },
        });
      } finally {
        clearTimeout(t);
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && expectedStatus < 300) {
        current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
        continue;
      }
      break;
    }
    const responseMs = Date.now() - started;
    if (!res) return { ok: false, statusCode: null, responseMs, error: 'No response' };
    if (res.status !== expectedStatus)
      return {
        ok: false,
        statusCode: res.status,
        responseMs,
        error: `Expected HTTP ${expectedStatus}, got ${res.status}`,
      };
    if (expectedText) {
      const body = (await res.text()).slice(0, 2_000_000);
      if (!body.includes(expectedText))
        return {
          ok: false,
          statusCode: res.status,
          responseMs,
          error: `Expected text not found: “${expectedText.slice(0, 80)}”`,
        };
    }
    return { ok: true, statusCode: res.status, responseMs, error: null };
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      responseMs: Date.now() - started,
      error:
        e instanceof Error
          ? e.name === 'AbortError'
            ? `Timed out after ${timeoutMs / 1000}s`
            : e.message
          : String(e),
    };
  }
}

/** Record a check result and drive the incident lifecycle (Workflow 5). */
export async function recordCheck(tx: DBOrTx, page: typeof monitoredPages.$inferSelect, r: CheckResult) {
  await tx.insert(pageChecks).values({
    pageId: page.id,
    ok: r.ok,
    statusCode: r.statusCode,
    responseMs: r.responseMs,
    error: r.error,
  });
  await tx
    .update(monitoredPages)
    .set({
      lastCheckedAt: new Date(),
      lastStatus: r.ok ? 'up' : 'down',
      consecutiveFailures: r.ok ? 0 : page.consecutiveFailures + 1,
    })
    .where(eq(monitoredPages.id, page.id));
  const [open] = await tx
    .select()
    .from(incidents)
    .where(
      and(eq(incidents.pageId, page.id), inArray(incidents.status, ['open', 'acknowledged', 'resolved'])),
    )
    .for('update');
  let event: 'opened' | 'reopened' | 'recovered' | 'closed' | null = null;
  if (!r.ok) {
    if (!open) {
      const ins = await tx
        .insert(incidents)
        .values({
          orgId: page.orgId,
          pageId: page.id,
          campaignId: page.campaignId,
          type: 'page_down',
          title: `${page.name} is failing: ${r.error ?? 'unknown error'}`.slice(0, 300),
          ownerId: page.ownerId,
        })
        .onConflictDoNothing()
        .returning();
      if (ins[0]) {
        event = 'opened';
        await alertIncident(tx, page, ins[0].id, `Landing page down: ${page.name}`, r.error ?? '', 'high');
      }
    } else if (open.status === 'resolved') {
      await tx
        .update(incidents)
        .set({
          status: 'open',
          resolvedAt: null,
          notes: [open.notes, `Re-opened ${new Date().toISOString()}: still failing (${r.error})`]
            .filter(Boolean)
            .join('\n'),
        })
        .where(eq(incidents.id, open.id));
      event = 'reopened';
      await alertIncident(
        tx,
        page,
        open.id,
        `Still failing after fix: ${page.name}`,
        r.error ?? '',
        'high',
        `reopen:${Date.now()}`,
      );
    }
  } else if (open) {
    if (open.status === 'resolved') {
      await tx
        .update(incidents)
        .set({ status: 'closed', verifiedAt: new Date(), closedAt: new Date() })
        .where(eq(incidents.id, open.id));
      event = 'closed';
    } else {
      await tx
        .update(incidents)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          notes: [open.notes, 'Recovered automatically; awaiting verification check.']
            .filter(Boolean)
            .join('\n'),
        })
        .where(eq(incidents.id, open.id));
      event = 'recovered';
    }
  }
  return event;
}

async function alertIncident(
  tx: DBOrTx,
  page: typeof monitoredPages.$inferSelect,
  incidentId: string,
  title: string,
  body: string,
  severity: 'warning' | 'high',
  suffix = '',
) {
  const recipients = page.ownerId
    ? [page.ownerId]
    : (await usersWithRoles(tx, page.orgId, ['coo', 'ceo'])).map((u) => u.id);
  for (const userId of recipients)
    await notify(tx, {
      orgId: page.orgId,
      userId,
      type: 'incident',
      severity,
      title,
      body,
      link: `/campaigns/monitoring?incident=${incidentId}`,
      dedupeKey: `incident:${incidentId}${suffix}`,
    });
}

/**
 * Conversion gap: the page's campaign spent money recently but no CRM leads arrived in the window.
 * Uses a minimum spend so a paused or tiny campaign does not alert.
 */
export async function checkConversionGap(
  tx: DBOrTx,
  page: typeof monitoredPages.$inferSelect,
  now = new Date(),
) {
  if (!page.campaignId || !page.conversionGapHours) return null;
  const since = new Date(now.getTime() - page.conversionGapHours * 3_600_000);
  const [spend] = await tx
    .select({ spend: sql<number | null>`sum(${campaignMetrics.spendMinor})::bigint` })
    .from(campaignMetrics)
    .where(
      and(
        eq(campaignMetrics.campaignId, page.campaignId),
        sql`${campaignMetrics.date} >= ${since.toISOString().slice(0, 10)}`,
      ),
    );
  if (!spend?.spend || Number(spend.spend) <= 0) return null;
  const [crm] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.campaignId, page.campaignId),
        eq(leads.isTest, false),
        isNull(leads.deletedAt),
        sql`${leads.createdAt} >= ${since}`,
      ),
    );
  const [existing] = await tx
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(
        eq(incidents.campaignId, page.campaignId),
        eq(incidents.type, 'conversion_missing'),
        inArray(incidents.status, ['open', 'acknowledged']),
      ),
    );
  if ((crm?.n ?? 0) > 0) {
    if (existing)
      await tx
        .update(incidents)
        .set({
          status: 'closed',
          closedAt: new Date(),
          verifiedAt: new Date(),
          notes: 'Leads are arriving again.',
        })
        .where(eq(incidents.id, existing.id));
    return existing ? 'closed' : null;
  }
  if (existing) return null;
  const [inc] = await tx
    .insert(incidents)
    .values({
      orgId: page.orgId,
      campaignId: page.campaignId,
      type: 'conversion_missing',
      title: `No CRM leads from “${page.name}” in ${page.conversionGapHours}h while the campaign is spending`,
      ownerId: page.ownerId,
    })
    .returning();
  await alertIncident(
    tx,
    page,
    inc.id,
    inc.title,
    'Check the form, tracking and the lead integration.',
    'warning',
  );
  return 'opened';
}

export const _test = { isPrivateAddress };
