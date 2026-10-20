import { PageHeader } from '@/components/ui';
import { readParams } from '@/lib/params';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { CONTENT_TEMPLATES, FORMAT_LABEL } from '@/server/services/deliverables';
import { projectOptions } from '@/server/services/projects';
import { NewDeliverableStudio } from '../creative-studio';

export const metadata = { title: 'New deliverable' };

export default async function NewDeliverable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('content.write');
  const sp = await readParams(searchParams);
  const [projects, team] = await Promise.all([projectOptions(actor), teamOptions(actor.orgId)]);
  const templates = Object.fromEntries(
    Object.entries(CONTENT_TEMPLATES).map(([k, v]) => [
      k,
      { label: FORMAT_LABEL[k as keyof typeof FORMAT_LABEL], brief: v.brief },
    ]),
  );
  return (
    <>
      <PageHeader
        title="Create new deliverable"
        description="Provide a brief and let AI suggest stronger content. You stay in control of what’s created."
        crumbs={[{ label: 'Content & deliverables', href: '/content' }, { label: 'New' }]}
      />
      <NewDeliverableStudio
        projects={projects}
        team={team}
        templates={templates}
        projectId={sp.projectId}
        me={actor.id}
      />
    </>
  );
}
