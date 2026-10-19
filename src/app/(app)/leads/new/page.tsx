import { PageHeader } from '@/components/ui';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { NewLeadForm } from '../lead-form';

export const metadata = { title: 'New lead' };

export default async function NewLead() {
  const actor = await requirePagePermission('leads.write');
  const [clients, team] = await Promise.all([clientOptions(actor), teamOptions(actor.orgId)]);
  return (
    <>
      <PageHeader
        title="New lead"
        crumbs={[{ label: 'CRM & leads', href: '/leads' }, { label: 'New lead' }]}
        description="Duplicates are detected by email and phone. Matching leads are updated, never overwritten; conflicting matches are flagged for review."
      />
      <NewLeadForm clients={clients} team={team} canAssign={can(actor, 'leads.assign')} />
    </>
  );
}
