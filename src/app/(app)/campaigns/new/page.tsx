import { PageHeader } from '@/components/ui';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { NewCampaignForm } from '../forms';

export const metadata = { title: 'New campaign' };

export default async function NewCampaign() {
  const actor = await requirePagePermission('campaigns.write');
  const [clients, team] = await Promise.all([clientOptions(actor), teamOptions(actor.orgId)]);
  return (
    <>
      <PageHeader
        title="New campaign"
        crumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'New' }]}
      />
      <NewCampaignForm clients={clients} team={team} thresholds={can(actor, 'campaigns.thresholds')} />
    </>
  );
}
