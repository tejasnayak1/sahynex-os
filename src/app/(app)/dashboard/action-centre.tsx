import Link from 'next/link';
import { formatDateTime, formatMoney, relativeTime } from '@/lib/format';
import type { actionCentre } from '@/server/services/dashboard';
import { cn } from '@/components/ui';

type Data = Awaited<ReturnType<typeof actionCentre>>;
type Item = {
  key: string;
  severity: 3 | 2 | 1;
  title: string;
  context: string;
  href: string;
  when?: Date | null;
};

const RAIL = { 3: 'bg-bad', 2: 'bg-warn', 1: 'bg-line-strong' } as const;
const LABEL = { 3: 'Needs a decision', 2: 'Overdue', 1: 'Coming up' } as const;

/** Ranked queue of what needs attention, across every module the viewer can see. */
export function ActionCentre({ data, currency }: { data: Data; currency: string }) {
  const items: Item[] = [
    ...data.handoverQueue.map((h) => ({
      key: `h${h.dealId}`,
      severity: 3 as const,
      title: `Approve handover: ${h.projectName}`,
      context: 'Won deal waiting for commercial approval before delivery can start',
      href: `/deals/${h.dealId}?tab=handover`,
      when: h.submittedAt,
    })),
    ...data.openIncidents.map((i) => ({
      key: `i${i.id}`,
      severity: 3 as const,
      title: i.title,
      context: `Incident ${i.status}`,
      href: `/campaigns/monitoring?incident=${i.id}`,
      when: i.openedAt,
    })),
    ...data.failures.map((f) => ({
      key: `f${f.key}`,
      severity: 3 as const,
      title: `Automation failing: ${f.name}`,
      context: `${f.n} failed run(s) in 7 days — inspect and retry`,
      href: `/automation/${f.key}`,
      when: f.last,
    })),
    ...data.uncontacted.map((l) => ({
      key: `l${l.id}`,
      severity: 2 as const,
      title: `First contact overdue: ${l.name}`,
      context: `${l.ref} · ${l.ownerName ?? 'Unassigned'} · past the ${data.slaHours}h SLA`,
      href: `/leads/${l.id}`,
      when: l.createdAt,
    })),
    ...data.overdueTasks.map((t) => ({
      key: `t${t.id}`,
      severity: 2 as const,
      title: t.title,
      context: `Task overdue · ${t.ownerName ?? 'Unassigned'}`,
      href: `/tasks/${t.id}`,
      when: t.dueAt,
    })),
    ...data.pendingApprovals.map((a) => ({
      key: `a${a.id}`,
      severity: 2 as const,
      title: `Review ${a.title}`,
      context: `${a.stage === 'client' ? 'Client' : 'Internal'} review pending`,
      href: `/content/${a.deliverableId}`,
      when: a.submittedAt,
    })),
    ...data.staleDeals.map((d) => ({
      key: `d${d.id}`,
      severity: 1 as const,
      title: `Stale deal: ${d.title}`,
      context: `${formatMoney(d.valueMinor, currency, { compact: true })} · ${d.ownerName ?? ''} · no recent interaction`,
      href: `/deals/${d.id}`,
      when: d.lastInteractionAt,
    })),
    ...data.upcoming.map((t) => ({
      key: `u${t.id}`,
      severity: 1 as const,
      title: t.title,
      context: `Due ${formatDateTime(t.dueAt)} · ${t.ownerName ?? 'Unassigned'}`,
      href: `/tasks/${t.id}`,
      when: t.dueAt,
    })),
  ].sort((a, b) => b.severity - a.severity);
  if (!items.length)
    return (
      <p className="px-4 py-6 text-muted">
        Nothing needs attention right now. New escalations, overdue work and pending decisions will appear
        here.
      </p>
    );
  const shown = items.slice(0, 14);
  return (
    <ol className="divide-y divide-line">
      {shown.map((i, idx) => {
        const header = idx === 0 || shown[idx - 1].severity !== i.severity;
        return (
          <li key={i.key}>
            {header ? (
              <p className="bg-surface-2 px-4 py-1.5 text-[12.5px] font-medium text-muted">
                {LABEL[i.severity]}
              </p>
            ) : null}
            <Link href={i.href} className="group flex items-stretch gap-3 px-4 py-2.5 hover:bg-surface-2">
              <span aria-hidden className={cn('w-[3px] shrink-0 rounded-full', RAIL[i.severity])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink group-hover:underline">{i.title}</span>
                <span className="block truncate text-[12.5px] text-muted">{i.context}</span>
              </span>
              <span className="shrink-0 self-center text-[12.5px] text-faint tabular">
                {relativeTime(i.when)}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
