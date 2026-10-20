import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, schema } from '@/db';
import { configureIntegration } from '@/server/services/admin';
import { evaluateBrief } from '@/server/services/creative';
import { createProject } from '@/server/services/projects';
import { makeClient, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
let projectId: string;
let otherProjectId: string;
beforeAll(async () => {
  org = await makeOrg();
  const c = await makeClient(org, 'Creative Test College');
  projectId = (await createProject(org.actors.pm, { clientId: c.id, name: 'Admissions 2027' })).id;
  const other = await makeClient(org, 'Someone Else', org.users.ceo.id);
  otherProjectId = (await createProject(org.actors.coo, { clientId: other.id, name: 'Not for PM' })).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AI_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});

const brief = {
  format: 'reel',
  title: 'Reel',
  channel: 'Instagram',
  audience: 'Class 12 PCM',
  brief: 'Hook (first 3s):\nCTA: apply now',
};
const deliverableCount = async () =>
  (await db.select().from(schema.deliverables).where(eq(schema.deliverables.orgId, org.orgId))).length;

describe('Creative Studio', () => {
  it('is unavailable when the AI assistant is disconnected, without blocking anything else', async () => {
    await expect(evaluateBrief(org.actors.pm, { projectId, ...brief })).rejects.toThrow(
      /continue manually|isn’t connected/,
    );
  });

  it('demo mode returns a labelled rule-based review and creates nothing', async () => {
    await configureIntegration(org.actors.ceo, 'ai_assistant', { mode: 'demo', config: {} });
    const before = await deliverableCount();
    const r = await evaluateBrief(org.actors.pm, { projectId, ...brief });
    expect(r.demo).toBe(true);
    expect(r.review.gaps.length).toBeGreaterThan(0);
    expect(await deliverableCount()).toBe(before);
  });

  it('validates input and only allows projects the person can see', async () => {
    await expect(evaluateBrief(org.actors.pm, { projectId, ...brief, brief: '' })).rejects.toThrow();
    await expect(evaluateBrief(org.actors.pm, { projectId: otherProjectId, ...brief })).rejects.toThrow(
      /Unknown project/,
    );
    await expect(evaluateBrief(org.actors.employee, { projectId, ...brief })).rejects.toThrow();
  });

  it('live: sends business context (no contacts) to Gemini, parses the review and audits it', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'g-test';
    await configureIntegration(org.actors.ceo, 'ai_assistant', { mode: 'live', config: {} });
    let sent = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent = String(init?.body);
        const review = {
          strengths: ['Clear audience'],
          gaps: ['No proof point'],
          recommendedDirection: 'Student-led reel.',
          concepts: [
            {
              name: 'Day one',
              rationale: 'r',
              coreMessage: 'Build it',
              hook: 'h',
              angle: 'a',
              visualDirection: 'v',
              cta: 'Apply',
            },
          ],
          copy: {
            hooks: ['h1'],
            caption: 'c',
            ctas: ['Apply'],
            hashtags: ['BTech'],
            structure: [],
            visualNotes: [],
          },
        };
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(review) }] } }] }),
        );
      }),
    );
    const r = await evaluateBrief(org.actors.pm, { projectId, ...brief });
    expect(r.demo).toBe(false);
    expect(r.review.concepts[0].name).toBe('Day one');
    expect(r.review.copy.hashtags).toEqual(['#BTech']);
    expect(sent).toContain('Creative Test College');
    expect(sent).toContain('never'); // the no-invented-facts rules travel with every request
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.orgId, org.orgId), eq(schema.auditLogs.action, 'ai.creative_review')));
    expect(audits).toHaveLength(1);
  });

  it('live: a provider failure surfaces as an error and changes nothing', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'g-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"quota"}', { status: 429 })),
    );
    const before = await deliverableCount();
    await expect(evaluateBrief(org.actors.pm, { projectId, ...brief })).rejects.toThrow(/429|rate limit/i);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })),
      ),
    );
    await expect(evaluateBrief(org.actors.pm, { projectId, ...brief })).rejects.toThrow(/expected format/);
    expect(await deliverableCount()).toBe(before);
  });
});
