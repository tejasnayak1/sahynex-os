import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/client/auto-submit';
import { Badge, DescList, PageHeader, Panel, StatusBadge, Table, Td, Th, cn } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDateTime, relativeTime } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { recentExecutions } from '@/server/automation/engine';
import { getWorkflow } from '@/server/automation/registry';
import { teamOptions } from '@/server/services/admin';
import { toggleAutomationAction } from '../actions';
import { ConfigForm, Retry, RunNow } from './forms';

export const metadata = { title: 'Automation' };

export default async function AutomationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('automation.read');
  const { key } = await params;
  const sp = await readParams(searchParams);
  const [a] = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.orgId, actor.orgId), eq(schema.automations.key, key)));
  const def = getWorkflow(key);
  if (!a || !def) notFound();
  const [execs, team] = await Promise.all([
    recentExecutions(actor.orgId, a.id, 100),
    teamOptions(actor.orgId),
  ]);
  const selected = execs.find((e) => e.id === sp.execution) ?? null;
  const manage = can(actor, 'automation.manage');
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Automation centre', href: '/automation' }, { label: a.name }]}
        title={a.name}
        meta={
          <>
            {a.enabled ? <Badge tone="ok">Enabled</Badge> : <Badge>Disabled</Badge>}
            {a.consecutiveFailures ? (
              <Badge tone="bad">{a.consecutiveFailures} consecutive failure(s)</Badge>
            ) : null}
            <span>Last success {a.lastSuccessAt ? relativeTime(a.lastSuccessAt) : 'never'}</span>
          </>
        }
        actions={
          manage ? (
            <>
              {a.trigger.type === 'schedule' && a.enabled ? <RunNow automationKey={a.key} /> : null}
              <ActionButton
                size="md"
                action={toggleAutomationAction}
                hidden={{ key: a.key, enabled: a.enabled ? 'false' : 'true' }}
                confirm={a.enabled ? 'Disable this automation?' : undefined}
              >
                {a.enabled ? 'Disable' : 'Enable'}
              </ActionButton>
            </>
          ) : null
        }
      />
      <p className="mb-5 max-w-[80ch] text-muted">{a.description}</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {selected ? (
            <Panel
              title={`Run ${selected.id.slice(0, 8)}`}
              actions={
                <Link href={`/automation/${key}`} className="text-[13px] text-accent hover:underline">
                  Close
                </Link>
              }
            >
              <DescList
                items={[
                  ['Status', <StatusBadge key="s" status={selected.status} />],
                  ['Attempts', String(selected.attempts)],
                  ['Started', formatDateTime(selected.startedAt)],
                  ['Finished', formatDateTime(selected.finishedAt)],
                  ['Duration', selected.durationMs != null ? `${selected.durationMs} ms` : '—'],
                  [
                    'Idempotency key',
                    <code key="k" className="break-all text-[12px]">
                      {selected.idempotencyKey}
                    </code>,
                  ],
                ]}
              />
              {selected.error ? (
                <p className="mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px]">
                  {selected.error}
                </p>
              ) : null}
              <h3 className="mb-1 mt-4 text-[13px] font-semibold">Log</h3>
              <ol className="max-h-80 space-y-1 overflow-y-auto rounded-md bg-surface-2 p-3 font-mono text-[12px]">
                {selected.logs.map((l, i) => (
                  <li
                    key={i}
                    className={cn(
                      l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-ink-2',
                    )}
                  >
                    {l.at.slice(11, 19)} {l.message}
                  </li>
                ))}
              </ol>
              <h3 className="mb-1 mt-4 text-[13px] font-semibold">Payload</h3>
              <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[12px]">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
              {manage && selected.status === 'dead' ? (
                <div className="mt-3">
                  <Retry executionId={selected.id} />
                </div>
              ) : null}
            </Panel>
          ) : null}
          <Panel title="Execution history" bodyClassName="p-0">
            {execs.length ? (
              <Table className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Status</Th>
                    <Th>Summary / error</Th>
                    <Th align="right">Attempts</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {execs.map((e) => (
                    <tr key={e.id} className={selected?.id === e.id ? 'bg-surface-2' : ''}>
                      <Td title={formatDateTime(e.createdAt)}>
                        <Link href={`/automation/${key}?execution=${e.id}`} className="hover:underline">
                          {relativeTime(e.createdAt)}
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge status={e.status} />
                      </Td>
                      <Td
                        className="max-w-[420px] truncate"
                        title={e.error ?? String(e.result?.summary ?? '')}
                      >
                        {e.error ??
                          String(
                            e.result?.summary ??
                              (e.status === 'queued' ? `Runs ${relativeTime(e.runAfter)}` : '—'),
                          )}
                      </Td>
                      <Td align="right" className="tabular">
                        {e.attempts}
                      </Td>
                      <Td>{manage && e.status === 'dead' ? <Retry executionId={e.id} /> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="p-4 text-muted">No runs yet.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Definition">
            <DescList
              cols={1}
              items={[
                [
                  'Trigger',
                  a.trigger.type === 'schedule'
                    ? `Schedule: ${a.trigger.cron} (next ${formatDateTime(a.nextRunAt)})`
                    : `Events: ${a.trigger.events.join(', ')}`,
                ],
                [
                  'Conditions',
                  <ul key="c" className="list-disc pl-4">
                    {a.conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>,
                ],
                [
                  'Actions',
                  <ul key="a" className="list-disc pl-4">
                    {a.actions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>,
                ],
                [
                  'Retry policy',
                  `Up to ${a.maxAttempts} attempts, exponential backoff from ${a.backoffBaseSeconds}s; timeout ${a.timeoutSeconds}s`,
                ],
                [
                  'Failure handling',
                  'After the last attempt the run is marked failed and the owner is alerted; after 3 consecutive failures, COO/CEO are alerted too.',
                ],
                [
                  'ID',
                  <code key="id" className="text-[12px]">
                    {a.key}
                  </code>,
                ],
              ]}
            />
          </Panel>
          {manage ? (
            <Panel title="Settings">
              <ConfigForm
                automationKey={a.key}
                cron={a.trigger.type === 'schedule' ? a.trigger.cron : undefined}
                fields={def.configFields ?? []}
                config={a.config}
                ownerId={a.ownerId}
                team={team}
              />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
