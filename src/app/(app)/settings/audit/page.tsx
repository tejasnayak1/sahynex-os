import { FilterBar, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { requirePagePermission } from '@/server/auth/current';
import { listAudit } from '@/server/services/admin';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('audit.read');
  const sp = await readParams(searchParams);
  const p = paging(sp, { pageSize: 50 });
  const res = await listAudit(actor, {
    q: sp.q,
    entityType: sp.entityType,
    page: p.page,
    pageSize: p.pageSize,
  });
  return (
    <>
      <FilterBar
        action="/settings/audit"
        q={sp.q}
        placeholder="Action, e.g. approval"
        reset={Object.keys(sp).length > 0}
      >
        <Select
          name="entityType"
          ariaLabel="Record type"
          defaultValue={sp.entityType}
          placeholder="All records"
          options={[
            'lead',
            'deal',
            'client',
            'project',
            'task',
            'deliverable',
            'campaign',
            'report',
            'automation',
            'integration',
            'user',
            'role',
            'invoice',
            'budget',
            'expense',
          ].map((v) => ({ value: v, label: v }))}
          className="w-44"
        />
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Change</Th>
          </tr>
        </thead>
        <tbody>
          {res.rows.map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
              <Td>{a.actorName ?? a.actorLabel ?? 'System'}</Td>
              <Td>
                <code className="text-[12.5px]">{a.action}</code>
              </Td>
              <Td className="text-[12.5px]">
                {a.entityType}
                {a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}
              </Td>
              <Td className="max-w-[420px]">
                <code className="block truncate text-[12px] text-muted" title={JSON.stringify(a.after)}>
                  {a.after ? JSON.stringify(a.after) : ''}
                </code>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination
        total={res.total}
        page={res.page}
        pageSize={res.pageSize}
        base="/settings/audit"
        params={sp}
      />
    </>
  );
}
