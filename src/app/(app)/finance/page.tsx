import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import {
  Badge,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  Stat,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatMoney, formatPercent, humanize } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { campaignOptions } from '@/server/services/campaigns';
import { clientOptions, upcomingRenewals } from '@/server/services/clients';
import {
  campaignBudgetVsActual,
  financeSummary,
  listBudgets,
  listExpenses,
  listInvoices,
  projectProfitability,
} from '@/server/services/finance';
import { getOrg } from '@/server/services/org';
import { projectOptions } from '@/server/services/projects';
import { approveBudgetAction } from './actions';
import { InvoiceStatus, NewBudget, NewExpense, NewInvoice } from './forms';

export const metadata = { title: 'Finance & commercials' };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('finance.read');
  const sp = await readParams(searchParams);
  const tab = sp.tab ?? 'overview';
  const org = await getOrg(db, actor.orgId);
  const cur = org.currency;
  const write = can(actor, 'finance.write');
  const [clients, projects, campaigns] = await Promise.all([
    clientOptions(actor),
    projectOptions(actor),
    campaignOptions(actor),
  ]);
  const header = (
    <>
      <PageHeader
        title="Finance & commercials"
        description="Agency revenue, costs, budgets and renewals. Media spend billed at cost is kept separate from agency revenue. This module records money; it never moves it."
      />
      <Tabs
        base="/finance"
        current={tab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'profitability', label: 'Profitability' },
          { key: 'invoices', label: 'Invoices' },
          { key: 'expenses', label: 'Expenses' },
          { key: 'budgets', label: 'Budgets' },
        ]}
      />
    </>
  );
  if (tab === 'profitability') {
    const rows = await projectProfitability(actor);
    return (
      <>
        {header}
        <Notice tone="info" title="Gross margin = invoiced agency fees − direct costs − allocated labour">
          Labour is allocated from logged time × each person’s hourly cost. Rows marked “Estimate” are missing
          inputs — read the caveats before relying on them.
        </Notice>
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>Project</Th>
              <Th align="right">Contract</Th>
              <Th align="right">Invoiced fees</Th>
              <Th align="right">Direct costs</Th>
              <Th align="right">Labour</Th>
              <Th align="right">Gross margin</Th>
              <Th>Confidence</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link className="font-medium text-ink hover:underline" href={`/projects/${r.id}`}>
                    {r.name}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {r.clientName} · {humanize(r.status)}
                  </div>
                </Td>
                <Td align="right" className="tabular">
                  {formatMoney(r.contractMinor, cur)}
                </Td>
                <Td align="right" className="tabular">
                  {formatMoney(r.invoicedMinor, cur)}
                </Td>
                <Td align="right" className="tabular">
                  {formatMoney(r.expenseMinor, cur)}
                  {r.passThroughMinor ? (
                    <div className="text-[12px] text-muted">
                      +{formatMoney(r.passThroughMinor, cur)} pass-through
                    </div>
                  ) : null}
                </Td>
                <Td align="right" className="tabular">
                  {formatMoney(r.labourMinor, cur)}
                  <div className="text-[12px] text-muted">{(r.minutesLogged / 60).toFixed(0)} h</div>
                </Td>
                <Td align="right" className="tabular font-medium">
                  {r.grossMarginMinor == null
                    ? 'Unavailable'
                    : `${formatMoney(r.grossMarginMinor, cur)} (${formatPercent(r.grossMarginPct, 0)})`}
                </Td>
                <Td>
                  {r.isEstimate ? (
                    <span title={r.caveats.join('; ')}>
                      <Badge tone="warn">Estimate</Badge>
                      <div className="mt-0.5 max-w-[220px] text-[12px] text-muted">
                        {r.caveats.join('; ')}
                      </div>
                    </span>
                  ) : (
                    <Badge tone="ok">Complete inputs</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </>
    );
  }
  if (tab === 'invoices') {
    const rows = await listInvoices(actor);
    return (
      <>
        {header}
        <div className="mb-3 flex justify-end">
          {write ? <NewInvoice clients={clients} projects={projects} /> : null}
        </div>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Client / project</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th align="right">Fee</Th>
                <Th align="right">Total incl. tax & pass-through</Th>
                <Th align="right">Received</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, clientName, projectName }) => (
                <tr key={i.id}>
                  <Td className="font-medium text-ink">
                    {i.number}
                    {i.isDemo ? (
                      <>
                        {' '}
                        <Badge tone="demo">Demo</Badge>
                      </>
                    ) : null}
                  </Td>
                  <Td>
                    {clientName}
                    <div className="text-[12.5px] text-muted">{projectName ?? ''}</div>
                  </Td>
                  <Td>{formatDate(i.issueDate)}</Td>
                  <Td>{formatDate(i.dueDate)}</Td>
                  <Td align="right" className="tabular">
                    {formatMoney(i.amountMinor, cur)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(i.amountMinor + i.taxMinor + i.passThroughMinor, cur)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(i.paidMinor, cur)}
                  </Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                  <Td>
                    {write && i.status !== 'void' ? <InvoiceStatus id={i.id} status={i.status} /> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No invoices recorded"
            body="Record invoices raised in your accounting system so revenue and collections are visible here."
          />
        )}
      </>
    );
  }
  if (tab === 'expenses') {
    const rows = await listExpenses(actor);
    return (
      <>
        {header}
        <div className="mb-3 flex justify-end">{write ? <NewExpense projects={projects} /> : null}</div>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th>Project</Th>
                <Th align="right">Amount</Th>
                <Th>Treatment</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, projectName, clientName }) => (
                <tr key={e.id}>
                  <Td>{formatDate(e.incurredOn)}</Td>
                  <Td>
                    {e.description}
                    {e.vendor ? <div className="text-[12.5px] text-muted">{e.vendor}</div> : null}
                  </Td>
                  <Td>{humanize(e.category)}</Td>
                  <Td>
                    {projectName ?? 'Overhead'}
                    <div className="text-[12.5px] text-muted">{clientName ?? ''}</div>
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(e.amountMinor, cur)}
                  </Td>
                  <Td>
                    {e.isPassThrough ? <Badge tone="info">Pass-through</Badge> : <Badge>Direct cost</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No expenses recorded" />
        )}
      </>
    );
  }
  if (tab === 'budgets') {
    const [rows, bva] = await Promise.all([listBudgets(actor), campaignBudgetVsActual(actor)]);
    const approver = can(actor, 'deals.approve_commercials') && write;
    return (
      <>
        {header}
        <div className="mb-3 flex justify-end">
          {write ? <NewBudget clients={clients} projects={projects} campaigns={campaigns} /> : null}
        </div>
        <Panel title="Campaign budget vs actual spend" className="mb-5" bodyClassName="p-0">
          {bva.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Campaign</Th>
                  <Th>Period</Th>
                  <Th align="right">Budget</Th>
                  <Th align="right">Spent (platform)</Th>
                  <Th>Used</Th>
                </tr>
              </thead>
              <tbody>
                {bva.map((b) => {
                  const used = b.spentMinor == null ? null : Number(b.spentMinor) / b.amountMinor;
                  return (
                    <tr key={b.budgetId}>
                      <Td>
                        {b.campaignName}
                        <div className="text-[12.5px] text-muted">{b.clientName}</div>
                      </Td>
                      <Td>
                        {formatDate(b.periodStart)} → {formatDate(b.periodEnd)}
                      </Td>
                      <Td align="right" className="tabular">
                        {formatMoney(b.amountMinor, cur)}
                      </Td>
                      <Td align="right" className="tabular">
                        {b.spentMinor == null ? 'No data' : formatMoney(Number(b.spentMinor), cur)}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 rounded-full bg-surface-2">
                            <div
                              className={`h-1.5 rounded-full ${used != null && used > 1 ? 'bg-bad' : used != null && used > 0.9 ? 'bg-warn' : 'bg-accent'}`}
                              style={{ width: `${Math.min(100, (used ?? 0) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[12.5px] tabular">{formatPercent(used, 0)}</span>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <p className="p-4 text-muted">No campaign budgets.</p>
          )}
        </Panel>
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>For</Th>
              <Th>Period</Th>
              <Th align="right">Amount</Th>
              <Th>Approval</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, clientName, projectName, campaignName }) => (
              <tr key={b.id}>
                <Td>{humanize(b.type)}</Td>
                <Td>{campaignName ?? projectName ?? clientName}</Td>
                <Td>
                  {formatDate(b.periodStart)} → {formatDate(b.periodEnd)}
                </Td>
                <Td align="right" className="tabular">
                  {formatMoney(b.amountMinor, cur)}
                </Td>
                <Td>
                  {b.approvedAt ? (
                    <Badge tone="ok">Approved {formatDate(b.approvedAt)}</Badge>
                  ) : approver ? (
                    <ActionButton
                      action={approveBudgetAction}
                      hidden={{ id: b.id }}
                      confirm="Approve this budget?"
                    >
                      Approve
                    </ActionButton>
                  ) : (
                    <Badge tone="warn">Awaiting approval</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </>
    );
  }
  const [summary, renewals, profit] = await Promise.all([
    financeSummary(actor),
    upcomingRenewals(actor, 90),
    projectProfitability(actor),
  ]);
  const estimated = profit.filter((p) => p.grossMarginMinor != null);
  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Agency fees invoiced this month"
          value={formatMoney(summary.feesThisMonthMinor, cur, { compact: true })}
        />
        <Stat
          label="Outstanding receivables"
          value={formatMoney(summary.outstandingMinor, cur, { compact: true })}
          href="/finance?tab=invoices"
        />
        <Stat
          label="Overdue"
          value={formatMoney(summary.overdueMinor, cur, { compact: true })}
          href="/finance?tab=invoices"
        />
        <Stat
          label="Projects with margin data"
          value={`${estimated.length} / ${profit.length}`}
          href="/finance?tab=profitability"
          sub={`${profit.filter((p) => p.isEstimate).length} are estimates`}
        />
      </div>
      <Panel title="Renewals in the next 90 days" className="mt-5" bodyClassName="p-0">
        {renewals.length ? (
          <ul className="divide-y divide-line">
            {renewals.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                <Link href={`/clients/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <span className="text-[13px] text-muted">
                  {formatDate(r.renewalDate)} · {r.ownerName ?? 'No owner'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-muted">No renewals due.</p>
        )}
      </Panel>
    </>
  );
}
