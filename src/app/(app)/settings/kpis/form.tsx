'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass } from '@/components/ui';
import { kpiAction } from '../actions';

export function KpiForm({ clients }: { clients: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={kpiAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      <FormField label="Measure" name="key">
        <select id="key" name="key" className={inputClass}>
          <option value="leads">Leads (CRM)</option>
          <option value="qualified_leads">Qualified leads</option>
          <option value="applications">Applications (verified)</option>
          <option value="admissions">Admissions (verified)</option>
        </select>
      </FormField>
      <FormField label="Client" name="clientId" hint="Leave empty for Sahynex’s own targets.">
        <select id="clientId" name="clientId" className={inputClass} defaultValue="">
          <option value="">Sahynex</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Name" name="name" required>
        <input
          id="name"
          name="name"
          required
          className={inputClass}
          placeholder="Monthly enquiries — Demo Institute"
        />
      </FormField>
      <FormField label="Monthly target" name="target" required>
        <input id="target" name="target" type="number" min={0} required className={inputClass} />
      </FormField>
      <FormField label="Definition" name="definition" required className="sm:col-span-2">
        <input
          id="definition"
          name="definition"
          required
          className={inputClass}
          placeholder="How this is measured and where the data comes from"
        />
      </FormField>
      <div>
        <SubmitButton size="sm">Add target</SubmitButton>
      </div>
    </ActionForm>
  );
}
