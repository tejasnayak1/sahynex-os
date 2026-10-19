'use client';
import { useState } from 'react';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass, textareaClass } from '@/components/ui';
import {
  createDeliverableAction,
  decideAction,
  publishedAction,
  scheduleAction,
  submitReviewAction,
  uploadAction,
} from './actions';

type Opt = { id: string; name: string };

export function NewDeliverableForm({
  projects,
  team,
  templates,
  projectId,
  me,
}: {
  projects: Array<{ id: string; name: string; ref: string }>;
  team: Opt[];
  templates: Record<string, { label: string; brief: string }>;
  projectId?: string;
  me: string;
}) {
  const [format, setFormat] = useState('social_post');
  return (
    <ActionForm action={createDeliverableAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField label="Project" name="projectId" required>
        <select
          id="projectId"
          name="projectId"
          required
          defaultValue={projectId ?? ''}
          className={inputClass}
        >
          <option value="">Choose…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ref} · {p.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Format" name="format" hint="Each format starts with a brief template.">
        <select
          id="format"
          name="format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className={inputClass}
        >
          {Object.entries(templates).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Title" name="title" required className="sm:col-span-2">
        <input id="title" name="title" required className={inputClass} />
      </FormField>
      <FormField label="Channel" name="channel">
        <input
          id="channel"
          name="channel"
          placeholder="Instagram, YouTube, print, web…"
          className={inputClass}
        />
      </FormField>
      <FormField label="Audience" name="audience">
        <input id="audience" name="audience" className={inputClass} />
      </FormField>
      <FormField label="Creative owner" name="ownerId">
        <select id="ownerId" name="ownerId" defaultValue={me} className={inputClass}>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Due for review" name="dueAt">
        <input id="dueAt" name="dueAt" type="datetime-local" className={inputClass} />
      </FormField>
      <FormField label="Planned publish" name="publishAt">
        <input id="publishAt" name="publishAt" type="datetime-local" className={inputClass} />
      </FormField>
      <div />
      <FormField label="Brief" name="brief" className="sm:col-span-2">
        <textarea
          key={format}
          id="brief"
          name="brief"
          defaultValue={templates[format]?.brief}
          className={cn(textareaClass, 'min-h-44')}
        />
      </FormField>
      <div className="sm:col-span-2">
        <SubmitButton>Create deliverable</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UploadVersion({ id, next }: { id: string; next: number }) {
  return (
    <ActionForm action={uploadAction} resetOnSuccess className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <FormField
        label={`Upload version ${next}`}
        name="file"
        hint="PNG, JPEG, WebP, GIF, PDF, MP4, MOV or ZIP · up to 25 MB."
      >
        <input id="file" name="file" type="file" required className={cn(inputClass, 'py-1.5')} />
      </FormField>
      <input
        name="note"
        aria-label="Version note"
        placeholder="What changed? (optional)"
        className={inputClass}
      />
      <SubmitButton size="sm" pendingText="Uploading…">
        Upload
      </SubmitButton>
    </ActionForm>
  );
}

export function SubmitForReview({ id, reviewers }: { id: string; reviewers: Opt[] }) {
  return (
    <ActionForm action={submitReviewAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label="Internal reviewer" name="reviewerId" className="min-w-52 flex-1">
        <select id="reviewerId" name="reviewerId" className={inputClass} defaultValue="">
          <option value="">Project owner</option>
          {reviewers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </FormField>
      <SubmitButton size="md">Submit for review</SubmitButton>
    </ActionForm>
  );
}

export function Decide({
  approvalId,
  stage,
  onBehalf,
}: {
  approvalId: string;
  stage: string;
  onBehalf: boolean;
}) {
  return (
    <ActionForm action={decideAction} className="space-y-2">
      <input type="hidden" name="approvalId" value={approvalId} />
      <FormField
        label={onBehalf ? 'Who decided and how (required)' : 'Feedback'}
        name="feedback"
        hint={
          stage === 'client' && onBehalf
            ? 'You’re recording the client’s decision, e.g. “Approved by Dr. Shetty on WhatsApp, 12 Oct”.'
            : 'Required when requesting changes.'
        }
      >
        <textarea id="feedback" name="feedback" className={textareaClass} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approved">
          Approve
        </SubmitButton>
        <SubmitButton name="decision" value="changes_requested" variant="secondary">
          Request changes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function Publish({ id, canSchedule }: { id: string; canSchedule: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canSchedule ? (
        <Dialog trigger="Schedule" title="Schedule publication" triggerSize="sm">
          {(close) => (
            <ActionForm action={scheduleAction} onSuccess={close} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <FormField label="Publish at" name="publishAt" required>
                <input
                  id="publishAt"
                  name="publishAt"
                  type="datetime-local"
                  required
                  className={inputClass}
                />
              </FormField>
              <p className="text-[12.5px] text-muted">
                No publishing integration is connected, so this records the plan; the owner publishes manually
                and marks it published.
              </p>
              <SubmitButton>Schedule</SubmitButton>
            </ActionForm>
          )}
        </Dialog>
      ) : null}
      <Dialog trigger="Mark published" title="Mark as published" triggerSize="sm" triggerVariant="primary">
        {(close) => (
          <ActionForm action={publishedAction} onSuccess={close} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <FormField
              label="Live link"
              name="finalUrl"
              hint="Post URL, page URL or shared-drive link to the delivered file."
            >
              <input id="finalUrl" name="finalUrl" type="url" className={inputClass} />
            </FormField>
            <SubmitButton>Mark published</SubmitButton>
          </ActionForm>
        )}
      </Dialog>
    </div>
  );
}
