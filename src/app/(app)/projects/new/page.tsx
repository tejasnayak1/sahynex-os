import { PageHeader } from '@/components/ui';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { listTemplates } from '@/server/services/projects';
import { NewProjectForm } from '../project-form';

export const metadata = { title: 'New project' };

export default async function NewProject({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('projects.write');
  const sp = await readParams(searchParams);
  const [clients, team, templates] = await Promise.all([
    clientOptions(actor),
    teamOptions(actor.orgId),
    listTemplates(actor.orgId),
  ]);
  return (
    <>
      <PageHeader title="New project" crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'New' }]} />
      <NewProjectForm
        clients={clients}
        team={team}
        templates={templates.map((t) => ({ key: t.key, name: t.name }))}
        commercials={can(actor, 'projects.commercials')}
        clientId={sp.clientId}
      />
    </>
  );
}
