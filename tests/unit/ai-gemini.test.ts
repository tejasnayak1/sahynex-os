import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiAdapter, aiProvider, anonymiseFacts, generateBriefWithAI } from '@/server/integrations/ai';

const KEYS = [
  'AI_PROVIDER',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AI_MODEL',
  'AI_WEB_SEARCH',
  'AI_ANONYMISE',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});
const setEnv = (e: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, e);
};

const facts = {
  person: { firstName: 'Tejas' },
  leads: { waitingForMe: [{ name: 'Asha Rao', stage: 'new' }] },
  email: {
    unread: 3,
    recent: [{ from: 'Principal SCEM', subject: 'Brochure' }],
    linkedinMessages: ['Rahul sent you a message'],
  },
};

describe('AI provider selection', () => {
  it('picks Gemini when only a Gemini key is set, and honours AI_PROVIDER', () => {
    setEnv({ GEMINI_API_KEY: 'g' });
    expect(aiProvider()).toBe('gemini');
    expect(aiAdapter.model()).toBe('gemini-flash-lite-latest');
    expect(aiAdapter.checkConfig().ok).toBe(true);
    setEnv({ AI_PROVIDER: 'gemini' });
    expect(aiAdapter.checkConfig().missing).toEqual(['GEMINI_API_KEY']);
    setEnv({ ANTHROPIC_API_KEY: 'a' });
    expect(aiProvider()).toBe('anthropic');
  });
});

describe('Gemini brief', () => {
  it('anonymises names, calls generateContent in JSON mode and parses the brief', async () => {
    setEnv({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' });
    const brief = {
      summary: 'Two things today.',
      priorities: ['Call Lead 1'],
      strategies: [],
      social: [],
      trends: [],
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(brief) }] } },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await generateBriefWithAI(facts);
    expect(r.model).toBe('gemini-flash-lite-latest');
    expect(r.content.summary).toBe('Two things today.');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const sent = JSON.stringify(JSON.parse(String(init.body)));
    expect(sent).toContain('application/json');
    for (const name of ['Asha Rao', 'Principal SCEM', 'Rahul', 'Tejas']) expect(sent).not.toContain(name);
  });

  it('anonymiseFacts leaves the original untouched', () => {
    const out = anonymiseFacts(facts) as typeof facts & { email: { linkedinMessages: string } };
    expect(out.leads.waitingForMe[0].name).toBe('Lead 1');
    expect(out.email.linkedinMessages).toBe('1 LinkedIn message alert(s)');
    expect(facts.leads.waitingForMe[0].name).toBe('Asha Rao');
  });
});
