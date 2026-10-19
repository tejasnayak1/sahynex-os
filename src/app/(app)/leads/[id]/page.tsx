import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { Badge, DescList, Notice, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDateTime, humanize, relativeTime } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { getLead, QUALIFICATION_QUESTIONS } from '@/server/services/leads';
import {
  ArchiveLead,
  Consent,
  Convert,
  DuplicateReview,
  EditLead,
  LogActivity,
  Qualification,
  StageAndOwner,
  WhatsAppSend,
} from './panels';
import { MeetingsPanel } from '../../_shared/meetings-panel';
import { canSendWhatsApp, whatsappAvailability, whatsappBlocker } from '@/server/services/messaging';

export const metadata = { title: 'Lead' };

const ACT_ICON: Record<string, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  stage_change: 'Stage',
  assignment: 'Owner',
  system: 'System',
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('leads.read.all', 'leads.read.own');
  const { id } = await params;
  const { lead, sourceName, clientName, campaignName, activities, duplicateOf } = await getLead(actor, id);
  const [team, tasks] = await Promise.all([
    teamOptions(actor.orgId),
    db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.leadId, id), eq(schema.tasks.orgId, actor.orgId)))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(20),
  ]);
  const canWrite = can(actor, 'leads.write');
  const wa = canSendWhatsApp(actor)
    ? await whatsappAvailability(actor)
    : ({ state: 'disconnected' } as const);
  const waBlocker = whatsappBlocker(lead);
  const closed = ['converted', 'lost', 'unqualified'].includes(lead.stage);
  const L = { ...lead, nextActionAt: lead.nextActionAt?.toISOString() ?? null };
  const touch = (t: typeof lead.firstTouch) =>
    t ? [t.source, t.medium, t.campaign].filter(Boolean).join(' / ') || '—' : '—';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'CRM & leads', href: '/leads' }, { label: lead.ref }]}
        title={lead.name}
        meta={
          <>
            <StatusBadge status={lead.stage} />
            <StatusBadge
              status={lead.qualificationStatus}
              label={
                lead.qualificationStatus === 'pending'
                  ? 'Qualification pending'
                  : humanize(lead.qualificationStatus)
              }
            />
            {lead.score != null ? <span className="tabular">Score {lead.score}</span> : null}
            <span>{lead.ref}</span>
            {lead.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
            {lead.isTest ? <Badge tone="warn">Test lead</Badge> : null}
          </>
        }
        actions={
          canWrite ? (
            <>
              {!closed && !lead.clientId ? <Convert lead={L} /> : null}
              <EditLead lead={L} />
            </>
          ) : null
        }
      />
      {duplicateOf ? (
        <div className="mb-4">
          <Notice tone="warn" title="Possible duplicate — needs review">
            Shares an email or phone with{' '}
            <Link className="font-medium underline" href={`/leads/${duplicateOf.id}`}>
              {duplicateOf.ref} {duplicateOf.name}
            </Link>{' '}
            but other details conflict, so it wasn’t merged automatically.
            {canWrite ? (
              <div className="mt-2">
                <DuplicateReview id={lead.id} canArchive={can(actor, 'leads.delete')} />
              </div>
            ) : null}
          </Notice>
        </div>
      ) : null}
      {lead.convertedDealId ? (
        <div className="mb-4">
          <Notice tone="ok" title="Converted">
            This lead became a deal.{' '}
            <Link className="underline" href={`/deals/${lead.convertedDealId}`}>
              Open the deal
            </Link>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="Details">
            <DescList
              items={[
                [
                  'Email',
                  lead.email ? (
                    <a className="text-accent hover:underline" href={`mailto:${lead.email}`}>
                      {lead.email}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                [
                  'Phone',
                  lead.phone ? (
                    <a className="text-accent hover:underline" href={`tel:${lead.phone}`}>
                      {lead.phone}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                ['Organisation', lead.organisationName ?? '—'],
                ['Lead type', humanize(lead.leadType)],
                ['Interest', lead.interest ?? '—'],
                ['City', lead.city ?? '—'],
                [
                  'For client',
                  clientName ? (
                    <Link className="hover:underline" href={`/clients/${lead.clientId}`}>
                      {clientName}
                    </Link>
                  ) : (
                    'Sahynex prospect'
                  ),
                ],
                ['Source', sourceName ?? '—'],
                [
                  'Campaign',
                  campaignName ? (
                    <Link className="hover:underline" href={`/campaigns/${lead.campaignId}`}>
                      {campaignName}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
                ['First touch', touch(lead.firstTouch)],
                ['Latest touch', touch(lead.latestTouch)],
                [
                  'Last contact',
                  lead.lastContactAt ? formatDateTime(lead.lastContactAt) : 'Not contacted yet',
                ],
                [
                  'Next action',
                  lead.nextActionAt
                    ? `${lead.nextAction ?? 'Follow up'} · ${formatDateTime(lead.nextActionAt)}`
                    : '—',
                ],
                ['Created', formatDateTime(lead.createdAt)],
                ...(lead.lossReason ? ([['Closed reason', lead.lossReason]] as Array<[string, string]>) : []),
              ]}
            />
          </Panel>
          {canWrite && !closed ? (
            <Panel title="Log activity">
              <LogActivity id={lead.id} />
            </Panel>
          ) : null}
          <Panel title="Activity timeline" bodyClassName="p-0">
            {activities.length ? (
              <ol className="divide-y divide-line">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <span className="mt-0.5 w-20 shrink-0 text-[12.5px] font-medium text-muted">
                      {ACT_ICON[a.type] ?? a.type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-line text-ink">{a.body}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {a.actorName ?? 'Automation'} · {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-4 text-muted">No activity yet.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Stage & owner">
            <StageAndOwner lead={L} team={team} canAssign={can(actor, 'leads.assign')} canWrite={canWrite} />
          </Panel>
          {canWrite && !closed ? (
            <Panel
              title="Qualification"
              actions={<span className="text-[12.5px] text-muted">Score {lead.score ?? '—'}</span>}
            >
              <Qualification lead={L} questions={QUALIFICATION_QUESTIONS} />
            </Panel>
          ) : null}
          <Panel title="Communication preferences">
            {canWrite ? (
              <Consent lead={L} />
            ) : (
              <p>
                {lead.suppressed ? 'Opted out' : lead.consentMarketing ? 'Consented' : 'No marketing consent'}
              </p>
            )}
            {lead.consentCapturedAt ? (
              <p className="mt-2 text-[12.5px] text-muted">
                Consent recorded {formatDateTime(lead.consentCapturedAt)} via {lead.consentSource}
              </p>
            ) : null}
          </Panel>
          {canSendWhatsApp(actor) && !lead.deletedAt ? (
            <Panel
              title="WhatsApp"
              actions={
                wa.state === 'ready' && wa.mode === 'demo' ? <Badge tone="demo">Demo mode</Badge> : null
              }
            >
              {wa.state === 'disconnected' ? (
                <p className="text-muted">
                  WhatsApp Business isn’t connected.{' '}
                  {can(actor, 'settings.integrations') ? (
                    <Link href="/settings/integrations" className="text-accent hover:underline">
                      Connect it in Settings → Integrations
                    </Link>
                  ) : (
                    'Ask an administrator to connect it.'
                  )}
                </p>
              ) : wa.state === 'misconfigured' ? (
                <p className="text-warn">
                  WhatsApp is not fully configured (missing: {wa.missing.join(', ')}).
                </p>
              ) : waBlocker ? (
                <p className="text-muted">{waBlocker}</p>
              ) : (
                <WhatsAppSend
                  leadId={lead.id}
                  demo={wa.mode === 'demo'}
                  templates={wa.templates.map((t) => ({
                    key: `${t.name}:${t.language}`,
                    label: t.label,
                    params: t.params,
                  }))}
                />
              )}
            </Panel>
          ) : null}
          {!lead.deletedAt ? (
            <MeetingsPanel
              actor={actor}
              leadId={lead.id}
              canWrite={canWrite && !closed}
              defaultAttendees={lead.suppressed ? null : lead.email}
            />
          ) : null}
          <Panel title="Follow-up tasks" bodyClassName="p-0">
            {tasks.length ? (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/tasks/${t.id}`} className="min-w-0 truncate hover:underline">
                      {t.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-muted">
                      {relativeTime(t.dueAt)} <StatusBadge status={t.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">No tasks.</p>
            )}
          </Panel>
          {can(actor, 'leads.delete') ? (
            <div className="text-right">
              <ArchiveLead id={lead.id} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
