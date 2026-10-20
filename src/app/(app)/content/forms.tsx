'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass, textareaClass } from '@/components/ui';
import { decideAction, publishedAction, scheduleAction, submitReviewAction, uploadAction } from './actions';

type Opt = { id: string; name: string };

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
