/**
 * AI daily brief via the Anthropic Messages API (POST https://api.anthropic.com/v1/messages).
 *
 * The model receives only the facts the app assembled (tasks, leads, campaigns, Instagram,
 * calendar titles, email senders/subjects — never email bodies). It must not invent numbers.
 * Optional web search (AI_WEB_SEARCH=true) lets it look up current marketing trends; the
 * server-side web search tool costs extra per search.
 */
import { PermanentError } from '../automation/types';
import { apiFetch } from './http';

const env = (k: string) => process.env[k]?.trim() || '';

export const aiAdapter = {
  requiredEnv: ['ANTHROPIC_API_KEY'],
  model: () => env('AI_MODEL') || 'claude-sonnet-5-5',
  setupSteps: [
    'Create an API key at console.anthropic.com (Settings → API keys) and add billing.',
    'Set ANTHROPIC_API_KEY in the server environment. Optional: AI_MODEL (default claude-sonnet-5-5) and AI_WEB_SEARCH=true to let the brief look up current trends on the web (extra cost per search).',
    'Choose Live below. Each person gets at most one automatic brief per day; “Refresh” regenerates on request.',
    'What is sent: your tasks, lead and campaign figures, Instagram numbers, calendar event titles and email senders/subjects (never email bodies).',
  ],
  checkConfig() {
    const missing = this.requiredEnv.filter((k) => !env(k));
    return { ok: missing.length === 0, missing };
  },
};

export type BriefContent = {
  summary: string;
  priorities: string[];
  strategies: Array<{ title: string; why: string; action: string }>;
  social: string[];
  trends: string[];
};

const SYSTEM = `You write a short morning brief for the co-founder/CMO of Sahynex, a brand, growth and technology studio in Mangaluru, India that runs admissions marketing (Meta, Google, social, websites) for educational institutions.

Rules:
- Use ONLY the facts in the JSON you are given (and web search results if you have them). Never invent numbers, names or events. If something is missing, say it is not available.
- Be specific and practical: reference the actual tasks, leads, campaigns and Instagram posts in the facts.
- Strategies are ideas, clearly framed as suggestions.
- Keep it short: summary ≤ 3 sentences; 3 priorities; 3 strategies; up to 3 social insights; up to 3 trends.

Return ONLY a JSON object with this shape and no other text:
{"summary": string, "priorities": string[], "strategies": [{"title": string, "why": string, "action": string}], "social": string[], "trends": string[]}`;

/** Pulls the first JSON object out of the model's text and validates its shape. */
export function parseBrief(text: string): BriefContent {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new PermanentError('The AI response did not contain a brief.');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<BriefContent>;
  const strs = (v: unknown, n: number) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, n)
      : [];
  const strategies = Array.isArray(raw.strategies)
    ? raw.strategies
        .filter((s): s is BriefContent['strategies'][number] => !!s && typeof s.title === 'string')
        .slice(0, 3)
        .map((s) => ({ title: s.title, why: String(s.why ?? ''), action: String(s.action ?? '') }))
    : [];
  if (typeof raw.summary !== 'string' || !raw.summary.trim())
    throw new PermanentError('The AI response was missing a summary.');
  return {
    summary: raw.summary.trim(),
    priorities: strs(raw.priorities, 3),
    strategies,
    social: strs(raw.social, 3),
    trends: strs(raw.trends, 3),
  };
}

export async function generateBriefWithAI(
  facts: Record<string, unknown>,
): Promise<{ content: BriefContent; model: string }> {
  const model = aiAdapter.model();
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Facts for today (JSON):\n${JSON.stringify(facts)}` }],
  };
  if (env('AI_WEB_SEARCH') === 'true')
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
  const res = (await apiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 90_000,
  })) as { content?: Array<{ type: string; text?: string }> };
  const text = (res.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
  return { content: parseBrief(text), model };
}

/**
 * Demo mode: a rule-based brief built only from the same facts — explicitly NOT AI-written, and
 * labelled as such in the UI.
 */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function demoBrief(f: {
  overdueTasks: number;
  dueToday: number;
  leadsToContact: number;
  newLeadsYesterday: number;
  cplChangePct: number | null;
  meetingsToday: number;
  topPost: string | null;
  followerChange: number | null;
}): BriefContent {
  const cpl =
    f.cplChangePct == null
      ? 'Cost per lead is not available yet.'
      : Math.abs(f.cplChangePct) < 1
        ? 'Cost per lead is flat compared with the previous period.'
        : `Cost per lead is ${f.cplChangePct > 0 ? 'up' : 'down'} ${Math.abs(f.cplChangePct).toFixed(0)}% compared with the previous period.`;
  return {
    summary: `You have ${plural(f.dueToday, 'task')} due today and ${f.overdueTasks} overdue, ${plural(f.meetingsToday, 'meeting')} on the calendar and ${plural(f.leadsToContact, 'lead')} waiting for contact. ${plural(f.newLeadsYesterday, 'new lead')} arrived yesterday.`,
    priorities: [
      f.overdueTasks
        ? `Clear the ${plural(f.overdueTasks, 'overdue task')} first.`
        : 'No overdue tasks — protect time for deep work.',
      f.leadsToContact
        ? `Call the ${plural(f.leadsToContact, 'lead')} waiting for first contact.`
        : 'All your leads have been contacted.',
      f.meetingsToday
        ? 'Prepare agendas for today’s meetings.'
        : 'Use the open calendar to follow up on proposals.',
    ],
    strategies: [
      {
        title: 'Speed-to-lead',
        why: 'Fast first contact usually improves conversion.',
        action: 'Block 30 minutes after lunch purely for first calls.',
      },
      {
        title: 'Recycle the best post',
        why: f.topPost ? `“${f.topPost}” had the most engagement recently.` : 'Reuse what already works.',
        action: 'Turn it into a short reel and a story with an admissions call-to-action.',
      },
      {
        title: 'Watch cost per lead',
        why: cpl,
        action: 'Pause the weakest ad set and move budget to the best performer.',
      },
    ],
    social: [
      f.followerChange == null
        ? 'Follower change will appear after two days of snapshots.'
        : `Followers changed by ${f.followerChange >= 0 ? '+' : ''}${f.followerChange} since yesterday.`,
    ],
    trends: ['Trends need the AI assistant connected (with web search) — not available in sample mode.'],
  };
}
