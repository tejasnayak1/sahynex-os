/**
 * Marketing news and platform updates from public RSS/Atom feeds.
 *
 * These are verified, attributable items (publisher, date and link come straight from the feed),
 * kept separate from anything AI-written. Default feeds were checked to be live RSS 2.0 on
 * 20 Oct 2026. Add more (for example an education-news feed) with MARKET_NEWS_FEEDS:
 *   MARKET_NEWS_FEEDS="education|The Source Name|https://example.com/feed; news|Other|https://…"
 * Set MARKET_NEWS=off to disable fetching entirely.
 */

export type NewsCategory = 'news' | 'platform' | 'education';
export type Feed = { url: string; source: string; category: NewsCategory };
export type NewsItem = {
  title: string;
  link: string;
  source: string;
  category: NewsCategory;
  published: string | null; // ISO
  summary: string | null;
};

export const DEFAULT_FEEDS: Feed[] = [
  { url: 'https://searchengineland.com/feed', source: 'Search Engine Land', category: 'news' },
  {
    url: 'https://blog.google/products/ads-commerce/rss/',
    source: 'Google Ads & Commerce Blog',
    category: 'news',
  },
  { url: 'https://www.socialmediatoday.com/feeds/news/', source: 'Social Media Today', category: 'platform' },
  { url: 'https://about.fb.com/feed/', source: 'Meta Newsroom', category: 'platform' },
  { url: 'https://blog.youtube/rss/', source: 'YouTube Official Blog', category: 'platform' },
];

export function configuredFeeds(): Feed[] {
  const extra = (process.env.MARKET_NEWS_FEEDS ?? '')
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s): Feed[] => {
      const [category, source, url] = s.split('|').map((x) => x?.trim());
      if (!url || !/^https:\/\//.test(url)) return [];
      const cat = (['news', 'platform', 'education'] as const).find((c) => c === category) ?? 'news';
      return [{ url, source: source || new URL(url).host, category: cat }];
    });
  return [...DEFAULT_FEEDS, ...extra];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
};

/** Parses RSS 2.0 <item> or Atom <entry> elements. Tolerant of CDATA and HTML in descriptions. */
export function parseFeed(xml: string, feed: Feed, limit = 8): NewsItem[] {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const b of blocks.slice(0, limit)) {
    const title = decodeText(tag(b, 'title') ?? '');
    let link = decodeText(tag(b, 'link') ?? '');
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '';
    if (!title || !/^https?:\/\//.test(link)) continue;
    const dateRaw = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date');
    const d = dateRaw ? new Date(decodeText(dateRaw)) : null;
    const desc = tag(b, 'description') ?? tag(b, 'summary');
    const summary = desc ? decodeText(desc).slice(0, 240) : null;
    out.push({
      title: title.slice(0, 220),
      link,
      source: feed.source,
      category: feed.category,
      published: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      summary: summary || null,
    });
  }
  return out;
}

type Cache = { at: number; items: NewsItem[]; failed: string[] };
let cache: Cache | null = null;
const TTL_MS = 3 * 3600_000;
const EMPTY_TTL_MS = 10 * 60_000; // after a total outage, wait a little before trying again

/** Fetches all feeds (in parallel, each with a short timeout); cached for a few hours per process. */
export async function fetchMarketNews(opts: { force?: boolean } = {}): Promise<Cache & { enabled: boolean }> {
  if ((process.env.MARKET_NEWS ?? '').toLowerCase() === 'off')
    return { enabled: false, at: 0, items: [], failed: [] };
  // Testing hook: a local JSON file of NewsItem[] instead of the network (used by end-to-end tests).
  if (process.env.MARKET_NEWS_FIXTURE) {
    const { readFile } = await import('node:fs/promises');
    const items = JSON.parse(await readFile(process.env.MARKET_NEWS_FIXTURE, 'utf8')) as NewsItem[];
    return { enabled: true, at: Date.now(), items, failed: [] };
  }
  if (!opts.force && cache && Date.now() - cache.at < (cache.items.length ? TTL_MS : EMPTY_TTL_MS))
    return { enabled: true, ...cache };
  const feeds = configuredFeeds();
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(f.url, {
          signal: ctrl.signal,
          headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        });
        if (!res.ok) throw new Error(String(res.status));
        return parseFeed(await res.text(), f);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const items: NewsItem[] = [];
  const failed: string[] = [];
  results.forEach((r, i) =>
    r.status === 'fulfilled' ? items.push(...r.value) : failed.push(feeds[i].source),
  );
  const seen = new Set<string>();
  const unique = items
    .filter((x) => (seen.has(x.link) ? false : (seen.add(x.link), true)))
    .sort((a, b) => Date.parse(b.published ?? '0') - Date.parse(a.published ?? '0'));
  // Keep the previous good result through a temporary outage.
  const next: Cache =
    unique.length || !cache?.items.length
      ? { at: Date.now(), items: unique, failed }
      : { items: cache.items, failed, at: Date.now() - TTL_MS + EMPTY_TTL_MS }; // retry in ~10 min
  cache = next;
  return { enabled: true, ...next };
}

/** Test helper. */
export function _resetNewsCache() {
  cache = null;
}
