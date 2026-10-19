import Link from 'next/link';
import { Panel, Table, Td, Th, cn } from '@/components/ui';
import { PERMISSIONS } from '@/lib/permissions';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { listRoles } from '@/server/services/admin';
import { RoleForm } from './form';

export const metadata = { title: 'Roles & permissions' };

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('settings.roles', 'settings.users');
  const sp = await readParams(searchParams);
  const roles = await listRoles(actor.orgId);
  const modules = [...new Set(Object.values(PERMISSIONS).map((p) => p.module))];
  const catalogue = modules.map((m) => ({
    module: m,
    items: Object.entries(PERMISSIONS)
      .filter(([, p]) => p.module === m)
      .map(([key, p]) => ({ key, description: p.description })),
  }));
  const selected = roles.find((r) => r.id === sp.role);
  return (
    <div className="space-y-5">
      <Panel
        title="Permissions matrix"
        bodyClassName="p-0"
        actions={
          <span className="text-[12.5px] text-muted">
            Enforced on the server for every page, action and API call
          </span>
        }
      >
        <div className="max-h-[520px] overflow-auto">
          <Table className="rounded-none border-0">
            <thead className="sticky top-0">
              <tr>
                <Th>Permission</Th>
                {roles.map((r) => (
                  <Th key={r.id} className="text-center">
                    <Link href={`/settings/roles?role=${r.id}`} className="hover:underline">
                      {r.name.split(' /')[0]}
                    </Link>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(PERMISSIONS).map(([k, p]) => (
                <tr key={k}>
                  <Td>
                    <span className="text-ink">{p.description}</span>
                    <div className="text-[11.5px] text-faint">
                      {p.module} · {k}
                    </div>
                  </Td>
                  {roles.map((r) => (
                    <Td
                      key={r.id}
                      className={cn(
                        'text-center',
                        r.permissions.has(k as keyof typeof PERMISSIONS) ? 'text-ok' : 'text-faint',
                      )}
                    >
                      {r.permissions.has(k as keyof typeof PERMISSIONS) ? '●' : '·'}
                      <span className="sr-only">
                        {r.permissions.has(k as keyof typeof PERMISSIONS) ? 'granted' : 'not granted'}
                      </span>
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Panel>
      {selected ? (
        <Panel title={`Edit role: ${selected.name}`}>
          <p className="mb-3 text-muted">{selected.description}</p>
          <RoleForm
            roleId={selected.id}
            granted={[...selected.permissions]}
            catalogue={catalogue}
            editable={can(actor, 'settings.roles')}
          />
        </Panel>
      ) : (
        <p className="text-muted">Select a role name in the matrix header to edit its permissions.</p>
      )}
    </div>
  );
}
