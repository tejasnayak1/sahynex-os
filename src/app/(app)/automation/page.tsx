import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { ActionButton } from '@/components/client/auto-submit';
import { Badge, LinkButton, PageHeader, Panel, Stat, StatusBadge, Table, Td, Th } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDateTime, relativeTime } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { queueDepth } from '@/server/automation/engine';
import { listIntegrations } from '@/server/services/admin';
import { toggleAutomationAction } from './actions';

export const metadata = { title: 'Automation centre' };

function isRecent(at: Date | string | null, minutes: number, now = new Date()) {
  return !!at && now.getTime() - new Date(at).getTime() < minutes * 60_000;
}

export default async function AutomationPage() {
  const actor = await requirePagePermission('automation.read');
  const { automations, automationExecutions, users } = schema;
  const rows = await db
    .select({
      a: automations,
      ownerName: users.name,
      runs7: sql<number>`(select count(*)::int from automation_executions e where e.automation_id = ${automations.id} and e.created_at > now() - interval '7 days' and e.status in ('succeeded','skipped','dead'))`,
      ok7: sql<number>`(select count(*)::int from automation_executions e where e.automation_id = ${automations.id} and e.created_at > now() - interval '7 days' and e.status in ('succeeded','skipped'))`,
      dead7: sql<number>`(select count(*)::int from automation_executions e where e.automation_id = ${automations.id} and e.created_at > now() - interval '7 days' and e.status = 'dead')`,
    })
    .from(automations)
    .leftJoin(users, eq(users.id, automations.ownerId))
    .where(eq(automations.orgId, actor.orgId))
    .orderBy(automations.name);
  const [q, integrations, recentFailures] = await Promise.all([
    queueDepth(actor.orgId),
    listIntegrations(actor),
    db
      .select({ e: automationExecutions, name: automations.name, key: automations.key })
      .from(automationExecutions)
      .innerJoin(automations, eq(automations.id, automationExecutions.automationId))
      .where(sql`${automationExecutions.orgId} = ${actor.orgId} and ${automationExecutions.status} = 'dead'`)
      .orderBy(desc(automationExecutions.finishedAt))
      .limit(8),
  ]);
  const [lastRun] = await db
    .select({ at: sql<Date | null>`max(${automationExecutions.finishedAt})` })
    .from(automationExecutions)
    .where(eq(automationExecutions.orgId, actor.orgId));
  const workerHealthy = isRecent(lastRun?.at ?? null, 20);
  const manage = can(actor, 'automation.manage');
  return (
    <>
      <PageHeader
        title="Automation centre"
        description="Every automated workflow, its trigger, owner and run history. Failures are retried with backoff; anything that still fails lands here for inspection and safe retry."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Worker"
          value={workerHealthy ? 'Running' : 'No recent runs'}
          sub={lastRun?.at ? `Last run finished ${relativeTime(lastRun.at)}` : 'Start it with npm run worker'}
        />
        <Stat label="Queued now" value={q.queued} sub={`${q.running} running`} />
        <Stat label="Retrying" value={q.retrying} />
        <Stat label="Failed (needs attention)" value={q.dead} />
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Automation</Th>
            <Th>Trigger</Th>
            <Th>Owner</Th>
            <Th>Last success</Th>
            <Th align="right">7-day success</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Toggle</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, ownerName, runs7, ok7, dead7 }) => (
            <tr key={a.id} className="hover:bg-surface-2">
              <Td>
                <Link href={`/automation/${a.key}`} className="font-medium text-ink hover:underline">
                  {a.name}
                </Link>
                <div className="max-w-[440px] text-[12.5px] text-muted">{a.description}</div>
              </Td>
              <Td className="text-[13px]">
                {a.trigger.type === 'schedule' ? (
                  <>
                    Schedule <code className="rounded bg-surface-2 px-1">{a.trigger.cron}</code>
                    {a.nextRunAt ? (
                      <div className="text-[12px] text-muted">next {formatDateTime(a.nextRunAt)}</div>
                    ) : null}
                  </>
                ) : (
                  <>On {a.trigger.events.join(', ')}</>
                )}
              </Td>
              <Td>{ownerName ?? <span className="text-warn">No owner</span>}</Td>
              <Td>{a.lastSuccessAt ? relativeTime(a.lastSuccessAt) : '—'}</Td>
              <Td align="right" className="tabular">
                {runs7 ? `${Math.round((ok7 / runs7) * 100)}% of ${runs7}` : '—'}
                {dead7 ? <div className="text-[12px] text-bad">{dead7} failed</div> : null}
              </Td>
              <Td>
                {a.enabled ? (
                  a.consecutiveFailures >= 3 ? (
                    <Badge tone="bad">Failing</Badge>
                  ) : (
                    <Badge tone="ok">Enabled</Badge>
                  )
                ) : (
                  <Badge>Disabled</Badge>
                )}
              </Td>
              <Td>
                {manage ? (
                  <ActionButton
                    action={toggleAutomationAction}
                    hidden={{ key: a.key, enabled: a.enabled ? 'false' : 'true' }}
                    variant="ghost"
                    confirm={
                      a.enabled ? `Disable “${a.name}”? It will stop running until re-enabled.` : undefined
                    }
                  >
                    {a.enabled ? 'Disable' : 'Enable'}
                  </ActionButton>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Recent failures" bodyClassName="p-0">
          {recentFailures.length ? (
            <ul className="divide-y divide-line">
              {recentFailures.map(({ e, name, key }) => (
                <li key={e.id} className="px-4 py-2.5">
                  <Link className="font-medium hover:underline" href={`/automation/${key}?execution=${e.id}`}>
                    {name}
                  </Link>
                  <p className="truncate text-[12.5px] text-bad">{e.error}</p>
                  <p className="text-[12px] text-muted">
                    {formatDateTime(e.finishedAt)} · {e.attempts} attempt(s)
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-muted">No failed runs in the recent history.</p>
          )}
        </Panel>
        <Panel
          title="Integration health"
          bodyClassName="p-0"
          actions={
            can(actor, 'settings.integrations') ? (
              <LinkButton size="sm" href="/settings/integrations">
                Manage
              </LinkButton>
            ) : null
          }
        >
          <ul className="divide-y divide-line">
            {integrations.map((i) => (
              <li key={i.provider} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span>{i.label}</span>
                <span className="flex items-center gap-2">
                  {i.connection?.mode === 'demo' ? <Badge tone="demo">Demo mode</Badge> : null}
                  <StatusBadge
                    status={
                      i.connection?.mode === 'disconnected' || !i.connection
                        ? 'disconnected'
                        : i.connection.status
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
