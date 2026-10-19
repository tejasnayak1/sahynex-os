import { PageHeader } from '@/components/ui';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { NewDealForm } from '../deal-form';

export const metadata = { title: 'New deal' };

export default async function NewDeal() {
  const actor = await requirePagePermission('deals.write');
  const [team, clients] = await Promise.all([teamOptions(actor.orgId), clientOptions(actor)]);
  return (
    <>
      <PageHeader
        title="New deal"
        crumbs={[{ label: 'Sales pipeline', href: '/pipeline' }, { label: 'New deal' }]}
      />
      <NewDealForm team={team} clients={clients} defaultOwner={actor.id} />
    </>
  );
}
