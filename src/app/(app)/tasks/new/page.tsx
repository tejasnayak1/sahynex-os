import { PageHeader } from '@/components/ui';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { projectOptions } from '@/server/services/projects';
import { NewTaskForm } from '../task-form';

export const metadata = { title: 'New task' };

export default async function NewTask({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('tasks.write');
  const sp = await readParams(searchParams);
  const [team, projects] = await Promise.all([teamOptions(actor.orgId), projectOptions(actor)]);
  return (
    <>
      <PageHeader title="New task" crumbs={[{ label: 'Tasks & team', href: '/tasks' }, { label: 'New' }]} />
      <NewTaskForm
        team={can(actor, 'tasks.assign') ? team : team.filter((t) => t.id === actor.id)}
        projects={projects}
        defaults={sp}
        canAssign={can(actor, 'tasks.assign')}
        me={actor.id}
      />
    </>
  );
}
