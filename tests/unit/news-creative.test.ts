import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepRealHeadlines, parseBrief } from '@/server/integrations/ai';
import {
  _resetNewsCache,
  configuredFeeds,
  decodeText,
  fetchMarketNews,
  parseFeed,
} from '@/server/integrations/news-feeds';
import { parseReview, sampleReview } from '@/server/services/creative';

const feed = { url: 'https://example.com/feed', source: 'Example', category: 'platform' as const };

describe('RSS / Atom parsing', () => {
  it('reads RSS items with CDATA, entities, HTML descriptions and dates', () => {
    const xml = `<rss><channel><title>x</title>
      <item><title><![CDATA[YouTube tests new Shorts incentives]]></title><link>https://example.com/a</link>
        <description>&lt;p&gt;Creators &amp;amp; brands&lt;/p&gt;</description><pubDate>Mon, 19 Oct 2026 18:37:45 -0400</pubDate></item>
      <item><title>Meta&#8217;s update</title><link>https://example.com/b</link></item>
      <item><title>No link</title></item>
    </channel></rss>`;
    const items = parseFeed(xml, feed);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'YouTube tests new Shorts incentives',
      link: 'https://example.com/a',
      source: 'Example',
      category: 'platform',
      published: '2026-10-19T22:37:45.000Z',
    });
    expect(items[1].title).toBe('Meta’s update');
    expect(items[1].published).toBeNull();
  });

  it('reads Atom entries', () => {
    const xml = `<feed><entry><title>Atom post</title><link href="https://example.com/c"/><updated>2026-10-18T10:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, feed)[0]).toMatchObject({ title: 'Atom post', link: 'https://example.com/c' });
  });

  it('decodes text safely', () => {
    expect(decodeText('<b>A</b> &amp; B &#x2014; C')).toBe('A & B — C');
  });

  it('accepts extra feeds from the environment, https only', () => {
    process.env.MARKET_NEWS_FEEDS =
      'education|Edu News|https://edu.example.com/rss; news|Bad|http://insecure.example.com';
    const feeds = configuredFeeds();
    expect(feeds.some((f) => f.source === 'Edu News' && f.category === 'education')).toBe(true);
    expect(feeds.some((f) => f.url.startsWith('http://'))).toBe(false);
    delete process.env.MARKET_NEWS_FEEDS;
  });
});

describe('fetchMarketNews', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetNewsCache();
    process.env.MARKET_NEWS = 'off';
  });

  it('merges feeds newest first, survives a failing source and caches the result', async () => {
    process.env.MARKET_NEWS = 'on';
    const f = vi.fn(async (url: string) => {
      if (url.includes('socialmediatoday')) return new Response('boom', { status: 500 });
      const day = url.includes('youtube') ? '20' : '18';
      return new Response(
        `<rss><item><title>From ${new URL(url).host}</title><link>${url}#1</link><pubDate>${day} Oct 2026 10:00:00 GMT</pubDate></item></rss>`,
      );
    });
    vi.stubGlobal('fetch', f);
    const r = await fetchMarketNews();
    expect(r.failed).toEqual(['Social Media Today']);
    expect(r.items.length).toBe(4);
    expect(r.items[0].title).toContain('blog.youtube');
    await fetchMarketNews();
    expect(f).toHaveBeenCalledTimes(5); // second call served from cache
  });

  it('can be switched off', async () => {
    process.env.MARKET_NEWS = 'off';
    expect((await fetchMarketNews()).enabled).toBe(false);
  });
});

describe('AI brief implications', () => {
  it('keeps only implications that refer to headlines we actually supplied', () => {
    const content = parseBrief(
      JSON.stringify({
        summary: 'Day.',
        priorities: [],
        strategies: [],
        social: [],
        trends: [],
        implications: [
          { headline: 'YouTube tests new Shorts incentives', action: 'Plan two Shorts this week.' },
          { headline: 'Instagram removes hashtags entirely', action: 'Invented — must be dropped.' },
        ],
      }),
    );
    const kept = keepRealHeadlines(content, {
      industryHeadlines: [{ title: 'YouTube tests new Shorts incentives', source: 'SMT' }],
    });
    expect(kept.implications).toEqual([
      { headline: 'YouTube tests new Shorts incentives', action: 'Plan two Shorts this week.' },
    ]);
  });
});

describe('Creative Studio output', () => {
  it('validates and trims the model output, keeping at most three concepts', () => {
    const r = parseReview({
      strengths: ['a', 'b', 'c', 'd', 'e'],
      gaps: ['g'],
      recommendedDirection: 'Go student-led.',
      concepts: [1, 2, 3, 4].map((i) => ({ name: `C${i}`, coreMessage: 'm', hook: 'h', cta: 'x' })),
      copy: { hashtags: ['Admissions 2027', '#BTech'], hooks: ['h1'] },
    });
    expect(r.strengths).toHaveLength(4);
    expect(r.concepts).toHaveLength(3);
    expect(r.copy.hashtags).toEqual(['#Admissions2027', '#BTech']);
    expect(() => parseReview({})).toThrow();
  });

  it('sample review points at empty template fields and missing audience, and invents nothing', () => {
    const r = sampleReview({
      projectId: '00000000-0000-0000-0000-000000000000',
      format: 'reel',
      brief: 'Hook (first 3s):\nStory beats:\nCTA:',
    });
    expect(r.gaps.join(' ')).toMatch(/Hook \(first 3s\)/);
    expect(r.gaps.join(' ')).toMatch(/audience/i);
    expect(r.concepts).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/\d+%|\bplacement(s)? of\b/i);
  });
});

describe('Google sign-in token checks', () => {
  const tok = (p: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y`;
  it('accepts only a verified email for our client, from Google, not expired', async () => {
    const { verifiedEmailFromIdToken } = await import('@/server/integrations/google-user');
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
    const ok = {
      aud: 'cid',
      iss: 'https://accounts.google.com',
      exp: Date.now() / 1000 + 60,
      email: 'A@B.com',
      email_verified: true,
    };
    expect(verifiedEmailFromIdToken(tok(ok))).toBe('a@b.com');
    expect(verifiedEmailFromIdToken(tok({ ...ok, aud: 'other' }))).toBeNull();
    expect(verifiedEmailFromIdToken(tok({ ...ok, iss: 'evil.com' }))).toBeNull();
    expect(verifiedEmailFromIdToken(tok({ ...ok, exp: 1 }))).toBeNull();
    expect(verifiedEmailFromIdToken(tok({ ...ok, email_verified: false }))).toBeNull();
    expect(verifiedEmailFromIdToken('garbage')).toBeNull();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  });
});

describe('Creative review v2 fields', () => {
  it('parses score (clamped), checklist and per-concept caption, hashtags and highlights', () => {
    const r = parseReview({
      score: 14,
      checklist: [{ ok: true, text: 'Clear audience' }, { ok: 'false', text: 'Add a hook' }, { text: '' }],
      recommendedDirection: 'x',
      concepts: [
        {
          name: 'A',
          coreMessage: 'm',
          caption: 'cap',
          hashtags: ['BCA'],
          highlights: ['One', 'Two', 'Three', 'Four'],
        },
      ],
    });
    expect(r.score).toBe(10);
    expect(r.checklist).toEqual([
      { ok: true, text: 'Clear audience' },
      { ok: false, text: 'Add a hook' },
    ]);
    expect(r.concepts[0]).toMatchObject({ caption: 'cap', hashtags: ['#BCA'] });
    expect(r.concepts[0].highlights).toHaveLength(3);
    expect(parseReview({ recommendedDirection: 'x', score: 'n/a' }).score).toBeNull();
  });
});
