/**
 * AI daily brief. Two providers:
 *  - Google Gemini (generativelanguage.googleapis.com, generateContent) — has a free tier.
 *  - Anthropic Messages API (POST https://api.anthropic.com/v1/messages) — paid.
 * AI_PROVIDER picks one; if unset, Gemini is used when only GEMINI_API_KEY is set.
 *
 * Gemini's free tier may use prompts to improve Google's products, so by default lead names,
 * email senders and LinkedIn alert subjects are replaced with neutral placeholders before
 * sending (AI_ANONYMISE=false turns this off).
 *
 * The model receives only the facts the app assembled (tasks, leads, campaigns, Instagram,
 * calendar titles, email senders/subjects — never email bodies). It must not invent numbers.
 * Optional web search (AI_WEB_SEARCH=true) lets it look up current marketing trends; the
 * server-side web search tool costs extra per search.
 */
import { PermanentError } from '../automation/types';
import { apiFetch } from './http';

const env = (k: string) => process.env[k]?.trim() || '';

export type AiProvider = 'anthropic' | 'gemini';

export function aiProvider(): AiProvider {
  const p = env('AI_PROVIDER').toLowerCase();
  if (p === 'gemini' || p === 'anthropic') return p;
  return env('GEMINI_API_KEY') && !env('ANTHROPIC_API_KEY') ? 'gemini' : 'anthropic';
}

export const aiAdapter = {
  requiredEnv: () => (aiProvider() === 'gemini' ? ['GEMINI_API_KEY'] : ['ANTHROPIC_API_KEY']),
  model: () =>
    env('AI_MODEL') || (aiProvider() === 'gemini' ? 'gemini-flash-lite-latest' : 'claude-sonnet-5-5'),
  get setupSteps() {
    return aiProvider() === 'gemini'
      ? [
          'Free option: create a Gemini API key at aistudio.google.com → Get API key (no billing needed for the free tier).',
          'Set AI_PROVIDER=gemini and GEMINI_API_KEY in the server environment. Optional: AI_MODEL (default gemini-flash-lite-latest; gemini-flash-latest writes better but has a lower free daily limit).',
          'Free-tier note: Google may use free-tier prompts to improve its products, so lead names and email senders are anonymised before sending (AI_ANONYMISE=false to turn off). Live web trends need a paid Gemini plan (AI_WEB_SEARCH=true).',
          'Choose Live below. Each person gets at most one automatic brief per day; “Refresh” regenerates on request.',
        ]
      : [
          'Create an API key at platform.claude.com (Settings → API keys) and add billing. Or use the free Gemini option: set AI_PROVIDER=gemini.',
          'Set ANTHROPIC_API_KEY in the server environment. Optional: AI_MODEL (default claude-sonnet-5-5) and AI_WEB_SEARCH=true to let the brief look up current trends on the web (extra cost per search).',
          'Choose Live below. Each person gets at most one automatic brief per day; “Refresh” regenerates on request.',
          'What is sent: your tasks, lead and campaign figures, Instagram numbers, calendar event titles and email senders/subjects (never email bodies).',
        ];
  },
  checkConfig() {
    const missing = this.requiredEnv().filter((k) => !env(k));
    return { ok: missing.length === 0, missing };
  },
};

/** Replaces personal names in the facts with neutral placeholders (used for Gemini's free tier). */
export function anonymiseFacts(facts: Record<string, unknown>): Record<string, unknown> {
  const f = structuredClone(facts) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (Array.isArray(f.leads?.waitingForMe))
    f.leads.waitingForMe = f.leads.waitingForMe.map((l: Record<string, unknown>, i: number) => ({
      ...l,
      name: `Lead ${i + 1}`,
    }));
  if (f.email && typeof f.email === 'object') {
    if (Array.isArray(f.email.recent))
      f.email.recent = f.email.recent.map((m: Record<string, unknown>) => ({ subject: m.subject }));
    if (Array.isArray(f.email.linkedinMessages))
      f.email.linkedinMessages = `${f.email.linkedinMessages.length} LinkedIn message alert(s)`;
  }
  if (f.person) f.person = {};
  return f;
}

export type BriefContent = {
  summary: string;
  priorities: string[];
  strategies: Array<{ title: string; why: string; action: string }>;
  social: string[];
  trends: string[];
  /** What a supplied (real) platform/news headline means for the team. Never a new claim of news. */
  implications?: Array<{ headline: string; action: string }>;
};

const SYSTEM = `You write a short morning brief for the co-founder/CMO of Sahynex, a brand, growth and technology studio in Mangaluru, India that runs admissions marketing (Meta, Google, social, websites) for educational institutions, mainly Indian engineering and technology colleges.

Rules:
- Use ONLY the facts in the JSON you are given (and web search results if you have them). Never invent numbers, names, events, rankings, placements or news. If something is missing, say it is not available.
- Be specific and practical: reference the actual tasks, leads, campaigns and Instagram posts in the facts.
- "priorities": the 3 most important things to do today, from the facts.
- "strategies": 3 actionable marketing or business ideas (awareness, consideration, conversion, lead generation, creative). They are suggestions, not facts.
- "social": up to 3 observations from the Instagram facts only.
- "implications": for up to 3 items in industryHeadlines, copy the headline EXACTLY and give one practical action for the team. Never mention a platform change that is not in industryHeadlines.
- "trends": leave as an empty array unless you have web search results; never present general knowledge as current news.
- Keep it short: summary ≤ 3 sentences.

Return ONLY a JSON object with this shape and no other text:
{"summary": string, "priorities": string[], "strategies": [{"title": string, "why": string, "action": string}], "social": string[], "implications": [{"headline": string, "action": string}], "trends": string[]}`;

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
  const implications = Array.isArray(raw.implications)
    ? raw.implications
        .filter(
          (x): x is { headline: string; action: string } =>
            !!x && typeof x.headline === 'string' && typeof x.action === 'string' && !!x.action.trim(),
        )
        .slice(0, 3)
        .map((x) => ({ headline: x.headline.trim(), action: x.action.trim() }))
    : [];
  return {
    summary: raw.summary.trim(),
    priorities: strs(raw.priorities, 3),
    strategies,
    social: strs(raw.social, 3),
    trends: strs(raw.trends, 3),
    implications,
  };
}

/** Drops any "implication" whose headline is not one of the real headlines we supplied. */
export function keepRealHeadlines(content: BriefContent, facts: Record<string, unknown>): BriefContent {
  const supplied = Array.isArray(facts.industryHeadlines)
    ? (facts.industryHeadlines as Array<{ title?: unknown }>).map((h) => String(h.title ?? '').toLowerCase())
    : [];
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[“”"']/g, '')
      .trim();
  return {
    ...content,
    implications: (content.implications ?? []).filter((i) =>
      supplied.some((t) => norm(t) === norm(i.headline) || norm(t).startsWith(norm(i.headline).slice(0, 40))),
    ),
  };
}

export async function generateBriefWithAI(
  facts: Record<string, unknown>,
): Promise<{ content: BriefContent; model: string }> {
  const model = aiAdapter.model();
  if (aiProvider() === 'gemini') {
    const sent = env('AI_ANONYMISE') === 'false' ? facts : anonymiseFacts(facts);
    return { content: keepRealHeadlines(parseBrief(await callGemini(model, sent)), facts), model };
  }
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
  return { content: keepRealHeadlines(parseBrief(text), facts), model };
}

async function callGemini(model: string, facts: Record<string, unknown>): Promise<string> {
  if (!/^[\w.-]{3,80}$/.test(model)) throw new PermanentError('AI_MODEL is not a valid Gemini model name.');
  const search = env('AI_WEB_SEARCH') === 'true';
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Facts for today (JSON):\n${JSON.stringify(facts)}` }] }],
    // JSON mode can't be combined with the search tool, so only request it without search.
    generationConfig: { maxOutputTokens: 4096, ...(search ? {} : { responseMimeType: 'application/json' }) },
  };
  if (search) body.tools = [{ google_search: {} }];
  const res = (await apiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    },
  )) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (res.promptFeedback?.blockReason)
    throw new PermanentError(`Gemini blocked the request (${res.promptFeedback.blockReason}).`);
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('\n');
  if (!text)
    throw new PermanentError(`Gemini returned no text (${res.candidates?.[0]?.finishReason ?? 'unknown'}).`);
  return text;
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

/**
 * General-purpose JSON-returning completion on the configured provider (no web search). Used by
 * features other than the daily brief, e.g. the Creative Studio. Callers validate the output.
 */
export async function aiJSONText(
  system: string,
  prompt: string,
  opts: { maxTokens?: number } = {},
): Promise<{ text: string; model: string }> {
  const model = aiAdapter.model();
  const maxTokens = opts.maxTokens ?? 3000;
  if (aiProvider() === 'gemini') {
    if (!/^[\w.-]{3,80}$/.test(model)) throw new PermanentError('AI_MODEL is not a valid Gemini model name.');
    const res = (await apiFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: Math.max(maxTokens, 4096),
            responseMimeType: 'application/json',
          },
        }),
        timeoutMs: 90_000,
      },
    )) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    if (res.promptFeedback?.blockReason)
      throw new PermanentError(`Gemini blocked the request (${res.promptFeedback.blockReason}).`);
    const text = (res.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('\n');
    if (!text) throw new PermanentError('The AI returned an empty answer. Try again.');
    return { text, model };
  }
  const res = (await apiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    timeoutMs: 90_000,
  })) as { content?: Array<{ type: string; text?: string }> };
  const text = (res.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
  if (!text) throw new PermanentError('The AI returned an empty answer. Try again.');
  return { text, model };
}

/** Pulls the first JSON object out of a model reply. */
export function extractJSON(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new PermanentError('The AI response was not in the expected format. Try again.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PermanentError('The AI response was not in the expected format. Try again.');
  }
}
