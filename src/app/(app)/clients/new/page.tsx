import { PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { NewClientForm } from '../client-form';

export const metadata = { title: 'New client' };

export default async function NewClient() {
  const actor = await requirePagePermission('clients.write');
  return (
    <>
      <PageHeader
        title="New client"
        crumbs={[{ label: 'Clients', href: '/clients' }, { label: 'New' }]}
        description="Prefer creating clients through a won deal’s handover so the commercial history stays linked."
      />
      <NewClientForm team={await teamOptions(actor.orgId)} />
    </>
  );
}
