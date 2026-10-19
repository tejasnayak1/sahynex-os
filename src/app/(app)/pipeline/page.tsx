import Link from 'next/link';
import { InlineSelect } from '@/components/client/auto-submit';
import {
  Badge,
  EmptyState,
  FilterBar,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  SortTh,
  StatusBadge,
  Table,
  Td,
  Th,
  cn,
} from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatMoney, relativeTime } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import {
  DEAL_STAGE_LABEL,
  DEAL_STAGES,
  listDeals,
  OPEN_DEAL_STAGES,
  pipelineBoard,
} from '@/server/services/deals';
import { getOrg } from '@/server/services/org';
import { dealStageAction } from '../deals/actions';
import { FilterForm } from '@/components/client/filter-form';

export const metadata = { title: 'Sales pipeline' };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('deals.read.all', 'deals.read.own');
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const team = await teamOptions(actor.orgId);
  const staleDays = org.parsedSettings.sales.staleDealDays;
  const view = sp.view === 'list' ? 'list' : 'board';
  const header = (
    <PageHeader
      title="Sales pipeline"
      description="New prospect → qualified → discovery → proposal → negotiation → won or lost."
      actions={
        <>
          <div className="flex rounded-md border border-line-strong p-0.5" role="group" aria-label="View">
            <Link
              href={`/pipeline${sp.ownerId ? `?ownerId=${sp.ownerId}` : ''}`}
              aria-current={view === 'board' ? 'page' : undefined}
              className={cn(
                'rounded px-2.5 py-1 text-[13px]',
                view === 'board' ? 'bg-surface-2 font-medium' : 'text-muted',
              )}
            >
              Board
            </Link>
            <Link
              href={`/pipeline?view=list${sp.ownerId ? `&ownerId=${sp.ownerId}` : ''}`}
              aria-current={view === 'list' ? 'page' : undefined}
              className={cn(
                'rounded px-2.5 py-1 text-[13px]',
                view === 'list' ? 'bg-surface-2 font-medium' : 'text-muted',
              )}
            >
              List
            </Link>
          </div>
          {can(actor, 'deals.write') ? (
            <LinkButton href="/deals/new" variant="primary">
              New deal
            </LinkButton>
          ) : null}
        </>
      }
    />
  );

  if (view === 'list') {
    const p = paging(sp, { sort: 'updatedAt' });
    const res = await listDeals(actor, { ...p, stage: sp.stage, ownerId: sp.ownerId });
    return (
      <>
        {header}
        <FilterBar action="/pipeline" q={sp.q} reset={Object.keys(sp).length > 1}>
          <input type="hidden" name="view" value="list" />
          <Select
            name="stage"
            ariaLabel="Stage"
            defaultValue={sp.stage}
            placeholder="Any stage"
            options={DEAL_STAGES.map((s) => ({ value: s, label: DEAL_STAGE_LABEL[s] }))}
            className="w-48"
          />
          <Select
            name="ownerId"
            ariaLabel="Owner"
            defaultValue={sp.ownerId}
            placeholder="Any owner"
            options={team.map((t) => ({ value: t.id, label: t.name }))}
            className="w-48"
          />
        </FilterBar>
        {res.rows.length ? (
          <Table>
            <thead>
              <tr>
                <SortTh label="Deal" field="title" params={sp} base="/pipeline" />
                <Th>Stage</Th>
                <SortTh label="Value" field="value" params={sp} base="/pipeline" align="right" />
                <Th align="right">Weighted</Th>
                <Th>Owner</Th>
                <SortTh label="Expected close" field="close" params={sp} base="/pipeline" />
                <SortTh label="Updated" field="updatedAt" params={sp} base="/pipeline" />
              </tr>
            </thead>
            <tbody>
              {res.rows.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/deals/${d.id}`} className="font-medium text-ink hover:underline">
                      {d.title}
                    </Link>
                    <div className="text-[12.5px] text-muted">
                      {d.ref} · {d.prospectName}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={d.stage} label={DEAL_STAGE_LABEL[d.stage]} />
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(d.valueMinor, org.currency)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {['won', 'lost'].includes(d.stage)
                      ? '—'
                      : formatMoney(Math.round((d.valueMinor * d.probability) / 100), org.currency)}
                  </Td>
                  <Td>{d.ownerName}</Td>
                  <Td>{formatDate(d.expectedCloseDate)}</Td>
                  <Td className="text-muted">{relativeTime(d.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No deals match" body="Clear the filters or create a deal." />
        )}
        <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/pipeline" params={sp} />
      </>
    );
  }

  const deals = await pipelineBoard(actor, sp.ownerId);
  const cols = [...OPEN_DEAL_STAGES, 'won', 'lost'] as const;
  const canWrite = can(actor, 'deals.write');
  const totalWeighted = deals
    .filter((d) => !['won', 'lost'].includes(d.stage))
    .reduce((a, d) => a + (d.valueMinor * d.probability) / 100, 0);
  return (
    <>
      {header}
      <FilterForm action="/pipeline" className="mb-3 flex flex-wrap items-center gap-2" label="Filter board">
        <Select
          name="ownerId"
          ariaLabel="Owner"
          defaultValue={sp.ownerId}
          placeholder="Everyone’s deals"
          options={team.map((t) => ({ value: t.id, label: t.name }))}
          className="w-56"
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-line-strong bg-surface px-3 text-[14px] font-medium"
        >
          Apply
        </button>
        <span className="ml-auto text-[13px] text-muted">
          Weighted open pipeline{' '}
          <span className="font-semibold text-ink tabular">{formatMoney(totalWeighted, org.currency)}</span>
        </span>
      </FilterForm>
      <div className="-mx-3 overflow-x-auto px-3 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-3">
          {cols.map((stage) => {
            const items = deals.filter((d) => d.stage === stage);
            const value = items.reduce((a, d) => a + d.valueMinor, 0);
            return (
              <section
                key={stage}
                aria-label={DEAL_STAGE_LABEL[stage]}
                className="flex w-[272px] flex-col rounded-lg border border-line bg-surface-2"
              >
                <header className="border-b border-line px-3 py-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[13.5px] font-semibold">{DEAL_STAGE_LABEL[stage]}</h2>
                    <span className="text-[12.5px] text-muted tabular">{items.length}</span>
                  </div>
                  <p className="text-[12.5px] text-muted tabular">
                    {formatMoney(value, org.currency, { compact: true })}
                    {stage === 'won' || stage === 'lost' ? ' · last 90 days' : ''}
                  </p>
                </header>
                <ul className="flex flex-1 flex-col gap-2 p-2">
                  {items.length === 0 ? (
                    <li className="px-1 py-3 text-[12.5px] text-faint">No deals</li>
                  ) : null}
                  {items.map((d) => {
                    const stale =
                      !['won', 'lost'].includes(d.stage) &&
                      d.lastInteractionAt &&
                      Date.now() - d.lastInteractionAt.getTime() > staleDays * 86400000;
                    return (
                      <li key={d.id} className="rounded-md border border-line bg-surface p-2.5">
                        <Link
                          href={`/deals/${d.id}`}
                          className="block font-medium leading-snug text-ink hover:underline"
                        >
                          {d.title}
                        </Link>
                        <p className="mt-0.5 truncate text-[12.5px] text-muted">{d.prospectName}</p>
                        <div className="mt-2 flex items-center justify-between text-[12.5px]">
                          <span className="font-semibold tabular">
                            {formatMoney(d.valueMinor, org.currency, { compact: true })}
                          </span>
                          <span className="text-muted">{d.ownerName?.split(' ')[0]}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                          {d.expectedCloseDate && !['won', 'lost'].includes(d.stage) ? (
                            <span>Close {formatDate(d.expectedCloseDate)}</span>
                          ) : null}
                          {stale ? <Badge tone="warn">No contact {staleDays}d+</Badge> : null}
                          {d.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                        </div>
                        {canWrite && !['won', 'lost'].includes(d.stage) ? (
                          <div className="mt-2">
                            <InlineSelect
                              action={dealStageAction}
                              name="stage"
                              value={d.stage}
                              label={`Move ${d.title}`}
                              hidden={{ id: d.id }}
                              className="h-7 w-full text-[12.5px]"
                              options={OPEN_DEAL_STAGES.map((s) => ({
                                value: s,
                                label: `Stage: ${DEAL_STAGE_LABEL[s]}`,
                              }))}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <p className="text-[12.5px] text-muted">
        Mark deals won or lost from the deal page, where the value, discount approval and lost reason are
        checked.
      </p>
    </>
  );
}
