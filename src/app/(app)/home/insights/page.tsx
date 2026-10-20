import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Instagram, Lightbulb, Newspaper } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { db } from '@/db';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { fetchMarketNews } from '@/server/integrations/news-feeds';
import { briefBlock } from '@/server/services/briefing';
import { getOrg } from '@/server/services/org';
import { NewsList, SourceTag } from '../briefing-sections';

export const metadata = { title: 'Marketing insights' };

function Section({
  id,
  icon,
  title,
  tag,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  tag: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-accent">{icon}</span>
        <h2 className="text-[18px] font-semibold">{title}</h2>
        {tag}
      </header>
      {children}
    </section>
  );
}

export default async function InsightsPage() {
  const actor = await requireActor();
  if (actor.clientId || !(can(actor, 'campaigns.read') || can(actor, 'dashboard.executive')))
    redirect('/home');
  const org = await getOrg(db, actor.orgId);
  const [feed, brief] = await Promise.all([
    fetchMarketNews().catch(() => ({ enabled: true, items: [], failed: ['all'], at: 0 })),
    briefBlock(actor),
  ]);
  const news = feed.items.filter((n) => n.category !== 'platform').slice(0, 15);
  const platform = feed.items.filter((n) => n.category === 'platform').slice(0, 15);
  const content = brief.state === 'ready' ? brief.content : null;
  const empty = !feed.enabled
    ? 'News feeds are turned off on this server.'
    : 'Couldn’t reach the news feeds just now. They’ll be retried shortly.';
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        crumbs={[{ label: 'Home', href: '/home' }, { label: 'Marketing insights' }]}
        title="Marketing intelligence"
        description="News and platform updates from publishers’ feeds, plus AI ideas built from your own data."
      />
      <Section
        id="news"
        icon={<Newspaper size={22} />}
        title="Latest marketing news"
        tag={<SourceTag kind="feed" />}
      >
        <NewsList
          items={news}
          tz={org.timezone}
          empty={feed.items.length ? 'No marketing news right now.' : empty}
        />
      </Section>
      <Section
        id="ideas"
        icon={<Lightbulb size={22} />}
        title="Strategy ideas for you"
        tag={<SourceTag kind={brief.state === 'ready' && brief.demo ? 'sample' : 'ai'} />}
      >
        {content ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {content.strategies.map((s, i) => (
              <li key={i} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <p className="text-[15px] font-semibold">{s.title}</p>
                <p className="mt-1 text-[13.5px] text-muted">{s.why}</p>
                <p className="mt-2 text-[14px]">
                  <span className="font-medium text-accent">Try: </span>
                  {s.action}
                </p>
              </li>
            ))}
            {content.social.map((s, i) => (
              <li key={`s${i}`} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                <p className="text-[12.5px] font-medium text-muted">From your Instagram</p>
                <p className="mt-1 text-[14px]">{s}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Ideas appear after today’s brief is written on{' '}
            <Link href="/home" className="text-accent underline underline-offset-4">
              Home
            </Link>
            .
          </p>
        )}
        <p className="mt-3 text-[12.5px] text-faint">Suggestions, not facts — check before acting.</p>
      </Section>
      <Section
        id="platform"
        icon={<Instagram size={22} />}
        title="Social media algorithm & platform updates"
        tag={<SourceTag kind="feed" />}
      >
        <NewsList
          items={platform}
          tz={org.timezone}
          implications={content?.implications ?? []}
          empty={feed.items.length ? 'No platform updates right now.' : empty}
        />
      </Section>
    </div>
  );
}
