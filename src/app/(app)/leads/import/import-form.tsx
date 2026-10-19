'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { cn, inputClass } from '@/components/ui';
import { importLeadsAction } from '../actions';

export function ImportForm({ clients }: { clients: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={importLeadsAction} className="grid max-w-2xl gap-4">
      <FormField
        label="CSV file"
        name="file"
        required
        hint="Columns recognised: name (or first name + last name), email, phone, organisation, interest/course, city, source, campaign, consent."
      >
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className={cn(inputClass, ' py-1.5')}
        />
      </FormField>
      <FormField label="Leads are for" name="clientId">
        <select id="clientId" name="clientId" className={inputClass} defaultValue="">
          <option value="">Sahynex (our own prospects)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (admission enquiries)
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Default source" name="sourceKey" hint="Used when a row has no source column.">
        <input id="sourceKey" name="sourceKey" defaultValue="csv_import" className={inputClass} />
      </FormField>
      <label className="flex items-start gap-2 text-[13.5px]">
        <input type="checkbox" name="consentConfirmed" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        <span>
          I confirm rows marked “consent = yes” gave explicit marketing consent. Unchecked, all imported leads
          are recorded without marketing consent.
        </span>
      </label>
      <div>
        <SubmitButton pendingText="Importing… this can take a minute">Import leads</SubmitButton>
      </div>
    </ActionForm>
  );
}
