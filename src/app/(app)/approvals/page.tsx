import Link from 'next/link';
import { desc, eq, and } from 'drizzle-orm';
import { EmptyState, PageHeader, Panel, StatusBadge, Table, Td, Th } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDateTime, relativeTime } from '@/lib/format';
import { requirePagePermission } from '@/server/auth/current';
import { approvalQueue, FORMAT_LABEL } from '@/server/services/deliverables';

export const metadata = { title: 'Approvals & revisions' };

export default async function ApprovalsPage() {
  const actor = await requirePagePermission('approvals.internal', 'approvals.client');
  const queue = await approvalQueue(actor);
  const revisions = actor.clientId
    ? []
    : await db
        .select({
          r: schema.revisions,
          title: schema.deliverables.title,
          deliverableId: schema.deliverables.id,
        })
        .from(schema.revisions)
        .innerJoin(schema.deliverables, eq(schema.deliverables.id, schema.revisions.deliverableId))
        .where(and(eq(schema.revisions.orgId, actor.orgId)))
        .orderBy(desc(schema.revisions.createdAt))
        .limit(20);
  return (
    <>
      <PageHeader
        title="Approvals & revisions"
        description={
          actor.clientId
            ? 'Creative waiting for your decision.'
            : 'Every pending review you can decide, oldest first. Decisions are versioned and audited.'
        }
      />
      {queue.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Deliverable</Th>
              <Th>Client</Th>
              <Th>Stage</Th>
              <Th align="right">Version</Th>
              <Th>Waiting</Th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.ap.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/content/${q.deliverableId}`} className="font-medium text-ink hover:underline">
                    {q.title}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {q.ref} · {FORMAT_LABEL[q.format]}
                  </div>
                </Td>
                <Td>{q.clientName}</Td>
                <Td>
                  <StatusBadge
                    status={q.ap.stage === 'client' ? 'submitted_to_client' : 'internal_review'}
                    label={q.ap.stage === 'client' ? 'Client review' : 'Internal review'}
                  />
                </Td>
                <Td align="right" className="tabular">
                  v{q.ap.version}
                </Td>
                <Td title={formatDateTime(q.ap.submittedAt)}>
                  {relativeTime(q.ap.submittedAt)}
                  {q.ap.remindersSent ? ` · ${q.ap.remindersSent} reminder(s)` : ''}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No approvals waiting on you"
          body="New submissions appear here and in your notifications."
        />
      )}
      {revisions.length ? (
        <Panel title="Recent revision requests" className="mt-5" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {revisions.map(({ r, title, deliverableId }) => (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link className="font-medium hover:underline" href={`/content/${deliverableId}`}>
                    {title}
                  </Link>
                  <span className="text-[12.5px] text-muted">
                    v{r.fromVersion} → {r.toVersion ? `v${r.toVersion}` : 'pending'} ·{' '}
                    {relativeTime(r.createdAt)}
                  </span>
                </div>
                {r.feedback ? <p className="text-[13px] text-ink-2">“{r.feedback}”</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
