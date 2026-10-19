import { inArray } from 'drizzle-orm';
import { Badge, Panel, Table, Td, Th } from '@/components/ui';
import { db, schema } from '@/db';
import { relativeTime } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { listRoles, listTeams, listUsers } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { EditUser, NewTeam, NewUser } from './forms';

export const metadata = { title: 'Users & teams' };

export default async function UsersPage() {
  const actor = await requirePagePermission('settings.users');
  const [users, roles, teams, clients] = await Promise.all([
    listUsers(actor),
    listRoles(actor.orgId),
    listTeams(actor.orgId),
    clientOptions(actor),
  ]);
  const finance = can(actor, 'finance.write');
  const profiles =
    finance && users.length
      ? await db
          .select()
          .from(schema.employeeProfiles)
          .where(
            inArray(
              schema.employeeProfiles.userId,
              users.map((u) => u.id),
            ),
          )
      : [];
  const assignable = roles.filter((r) => r.key !== 'ceo' || can(actor, 'settings.roles'));
  return (
    <div className="space-y-5">
      <Panel
        title={`Users (${users.length})`}
        bodyClassName="p-0"
        actions={<NewUser roles={assignable} teams={teams} clients={clients} />}
      >
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Team</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const p = profiles.find((x) => x.userId === u.id);
              return (
                <tr key={u.id}>
                  <Td>
                    <span className="font-medium text-ink">{u.name}</span>
                    <div className="text-[12.5px] text-muted">{u.email}</div>
                  </Td>
                  <Td>
                    {u.roleName}
                    {u.clientId ? (
                      <div className="text-[12.5px] text-muted">
                        {clients.find((c) => c.id === u.clientId)?.name}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{teams.find((t) => t.id === u.teamId)?.name ?? '—'}</Td>
                  <Td className="space-x-1">
                    {u.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Deactivated</Badge>}
                    {u.acceptsLeads ? <Badge tone="info">Gets leads</Badge> : null}
                    {u.lockedUntil && u.lockedUntil > new Date() ? <Badge tone="bad">Locked</Badge> : null}
                  </Td>
                  <Td>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</Td>
                  <Td>
                    {u.id !== actor.id ? (
                      <EditUser
                        u={u}
                        roles={assignable}
                        teams={teams}
                        finance={finance}
                        cost={p ? { hourly: p.hourlyCostMinor, capacity: p.capacityHoursPerWeek } : null}
                      />
                    ) : (
                      <span className="text-[12.5px] text-muted">You</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Teams">
        <ul className="mb-3 flex flex-wrap gap-2">
          {teams.map((t) => (
            <li key={t.id}>
              <Badge>{t.name}</Badge>
            </li>
          ))}
        </ul>
        <NewTeam />
      </Panel>
    </div>
  );
}
