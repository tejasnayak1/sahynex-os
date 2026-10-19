import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { fromDateTimeLocal, todayIn } from '@/lib/format';
import { pctChange } from '@/lib/metrics';
import { actorUserId, can, type Actor } from '../actor';
import { audit } from '../audit';
import { decryptSecret, encryptSecret } from '../crypto';
import { forbidden, precondition } from '../errors';
import { aiAdapter, demoBrief, generateBriefWithAI, type BriefContent } from '../integrations/ai';
import {
  accessTokenFor,
  fetchCalendar,
  fetchInbox,
  googleConfigured,
  revoke,
  type CalendarItem,
  type MailItem,
} from '../integrations/google-user';
import { demoSnapshot, instagramAdapter, type IgSnapshot } from '../integrations/instagram';
import { rateLimit } from '../rate-limit';
import { executiveDashboard, homeToday } from './dashboard';
import { getOrg } from './org';

const { integrationConnections, userGoogleConnections, instagramSnapshots, aiBriefs, tasks, leads } = schema;
type Provider = 'google_workspace' | 'instagram' | 'ai_assistant';

async function connection(orgId: string, provider: Provider) {
  const [c] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.orgId, orgId), eq(integrationConnections.provider, provider)));
  return c ?? null;
}

async function dayBounds(orgId: string) {
  const org = await getOrg(db, orgId);
  const today = todayIn(org.timezone);
  return {
    org,
    today,
    start: fromDateTimeLocal(`${today}T00:00`, org.timezone),
    end: fromDateTimeLocal(`${today}T23:59:59`, org.timezone),
  };
}

/* ------------------------------------------------------------ Google */

export type GoogleBlock =
  | { state: 'off'; reason: string; canConfigure: boolean }
  | { state: 'not_connected' }
  | { state: 'error'; email: string | null; message: string }
  | {
      state: 'ready';
      demo: boolean;
      email: string | null;
      unreadCount: number | null;
      recent: MailItem[];
      linkedin: MailItem[];
      calendar: CalendarItem[];
      fetchedAt: string;
    };

const googleCache = new Map<string, { at: number; value: GoogleBlock }>();
const GOOGLE_TTL_MS = 5 * 60_000;

function demoGoogle(today: string, startOfDay: Date): GoogleBlock {
  const at = (h: number, m = 0) => new Date(startOfDay.getTime() + (h * 60 + m) * 60_000).toISOString();
  const mail = (
    i: number,
    from: string,
    email: string,
    subject: string,
    snippet: string,
    h: number,
  ): MailItem => ({
    id: `demo-${today}-${i}`,
    from,
    fromEmail: email,
    subject: `DEMO · ${subject}`,
    snippet,
    date: at(h),
    unread: i % 2 === 0,
    important: i < 2,
    link: '#',
  });
  return {
    state: 'ready',
    demo: true,
    email: 'you@demo.example',
    unreadCount: 7,
    recent: [
      mail(
        0,
        'Principal, Demo Institute',
        'principal@demo-institute.example',
        'Feedback on the campus film cut',
        'Loved the second half — can we shorten the intro…',
        8,
      ),
      mail(
        1,
        'Accounts, Demo College',
        'accounts@demo-college.example',
        'Invoice INV-0042 processed',
        'Payment has been scheduled for Friday…',
        7,
      ),
      mail(
        2,
        'Meta for Business',
        'notification@business.example',
        'Your ad account spend summary',
        'Here is a summary of yesterday’s spend…',
        6,
      ),
    ],
    linkedin: [
      mail(
        3,
        'LinkedIn',
        'messages-noreply@linkedin.com',
        'Rahul Shenoy sent you a message',
        'Hi, we are planning our 2027 admissions campaign…',
        9,
      ),
      mail(
        4,
        'LinkedIn',
        'inmail-hit-reply@linkedin.com',
        'New InMail from Director, Demo Nursing College',
        'Would love to discuss a website revamp…',
        10,
      ),
    ],
    calendar: [
      {
        id: 'd1',
        title: 'DEMO · Team stand-up',
        start: at(10),
        end: at(10, 15),
        allDay: false,
        location: null,
        meetLink: 'https://meet.google.com/demo',
        link: null,
        attendees: 6,
      },
      {
        id: 'd2',
        title: 'DEMO · Call with Demo Polytechnic (proposal)',
        start: at(12),
        end: at(12, 30),
        allDay: false,
        location: null,
        meetLink: null,
        link: null,
        attendees: 2,
      },
      {
        id: 'd3',
        title: 'DEMO · Creative review — reels batch',
        start: at(16),
        end: at(17),
        allDay: false,
        location: 'Studio',
        meetLink: null,
        link: null,
        attendees: 4,
      },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

export async function googleBlock(actor: Actor, opts: { fresh?: boolean } = {}): Promise<GoogleBlock> {
  const userId = actorUserId(actor);
  if (!userId) return { state: 'off', reason: 'Only people can connect Google.', canConfigure: false };
  const conn = await connection(actor.orgId, 'google_workspace');
  const canConfigure = can(actor, 'settings.integrations');
  const { today, start, end } = await dayBounds(actor.orgId);
  if (!conn || conn.mode === 'disconnected')
    return {
      state: 'off',
      reason: 'Gmail & Calendar aren’t enabled for your organisation yet.',
      canConfigure,
    };
  if (conn.mode === 'demo') return demoGoogle(today, start);
  const cfg = googleConfigured();
  if (!cfg.ok)
    return {
      state: 'off',
      reason: `Google sign-in isn’t configured (missing ${cfg.missing.join(', ')}).`,
      canConfigure,
    };

  const cached = googleCache.get(userId);
  if (!opts.fresh && cached && Date.now() - cached.at < GOOGLE_TTL_MS) return cached.value;

  const [row] = await db.select().from(userGoogleConnections).where(eq(userGoogleConnections.userId, userId));
  if (!row) return { state: 'not_connected' };
  let value: GoogleBlock;
  try {
    const token = await accessTokenFor(decryptSecret(row.refreshTokenEnc));
    const [inbox, calendar] = await Promise.all([fetchInbox(token), fetchCalendar(token, start, end)]);
    value = {
      state: 'ready',
      demo: false,
      email: row.googleEmail,
      ...inbox,
      calendar,
      fetchedAt: new Date().toISOString(),
    };
    await db
      .update(userGoogleConnections)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(userGoogleConnections.userId, userId));
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : String(e);
    await db
      .update(userGoogleConnections)
      .set({ lastError: message })
      .where(eq(userGoogleConnections.userId, userId));
    value = { state: 'error', email: row.googleEmail, message };
  }
  googleCache.set(userId, { at: Date.now(), value });
  return value;
}

export async function saveGoogleConnection(
  actor: Actor,
  input: { refreshToken: string; email: string | null; scopes: string },
) {
  const userId = actorUserId(actor);
  if (!userId) throw forbidden();
  const values = {
    orgId: actor.orgId,
    googleEmail: input.email,
    refreshTokenEnc: encryptSecret(input.refreshToken),
    scopes: input.scopes,
    lastError: null,
  };
  await db
    .insert(userGoogleConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userGoogleConnections.userId, set: values });
  googleCache.delete(userId);
  await audit(db, actor, 'google.connected', 'user', userId, {
    after: { email: input.email, scopes: input.scopes },
  });
}

export async function disconnectGoogle(actor: Actor) {
  const userId = actorUserId(actor);
  if (!userId) throw forbidden();
  const [row] = await db.select().from(userGoogleConnections).where(eq(userGoogleConnections.userId, userId));
  if (!row) return;
  try {
    await revoke(decryptSecret(row.refreshTokenEnc));
  } catch {
    /* token already unreadable or revoked — deleting it locally is what matters */
  }
  await db.delete(userGoogleConnections).where(eq(userGoogleConnections.userId, userId));
  googleCache.delete(userId);
  await audit(db, actor, 'google.disconnected', 'user', userId, {});
}

/* ---------------------------------------------------------- Instagram */

export type InstagramBlock =
  | { state: 'off'; canConfigure: boolean; reason: string }
  | { state: 'error'; message: string }
  | {
      state: 'ready';
      demo: boolean;
      username: string | null;
      followers: number | null;
      followerChange: number | null;
      mediaCount: number | null;
      postsLast24h: number;
      recent: IgSnapshot['recentMedia'];
      top: IgSnapshot['recentMedia'][number] | null;
      engagementRecent: number | null;
      snapshotDate: string;
    };

export async function instagramBlock(actor: Actor): Promise<InstagramBlock> {
  if (actor.clientId) return { state: 'off', canConfigure: false, reason: 'Not available.' };
  const conn = await connection(actor.orgId, 'instagram');
  const canConfigure = can(actor, 'settings.integrations');
  if (!conn || conn.mode === 'disconnected')
    return { state: 'off', canConfigure, reason: 'Instagram isn’t connected yet.' };
  const { today } = await dayBounds(actor.orgId);
  const demo = conn.mode === 'demo';
  if (!demo && !instagramAdapter.checkConfig(conn).ok)
    return {
      state: 'off',
      canConfigure,
      reason: `Instagram needs ${instagramAdapter.checkConfig(conn).missing.join(', ')}.`,
    };
  const igUserId = demo ? 'demo' : conn.config.igUserId;

  const snapshotFor = async (date: string) =>
    (
      await db
        .select()
        .from(instagramSnapshots)
        .where(
          and(
            eq(instagramSnapshots.orgId, actor.orgId),
            eq(instagramSnapshots.igUserId, igUserId),
            eq(instagramSnapshots.date, date),
          ),
        )
    )[0];
  const store = async (date: string, s: IgSnapshot, isDemo: boolean) =>
    db
      .insert(instagramSnapshots)
      .values({
        orgId: actor.orgId,
        igUserId,
        date,
        username: s.username,
        followers: s.followers,
        mediaCount: s.mediaCount,
        recentMedia: s.recentMedia,
        isDemo,
      })
      .onConflictDoNothing();

  let todays = await snapshotFor(today);
  if (!todays) {
    try {
      if (demo) {
        const y = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
        if (!(await snapshotFor(y))) await store(y, demoSnapshot(y), true);
        await store(today, demoSnapshot(today), true);
      } else {
        await store(today, await instagramAdapter.fetchSnapshot(conn), false);
        await db
          .update(integrationConnections)
          .set({ status: 'healthy', lastSuccessSyncAt: new Date(), lastError: null })
          .where(eq(integrationConnections.id, conn.id));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : String(e);
      await db
        .update(integrationConnections)
        .set({ status: 'error', lastError: message })
        .where(eq(integrationConnections.id, conn.id));
      return { state: 'error', message };
    }
    todays = await snapshotFor(today);
  }
  if (!todays) return { state: 'error', message: 'No snapshot available.' };
  const [prev] = await db
    .select()
    .from(instagramSnapshots)
    .where(
      and(
        eq(instagramSnapshots.orgId, actor.orgId),
        eq(instagramSnapshots.igUserId, igUserId),
        sql`${instagramSnapshots.date} < ${today}`,
      ),
    )
    .orderBy(desc(instagramSnapshots.date))
    .limit(1);
  const recent = todays.recentMedia;
  const dayAgo = Date.now() - 86_400_000;
  const top =
    [...recent].sort(
      (a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)),
    )[0] ?? null;
  const known = recent.filter((m) => m.likes != null || m.comments != null);
  return {
    state: 'ready',
    demo: todays.isDemo,
    username: todays.username,
    followers: todays.followers,
    followerChange:
      prev && prev.followers != null && todays.followers != null ? todays.followers - prev.followers : null,
    mediaCount: todays.mediaCount,
    postsLast24h: recent.filter((m) => Date.parse(m.timestamp) >= dayAgo).length,
    recent: recent.slice(0, 4),
    top,
    engagementRecent: known.length
      ? Math.round(known.reduce((s, m) => s + (m.likes ?? 0) + (m.comments ?? 0), 0) / known.length)
      : null,
    snapshotDate: todays.date,
  };
}

/* ----------------------------------------------------------- Calls & progress */

export async function callsAndProgress(actor: Actor) {
  const userId = actorUserId(actor);
  if (!userId) return { calls: [], progress: { done: 0, total: 0 } };
  const { start, end } = await dayBounds(actor.orgId);
  const canLeads = can(actor, 'leads.read.own') || can(actor, 'leads.read.all');
  const [callLeads, [p]] = await Promise.all([
    canLeads
      ? db
          .select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
            stage: leads.stage,
            nextAction: leads.nextAction,
            nextActionAt: leads.nextActionAt,
            organisationName: leads.organisationName,
          })
          .from(leads)
          .where(
            and(
              eq(leads.ownerId, userId),
              sql`${leads.deletedAt} is null`,
              eq(leads.isTest, false),
              eq(leads.suppressed, false),
              sql`${leads.phone} is not null`,
              sql`${leads.stage} in ('new','contacted','qualified')`,
              sql`(${leads.stage} = 'new' or ${leads.nextActionAt} <= ${end})`,
            ),
          )
          .orderBy(sql`${leads.nextActionAt} asc nulls first`)
          .limit(6)
      : Promise.resolve([]),
    db
      .select({
        doneToday: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${start})::int`,
        openDue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} <= ${end})::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.ownerId, userId), sql`${tasks.deletedAt} is null`)),
  ]);
  return {
    calls: callLeads,
    progress: { done: p?.doneToday ?? 0, total: (p?.doneToday ?? 0) + (p?.openDue ?? 0) },
  };
}

/* ------------------------------------------------------------- AI brief */

export type BriefBlock =
  | { state: 'off'; canConfigure: boolean }
  | { state: 'empty'; demo: boolean }
  | { state: 'ready'; demo: boolean; content: BriefContent; model: string; createdAt: Date };

export async function briefBlock(actor: Actor): Promise<BriefBlock> {
  const userId = actorUserId(actor);
  const conn = await connection(actor.orgId, 'ai_assistant');
  if (
    !userId ||
    !conn ||
    conn.mode === 'disconnected' ||
    (conn.mode === 'live' && !aiAdapter.checkConfig().ok)
  )
    return { state: 'off', canConfigure: can(actor, 'settings.integrations') };
  const { today } = await dayBounds(actor.orgId);
  const [row] = await db
    .select()
    .from(aiBriefs)
    .where(and(eq(aiBriefs.userId, userId), eq(aiBriefs.date, today)));
  if (!row) return { state: 'empty', demo: conn.mode === 'demo' };
  return {
    state: 'ready',
    demo: row.isDemo,
    content: row.content as unknown as BriefContent,
    model: row.model,
    createdAt: row.updatedAt,
  };
}

/** Builds the facts given to the model — the only information it may use. */
export async function briefFacts(actor: Actor) {
  const userId = actorUserId(actor)!;
  const { org, today, start } = await dayBounds(actor.orgId);
  const [home, ig, google, cp] = await Promise.all([
    homeToday(actor),
    instagramBlock(actor),
    googleBlock(actor),
    callsAndProgress(actor),
  ]);
  const yesterdayStart = new Date(start.getTime() - 86_400_000);
  const [ly] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.orgId, actor.orgId),
        gte(leads.createdAt, yesterdayStart),
        sql`${leads.createdAt} < ${start}`,
        eq(leads.isTest, false),
      ),
    );
  let marketing: Record<string, unknown> | null = null;
  if (can(actor, 'dashboard.executive')) {
    const from = new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10);
    const d = await executiveDashboard(actor, { from, to: today });
    marketing = {
      period: `${from} to ${today}`,
      leads: d.leads.cur.total,
      leadsPrev: d.leads.prev.total,
      qualified: d.leads.cur.qualified,
      spendRupees: d.campaigns.cur.spendMinor == null ? null : d.campaigns.cur.spendMinor / 100,
      costPerLeadRupees: d.campaigns.cur.cplMinor == null ? null : d.campaigns.cur.cplMinor / 100,
      costPerLeadChangePct: pctChange(d.campaigns.cur.cplMinor, d.campaigns.prev.cplMinor),
      includesDemoCampaigns: d.campaigns.demoCampaigns > 0,
      openDeals: d.pipeline.open,
      weightedPipelineRupees: d.pipeline.weighted / 100,
    };
  }
  return {
    date: today,
    timezone: org.timezone,
    person: { firstName: (actor.kind === 'user' ? actor.name : '').split(' ')[0] },
    tasks: {
      dueTodayOrOverdue:
        home?.tasks.map((t) => ({
          title: t.title,
          due: t.dueAt,
          status: t.status,
          project: t.projectName,
        })) ?? [],
      overdueCount: home?.taskCounts.overdue ?? 0,
      dueTodayCount: home?.taskCounts.dueToday ?? 0,
      doneToday: cp.progress.done,
    },
    leads: {
      newYesterdayOrgWide: ly?.n ?? 0,
      waitingForMe:
        home?.leads.map((l) => ({
          name: l.name,
          stage: l.stage,
          nextAction: l.nextAction,
          organisation: l.organisationName,
        })) ?? [],
    },
    meetings: [
      ...(home?.meetings.map((m) => ({ title: m.title, start: m.startAt })) ?? []),
      ...(google.state === 'ready' ? google.calendar.map((e) => ({ title: e.title, start: e.start })) : []),
    ],
    email:
      google.state === 'ready'
        ? {
            unread: google.unreadCount,
            recent: google.recent.map((m) => ({ from: m.from, subject: m.subject })),
            linkedinMessages: google.linkedin.map((m) => m.subject),
          }
        : 'not connected',
    instagram:
      ig.state === 'ready'
        ? {
            username: ig.username,
            followers: ig.followers,
            followerChangeSinceLastSnapshot: ig.followerChange,
            postsLast24h: ig.postsLast24h,
            recentPosts: ig.recent.map((m) => ({
              caption: m.caption,
              likes: m.likes,
              comments: m.comments,
              posted: m.timestamp,
            })),
          }
        : 'not connected',
    marketingLast7Days: marketing ?? 'not available for this role',
    _userId: userId,
  };
}

export async function generateBrief(actor: Actor, opts: { force?: boolean } = {}) {
  const userId = actorUserId(actor);
  if (!userId) throw forbidden();
  const conn = await connection(actor.orgId, 'ai_assistant');
  if (!conn || conn.mode === 'disconnected')
    throw precondition(
      'The AI assistant isn’t connected. An administrator can connect it in Settings → Integrations.',
    );
  if (conn.mode === 'live' && !aiAdapter.checkConfig().ok)
    throw precondition(`The AI assistant needs ${aiAdapter.checkConfig().missing.join(', ')}.`);
  const { today } = await dayBounds(actor.orgId);
  if (!opts.force) {
    const [existing] = await db
      .select()
      .from(aiBriefs)
      .where(and(eq(aiBriefs.userId, userId), eq(aiBriefs.date, today)));
    if (existing) return existing;
  }
  await rateLimit(`ai-brief:${userId}`, 6, 24 * 3600);
  const facts = await briefFacts(actor);
  const { _userId: _ignored, ...forModel } = facts;
  void _ignored;
  let content: BriefContent;
  let model: string;
  const isDemo = conn.mode === 'demo';
  if (isDemo) {
    const ig = forModel.instagram;
    const mk = forModel.marketingLast7Days;
    content = demoBrief({
      overdueTasks: forModel.tasks.overdueCount,
      dueToday: forModel.tasks.dueTodayCount,
      leadsToContact: forModel.leads.waitingForMe.length,
      newLeadsYesterday: forModel.leads.newYesterdayOrgWide,
      cplChangePct: typeof mk === 'object' ? ((mk.costPerLeadChangePct as number | null) ?? null) : null,
      meetingsToday: forModel.meetings.length,
      topPost:
        typeof ig === 'object'
          ? ([...ig.recentPosts].sort(
              (x, y) => (y.likes ?? 0) + (y.comments ?? 0) - ((x.likes ?? 0) + (x.comments ?? 0)),
            )[0]?.caption ?? null)
          : null,
      followerChange: typeof ig === 'object' ? ig.followerChangeSinceLastSnapshot : null,
    });
    model = 'demo (rule-based, not AI)';
  } else {
    const res = await generateBriefWithAI(forModel);
    content = res.content;
    model = res.model;
  }
  const values = {
    orgId: actor.orgId,
    content: content as unknown as Record<string, unknown>,
    facts: forModel as unknown as Record<string, unknown>,
    model,
    isDemo,
  };
  const [row] = await db
    .insert(aiBriefs)
    .values({ userId, date: today, ...values })
    .onConflictDoUpdate({ target: [aiBriefs.userId, aiBriefs.date], set: values })
    .returning();
  await audit(db, actor, 'ai.brief_generated', 'user', userId, {
    after: { date: today, model, demo: isDemo },
  });
  return row;
}
