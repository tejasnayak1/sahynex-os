'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass } from '@/components/ui';
import { createDealAction } from './actions';

export function NewDealForm({
  team,
  clients,
  defaultOwner,
}: {
  team: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  defaultOwner: string;
}) {
  return (
    <ActionForm action={createDealAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField label="Deal title" name="title" required className="sm:col-span-2">
        <input
          id="title"
          name="title"
          required
          className={inputClass}
          placeholder="e.g. Demo College — 2027 admissions campaign"
          autoFocus
        />
      </FormField>
      <FormField label="Prospect organisation" name="prospectName" required>
        <input id="prospectName" name="prospectName" required className={inputClass} />
      </FormField>
      <FormField label="Organisation type" name="prospectOrgType">
        <select id="prospectOrgType" name="prospectOrgType" className={inputClass}>
          <option value="educational_institution">Educational institution</option>
          <option value="company">Company</option>
          <option value="media">Media</option>
          <option value="community">Community organisation</option>
          <option value="government">Government</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Existing client (upsell)" name="clientId">
        <select id="clientId" name="clientId" className={inputClass} defaultValue="">
          <option value="">— New client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Owner" name="ownerId">
        <select id="ownerId" name="ownerId" className={inputClass} defaultValue={defaultOwner}>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Primary contact" name="contactName">
        <input id="contactName" name="contactName" className={inputClass} />
      </FormField>
      <FormField label="Contact email" name="contactEmail">
        <input id="contactEmail" name="contactEmail" type="email" className={inputClass} />
      </FormField>
      <FormField label="Contact phone" name="contactPhone">
        <input id="contactPhone" name="contactPhone" className={inputClass} />
      </FormField>
      <FormField label="Estimated value (₹)" name="value">
        <input id="value" name="value" inputMode="decimal" className={inputClass} placeholder="350000" />
      </FormField>
      <FormField label="Services (comma-separated)" name="services">
        <input id="services" name="services" className={inputClass} placeholder="Branding, Website" />
      </FormField>
      <FormField label="Expected close" name="expectedCloseDate">
        <input id="expectedCloseDate" name="expectedCloseDate" type="date" className={inputClass} />
      </FormField>
      <div className="sm:col-span-2">
        <SubmitButton>Create deal</SubmitButton>
      </div>
    </ActionForm>
  );
}
