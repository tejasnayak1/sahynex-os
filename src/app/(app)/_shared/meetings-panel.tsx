import { addDays, differenceInMinutes, setHours, setMinutes } from 'date-fns';
import { Badge, Panel, StatusBadge } from '@/components/ui';
import { formatDateTime, toDateTimeLocal } from '@/lib/format';
import type { Actor } from '@/server/actor';
import { listMeetings, PURPOSE_LABEL, type MEETING_PURPOSES } from '@/server/services/meetings';
import { CancelMeeting, CompleteMeeting, RescheduleMeeting, ScheduleMeeting } from './meeting-forms';

const TZ = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';

/** Meetings for a deal or lead: schedule, reschedule, cancel, record outcomes, download invites. */
export async function MeetingsPanel({
  actor,
  dealId,
  leadId,
  canWrite,
  defaultAttendees,
  dealStage,
}: {
  actor: Actor;
  dealId?: string;
  leadId?: string;
  canWrite: boolean;
  defaultAttendees?: string | null;
  dealStage?: string;
}) {
  const rows = await listMeetings(actor, dealId ? { dealId } : { leadId: leadId! });
  const now = new Date();
  const upcoming = rows.filter((m) => m.status === 'scheduled');
  const past = rows.filter((m) => m.status !== 'scheduled').reverse();
  // Suggest tomorrow 11:00 local as a sensible default slot.
  const suggested = setMinutes(setHours(addDays(now, 1), 11), 0);
  const closedDeal = dealStage === 'won' || dealStage === 'lost';
  const canAdvance = dealStage === 'new_prospect' || dealStage === 'qualified';
  return (
    <Panel
      title="Meetings"
      bodyClassName="p-0"
      actions={
        canWrite && !closedDeal ? (
          <ScheduleMeeting
            dealId={dealId}
            leadId={leadId}
            defaultAttendees={defaultAttendees ?? ''}
            defaultStart={toDateTimeLocal(suggested, TZ)}
            tzLabel={TZ === 'Asia/Kolkata' ? 'IST' : TZ}
          />
        ) : null
      }
    >
      {rows.length ? (
        <ul className="divide-y divide-line">
          {[...upcoming, ...past].map((m) => {
            const started = m.startAt <= now;
            return (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{m.title}</div>
                    <div className="text-[12.5px] text-muted">
                      {PURPOSE_LABEL[m.purpose as (typeof MEETING_PURPOSES)[number]] ?? 'Meeting'} ·{' '}
                      {formatDateTime(m.startAt)} · {differenceInMinutes(m.endAt, m.startAt)} min ·{' '}
                      {m.organizerName}
                    </div>
                    {m.location ? (
                      <div className="truncate text-[12.5px] text-muted">
                        {/^https?:\/\//i.test(m.location) ? (
                          <a
                            href={m.location}
                            className="hover:underline"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {m.location}
                          </a>
                        ) : (
                          m.location
                        )}
                      </div>
                    ) : null}
                    {m.attendees.length ? (
                      <div className="text-[12.5px] text-muted">
                        {m.attendees.length} attendee{m.attendees.length === 1 ? '' : 's'}
                        {m.inviteEmailedAt ? ' · invite emailed' : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.status === 'scheduled' && started ? <Badge tone="warn">Outcome due</Badge> : null}
                    <StatusBadge status={m.status} label={m.status === 'no_show' ? 'No-show' : undefined} />
                  </div>
                </div>
                {m.outcome ? (
                  <p className="mt-1.5 whitespace-pre-line text-[13px] text-ink-2">{m.outcome}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <a
                    href={`/api/meetings/${m.id}/ics`}
                    className="inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
                  >
                    Download invite (.ics)
                  </a>
                  {canWrite && m.status === 'scheduled' ? (
                    <>
                      {started ? (
                        <CompleteMeeting id={m.id} isDeal={Boolean(dealId)} canAdvance={canAdvance} />
                      ) : (
                        <RescheduleMeeting
                          id={m.id}
                          start={toDateTimeLocal(m.startAt, TZ)}
                          duration={differenceInMinutes(m.endAt, m.startAt)}
                          location={m.location ?? ''}
                          invited={Boolean(m.inviteEmailedAt)}
                          tzLabel={TZ === 'Asia/Kolkata' ? 'IST' : TZ}
                        />
                      )}
                      <CancelMeeting id={m.id} invited={Boolean(m.inviteEmailedAt)} />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-muted">
          No meetings yet.{' '}
          {canWrite && !closedDeal
            ? 'Schedule one — it lands on your task calendar and you get a calendar invite to send.'
            : ''}
        </p>
      )}
    </Panel>
  );
}
