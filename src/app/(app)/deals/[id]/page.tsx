import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import {
  Badge,
  DescList,
  LinkButton,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';
import { db, schema } from '@/db';
import { formatDate, formatDateTime, formatMoney, humanize, relativeTime } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { DEAL_STAGE_LABEL, discountPending, getDeal, handoverMissing } from '@/server/services/deals';
import { getOrg } from '@/server/services/org';
import { listTemplates } from '@/server/services/projects';
import { MeetingsPanel } from '../../_shared/meetings-panel';
import {
  ApproveDiscount,
  CloseDeal,
  DecideHandover,
  EditDeal,
  HandoverForm,
  NewProposal,
  ProposalActions,
} from './panels';

export const metadata = { title: 'Deal' };

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('deals.read.all', 'deals.read.own');
  const { id } = await params;
  const sp = await readParams(searchParams);
  const { deal, ownerName, clientName, leadRef, proposals, history, handover } = await getDeal(actor, id);
  const org = await getOrg(db, actor.orgId);
  const [team, templates, tasks] = await Promise.all([
    teamOptions(actor.orgId),
    listTemplates(actor.orgId),
    db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.dealId, id), eq(schema.tasks.orgId, actor.orgId)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(30),
  ]);
  const canWrite = can(actor, 'deals.write');
  const closed = deal.stage === 'won' || deal.stage === 'lost';
  const tab = sp.tab ?? (deal.stage === 'won' && handover?.status !== 'approved' ? 'handover' : 'overview');
  const D = { ...deal };
  const pendingDiscount = discountPending(deal, org.parsedSettings.sales.discountApprovalAbovePct);
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Sales pipeline', href: '/pipeline' }, { label: deal.ref }]}
        title={deal.title}
        meta={
          <>
            <StatusBadge status={deal.stage} label={DEAL_STAGE_LABEL[deal.stage]} />
            <span className="font-medium text-ink tabular">{formatMoney(deal.valueMinor, org.currency)}</span>
            {!closed ? (
              <span className="tabular">
                {deal.probability}% · weighted{' '}
                {formatMoney(Math.round((deal.valueMinor * deal.probability) / 100), org.currency)}
              </span>
            ) : null}
            <span>Owner {ownerName}</span>
            {deal.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
        actions={
          canWrite ? (
            <>
              {!closed ? <CloseDeal id={deal.id} /> : null}
              <EditDeal deal={D} team={team} closed={closed} />
            </>
          ) : null
        }
      />
      {pendingDiscount ? (
        <div className="mb-4">
          <Notice tone="warn" title={`Discount of ${deal.discountPct}% needs approval`}>
            Discounts above {org.parsedSettings.sales.discountApprovalAbovePct}% require a director’s approval
            before the deal can be won.
            {can(actor, 'deals.approve_commercials') ? (
              <div className="mt-2">
                <ApproveDiscount id={deal.id} />
              </div>
            ) : null}
          </Notice>
        </div>
      ) : null}
      <Tabs
        base={`/deals/${id}`}
        current={tab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'proposals', label: 'Proposals', count: proposals.length },
          ...(deal.stage === 'won' ? [{ key: 'handover', label: 'Handover' }] : []),
          { key: 'history', label: 'History' },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Deal">
            <DescList
              items={[
                ['Prospect', `${deal.prospectName} (${humanize(deal.prospectOrgType)})`],
                [
                  'Client record',
                  clientName ? (
                    <Link className="hover:underline" href={`/clients/${deal.clientId}`}>
                      {clientName}
                    </Link>
                  ) : (
                    'Not yet a client'
                  ),
                ],
                [
                  'Primary contact',
                  [deal.contactName, deal.contactEmail, deal.contactPhone].filter(Boolean).join(' · ') || '—',
                ],
                ['Services', deal.services.join(', ') || '—'],
                ['Expected close', formatDate(deal.expectedCloseDate)],
                ['Last interaction', deal.lastInteractionAt ? relativeTime(deal.lastInteractionAt) : '—'],
                [
                  'Next action',
                  deal.nextAction
                    ? `${deal.nextAction}${deal.nextActionAt ? ` · ${formatDateTime(deal.nextActionAt)}` : ''}`
                    : '—',
                ],
                [
                  'Discount',
                  deal.discountPct
                    ? `${deal.discountPct}%${deal.discountApprovedAt ? ' (approved)' : ''}`
                    : '—',
                ],
                [
                  'Contract',
                  deal.contractStart
                    ? `${formatDate(deal.contractStart)} → ${formatDate(deal.contractEnd)}`
                    : '—',
                ],
                ['Renewal', formatDate(deal.renewalDate)],
                [
                  'Source lead',
                  leadRef ? (
                    <Link className="hover:underline" href={`/leads/${deal.leadId}`}>
                      {leadRef}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
                ...(deal.lostReason ? ([['Lost reason', deal.lostReason]] as Array<[string, string]>) : []),
              ]}
            />
          </Panel>
          <MeetingsPanel
            actor={actor}
            dealId={deal.id}
            canWrite={canWrite}
            defaultAttendees={deal.contactEmail}
            dealStage={deal.stage}
          />
          <Panel
            title="Tasks"
            bodyClassName="p-0"
            actions={
              canWrite ? (
                <LinkButton size="sm" href={`/tasks/new?dealId=${deal.id}`}>
                  Add task
                </LinkButton>
              ) : null
            }
          >
            {tasks.length ? (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/tasks/${t.id}`} className="min-w-0 truncate hover:underline">
                      {t.title}
                    </Link>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">
                No tasks. Stage changes create discovery and proposal tasks automatically.
              </p>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === 'proposals' ? (
        <Panel
          title="Proposal versions"
          bodyClassName="p-0"
          actions={canWrite && !closed ? <NewProposal dealId={deal.id} valueMinor={deal.valueMinor} /> : null}
        >
          {proposals.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Version</Th>
                  <Th>Title</Th>
                  <Th align="right">Value</Th>
                  <Th>Status</Th>
                  <Th>Sent</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <Td className="tabular">v{p.version}</Td>
                    <Td>
                      {p.documentUrl ? (
                        <a
                          href={p.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          {p.title}
                        </a>
                      ) : (
                        p.title
                      )}
                    </Td>
                    <Td align="right" className="tabular">
                      {formatMoney(p.valueMinor, org.currency)}
                    </Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td>{p.sentAt ? formatDate(p.sentAt) : '—'}</Td>
                    <Td>{canWrite ? <ProposalActions id={p.id} status={p.status} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="p-4 text-muted">
              No proposals yet. Draft one, then mark it sent to start follow-up reminders.
            </p>
          )}
        </Panel>
      ) : null}

      {tab === 'handover' && deal.stage === 'won' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Sales → operations handover">
            {handover?.status === 'approved' ? (
              <Notice tone="ok" title="Approved">
                Commercials approved {handover.decidedAt ? formatDateTime(handover.decidedAt) : ''}.{' '}
                {handover.projectId ? (
                  <Link className="font-medium underline" href={`/projects/${handover.projectId}`}>
                    Open the project
                  </Link>
                ) : (
                  'The project is being created.'
                )}
              </Notice>
            ) : canWrite ? (
              <>
                {handover?.status === 'rejected' ? (
                  <div className="mb-3">
                    <Notice tone="bad" title="Sent back for changes">
                      {handover.decisionNote}
                    </Notice>
                  </div>
                ) : null}
                {handover?.status === 'submitted' ? (
                  <div className="mb-3">
                    <Notice tone="info" title="Awaiting approval">
                      Edits will return it to draft.
                    </Notice>
                  </div>
                ) : null}
                <HandoverForm
                  dealId={deal.id}
                  h={handover}
                  team={team}
                  templates={templates.map((t) => ({ key: t.key, name: t.name }))}
                  title={deal.title}
                />
              </>
            ) : (
              <p className="text-muted">Handover in progress.</p>
            )}
          </Panel>
          <Panel title="Readiness">
            <ul className="space-y-1.5 text-[13.5px]">
              {[
                'Scope',
                'Deliverables',
                'Project owner',
                'Target start date',
                'Target end date',
                'Budget',
              ].map((k) => {
                const missing = handoverMissing(handover ?? {}).includes(k);
                return (
                  <li key={k} className="flex items-center gap-2">
                    <span aria-hidden className={missing ? 'text-faint' : 'text-ok'}>
                      {missing ? '○' : '●'}
                    </span>
                    {k}
                    <span className="sr-only">{missing ? ' missing' : ' recorded'}</span>
                  </li>
                );
              })}
            </ul>
            {handover?.status === 'submitted' && can(actor, 'deals.approve_commercials') ? (
              <div className="mt-4 border-t border-line pt-4">
                <DecideHandover dealId={deal.id} />
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {tab === 'history' ? (
        <Panel title="Stage history" bodyClassName="p-0">
          <ol className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  {h.fromStage ? `${DEAL_STAGE_LABEL[h.fromStage]} → ` : 'Created in '}
                  <span className="font-medium">{DEAL_STAGE_LABEL[h.toStage]}</span>
                  {h.note ? <span className="text-muted"> — {h.note}</span> : null}
                </span>
                <span className="shrink-0 text-[12.5px] text-muted">
                  {h.actorName ?? 'System'} · {formatDateTime(h.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </>
  );
}
