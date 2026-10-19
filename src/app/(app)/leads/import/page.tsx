import { PageHeader, Panel } from '@/components/ui';
import { requirePagePermission } from '@/server/auth/current';
import { clientOptions } from '@/server/services/clients';
import { ImportForm } from './import-form';

export const metadata = { title: 'Import leads' };

export default async function ImportPage() {
  const actor = await requirePagePermission('leads.import');
  return (
    <>
      <PageHeader
        title="Import leads from CSV"
        crumbs={[{ label: 'CRM & leads', href: '/leads' }, { label: 'Import' }]}
        description="Each row is validated and deduplicated. Rows that match an existing lead update empty fields only; conflicting matches are created and flagged for review. Imported leads are assigned and get follow-up tasks automatically."
      />
      <Panel>
        <ImportForm clients={await clientOptions(actor)} />
      </Panel>
    </>
  );
}
