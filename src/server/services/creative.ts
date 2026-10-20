/**
 * AI Creative Studio: critiques a deliverable brief and proposes creative directions BEFORE a
 * deliverable exists. It never creates, submits, approves, schedules or publishes anything —
 * the person copies what they want into the form and creates the deliverable themselves.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { actorUserId, assertCan, type Actor } from '../actor';
import { projectScope } from '../access';
import { audit } from '../audit';
import { forbidden, invalid, precondition } from '../errors';
import { aiAdapter, aiJSONText, extractJSON } from '../integrations/ai';
import { rateLimit } from '../rate-limit';
import { optStr, parse, reqStr } from '../validation';
import { DELIVERABLE_FORMATS, FORMAT_LABEL } from './deliverables';

const { projects, clients, integrationConnections } = schema;

export type Concept = {
  name: string;
  rationale: string;
  coreMessage: string;
  hook: string;
  angle: string;
  visualDirection: string;
  cta: string;
  /** Concept-specific caption and hashtags. */
  caption: string;
  hashtags: string[];
  /** 2–3 short benefit lines for the layout preview (placeholders where proof is needed). */
  highlights: string[];
};
export type CreativeReview = {
  /** AI's overall rating of the brief, 0–10 (one decimal). An opinion, not a measurement. */
  score: number | null;
  /** Short checklist: ok=true for what's working, false for what to improve. */
  checklist: Array<{ ok: boolean; text: string }>;
  strengths: string[];
  gaps: string[];
  audienceFit: string;
  formatFit: string;
  objectiveFit: string;
  opportunities: string[];
  recommendedDirection: string;
  concepts: Concept[];
  copy: {
    hooks: string[];
    caption: string;
    ctas: string[];
    hashtags: string[];
    structure: string[];
    visualNotes: string[];
  };
};

const inputSchema = z.object({
  projectId: z.string().uuid('Choose a project first'),
  format: z.enum(DELIVERABLE_FORMATS).default('social_post'),
  title: optStr(300),
  channel: optStr(100),
  audience: optStr(300),
  objective: optStr(200),
  brief: reqStr(8000),
  variation: z
    .preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['short_caption', 'student_life', 'placement_focus', 'carousel', 'reel_script']).optional(),
    )
    .optional(),
});

export const VARIATIONS = {
  short_caption: 'Short caption',
  student_life: 'Student life focus',
  placement_focus: 'Placement focused',
  carousel: 'Carousel idea',
  reel_script: 'Reel script',
} as const;
const VARIATION_PROMPT: Record<keyof typeof VARIATIONS, string> = {
  short_caption: 'Keep every caption under 25 words.',
  student_life: 'Lean every concept towards everyday student life, campus culture and peers.',
  placement_focus:
    'Lean towards careers and placements, but use placeholders like [confirm placement figure] — never numbers.',
  carousel: 'Shape every concept as an Instagram carousel: describe slides 1–6 in the structure.',
  reel_script: 'Shape every concept as a 20–30 second reel: give a beat-by-beat script in the structure.',
};

const SYSTEM = `You are a senior creative strategist at Sahynex, a brand, growth and technology studio in Mangaluru, India. Most clients are Indian engineering and technology colleges running admissions marketing; others are companies and organisations.

Critique the creative brief you are given and help the team make the content stronger before production.

Hard rules:
- Use only the facts in the brief and context. NEVER invent institutional facts, placement figures, rankings, accreditations, statistics, testimonials, awards or guarantees. Where a claim would need proof, write a placeholder like [confirm placement figure] instead of a number.
- Be concrete and specific to the format and channel. No generic advice.
- The three concepts must be genuinely different strategic angles, not rewrites of one headline.
- Recommendations must suit the selected format (e.g. a reel needs a 3-second hook and beats; a poster needs a headline, hierarchy and mandatory elements; a landing page needs sections and a form).
- Respect consent: never suggest using a student's name, face or quote without permission.

Return ONLY a JSON object with exactly this shape:
{"score": number, "checklist": [{"ok": boolean, "text": string}],
 "strengths": string[], "gaps": string[], "audienceFit": string, "formatFit": string, "objectiveFit": string, "opportunities": string[], "recommendedDirection": string,
 "concepts": [{"name": string, "rationale": string, "coreMessage": string, "hook": string, "angle": string, "visualDirection": string, "cta": string, "caption": string, "hashtags": string[], "highlights": string[]}],
 "copy": {"hooks": string[], "caption": string, "ctas": string[], "hashtags": string[], "structure": string[], "visualNotes": string[]}}
"score" is your 0–10 rating of how ready the brief is (one decimal). "checklist" has 3–5 short lines: ok=true for what is already strong, ok=false for what to improve. "highlights" are 2–3 short benefit lines (max 5 words each) for a layout preview.
Limits: up to 4 strengths, 5 gaps, 4 opportunities, exactly 3 concepts, 5 hooks, 4 CTAs, 10 hashtags (without spaces), 8 structure steps, 5 visual notes. Each string under 300 characters; caption under 1200 characters.`;

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, n: number, max = 300) =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, max))
        .filter(Boolean)
        .slice(0, n)
    : [];

/** Validates and trims the model's output into the shape the UI expects. */
export function parseReview(raw: unknown): CreativeReview {
  const r = (raw ?? {}) as Record<string, unknown>;
  const c = (r.copy ?? {}) as Record<string, unknown>;
  const concepts = Array.isArray(r.concepts)
    ? r.concepts
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            name: str(o.name, 80),
            rationale: str(o.rationale),
            coreMessage: str(o.coreMessage),
            hook: str(o.hook),
            angle: str(o.angle),
            visualDirection: str(o.visualDirection),
            cta: str(o.cta, 160),
            caption: str(o.caption, 1200),
            hashtags: strs(o.hashtags, 10, 60).map((h) =>
              (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, ''),
            ),
            highlights: strs(o.highlights, 3, 60),
          };
        })
        .filter((x) => x.name && x.coreMessage)
        .slice(0, 3)
    : [];
  const rawScore = typeof r.score === 'number' ? r.score : Number(r.score);
  const checklist = Array.isArray(r.checklist)
    ? r.checklist
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return { ok: o.ok === true || o.ok === 'true', text: str(o.text, 200) };
        })
        .filter((x) => x.text)
        .slice(0, 5)
    : [];
  const review: CreativeReview = {
    score: Number.isFinite(rawScore) ? Math.round(Math.min(10, Math.max(0, rawScore)) * 10) / 10 : null,
    checklist,
    strengths: strs(r.strengths, 4),
    gaps: strs(r.gaps, 5),
    audienceFit: str(r.audienceFit),
    formatFit: str(r.formatFit),
    objectiveFit: str(r.objectiveFit),
    opportunities: strs(r.opportunities, 4),
    recommendedDirection: str(r.recommendedDirection, 600),
    concepts,
    copy: {
      hooks: strs(c.hooks, 5),
      caption: str(c.caption, 1200),
      ctas: strs(c.ctas, 4, 160),
      hashtags: strs(c.hashtags, 10, 60).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')),
      structure: strs(c.structure, 8),
      visualNotes: strs(c.visualNotes, 5),
    },
  };
  if (!review.recommendedDirection && !review.concepts.length && !review.gaps.length)
    throw invalid('The AI response was empty. Try again.');
  return review;
}

/**
 * Sample-mode review: rule-based checks on the brief itself — clearly labelled, not AI. Useful when
 * the AI assistant is in Demo mode, and as a preview of the workflow.
 */
export function sampleReview(i: z.infer<typeof inputSchema>): CreativeReview {
  const b = i.brief;
  const lines = b.split('\n').map((l) => l.trim());
  const emptyFields = lines.filter((l) => /:\s*$/.test(l)).map((l) => l.replace(/:\s*$/, ''));
  const has = (re: RegExp) => re.test(b);
  const gaps = [
    ...emptyFields.slice(0, 3).map((f) => `“${f}” is still empty in the brief.`),
    !i.audience ? 'No audience is set — say who this is for (e.g. Class 12 PCM students and parents).' : '',
    !has(/cta|call to action|apply|register|enquire|book/i) ? 'No clear call to action.' : '',
    !i.channel ? 'No channel chosen, so format and length can’t be checked.' : '',
  ].filter(Boolean);
  const strengths = [
    b.length > 120 ? 'The brief has enough detail to start from.' : '',
    i.audience ? `Audience is defined: ${i.audience}.` : '',
    has(/deadline|date|by \d/i) ? 'Timing is mentioned.' : '',
  ].filter(Boolean);
  return {
    score: null,
    checklist: [
      ...strengths.slice(0, 2).map((t) => ({ ok: true, text: t })),
      ...gaps.slice(0, 3).map((t) => ({ ok: false, text: t })),
    ],
    strengths: [
      b.length > 120 ? 'The brief has enough detail to start from.' : '',
      i.audience ? `Audience is defined: ${i.audience}.` : '',
      has(/deadline|date|by \d/i) ? 'Timing is mentioned.' : '',
    ].filter(Boolean),
    gaps: gaps.slice(0, 5),
    audienceFit: i.audience
      ? 'Sample mode can’t judge tone — connect the AI assistant for a real audience check.'
      : 'Add an audience to check fit.',
    formatFit: `${FORMAT_LABEL[i.format]}${i.channel ? ` on ${i.channel}` : ''}: sample mode checks completeness only.`,
    objectiveFit: has(/objective|goal|aim/i)
      ? 'An objective is stated.'
      : 'State one objective (awareness, enquiries, applications) so the message can be judged against it.',
    opportunities: ['Lead with one specific proof point the client can confirm, rather than a list.'],
    recommendedDirection:
      'Fill the gaps above, then run the evaluation again with the AI assistant connected.',
    concepts: [],
    copy: { hooks: [], caption: '', ctas: [], hashtags: [], structure: [], visualNotes: [] },
  };
}

export async function evaluateBrief(
  actor: Actor,
  raw: Record<string, unknown>,
): Promise<{ review: CreativeReview; demo: boolean; model: string }> {
  assertCan(actor, 'content.write');
  const userId = actorUserId(actor);
  if (!userId) throw forbidden();
  const input = parse(inputSchema, raw);

  // The project must be one this person can see; only business context is sent, never contacts.
  const [p] = await db
    .select({
      name: projects.name,
      clientName: clients.name,
      orgType: clients.orgType,
      services: clients.services,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, input.projectId), projectScope(actor)));
  if (!p) throw invalid('Unknown project.', { projectId: 'Unknown project' });

  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(eq(integrationConnections.orgId, actor.orgId), eq(integrationConnections.provider, 'ai_assistant')),
    );
  if (!conn || conn.mode === 'disconnected')
    throw precondition('The AI assistant isn’t connected. You can still create the deliverable manually.');
  if (conn.mode === 'live' && !aiAdapter.checkConfig().ok)
    throw precondition(
      `The AI assistant needs ${aiAdapter.checkConfig().missing.join(', ')}. You can still continue manually.`,
    );

  await rateLimit(`ai-creative:${userId}`, 30, 24 * 3600);

  if (conn.mode === 'demo')
    return { review: sampleReview(input), demo: true, model: 'sample (rule-based, not AI)' };

  const context = {
    client: p.clientName,
    clientType: p.orgType,
    servicesEngaged: p.services,
    project: p.name,
    format: FORMAT_LABEL[input.format],
    channel: input.channel ?? 'not specified',
    audience: input.audience ?? 'not specified',
    workingTitle: input.title ?? 'not specified',
    campaignObjective: input.objective ?? 'not specified',
  };
  const { text, model } = await aiJSONText(
    SYSTEM,
    `Context (JSON):\n${JSON.stringify(context)}\n\nBrief:\n"""\n${input.brief}\n"""${input.variation ? `\n\nVariation requested: ${VARIATION_PROMPT[input.variation]}` : ''}`,
    { maxTokens: 3500 },
  );
  const review = parseReview(extractJSON(text));
  await audit(db, actor, 'ai.creative_review', 'project', input.projectId, {
    after: { format: input.format, model },
  });
  return { review, demo: false, model };
}
