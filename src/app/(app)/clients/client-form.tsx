'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { inputClass, textareaClass } from '@/components/ui';
import { Pencil } from 'lucide-react';
import {
  addClientNoteAction,
  addContactAction,
  createClientAction,
  updateClientAction,
  updateContactAction,
} from './actions';

type C = {
  id?: string;
  name?: string;
  legalName?: string | null;
  orgType?: string;
  status?: string;
  accountOwnerId?: string | null;
  services?: string[];
  commercialTerms?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  renewalDate?: string | null;
  website?: string | null;
  city?: string | null;
  notes?: string | null;
  marketingBudgetMinor?: number | null;
  marketingBudgetPeriod?: string | null;
  brandingBudgetMinor?: number | null;
  brandingBudgetPeriod?: string | null;
};

function BudgetField({ kind, c }: { kind: 'marketing' | 'branding'; c: C }) {
  const amountName = `${kind}BudgetMinor`;
  const periodName = `${kind}BudgetPeriod`;
  const minor = c[amountName as 'marketingBudgetMinor'];
  const period = c[periodName as 'marketingBudgetPeriod'];
  const label = kind === 'marketing' ? 'Marketing budget' : 'Branding budget';
  return (
    <FormField
      label={label}
      name={amountName}
      hint="In rupees. Leave empty if not known — it shows as “Not set”, not ₹0."
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
            ₹
          </span>
          <input
            id={amountName}
            name={amountName}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={minor == null ? '' : String(minor / 100)}
            placeholder="Not set"
            className={`${inputClass} pl-7 tabular`}
          />
        </div>
        <select
          name={periodName}
          aria-label={`${label} period`}
          defaultValue={period ?? 'monthly'}
          className={`${inputClass} w-32 shrink-0`}
        >
          <option value="monthly">per month</option>
          <option value="annual">per year</option>
        </select>
      </div>
    </FormField>
  );
}

function Fields({ c, team }: { c: C; team: Array<{ id: string; name: string }> }) {
  return (
    <>
      <FormField label="Name" name="name" required>
        <input id="name" name="name" required defaultValue={c.name} className={inputClass} />
      </FormField>
      <FormField label="Legal name" name="legalName">
        <input id="legalName" name="legalName" defaultValue={c.legalName ?? ''} className={inputClass} />
      </FormField>
      <FormField label="Type" name="orgType">
        <select
          id="orgType"
          name="orgType"
          defaultValue={c.orgType ?? 'educational_institution'}
          className={inputClass}
        >
          <option value="educational_institution">Educational institution</option>
          <option value="company">Company</option>
          <option value="media">Media</option>
          <option value="community">Community organisation</option>
          <option value="government">Government</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Status" name="status">
        <select id="status" name="status" defaultValue={c.status ?? 'onboarding'} className={inputClass}>
          <option value="onboarding">Onboarding</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="churned">Churned</option>
        </select>
      </FormField>
      <FormField label="Account owner" name="accountOwnerId">
        <select
          id="accountOwnerId"
          name="accountOwnerId"
          defaultValue={c.accountOwnerId ?? ''}
          className={inputClass}
        >
          <option value="">Me</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Services engaged" name="services">
        <input
          id="services"
          name="services"
          defaultValue={c.services?.join(', ')}
          className={inputClass}
          placeholder="Comma-separated"
        />
      </FormField>
      <FormField label="City" name="city">
        <input id="city" name="city" defaultValue={c.city ?? ''} className={inputClass} />
      </FormField>
      <FormField label="Website" name="website">
        <input id="website" name="website" type="url" defaultValue={c.website ?? ''} className={inputClass} />
      </FormField>
      <FormField label="Contract start" name="contractStart">
        <input
          id="contractStart"
          name="contractStart"
          type="date"
          defaultValue={c.contractStart ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="Contract end" name="contractEnd">
        <input
          id="contractEnd"
          name="contractEnd"
          type="date"
          defaultValue={c.contractEnd ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField
        label="Renewal date"
        name="renewalDate"
        hint="Renewal reminders appear on the dashboard and finance view."
      >
        <input
          id="renewalDate"
          name="renewalDate"
          type="date"
          defaultValue={c.renewalDate ?? ''}
          className={inputClass}
        />
      </FormField>
      <div />
      <BudgetField kind="marketing" c={c} />
      <BudgetField kind="branding" c={c} />
      <FormField label="Commercial terms" name="commercialTerms" className="sm:col-span-2">
        <textarea
          id="commercialTerms"
          name="commercialTerms"
          defaultValue={c.commercialTerms ?? ''}
          className={textareaClass}
        />
      </FormField>
      <FormField label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" defaultValue={c.notes ?? ''} className={textareaClass} />
      </FormField>
    </>
  );
}

export function NewClientForm({ team }: { team: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={createClientAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Fields c={{}} team={team} />
      <div className="sm:col-span-2">
        <SubmitButton>Create client</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditClient({
  c,
  team,
  primary,
  label,
}: {
  c: C;
  team: Array<{ id: string; name: string }>;
  primary?: boolean;
  label?: string;
}) {
  return (
    <Dialog
      trigger={
        label ? (
          <>
            <Pencil size={14} aria-hidden /> {label}
          </>
        ) : (
          'Edit client'
        )
      }
      triggerLabel={label ? 'Edit client' : undefined}
      title="Edit client"
      triggerSize={primary ? 'md' : 'sm'}
      triggerVariant={primary ? 'primary' : 'secondary'}
      triggerClassName={primary ? 'h-11 px-5 text-[15px]' : undefined}
      wide
      guardUnsaved
    >
      {(close) => (
        <ActionForm
          action={updateClientAction}
          onSuccess={close}
          successMessage="Client saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={c.id} />
          <Fields c={c} team={team} />
          <div className="sm:col-span-2">
            <SubmitButton>Save client</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  isPrimary: boolean;
  isApprover: boolean;
};

function ContactFields({ ct }: { ct?: Contact }) {
  return (
    <>
      <FormField label="Name" name="name" required>
        <input id="name" name="name" required defaultValue={ct?.name} className={inputClass} />
      </FormField>
      <FormField label="Designation" name="designation">
        <input
          id="designation"
          name="designation"
          defaultValue={ct?.designation ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="Email" name="email">
        <input id="email" name="email" type="email" defaultValue={ct?.email ?? ''} className={inputClass} />
      </FormField>
      <FormField label="Phone" name="phone">
        <input id="phone" name="phone" type="tel" defaultValue={ct?.phone ?? ''} className={inputClass} />
      </FormField>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={ct?.isPrimary}
          className="h-4 w-4 accent-[var(--accent)]"
        />{' '}
        Primary contact
      </label>
      <label className="flex items-center gap-2 text-[13.5px]">
        <input
          type="checkbox"
          name="isApprover"
          defaultChecked={ct?.isApprover}
          className="h-4 w-4 accent-[var(--accent)]"
        />{' '}
        Designated approver
      </label>
    </>
  );
}

export function AddContact({ clientId }: { clientId: string }) {
  return (
    <Dialog trigger="Add contact" title="Add contact" triggerSize="sm" guardUnsaved>
      {(close) => (
        <ActionForm action={addContactAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="clientId" value={clientId} />
          <ContactFields />
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Adding…">Add contact</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditContact({ ct }: { ct: Contact }) {
  return (
    <Dialog
      trigger={
        <>
          <Pencil size={14} aria-hidden /> Edit
        </>
      }
      triggerLabel={`Edit ${ct.name}`}
      title={`Edit ${ct.name}`}
      triggerSize="sm"
      triggerVariant="secondary"
      guardUnsaved
    >
      {(close) => (
        <ActionForm action={updateContactAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={ct.id} />
          <ContactFields ct={ct} />
          <p className="text-[12.5px] text-muted sm:col-span-2">
            Making this person the primary contact replaces the current primary contact for this client.
          </p>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Saving…">Save contact</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

/** Quick edit of just the two budgets (same server action and checks as the full client edit). */
export function EditBudgets({ c }: { c: C }) {
  return (
    <Dialog trigger="Edit budgets" title="Budgets" triggerSize="sm" triggerVariant="ghost" guardUnsaved>
      {(close) => (
        <ActionForm
          action={updateClientAction}
          onSuccess={close}
          successMessage="Budgets saved"
          className="grid gap-3"
        >
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="_scope" value="budgets" />
          <BudgetField kind="marketing" c={c} />
          <BudgetField kind="branding" c={c} />
          <div>
            <SubmitButton pendingText="Saving…">Save budgets</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

/** Edit one budget (amount + period) from its tile. */
export function EditOneBudget({ c, kind }: { c: C; kind: 'marketing' | 'branding' }) {
  const label = kind === 'marketing' ? 'Marketing budget' : 'Branding budget';
  return (
    <Dialog
      trigger={
        <>
          <Pencil size={14} aria-hidden /> Edit
        </>
      }
      triggerLabel={`Edit ${label.toLowerCase()}`}
      title={label}
      triggerSize="sm"
      guardUnsaved
    >
      {(close) => (
        <ActionForm action={updateClientAction} onSuccess={close} className="grid gap-3">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="_scope" value="budgets" />
          <BudgetField kind={kind} c={c} />
          <div>
            <SubmitButton pendingText="Saving…">Save budget</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function AddNote({ clientId }: { clientId: string }) {
  return (
    <Dialog trigger="Add note" title="Add note" triggerSize="sm" guardUnsaved>
      {(close) => (
        <ActionForm action={addClientNoteAction} onSuccess={close} className="grid gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <FormField label="Title" name="title" required>
            <input
              id="title"
              name="title"
              required
              maxLength={160}
              placeholder="e.g. Budget discussion"
              className={inputClass}
            />
          </FormField>
          <FormField label="Note" name="body">
            <textarea id="body" name="body" className={textareaClass} />
          </FormField>
          <div>
            <SubmitButton pendingText="Saving…">Add note</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
