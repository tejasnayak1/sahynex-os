import Link from 'next/link';
import { Panel, Table, Td, Th } from '@/components/ui';
import type { TemplateItem } from '@/db/schema';
import { readParams } from '@/lib/params';
import { requirePagePermission } from '@/server/auth/current';
import { listTemplates } from '@/server/services/projects';
import { TemplateForm } from './form';

export const metadata = { title: 'Task templates' };

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('tasks.templates');
  const sp = await readParams(searchParams);
  const templates = await listTemplates(actor.orgId);
  const sel = templates.find((t) => t.key === sp.edit);
  return (
    <div className="space-y-5">
      <Panel
        title="Templates"
        bodyClassName="p-0"
        actions={
          <Link href="/settings/templates?edit=__new" className="text-[13px] text-accent hover:underline">
            New template
          </Link>
        }
      >
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Template</Th>
              <Th align="right">Tasks</Th>
              <Th>Milestones</Th>
              <Th>
                <span className="sr-only">Edit</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const items = t.items as TemplateItem[];
              return (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium text-ink">{t.name}</span>
                    <div className="text-[12.5px] text-muted">{t.description}</div>
                  </Td>
                  <Td align="right" className="tabular">
                    {items.length}
                  </Td>
                  <Td className="text-[13px]">
                    {[...new Set(items.map((i) => i.milestone).filter(Boolean))].join(', ') || '—'}
                  </Td>
                  <Td>
                    <Link href={`/settings/templates?edit=${t.key}`} className="text-accent hover:underline">
                      Edit
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      {sp.edit ? (
        <Panel title={sel ? `Edit: ${sel.name}` : 'New template'}>
          <TemplateForm t={sel} />
        </Panel>
      ) : null}
    </div>
  );
}
