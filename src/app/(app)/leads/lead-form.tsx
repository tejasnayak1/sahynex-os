'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass, textareaClass } from '@/components/ui';
import { createLeadAction } from './actions';

export function NewLeadForm({
  clients,
  team,
  canAssign,
}: {
  clients: Array<{ id: string; name: string }>;
  team: Array<{ id: string; name: string }>;
  canAssign: boolean;
}) {
  return (
    <ActionForm action={createLeadAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField label="Full name" name="name" required>
        <input id="name" name="name" required maxLength={200} className={inputClass} autoFocus />
      </FormField>
      <FormField label="Organisation / institution" name="organisationName">
        <input id="organisationName" name="organisationName" className={inputClass} />
      </FormField>
      <FormField label="Email" name="email" hint="Email or phone is required.">
        <input id="email" name="email" type="email" className={inputClass} />
      </FormField>
      <FormField label="Phone" name="phone" hint="10-digit numbers are assumed to be Indian (+91).">
        <input id="phone" name="phone" type="tel" className={inputClass} />
      </FormField>
      <FormField label="Lead type" name="leadType">
        <select id="leadType" name="leadType" className={inputClass} defaultValue="client_prospect">
          <option value="client_prospect">Prospect for Sahynex</option>
          <option value="admission_enquiry">Admission enquiry (for a client)</option>
          <option value="partnership">Partnership</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="For client" name="clientId" hint="Leave empty for Sahynex’s own sales prospects.">
        <select id="clientId" name="clientId" className={inputClass} defaultValue="">
          <option value="">— Sahynex prospect —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Service / course interest" name="interest">
        <input id="interest" name="interest" className={inputClass} />
      </FormField>
      <FormField label="City" name="city">
        <input id="city" name="city" className={inputClass} />
      </FormField>
      <FormField label="Source" name="sourceKey" hint="e.g. referral, walk_in, event, linkedin">
        <input id="sourceKey" name="sourceKey" className={inputClass} defaultValue="manual" />
      </FormField>
      {canAssign ? (
        <FormField label="Owner" name="ownerId" hint="Leave empty to auto-assign.">
          <select id="ownerId" name="ownerId" className={inputClass} defaultValue="">
            <option value="">Auto-assign</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <div />
      )}
      <FormField label="Notes" name="notes" className="sm:col-span-2">
        <textarea id="notes" name="notes" className={textareaClass} />
      </FormField>
      <label className="flex items-start gap-2 text-[13.5px] sm:col-span-2">
        <input type="checkbox" name="consentMarketing" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        <span>
          This person agreed to receive marketing communication{' '}
          <span className="text-muted">(record only with explicit consent)</span>
        </span>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton pendingText="Creating…">Create lead</SubmitButton>
      </div>
    </ActionForm>
  );
}
