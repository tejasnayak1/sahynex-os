import Link from 'next/link';
import { Badge, DescList, Notice, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { FORMAT_LABEL, getDeliverable } from '@/server/services/deliverables';
import { signedFileUrl } from '@/server/storage';
import { Decide, Publish, SubmitForReview, UploadVersion } from '../forms';

export const metadata = { title: 'Deliverable' };

const FLOW = ['draft', 'internal_review', 'submitted_to_client', 'approved', 'published'] as const;
const FLOW_LABEL: Record<string, string> = {
  draft: 'Draft',
  internal_review: 'Internal review',
  submitted_to_client: 'Client review',
  approved: 'Approved',
  published: 'Published',
};

export default async function DeliverablePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('content.read');
  const { id } = await params;
  const d = await getDeliverable(actor, id);
  const del = d.deliverable;
  const team = actor.clientId ? [] : await teamOptions(actor.orgId);
  const canWrite = can(actor, 'content.write') && !actor.clientId;
  const pending = d.approvals.find((a) => a.decision === 'pending' && a.version === del.currentVersion);
  const canDecide =
    pending &&
    (pending.stage === 'internal'
      ? can(actor, 'approvals.internal') && !actor.clientId
      : can(actor, 'approvals.client'));
  const flowIdx = Math.max(
    0,
    FLOW.indexOf(
      (['changes_requested', 'revised'].includes(del.status)
        ? 'draft'
        : del.status === 'scheduled'
          ? 'approved'
          : del.status) as (typeof FLOW)[number],
    ),
  );
  const latest = d.versions[0];
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Content & deliverables', href: '/content' }, { label: del.ref }]}
        title={del.title}
        meta={
          <>
            <StatusBadge status={del.status} />
            <span>
              {FORMAT_LABEL[del.format]}
              {del.channel ? ` · ${del.channel}` : ''}
            </span>
            <span>{d.clientName}</span>
            {del.revisionCount ? <span>{del.revisionCount} revision round(s)</span> : null}
            {del.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
      />
      <ol className="mb-5 flex flex-wrap items-center gap-1 text-[13px]" aria-label="Approval progress">
        {FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden className={i <= flowIdx ? 'text-accent' : 'text-faint'}>
                —
              </span>
            ) : null}
            <span
              className={
                i < flowIdx
                  ? 'text-accent'
                  : i === flowIdx
                    ? 'rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent'
                    : 'text-faint'
              }
              aria-current={i === flowIdx ? 'step' : undefined}
            >
              {FLOW_LABEL[s]}
            </span>
          </li>
        ))}
        {del.status === 'changes_requested' ? (
          <li className="ml-2">
            <Badge tone="bad">Changes requested</Badge>
          </li>
        ) : null}
      </ol>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel
            title={latest ? `Version ${latest.version}` : 'No versions yet'}
            actions={
              latest ? (
                <a
                  className="text-[13px] text-accent hover:underline"
                  href={signedFileUrl(latest.id, actor.id) + '&download=1'}
                >
                  Download
                </a>
              ) : null
            }
          >
            {latest ? (
              latest.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signedFileUrl(latest.id, actor.id)}
                  alt={`${del.title}, version ${latest.version}`}
                  className="max-h-[520px] w-auto rounded border border-line bg-surface-2 object-contain"
                />
              ) : latest.mimeType.startsWith('video/') ? (
                <video
                  src={signedFileUrl(latest.id, actor.id)}
                  controls
                  className="max-h-[520px] w-full rounded border border-line"
                />
              ) : latest.mimeType === 'application/pdf' ? (
                <iframe
                  title={`${del.title} v${latest.version}`}
                  src={signedFileUrl(latest.id, actor.id)}
                  className="h-[560px] w-full rounded border border-line"
                />
              ) : (
                <p className="text-muted">{latest.fileName} — preview not available; download to view.</p>
              )
            ) : (
              <p className="text-muted">Upload the first version to start the review.</p>
            )}
            {latest ? (
              <p className="mt-2 text-[12.5px] text-muted">
                {latest.fileName} · {(latest.sizeBytes / 1024).toFixed(0)} KB · uploaded by{' '}
                {latest.uploadedByName ?? '—'} {formatDateTime(latest.createdAt)}
              </p>
            ) : null}
          </Panel>
          {canDecide && pending ? (
            <Panel
              title={
                pending.stage === 'internal'
                  ? `Internal review — v${pending.version}`
                  : `Client review — v${pending.version}`
              }
            >
              <Decide
                approvalId={pending.id}
                stage={pending.stage}
                onBehalf={pending.stage === 'client' && !actor.clientId}
              />
            </Panel>
          ) : pending ? (
            <Notice
              tone="info"
              title={`Waiting for ${pending.stage === 'client' ? 'the client' : 'internal review'}`}
            >
              Submitted {formatDateTime(pending.submittedAt)}. Reviewers get reminders automatically.
            </Notice>
          ) : null}
          {canWrite && ['draft', 'changes_requested', 'revised'].includes(del.status) ? (
            <Panel title="Next step">
              <div className="space-y-4">
                <UploadVersion id={del.id} next={del.currentVersion + 1} />
                {del.currentVersion > 0 && del.status !== 'changes_requested' ? (
                  <div className="border-t border-line pt-4">
                    <SubmitForReview id={del.id} reviewers={team} />
                  </div>
                ) : null}
              </div>
            </Panel>
          ) : null}
          {canWrite && ['approved', 'scheduled'].includes(del.status) ? (
            <Panel title="Publishing">
              <p className="mb-3 text-muted">
                {del.publishMode === 'manual'
                  ? 'Publishing is a manual handoff — no publishing API is connected for this channel.'
                  : ''}{' '}
                {del.publishAt ? `Planned for ${formatDateTime(del.publishAt)}.` : ''}
              </p>
              <Publish id={del.id} canSchedule={del.status === 'approved'} />
            </Panel>
          ) : null}
          {del.status === 'published' ? (
            <Notice tone="ok" title="Published">
              {formatDateTime(del.publishedAt)}
              {del.finalUrl ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={del.finalUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Live link
                  </a>
                </>
              ) : null}
            </Notice>
          ) : null}
          {!actor.clientId ? (
            <Panel title="Brief">
              <p className="whitespace-pre-line text-ink-2">{del.brief || '—'}</p>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-5">
          <Panel title="Details">
            <DescList
              cols={1}
              items={[
                [
                  'Project',
                  actor.clientId ? (
                    d.projectName
                  ) : (
                    <Link key="p" href={`/projects/${del.projectId}`} className="hover:underline">
                      {d.projectName}
                    </Link>
                  ),
                ],
                ['Creative owner', d.ownerName ?? '—'],
                ['Audience', del.audience ?? '—'],
                ['Due', formatDateTime(del.dueAt)],
                ['Planned publish', formatDateTime(del.publishAt)],
              ]}
            />
          </Panel>
          <Panel title="Approval history" bodyClassName="p-0">
            {d.approvals.length ? (
              <ol className="divide-y divide-line">
                {d.approvals.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        v{a.version} · {humanize(a.stage)}
                      </span>
                      <StatusBadge
                        status={
                          a.decision === 'approved'
                            ? 'approved'
                            : a.decision === 'changes_requested'
                              ? 'changes_requested'
                              : a.decision
                        }
                      />
                    </div>
                    <p className="text-[12.5px] text-muted">
                      Submitted {formatDateTime(a.submittedAt)}
                      {a.decidedAt
                        ? ` · decided ${formatDateTime(a.decidedAt)} by ${a.decidedByName ?? '—'}`
                        : ''}
                    </p>
                    {a.feedback ? (
                      <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">“{a.feedback}”</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-4 text-muted">Not yet submitted.</p>
            )}
          </Panel>
          <Panel title="Versions" bodyClassName="p-0">
            {d.versions.length ? (
              <ul className="divide-y divide-line">
                {d.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <a className="text-accent hover:underline" href={signedFileUrl(v.id, actor.id)}>
                      v{v.version} · {v.fileName}
                    </a>
                    <span className="text-[12.5px] text-muted">{formatDateTime(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">None</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
