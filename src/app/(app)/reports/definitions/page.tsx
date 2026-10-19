import { PageHeader, Table, Td, Th } from '@/components/ui';
import { METRIC_DEFINITIONS } from '@/lib/metrics';
import { requireActor } from '@/server/auth/current';

export const metadata = { title: 'Metric definitions' };

export default async function Definitions() {
  await requireActor();
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Reports & analytics', href: '/reports' }, { label: 'Metric definitions' }]}
        title="Metric definitions"
        description="How every reported number is calculated. Derived metrics are unavailable when an input is missing or the denominator is zero."
      />
      <Table>
        <thead>
          <tr>
            <Th>Metric</Th>
            <Th>Definition</Th>
            <Th>Unit</Th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(METRIC_DEFINITIONS).map(([k, m]) => (
            <tr key={k}>
              <Td className="font-medium text-ink">{m.label}</Td>
              <Td>{m.definition}</Td>
              <Td>{m.unit}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
