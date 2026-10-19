'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { InlineSelect } from '@/components/client/auto-submit';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass, textareaClass } from '@/components/ui';
import {
  activityAction,
  archiveAction,
  assignAction,
  consentAction,
  convertAction,
  duplicateAction,
  qualificationAction,
  stageAction,
  updateLeadAction,
  whatsappAction,
} from '../actions';

type L = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organisationName: string | null;
  interest: string | null;
  city: string | null;
  leadType: string;
  nextAction: string | null;
  nextActionAt: string | null;
  stage: string;
  ownerId: string | null;
  consentMarketing: boolean;
  suppressed: boolean;
  suppressedReason: string | null;
  qualificationData: Record<string, unknown>;
  clientId: string | null;
};

export function EditLead({ lead }: { lead: L }) {
  return (
    <Dialog trigger="Edit details" title="Edit lead" triggerSize="sm">
      {(close) => (
        <ActionForm
          action={updateLeadAction}
          successMessage="Lead saved"
          onSuccess={close}
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={lead.id} />
          <FormField label="Name" name="name" required>
            <input id="name" name="name" defaultValue={lead.name} className={inputClass} required />
          </FormField>
          <FormField label="Organisation" name="organisationName">
            <input
              id="organisationName"
              name="organisationName"
              defaultValue={lead.organisationName ?? ''}
              className={inputClass}
            />
          </FormField>
          <FormField label="Email" name="email">
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={lead.email ?? ''}
              className={inputClass}
            />
          </FormField>
          <FormField label="Phone" name="phone">
            <input id="phone" name="phone" defaultValue={lead.phone ?? ''} className={inputClass} />
          </FormField>
          <FormField label="Interest" name="interest">
            <input id="interest" name="interest" defaultValue={lead.interest ?? ''} className={inputClass} />
          </FormField>
          <FormField label="City" name="city">
            <input id="city" name="city" defaultValue={lead.city ?? ''} className={inputClass} />
          </FormField>
          <div className="sm:col-span-2">
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function LogActivity({ id }: { id: string }) {
  return (
    <ActionForm action={activityAction} resetOnSuccess className="space-y-2.5">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="type">
          Activity type
        </label>
        <select id="type" name="type" className={cn(inputClass, ' w-36')} defaultValue="call">
          <option value="call">Call</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
          <option value="note">Note</option>
        </select>
        <label className="sr-only" htmlFor="nextActionAt">
          Next follow-up
        </label>
        <input
          id="nextActionAt"
          name="nextActionAt"
          type="datetime-local"
          className={cn(inputClass, ' w-56')}
          title="Next follow-up (optional)"
        />
        <input
          name="nextAction"
          placeholder="Next action (optional)"
          aria-label="Next action"
          className={cn(inputClass, ' min-w-40 flex-1')}
        />
      </div>
      <label htmlFor="body" className="sr-only">
        What happened
      </label>
      <textarea
        id="body"
        name="body"
        required
        placeholder="What happened? e.g. Spoke to parent, shared fee structure, visiting campus Saturday."
        className={textareaClass}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          Logging a call, message, email or meeting marks the lead as contacted and completes the
          first-contact task.
        </p>
        <SubmitButton size="sm" pendingText="Logging…">
          Log activity
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

const STAGES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['qualified', 'Qualified'],
  ['unqualified', 'Unqualified'],
  ['lost', 'Lost'],
] as const;

export function StageAndOwner({
  lead,
  team,
  canAssign,
  canWrite,
}: {
  lead: L;
  team: Array<{ id: string; name: string }>;
  canAssign: boolean;
  canWrite: boolean;
}) {
  const closing = (
    <Dialog trigger="Close as lost / unqualified" title="Close lead" triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <ActionForm action={stageAction} onSuccess={close} successMessage="Lead closed" className="space-y-3">
          <input type="hidden" name="id" value={lead.id} />
          <FormField label="Outcome" name="stage">
            <select id="stage" name="stage" className={inputClass}>
              <option value="lost">Lost</option>
              <option value="unqualified">Unqualified</option>
            </select>
          </FormField>
          <FormField label="Reason" name="reason" required hint="Used in lost-reason reporting.">
            <input
              id="reason"
              name="reason"
              required
              className={inputClass}
              placeholder="e.g. Chose another college, not eligible, budget"
            />
          </FormField>
          <p className="text-[12.5px] text-muted">
            Open follow-up tasks for this lead will be cancelled and reminders stop.
          </p>
          <SubmitButton variant="danger">Close lead</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">Stage</span>
        {canWrite && !['converted', 'lost', 'unqualified'].includes(lead.stage) ? (
          <InlineSelect
            action={stageAction}
            name="stage"
            value={lead.stage}
            label="Lead stage"
            hidden={{ id: lead.id }}
            options={STAGES.filter(([v]) => v !== 'lost' && v !== 'unqualified').map(([value, label]) => ({
              value,
              label,
            }))}
          />
        ) : (
          <span className="font-medium capitalize">{lead.stage}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">Owner</span>
        {canAssign ? (
          <InlineSelect
            action={assignAction}
            name="ownerId"
            value={lead.ownerId ?? ''}
            label="Lead owner"
            hidden={{ id: lead.id }}
            options={[
              ...(lead.ownerId ? [] : [{ value: '', label: 'Unassigned' }]),
              ...team.map((t) => ({ value: t.id, label: t.name })),
            ]}
            successMessage="Owner updated — they’ve been notified"
          />
        ) : (
          <span>{team.find((t) => t.id === lead.ownerId)?.name ?? 'Unassigned'}</span>
        )}
      </div>
      {canWrite && !['converted', 'lost', 'unqualified'].includes(lead.stage) ? (
        <div className="text-right">{closing}</div>
      ) : null}
    </div>
  );
}

export function Qualification({
  lead,
  questions,
}: {
  lead: L;
  questions: Array<{ key: string; label: string }>;
}) {
  return (
    <ActionForm action={qualificationAction} className="space-y-2">
      <input type="hidden" name="id" value={lead.id} />
      {questions.map((q) => (
        <label key={q.key} className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            name={q.key}
            defaultChecked={lead.qualificationData[q.key] === true}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          {q.label}
        </label>
      ))}
      <label htmlFor="qnotes" className="sr-only">
        Notes
      </label>
      <input id="qnotes" name="notes" placeholder="Notes (optional)" className={inputClass} />
      <SubmitButton size="sm" variant="secondary">
        Save qualification
      </SubmitButton>
    </ActionForm>
  );
}

export function Consent({ lead }: { lead: L }) {
  return (
    <ActionForm action={consentAction} className="space-y-2">
      <input type="hidden" name="id" value={lead.id} />
      <label className="flex items-center gap-2 text-[13.5px]">
        <input
          type="checkbox"
          name="consent"
          defaultChecked={lead.consentMarketing}
          className="h-4 w-4 accent-[var(--accent)]"
        />{' '}
        Consented to marketing communication
      </label>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input
          type="checkbox"
          name="suppressed"
          defaultChecked={lead.suppressed}
          className="h-4 w-4 accent-[var(--accent)]"
        />{' '}
        Opted out / do not contact for marketing
      </label>
      <input
        name="reason"
        aria-label="Opt-out reason"
        placeholder="Opt-out reason"
        defaultValue={lead.suppressedReason ?? ''}
        className={inputClass}
      />
      <SubmitButton size="sm" variant="secondary">
        Save preferences
      </SubmitButton>
    </ActionForm>
  );
}

export function Convert({ lead }: { lead: L }) {
  return (
    <Dialog trigger="Convert to deal" title="Convert to deal" triggerVariant="primary" triggerSize="sm">
      {() => (
        <ActionForm action={convertAction} className="space-y-3">
          <input type="hidden" name="id" value={lead.id} />
          <FormField label="Deal title" name="title">
            <input
              id="title"
              name="title"
              defaultValue={`${lead.organisationName ?? lead.name} — ${lead.interest ?? 'new engagement'}`}
              className={inputClass}
            />
          </FormField>
          <FormField label="Estimated value (₹)" name="value">
            <input
              id="value"
              name="value"
              inputMode="decimal"
              className={inputClass}
              placeholder="e.g. 350000"
            />
          </FormField>
          <FormField label="Services (comma-separated)" name="services">
            <input
              id="services"
              name="services"
              className={inputClass}
              placeholder="Performance marketing, Website"
            />
          </FormField>
          <SubmitButton>Create deal</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function DuplicateReview({ id, canArchive }: { id: string; canArchive: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={duplicateAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="resolution" value="distinct" />
        <SubmitButton size="sm" variant="secondary">
          It’s a different person
        </SubmitButton>
      </ActionForm>
      {canArchive ? (
        <ActionForm action={duplicateAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="resolution" value="archive" />
          <SubmitButton
            size="sm"
            variant="danger"
            confirm="Archive this lead as a duplicate? The original lead is kept."
          >
            Archive as duplicate
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function ArchiveLead({ id }: { id: string }) {
  return (
    <ActionForm action={archiveAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        size="sm"
        variant="ghost"
        confirm="Archive this lead? It will be hidden from lists and its open follow-ups cancelled."
      >
        Archive lead
      </SubmitButton>
    </ActionForm>
  );
}

export function WhatsAppSend({
  leadId,
  templates,
  demo,
}: {
  leadId: string;
  templates: Array<{ key: string; label: string; params: string[] }>;
  demo: boolean;
}) {
  return (
    <ActionForm action={whatsappAction} className="grid gap-2">
      <input type="hidden" name="id" value={leadId} />
      <FormField label="Approved template" name="template">
        <select id="template" name="template" className={inputClass} required defaultValue="">
          <option value="" disabled>
            Choose a template…
          </option>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
              {t.params.length ? ` (uses ${t.params.join(', ').replace(/_/g, ' ')})` : ''}
            </option>
          ))}
        </select>
      </FormField>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          {demo
            ? 'Demo mode: nothing is sent; the attempt is logged and labelled.'
            : 'Sends one message now. The same template can’t be re-sent to this lead within 24 hours.'}
        </p>
        <SubmitButton
          size="sm"
          variant="secondary"
          pendingText="Sending…"
          confirm={demo ? undefined : 'Send this WhatsApp template to the lead now?'}
        >
          {demo ? 'Log demo send' : 'Send'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
