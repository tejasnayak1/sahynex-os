'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { inputClass, textareaClass } from '@/components/ui';
import {
  cancelMeetingAction,
  completeMeetingAction,
  rescheduleMeetingAction,
  scheduleMeetingAction,
} from './meeting-actions';

const PURPOSES: Array<[string, string]> = [
  ['discovery', 'Discovery meeting'],
  ['proposal_review', 'Proposal walkthrough'],
  ['negotiation', 'Negotiation'],
  ['kickoff', 'Kick-off'],
  ['other', 'Other'],
];
const DURATIONS = [15, 30, 45, 60, 90, 120];

function EmailInviteBox({ defaultChecked = false, label }: { defaultChecked?: boolean; label: string }) {
  return (
    <label className="flex items-start gap-2 text-[13.5px] sm:col-span-2">
      <input
        type="checkbox"
        name="emailInvite"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
      />
      <span>
        {label}
        <span className="block text-[12.5px] text-muted">
          Sent only when you tick this. You can always download the .ics instead.
        </span>
      </span>
    </label>
  );
}

export function ScheduleMeeting({
  dealId,
  leadId,
  defaultAttendees,
  defaultStart,
  tzLabel,
}: {
  dealId?: string;
  leadId?: string;
  defaultAttendees: string;
  defaultStart: string;
  tzLabel: string;
}) {
  return (
    <Dialog trigger="Schedule meeting" title="Schedule a meeting" triggerSize="sm" wide>
      {(close) => (
        <ActionForm action={scheduleMeetingAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
          {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
          <FormField label="Purpose" name="purpose">
            <select id="purpose" name="purpose" defaultValue="discovery" className={inputClass}>
              {PURPOSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" name="title" hint="Leave blank for “Purpose — organisation”.">
            <input id="title" name="title" className={inputClass} maxLength={200} />
          </FormField>
          <FormField label={`Starts (${tzLabel})`} name="startAt" required>
            <input
              id="startAt"
              name="startAt"
              type="datetime-local"
              required
              defaultValue={defaultStart}
              className={inputClass}
            />
          </FormField>
          <FormField label="Duration" name="durationMinutes">
            <select id="durationMinutes" name="durationMinutes" defaultValue="45" className={inputClass}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Location or video link"
            name="location"
            className="sm:col-span-2"
            hint="A Meet/Zoom/Teams URL, or the campus address."
          >
            <input id="location" name="location" className={inputClass} maxLength={500} />
          </FormField>
          <FormField
            label="Attendee emails"
            name="attendees"
            className="sm:col-span-2"
            hint="Separate with commas. Up to 20."
          >
            <input id="attendees" name="attendees" defaultValue={defaultAttendees} className={inputClass} />
          </FormField>
          <FormField label="Agenda" name="agenda" className="sm:col-span-2">
            <textarea
              id="agenda"
              name="agenda"
              rows={3}
              className={textareaClass}
              placeholder="Goals for the meeting, questions to answer, who should attend…"
            />
          </FormField>
          <EmailInviteBox label="Email a calendar invite to the attendees" />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <SubmitButton pendingText="Scheduling…">Schedule</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function RescheduleMeeting({
  id,
  start,
  duration,
  location,
  invited,
  tzLabel,
}: {
  id: string;
  start: string;
  duration: number;
  location: string;
  invited: boolean;
  tzLabel: string;
}) {
  return (
    <Dialog trigger="Reschedule" title="Reschedule meeting" triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <ActionForm action={rescheduleMeetingAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={id} />
          <FormField label={`Starts (${tzLabel})`} name="startAt" required>
            <input
              id="startAt"
              name="startAt"
              type="datetime-local"
              required
              defaultValue={start}
              className={inputClass}
            />
          </FormField>
          <FormField label="Duration (minutes)" name="durationMinutes">
            <input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={15}
              max={480}
              step={5}
              defaultValue={duration}
              className={inputClass}
            />
          </FormField>
          <FormField label="Location or video link" name="location" className="sm:col-span-2">
            <input id="location" name="location" defaultValue={location} className={inputClass} />
          </FormField>
          <EmailInviteBox
            defaultChecked={invited}
            label="Email the updated invite to the attendees (replaces the original event)"
          />
          <div className="flex justify-end sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CompleteMeeting({
  id,
  isDeal,
  canAdvance,
}: {
  id: string;
  isDeal: boolean;
  canAdvance: boolean;
}) {
  return (
    <Dialog
      trigger="Record outcome"
      title="Record meeting outcome"
      triggerSize="sm"
      triggerVariant="secondary"
    >
      {(close) => (
        <ActionForm action={completeMeetingAction} onSuccess={close} className="grid gap-3">
          <input type="hidden" name="id" value={id} />
          <FormField label="What happened?" name="status">
            <select id="status" name="status" defaultValue="completed" className={inputClass}>
              <option value="completed">Meeting held</option>
              <option value="no_show">They did not attend</option>
            </select>
          </FormField>
          <FormField
            label="Notes and agreed next step"
            name="outcome"
            hint="Required when the meeting was held."
          >
            <textarea id="outcome" name="outcome" rows={4} className={textareaClass} />
          </FormField>
          {isDeal && canAdvance ? (
            <label className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                name="markDiscoveryCompleted"
                defaultChecked
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Move the deal to “Discovery completed”
            </label>
          ) : null}
          <div className="flex justify-end">
            <SubmitButton>Save outcome</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CancelMeeting({ id, invited }: { id: string; invited: boolean }) {
  return (
    <Dialog trigger="Cancel" title="Cancel meeting" triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <ActionForm action={cancelMeetingAction} onSuccess={close} className="grid gap-3">
          <input type="hidden" name="id" value={id} />
          <FormField label="Reason (optional)" name="reason">
            <input id="reason" name="reason" className={inputClass} maxLength={1000} />
          </FormField>
          {invited ? (
            <label className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                name="emailInvite"
                defaultChecked
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Email a cancellation to the invited attendees
            </label>
          ) : null}
          <div className="flex justify-end">
            <SubmitButton variant="danger" confirm="Cancel this meeting?">
              Cancel meeting
            </SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
