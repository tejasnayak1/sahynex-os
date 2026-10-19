'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { ActionButton } from '@/components/client/auto-submit';
import { Dialog } from '@/components/client/dialog';
import { inputClass, textareaClass } from '@/components/ui';
import {
  approveDiscountAction,
  createProposalAction,
  dealStageAction,
  decideHandoverAction,
  proposalResponseAction,
  saveHandoverAction,
  sendProposalAction,
  updateDealAction,
} from '../actions';

type D = {
  id: string;
  title: string;
  stage: string;
  valueMinor: number;
  probability: number;
  expectedCloseDate: string | null;
  services: string[];
  nextAction: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  discountPct: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  renewalDate: string | null;
  ownerId: string;
};

export function EditDeal({
  deal,
  team,
  closed,
}: {
  deal: D;
  team: Array<{ id: string; name: string }>;
  closed: boolean;
}) {
  return (
    <Dialog trigger="Edit deal" title="Edit deal" triggerSize="sm" wide>
      {(close) => (
        <ActionForm
          action={updateDealAction}
          onSuccess={close}
          successMessage="Deal saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={deal.id} />
          {!closed ? (
            <>
              <FormField label="Title" name="title" className="sm:col-span-2">
                <input id="title" name="title" defaultValue={deal.title} className={inputClass} />
              </FormField>
              <FormField label="Value (₹)" name="value">
                <input
                  id="value"
                  name="value"
                  defaultValue={deal.valueMinor / 100}
                  inputMode="decimal"
                  className={inputClass}
                />
              </FormField>
              <FormField
                label="Probability (%)"
                name="probability"
                hint="Defaults from stage; override if you know better."
              >
                <input
                  id="probability"
                  name="probability"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={deal.probability}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Expected close" name="expectedCloseDate">
                <input
                  id="expectedCloseDate"
                  name="expectedCloseDate"
                  type="date"
                  defaultValue={deal.expectedCloseDate ?? ''}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Owner" name="ownerId">
                <select id="ownerId" name="ownerId" defaultValue={deal.ownerId} className={inputClass}>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Services" name="services" className="sm:col-span-2">
                <input
                  id="services"
                  name="services"
                  defaultValue={deal.services.join(', ')}
                  className={inputClass}
                />
              </FormField>
              <FormField
                label="Discount (%)"
                name="discountPct"
                hint="Above the approval threshold, a director must approve."
              >
                <input
                  id="discountPct"
                  name="discountPct"
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  defaultValue={deal.discountPct ?? ''}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Next action" name="nextAction">
                <input
                  id="nextAction"
                  name="nextAction"
                  defaultValue={deal.nextAction ?? ''}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Contact" name="contactName">
                <input
                  id="contactName"
                  name="contactName"
                  defaultValue={deal.contactName ?? ''}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Contact email" name="contactEmail">
                <input
                  id="contactEmail"
                  name="contactEmail"
                  defaultValue={deal.contactEmail ?? ''}
                  className={inputClass}
                />
              </FormField>
            </>
          ) : null}
          <FormField label="Contract start" name="contractStart">
            <input
              id="contractStart"
              name="contractStart"
              type="date"
              defaultValue={deal.contractStart ?? ''}
              className={inputClass}
            />
          </FormField>
          <FormField label="Contract end" name="contractEnd">
            <input
              id="contractEnd"
              name="contractEnd"
              type="date"
              defaultValue={deal.contractEnd ?? ''}
              className={inputClass}
            />
          </FormField>
          <FormField label="Renewal date" name="renewalDate">
            <input
              id="renewalDate"
              name="renewalDate"
              type="date"
              defaultValue={deal.renewalDate ?? ''}
              className={inputClass}
            />
          </FormField>
          <div className="sm:col-span-2">
            <SubmitButton>Save deal</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CloseDeal({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <Dialog trigger="Mark won" title="Mark deal won" triggerVariant="primary" triggerSize="sm">
        {(close) => (
          <ActionForm action={dealStageAction} onSuccess={close} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="stage" value="won" />
            <p className="text-[13.5px] text-ink-2">
              Winning starts the handover to operations: a handover task is created and operations leads are
              notified. Open sales follow-ups stop.
            </p>
            <FormField label="Note (optional)" name="note">
              <input id="note" name="note" className={inputClass} />
            </FormField>
            <SubmitButton>Mark won</SubmitButton>
          </ActionForm>
        )}
      </Dialog>
      <Dialog trigger="Mark lost" title="Mark deal lost" triggerSize="sm">
        {(close) => (
          <ActionForm action={dealStageAction} onSuccess={close} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="stage" value="lost" />
            <FormField label="Why was it lost?" name="lostReason" required>
              <input
                id="lostReason"
                name="lostReason"
                required
                className={inputClass}
                placeholder="e.g. Budget moved to next year, chose competitor"
              />
            </FormField>
            <SubmitButton variant="danger">Mark lost</SubmitButton>
          </ActionForm>
        )}
      </Dialog>
    </div>
  );
}

export function ApproveDiscount({ id }: { id: string }) {
  return (
    <ActionButton
      action={approveDiscountAction}
      hidden={{ id }}
      variant="primary"
      confirm="Approve this discount?"
    >
      Approve discount
    </ActionButton>
  );
}

export function NewProposal({ dealId, valueMinor }: { dealId: string; valueMinor: number }) {
  return (
    <Dialog trigger="New proposal version" title="New proposal version" triggerSize="sm">
      {(close) => (
        <ActionForm action={createProposalAction} onSuccess={close} className="space-y-3">
          <input type="hidden" name="dealId" value={dealId} />
          <FormField label="Title" name="title" required>
            <input id="title" name="title" required className={inputClass} />
          </FormField>
          <FormField label="Value (₹)" name="value">
            <input
              id="value"
              name="value"
              defaultValue={valueMinor / 100}
              inputMode="decimal"
              className={inputClass}
            />
          </FormField>
          <FormField
            label="Document link"
            name="documentUrl"
            hint="Link to the proposal in Drive / Docs (https://)."
          >
            <input id="documentUrl" name="documentUrl" type="url" className={inputClass} />
          </FormField>
          <FormField label="Summary" name="summary">
            <textarea id="summary" name="summary" className={textareaClass} />
          </FormField>
          <p className="text-[12.5px] text-muted">Earlier draft or sent versions are marked superseded.</p>
          <SubmitButton>Save draft</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ProposalActions({ id, status }: { id: string; status: string }) {
  if (status === 'draft')
    return (
      <ActionButton
        action={sendProposalAction}
        hidden={{ proposalId: id }}
        confirm="Mark this proposal as sent to the client? Follow-up reminders will be scheduled."
      >
        Mark sent
      </ActionButton>
    );
  if (status === 'sent')
    return (
      <span className="flex gap-1.5">
        <ActionButton action={proposalResponseAction} hidden={{ proposalId: id, accepted: 'true' }}>
          Accepted
        </ActionButton>
        <ActionButton
          action={proposalResponseAction}
          hidden={{ proposalId: id, accepted: 'false' }}
          variant="ghost"
        >
          Rejected
        </ActionButton>
      </span>
    );
  return null;
}

type H = {
  projectName: string;
  scope: string | null;
  deliverablesSummary: string | null;
  proposedOwnerId: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  budgetMinor: number | null;
  templateKey: string | null;
  status: string;
} | null;

export function HandoverForm({
  dealId,
  h,
  team,
  templates,
  title,
}: {
  dealId: string;
  h: H;
  team: Array<{ id: string; name: string }>;
  templates: Array<{ key: string; name: string }>;
  title: string;
}) {
  return (
    <ActionForm action={saveHandoverAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="dealId" value={dealId} />
      <FormField label="Project name" name="projectName" required className="sm:col-span-2">
        <input
          id="projectName"
          name="projectName"
          required
          defaultValue={h?.projectName ?? title}
          className={inputClass}
        />
      </FormField>
      <FormField label="Scope" name="scope" required className="sm:col-span-2">
        <textarea
          id="scope"
          name="scope"
          defaultValue={h?.scope ?? ''}
          className={textareaClass}
          placeholder="What’s included and excluded, channels, markets, success measures"
        />
      </FormField>
      <FormField label="Deliverables" name="deliverablesSummary" required className="sm:col-span-2">
        <textarea
          id="deliverablesSummary"
          name="deliverablesSummary"
          defaultValue={h?.deliverablesSummary ?? ''}
          className={textareaClass}
          placeholder="e.g. 12 posters/month, 4 reels, landing page, monthly report"
        />
      </FormField>
      <FormField label="Project owner" name="proposedOwnerId" required>
        <select
          id="proposedOwnerId"
          name="proposedOwnerId"
          defaultValue={h?.proposedOwnerId ?? ''}
          className={inputClass}
        >
          <option value="">Choose…</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="Task template"
        name="templateKey"
        hint="Tasks and milestones are generated from this."
      >
        <select
          id="templateKey"
          name="templateKey"
          defaultValue={h?.templateKey ?? ''}
          className={inputClass}
        >
          <option value="">No template</option>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Target start" name="targetStart" required>
        <input
          id="targetStart"
          name="targetStart"
          type="date"
          defaultValue={h?.targetStart ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="Target end" name="targetEnd" required>
        <input
          id="targetEnd"
          name="targetEnd"
          type="date"
          defaultValue={h?.targetEnd ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="Approved budget (₹)" name="budget" required>
        <input
          id="budget"
          name="budget"
          defaultValue={h?.budgetMinor != null ? h.budgetMinor / 100 : ''}
          inputMode="decimal"
          className={inputClass}
        />
      </FormField>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton name="intent" value="save" variant="secondary">
          Save draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit">
          Submit for approval
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DecideHandover({ dealId }: { dealId: string }) {
  return (
    <ActionForm action={decideHandoverAction} className="space-y-2">
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="hnote" className="text-[13px] font-medium text-ink-2">
        Decision note
      </label>
      <input id="hnote" name="note" className={inputClass} placeholder="Required when sending back" />
      <div className="flex gap-2">
        <SubmitButton name="decision" value="approve" confirm="Approve commercials and create the project?">
          Approve & create project
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="secondary">
          Send back
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
