import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  FileText,
  Instagram,
  Lightbulb,
  Mail,
  Newspaper,
  Phone,
  SquareCheckBig,
  Sun,
} from 'lucide-react';
import { ActionButton } from '@/components/client/auto-submit';
import { cn } from '@/components/ui';
import { fetchMarketNews, type NewsItem } from '@/server/integrations/news-feeds';
import type { BriefBlock } from '@/server/services/briefing';
import { generateBriefAction } from './actions';

export type Alert = { tone: 'bad' | 'warn' | 'info' | 'muted'; text: string; href: string };

/* ----------------------------------------------------------- shared bits */

/** Marks content written by AI (or by rules in sample mode) so it is never mistaken for fact. */
export function SourceTag({ kind }: { kind: 'ai' | 'sample' | 'feed' }) {
  const map = {
    ai: ['AI suggestion', 'bg-demo-soft text-demo'],
    sample: ['Sample · written by rules', 'bg-demo-soft text-demo'],
    feed: ['From publisher feeds', 'bg-info-soft text-info'],
  } as const;
  const [label, cls] = map[kind];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap', cls)}>
      {label}
    </span>
  );
}

/* -------------------------------------------------- Marketing intelligence */

function ago(iso: string | null, tz: string) {
  if (!iso) return 'Date not given';
  const d = new Date(iso);
  const hours = (Date.now() - d.getTime()) / 3_600_000;
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: tz }).format(d);
}

export function NewsList({
  items,
  tz,
  implications,
  empty,
}: {
  items: NewsItem[];
  tz: string;
  implications?: Array<{ headline: string; action: string }>;
  empty: string;
}) {
  if (!items.length) return <p className="py-2 text-[13.5px] text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((n) => {
        const t = n.title.toLowerCase();
        const meaning = implications?.find((i) => {
          const h = i.headline.toLowerCase().replace(/[“”"']/g, '');
          return t.replace(/[“”"']/g, '') === h || t.startsWith(h.slice(0, 40));
        })?.action;
        return (
          <li key={n.link} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <a href={n.link} target="_blank" rel="noopener noreferrer" className="group block">
              <span className="block text-[14px] leading-snug font-medium group-hover:underline">
                {n.title}
              </span>
              <span className="mt-1 block text-[12px] text-muted">
                {n.source} · <time dateTime={n.published ?? undefined}>{ago(n.published, tz)}</time>
              </span>
            </a>
            {meaning ? (
              <div className="mt-2 flex gap-2 rounded-lg bg-demo-soft/60 px-3 py-2 text-[13px] leading-snug">
                <span className="shrink-0 font-semibold text-demo">What it means (AI)</span>
                <span className="text-ink-2">{meaning}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------- Home: the two "paper" cards */

// These two cards are deliberately light in both themes so they read as the day's front page.
const PAPER_INK = 'text-[#10292d]';

type Stat = {
  icon: 'calendar' | 'tasks' | 'mail' | 'phone';
  value: string;
  label: string;
  sub: string;
  href: string;
};
const STAT_ICON = {
  calendar: <CalendarDays size={26} strokeWidth={1.7} className="text-[#2f6fd6]" aria-hidden />,
  tasks: <SquareCheckBig size={26} strokeWidth={1.7} className="text-[#1c9a6a]" aria-hidden />,
  mail: <Mail size={26} strokeWidth={1.7} className="text-[#2f6fd6]" aria-hidden />,
  phone: <Phone size={26} strokeWidth={1.7} className="text-[#1f9a9f]" aria-hidden />,
};

export function DailyBriefingCard({
  brief,
  dateLabel,
  summary,
  stats,
  alerts,
  t,
}: {
  brief: BriefBlock;
  dateLabel: string;
  summary: string;
  stats: Stat[];
  alerts: Alert[];
  t: (d: string | Date | null) => string;
}) {
  const ready = brief.state === 'ready';
  return (
    <section
      aria-labelledby="daily-briefing"
      className={cn(
        'rounded-3xl bg-[linear-gradient(135deg,#e2f6f3_0%,#c9ecea_100%)] p-5 shadow-[0_1px_0_rgb(255_255_255/0.4)_inset] sm:p-6',
        PAPER_INK,
      )}
    >
      <header className="flex flex-wrap items-start gap-4">
        <Sun size={36} strokeWidth={1.6} className="mt-0.5 text-[#1f9a9f]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="daily-briefing" className="text-[24px] leading-tight font-semibold tracking-[-0.01em]">
            Your daily briefing
          </h2>
          <p className="mt-1 text-[15.5px] text-[#3c5a5e]">Here’s what needs your attention today.</p>
        </div>
        <span className="rounded-lg bg-white/70 px-3 py-1.5 text-[13.5px] font-medium text-[#24474b]">
          {dateLabel}
        </span>
      </header>

      <div className="mt-5 rounded-2xl bg-white/90 p-5 shadow-[0_8px_24px_rgb(16_41_45/0.06)]">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#e3f4f2] text-[#1f7e83]">
            <FileText size={26} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-semibold">Today’s summary</h3>
              {ready ? (
                <span className="rounded-full bg-[#efe8ff] px-2 py-0.5 text-[11.5px] font-medium text-[#6a4bc4]">
                  {brief.demo ? 'Sample · written by rules' : `AI · ${t(brief.createdAt).toLowerCase()}`}
                </span>
              ) : null}
              <span className="ml-auto">
                {ready ? (
                  <ActionButton
                    action={generateBriefAction}
                    hidden={{ force: '1' }}
                    variant="ghost"
                    successMessage="Brief refreshed"
                  >
                    <span className="text-[#1f7e83]">Refresh</span>
                  </ActionButton>
                ) : brief.state === 'empty' ? (
                  <ActionButton
                    action={generateBriefAction}
                    variant="ghost"
                    successMessage="Your brief is ready"
                  >
                    <span className="text-[#1f7e83]">Write today’s brief</span>
                  </ActionButton>
                ) : brief.canConfigure ? (
                  <Link
                    href="/settings/integrations"
                    className="text-[13px] font-medium text-[#1f7e83] hover:underline"
                  >
                    Connect AI
                  </Link>
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-[15px] leading-relaxed text-[#34504f]">{summary}</p>
          </div>
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-y-4 border-t border-[#10292d]/10 pt-5 md:grid-cols-4">
          {stats.map((s, i) => (
            <li
              key={s.label}
              className={cn('border-[#10292d]/10 px-3', i % 2 === 1 && 'border-l', i >= 2 && 'md:border-l')}
            >
              <a href={s.href} className="flex gap-3 hover:opacity-80">
                {STAT_ICON[s.icon]}
                <div className="min-w-0">
                  <span className="block text-[24px] leading-none font-semibold tabular">{s.value}</span>
                  <span className="mt-1.5 block text-[14.5px] font-medium">{s.label}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-[#55706f]">{s.sub}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>

        {(ready && brief.content.priorities.length) || alerts.length ? (
          <details className="group mt-4 border-t border-[#10292d]/10 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-medium text-[#1f7e83] [&::-webkit-details-marker]:hidden">
              <ArrowRight size={15} className="transition-transform group-open:rotate-90" aria-hidden />
              Priorities &amp; follow-ups
              <span className="text-[#55706f]">
                ({(ready ? brief.content.priorities.length : 0) + alerts.length})
              </span>
            </summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {ready && brief.content.priorities.length ? (
                <ol className="space-y-2 text-[14px]">
                  {brief.content.priorities.map((p, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1f9a9f] text-[11px] font-semibold text-white">
                        {i + 1}
                      </span>
                      {p}
                    </li>
                  ))}
                </ol>
              ) : null}
              {alerts.length ? (
                <ul className="space-y-1.5 text-[14px]">
                  {alerts.map((a) => (
                    <li key={a.text}>
                      <Link href={a.href} className="flex items-center gap-2 hover:underline">
                        <span
                          aria-hidden
                          className={cn('h-2 w-2 shrink-0 rounded-full', PAPER_DOT[a.tone])}
                        />
                        {a.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

const PAPER_DOT: Record<Alert['tone'], string> = {
  bad: 'bg-[#d6453d]',
  warn: 'bg-[#c98a12]',
  info: 'bg-[#2f6fd6]',
  muted: 'bg-[#8aa0a3]',
};

function shortDate(iso: string | null | Date, tz: string) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz,
  }).format(new Date(iso));
}

export async function IntelCard({ brief, tz }: { brief: BriefBlock; tz: string }) {
  const feed = await fetchMarketNews().catch(() => ({
    enabled: true,
    items: [] as NewsItem[],
    failed: ['all'],
    at: 0,
  }));
  const news = feed.items.find((n) => n.category !== 'platform') ?? null;
  const platform = feed.items.find((n) => n.category === 'platform') ?? null;
  const content = brief.state === 'ready' ? brief.content : null;
  const ideas = content?.strategies ?? [];
  const rows = [
    {
      key: 'news',
      icon: <Newspaper size={26} strokeWidth={1.6} aria-hidden />,
      tile: 'bg-[#e4e6fb] text-[#4b52c4]',
      title: 'Latest marketing news',
      line: news
        ? news.title
        : feed.enabled
          ? 'News feeds didn’t respond just now.'
          : 'News feeds are turned off.',
      date: news ? shortDate(news.published, tz) : '',
      source: news?.source,
    },
    {
      key: 'ideas',
      icon: <Lightbulb size={26} strokeWidth={1.6} aria-hidden />,
      tile: 'bg-[#fbf0d4] text-[#b17d0c]',
      title: 'Strategy ideas for you',
      line: ideas.length
        ? `${ideas.length} idea${ideas.length === 1 ? '' : 's'} — ${ideas[0].title}${brief.state === 'ready' && brief.demo ? ' (sample)' : ' (AI)'}`
        : brief.state === 'off'
          ? 'Connect the AI assistant to get ideas.'
          : 'Write today’s brief to get fresh ideas.',
      date: brief.state === 'ready' ? shortDate(brief.createdAt, tz) : '',
    },
    {
      key: 'platform',
      icon: <Instagram size={26} strokeWidth={1.6} aria-hidden />,
      tile: 'bg-[#f6e1f3] text-[#b0368f]',
      title: 'Social media algorithm updates',
      line: platform ? platform.title : 'No platform updates in the feeds right now.',
      date: platform ? shortDate(platform.published, tz) : '',
      source: platform?.source,
    },
  ];
  return (
    <section
      aria-labelledby="marketing-intel"
      className={cn('rounded-3xl bg-[linear-gradient(135deg,#edf6f8_0%,#dcecf1_100%)] p-5 sm:p-6', PAPER_INK)}
    >
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/70 text-[#1f9a9f]">
          <BarChart3 size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="marketing-intel" className="text-[24px] leading-tight font-semibold tracking-[-0.01em]">
            Marketing intelligence
          </h2>
          <p className="mt-1 text-[15.5px] text-[#3c5a5e]">
            Latest updates, ideas and algorithm changes for you.
          </p>
        </div>
        <Link
          href="/home/insights"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#10292d] px-4 text-[14px] font-medium text-white hover:bg-[#18383d]"
        >
          View all insights <ArrowRight size={16} aria-hidden />
        </Link>
      </header>
      <ul className="mt-5 space-y-2.5">
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              href={`/home/insights#${r.key}`}
              className="flex items-center gap-4 rounded-2xl bg-white/90 px-4 py-3.5 shadow-[0_6px_18px_rgb(16_41_45/0.05)] transition-colors hover:bg-white"
            >
              <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-xl', r.tile)}>
                {r.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{r.title}</span>
                <span className="mt-0.5 block truncate text-[14px] text-[#45605f]">{r.line}</span>
              </span>
              {r.date ? (
                <span className="hidden shrink-0 text-[13.5px] text-[#55706f] sm:block">{r.date}</span>
              ) : null}
              <ArrowRight size={18} className="shrink-0 text-[#55706f]" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-[#55706f]">
        News and platform updates link to their publishers; ideas are AI suggestions.
      </p>
    </section>
  );
}

export function IntelCardSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading marketing intelligence"
      className="rounded-3xl bg-[#e6f1f4] p-6"
    >
      <div className="h-7 w-64 animate-pulse rounded bg-white/70" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-4 h-20 animate-pulse rounded-2xl bg-white/70" />
      ))}
    </section>
  );
}
