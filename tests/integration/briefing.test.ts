import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, schema } from '@/db';
import { configureIntegration } from '@/server/services/admin';
import {
  briefBlock,
  callsAndProgress,
  disconnectGoogle,
  generateBrief,
  googleBlock,
  instagramBlock,
  saveGoogleConnection,
} from '@/server/services/briefing';
import { ingestLead } from '@/server/services/leads';
import { createTask, setTaskStatus } from '@/server/services/tasks';
import { drainOrg, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'APP_URL',
    'INSTAGRAM_ACCESS_TOKEN',
    'META_GRAPH_VERSION',
    'ANTHROPIC_API_KEY',
  ])
    delete process.env[k];
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Home briefing — nothing connected', () => {
  it('shows honest “not connected” states and refuses to generate a brief', async () => {
    expect((await googleBlock(org.actors.sales)).state).toBe('off');
    expect((await instagramBlock(org.actors.sales)).state).toBe('off');
    expect(await briefBlock(org.actors.sales)).toMatchObject({ state: 'off', canConfigure: false });
    expect(await briefBlock(org.actors.ceo)).toMatchObject({ state: 'off', canConfigure: true });
    await expect(generateBrief(org.actors.sales)).rejects.toThrow(/isn’t connected/);
  });
});

describe('Home briefing — sample (demo) mode', () => {
  beforeAll(async () => {
    for (const p of ['google_workspace', 'instagram', 'ai_assistant'] as const)
      await configureIntegration(org.actors.ceo, p, { mode: 'demo', config: {} });
  });

  it('returns labelled sample inbox, LinkedIn alerts and calendar', async () => {
    const g = await googleBlock(org.actors.sales);
    expect(g.state).toBe('ready');
    if (g.state !== 'ready') return;
    expect(g.demo).toBe(true);
    expect(g.recent.length).toBeGreaterThan(0);
    expect(g.linkedin.every((m) => m.subject.startsWith('DEMO'))).toBe(true);
    expect(g.calendar.every((e) => e.title.startsWith('DEMO'))).toBe(true);
  });

  it('stores one labelled Instagram snapshot per day and reports the change since yesterday', async () => {
    const a = await instagramBlock(org.actors.sales);
    const b = await instagramBlock(org.actors.pm);
    expect(a.state).toBe('ready');
    if (a.state !== 'ready' || b.state !== 'ready') return;
    expect(a.demo).toBe(true);
    expect(a.followerChange).not.toBeNull();
    expect(b.followers).toBe(a.followers);
    const rows = await db
      .select()
      .from(schema.instagramSnapshots)
      .where(eq(schema.instagramSnapshots.orgId, org.orgId));
    expect(rows).toHaveLength(2); // yesterday + today, no duplicates
    expect(rows.every((r) => r.isDemo)).toBe(true);
  });

  it('writes a rule-based sample brief once per day, keeps the facts, and only regenerates on request', async () => {
    const first = await generateBrief(org.actors.sales);
    expect(first.isDemo).toBe(true);
    expect(first.model).toMatch(/not AI/);
    expect(first.facts).toHaveProperty('tasks');
    expect(first.facts).not.toHaveProperty('_userId');
    const again = await generateBrief(org.actors.sales);
    expect(again.id).toBe(first.id);
    const forced = await generateBrief(org.actors.sales, { force: true });
    expect(forced.id).toBe(first.id); // same day row, updated in place
    expect(forced.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
    const block = await briefBlock(org.actors.sales);
    expect(block).toMatchObject({ state: 'ready', demo: true });
    // Briefs are personal.
    expect((await briefBlock(org.actors.pm)).state).toBe('empty');
  });

  it('counts today’s task progress and lists callable leads (not opted-out ones)', async () => {
    const t1 = await createTask(org.actors.sales, {
      title: 'Send proposal',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await createTask(org.actors.sales, {
      title: 'Prepare deck',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await setTaskStatus(org.actors.sales, t1.id, 'done');
    const l = await ingestLead(
      org.actors.sales,
      { name: 'Callable Lead', phone: '9845066666', ownerId: org.users.sales.id },
      'manual',
    );
    await drainOrg(org.orgId);
    const cp = await callsAndProgress(org.actors.sales);
    expect(cp.progress.done).toBeGreaterThanOrEqual(1);
    expect(cp.progress.total).toBeGreaterThanOrEqual(2);
    const owner = (await db.select().from(schema.leads).where(eq(schema.leads.id, l.lead.id)))[0].ownerId;
    const forOwner = await callsAndProgress(
      owner === org.users.sales.id ? org.actors.sales : org.actors.sales2,
    );
    expect(forOwner.calls.some((c) => c.id === l.lead.id)).toBe(true);
    await db.update(schema.leads).set({ suppressed: true }).where(eq(schema.leads.id, l.lead.id));
    const after = await callsAndProgress(owner === org.users.sales.id ? org.actors.sales : org.actors.sales2);
    expect(after.calls.some((c) => c.id === l.lead.id)).toBe(false);
  });
});

describe('Home briefing — live mode (external services simulated)', () => {
  let live: TestOrg;
  beforeAll(async () => {
    live = await makeOrg();
  });

  it('Google: needs the person to connect, stores the token encrypted, reads mail and calendar, and disconnects', async () => {
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
      APP_URL: 'https://os.example.com',
    });
    await configureIntegration(live.actors.ceo, 'google_workspace', { mode: 'live', config: {} });
    expect((await googleBlock(live.actors.sales)).state).toBe('not_connected');

    await saveGoogleConnection(live.actors.sales, {
      refreshToken: 'REFRESH-123',
      email: 'neha@sahynex.in',
      scopes: 'gmail.readonly',
    });
    const [row] = await db
      .select()
      .from(schema.userGoogleConnections)
      .where(eq(schema.userGoogleConnections.userId, live.users.sales.id));
    expect(row.refreshTokenEnc).not.toContain('REFRESH-123');

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          expect(String(init?.body)).toContain('refresh_token=REFRESH-123');
          return json({ access_token: 'AT' });
        }
        if (url.includes('/labels/INBOX')) return json({ messagesUnread: 4 });
        if (url.includes('/messages?')) {
          return url.includes('linkedin')
            ? json({ messages: [{ id: 'li1' }] })
            : json({ messages: [{ id: 'm1' }] });
        }
        if (url.includes('/messages/m1'))
          return json({
            id: 'm1',
            labelIds: ['UNREAD'],
            snippet: 'Hello',
            payload: {
              headers: [
                { name: 'From', value: 'A <a@x.com>' },
                { name: 'Subject', value: 'Hi' },
              ],
            },
          });
        if (url.includes('/messages/li1'))
          return json({
            id: 'li1',
            payload: {
              headers: [
                { name: 'From', value: 'LinkedIn <messages-noreply@linkedin.com>' },
                { name: 'Subject', value: 'Rahul sent you a message' },
              ],
            },
          });
        if (url.includes('/calendar/v3/'))
          return json({
            items: [
              {
                id: 'e1',
                summary: 'Call with SCEM',
                start: { dateTime: new Date().toISOString() },
                end: { dateTime: new Date().toISOString() },
              },
            ],
          });
        return json({}, 404);
      }),
    );
    const g = await googleBlock(live.actors.sales, { fresh: true });
    expect(g).toMatchObject({ state: 'ready', demo: false, email: 'neha@sahynex.in', unreadCount: 4 });
    if (g.state !== 'ready') return;
    expect(g.recent.map((m) => m.subject)).toEqual(['Hi']);
    expect(g.linkedin.map((m) => m.subject)).toEqual(['Rahul sent you a message']);
    expect(g.calendar.map((e) => e.title)).toEqual(['Call with SCEM']);
    expect(calls.every((u) => !/[?&](access_token|key)=/.test(u) || u.includes('graph.facebook'))).toBe(true);
    // Another person sees only their own (unconnected) state.
    expect((await googleBlock(live.actors.pm)).state).toBe('not_connected');

    await disconnectGoogle(live.actors.sales);
    expect(
      await db
        .select()
        .from(schema.userGoogleConnections)
        .where(eq(schema.userGoogleConnections.userId, live.users.sales.id)),
    ).toHaveLength(0);
  });

  it('Google errors are shown, not hidden', async () => {
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
      APP_URL: 'https://os.example.com',
    });
    await saveGoogleConnection(live.actors.pm, { refreshToken: 'BAD', email: null, scopes: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'invalid_grant' }, 400)),
    );
    const g = await googleBlock(live.actors.pm, { fresh: true });
    expect(g.state).toBe('error');
  });

  it('Instagram: takes a real snapshot from the Graph API once a day', async () => {
    Object.assign(process.env, { INSTAGRAM_ACCESS_TOKEN: 'IGT', META_GRAPH_VERSION: 'v21.0' });
    await configureIntegration(live.actors.ceo, 'instagram', {
      mode: 'live',
      config: { igUserId: '17841400000000' },
    });
    const f = vi.fn(async (url: string) =>
      url.includes('/media?')
        ? json({
            data: [
              {
                id: 'p1',
                caption: 'Open day',
                timestamp: new Date().toISOString(),
                like_count: 120,
                comments_count: 8,
              },
            ],
          })
        : json({ username: 'sahynex', followers_count: 5000, media_count: 300 }),
    );
    vi.stubGlobal('fetch', f);
    const ig = await instagramBlock(live.actors.sales);
    expect(ig).toMatchObject({
      state: 'ready',
      demo: false,
      username: 'sahynex',
      followers: 5000,
      postsLast24h: 1,
      followerChange: null,
    });
    expect(f.mock.calls[0][0]).toContain('https://graph.facebook.com/v21.0/17841400000000');
    await instagramBlock(live.actors.pm);
    expect(f).toHaveBeenCalledTimes(2); // second view reuses today's snapshot
  });

  it('AI: sends only assembled facts to the Anthropic API and stores the parsed brief', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await configureIntegration(live.actors.ceo, 'ai_assistant', { mode: 'live', config: {} });
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'https://api.anthropic.com/v1/messages') {
          sent = JSON.parse(String(init?.body));
          expect((init?.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
          return json({
            content: [
              {
                type: 'text',
                text: '{"summary":"Focus on SCEM leads.","priorities":["Call 3 leads"],"strategies":[],"social":[],"trends":["Short reels"]}',
              },
            ],
          });
        }
        // Instagram (still live from the previous test) and Google token calls
        if (url.includes('graph.facebook.com'))
          return json({ username: 'sahynex', followers_count: 5000, media_count: 300, data: [] });
        return json({}, 404);
      }),
    );
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGT';
    process.env.META_GRAPH_VERSION = 'v21.0';
    const row = await generateBrief(live.actors.sales);
    expect(row.isDemo).toBe(false);
    expect(row.content).toMatchObject({ summary: 'Focus on SCEM leads.', trends: ['Short reels'] });
    const userMsg = JSON.stringify(sent);
    expect(userMsg).toContain('Facts for today');
    expect(userMsg).not.toContain('_userId');
    expect(userMsg).not.toContain('REFRESH');
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.orgId, live.orgId), eq(schema.auditLogs.action, 'ai.brief_generated')));
    expect(audits).toHaveLength(1);
  });
});
