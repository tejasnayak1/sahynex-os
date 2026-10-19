import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import { Badge, EmptyState, PageHeader, Table, Td, Th, cn } from '@/components/ui';
import { formatDate, humanize } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { campaignOptions, listConversions } from '@/server/services/campaigns';
import { clientOptions } from '@/server/services/clients';
import { verifyConversionAction } from '../actions';
import { RecordOutcome } from '../forms';

export const metadata = { title: 'Outcomes' };

export default async function ConversionsPage() {
  const actor = await requirePagePermission('campaigns.read');
  const [rows, clients, campaigns] = await Promise.all([
    listConversions(actor),
    clientOptions(actor),
    campaignOptions(actor),
  ]);
  const canWrite = can(actor, 'campaigns.write');
  return (
    <>
      <PageHeader
        title="Campaigns & performance"
        description="Applications, admissions and sales recorded from client systems. Only verified outcomes are reported; campaign attribution is only set with evidence."
        actions={canWrite ? <RecordOutcome clients={clients} campaigns={campaigns} /> : null}
      />
      <nav className="mb-3 flex gap-1 border-b border-line" aria-label="Sections">
        {[
          ['/campaigns', 'Campaigns'],
          ['/campaigns/conversions', 'Outcomes'],
          ['/campaigns/monitoring', 'Landing-page monitoring'],
        ].map(([h, l]) => (
          <Link
            key={h}
            href={h}
            aria-current={h === '/campaigns/conversions' ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium',
              h === '/campaigns/conversions'
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {l}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Client</Th>
              <Th>Attributed campaign</Th>
              <Th>Source of record</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, clientName, campaignName }) => (
              <tr key={e.id}>
                <Td>{formatDate(e.occurredAt)}</Td>
                <Td>{humanize(e.type)}</Td>
                <Td>{clientName}</Td>
                <Td>{campaignName ?? <span className="text-muted">Not attributed</span>}</Td>
                <Td className="max-w-[260px] truncate" title={e.source}>
                  {e.source}
                </Td>
                <Td>
                  {e.verified ? (
                    <Badge tone="ok">Verified</Badge>
                  ) : canWrite ? (
                    <ActionButton
                      action={verifyConversionAction}
                      hidden={{ id: e.id }}
                      confirm="Confirm this outcome has been checked against the client’s records?"
                    >
                      Verify
                    </ActionButton>
                  ) : (
                    <Badge>Unverified</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No outcomes recorded"
          body="Record applications and admissions from the client’s admissions office so reports can show verified results."
        />
      )}
    </>
  );
}
