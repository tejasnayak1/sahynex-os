import { ActionButton } from '@/components/client/auto-submit';
import { Panel, Table, Td, Th } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { requirePagePermission } from '@/server/auth/current';
import { listKpis } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { deleteKpiAction } from '../actions';
import { KpiForm } from './form';

export const metadata = { title: 'KPI targets' };

export default async function KpisPage() {
  const actor = await requirePagePermission('settings.org');
  const [kpis, clients] = await Promise.all([listKpis(actor), clientOptions(actor)]);
  return (
    <div className="space-y-5">
      <Panel title="Targets" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>KPI</Th>
              <Th>Client</Th>
              <Th align="right">Target / month</Th>
              <Th align="right">Latest recorded</Th>
              <Th>
                <span className="sr-only">Remove</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((k) => (
              <tr key={k.id}>
                <Td>
                  <span className="text-ink">{k.name}</span>
                  <div className="text-[12px] text-muted">{k.definition}</div>
                </Td>
                <Td>{k.clientName ?? 'Sahynex'}</Td>
                <Td align="right" className="tabular">
                  {Number(k.target)}
                </Td>
                <Td align="right" className="tabular">
                  {k.latest ? `${Number(k.latest.value)} (${formatDate(k.latest.periodStart)} MTD)` : '—'}
                </Td>
                <Td>
                  <ActionButton
                    action={deleteKpiAction}
                    hidden={{ id: k.id }}
                    variant="ghost"
                    confirm={`Remove “${k.name}”?`}
                  >
                    Remove
                  </ActionButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Add a target">
        <KpiForm clients={clients} />
      </Panel>
      <p className="text-[12.5px] text-muted">
        Month-to-date values are recorded each morning by the daily digest automation and shown against
        targets on the executive dashboard.
      </p>
    </div>
  );
}
