'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { inputClass, textareaClass } from '@/components/ui';
import { addContactAction, createClientAction, updateClientAction } from './actions';

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
};

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

export function EditClient({ c, team }: { c: C; team: Array<{ id: string; name: string }> }) {
  return (
    <Dialog trigger="Edit client" title="Edit client" triggerSize="sm" wide>
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

export function AddContact({ clientId }: { clientId: string }) {
  return (
    <Dialog trigger="Add contact" title="Add contact" triggerSize="sm">
      {(close) => (
        <ActionForm action={addContactAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="clientId" value={clientId} />
          <FormField label="Name" name="name" required>
            <input id="name" name="name" required className={inputClass} />
          </FormField>
          <FormField label="Designation" name="designation">
            <input id="designation" name="designation" className={inputClass} />
          </FormField>
          <FormField label="Email" name="email">
            <input id="email" name="email" type="email" className={inputClass} />
          </FormField>
          <FormField label="Phone" name="phone">
            <input id="phone" name="phone" className={inputClass} />
          </FormField>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="isPrimary" className="h-4 w-4 accent-[var(--accent)]" /> Primary
            contact
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="isApprover" className="h-4 w-4 accent-[var(--accent)]" /> Designated
            approver
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Add contact</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
