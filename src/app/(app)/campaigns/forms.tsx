'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass, textareaClass } from '@/components/ui';
import {
  conversionAction,
  createCampaignAction,
  createMonitorAction,
  importMetricsAction,
  incidentAction,
  updateCampaignAction,
} from './actions';

type Opt = { id: string; name: string };
type C = {
  id?: string;
  clientId?: string;
  projectId?: string | null;
  name?: string;
  platform?: string;
  externalId?: string | null;
  objective?: string | null;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  budgetMinor?: number | null;
  cplThresholdMinor?: number | null;
  dailySpendThresholdMinor?: number | null;
  minLeadsForAlert?: number;
  attributionWindow?: string | null;
  ownerId?: string | null;
};
const rupees = (m: number | null | undefined) => (m == null ? '' : String(m / 100));

function Fields({
  c,
  team,
  thresholds,
  isNew,
  clients,
}: {
  c: C;
  team: Opt[];
  thresholds: boolean;
  isNew: boolean;
  clients: Opt[];
}) {
  return (
    <>
      {isNew ? (
        <FormField label="Client" name="clientId" required>
          <select
            id="clientId"
            name="clientId"
            required
            defaultValue={c.clientId ?? ''}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {clients.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      {isNew ? (
        <FormField label="Platform" name="platform" required>
          <select id="platform" name="platform" defaultValue={c.platform ?? 'meta'} className={inputClass}>
            <option value="meta">Meta Ads</option>
            <option value="google_ads">Google Ads</option>
            <option value="other">Other (CSV / manual)</option>
          </select>
        </FormField>
      ) : null}
      <FormField label="Name" name="name" required className="sm:col-span-2">
        <input id="name" name="name" required defaultValue={c.name} className={inputClass} />
      </FormField>
      <FormField
        label="Platform campaign ID"
        name="externalId"
        hint="Required for automatic sync. Find it in Ads Manager / Google Ads."
      >
        <input id="externalId" name="externalId" defaultValue={c.externalId ?? ''} className={inputClass} />
      </FormField>
      <FormField label="Objective" name="objective">
        <input
          id="objective"
          name="objective"
          defaultValue={c.objective ?? ''}
          className={inputClass}
          placeholder="Lead generation"
        />
      </FormField>
      <FormField label="Status" name="status">
        <select id="status" name="status" defaultValue={c.status ?? 'active'} className={inputClass}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
        </select>
      </FormField>
      <FormField label="Owner" name="ownerId">
        <select id="ownerId" name="ownerId" defaultValue={c.ownerId ?? ''} className={inputClass}>
          <option value="">Me</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Start" name="startDate">
        <input
          id="startDate"
          name="startDate"
          type="date"
          defaultValue={c.startDate ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="End" name="endDate">
        <input
          id="endDate"
          name="endDate"
          type="date"
          defaultValue={c.endDate ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="Media budget (₹)" name="budget">
        <input
          id="budget"
          name="budget"
          inputMode="decimal"
          defaultValue={rupees(c.budgetMinor)}
          className={inputClass}
        />
      </FormField>
      <FormField
        label="Attribution window"
        name="attributionWindow"
        hint="As configured on the platform; shown on reports."
      >
        <input
          id="attributionWindow"
          name="attributionWindow"
          defaultValue={c.attributionWindow ?? ''}
          className={inputClass}
        />
      </FormField>
      {thresholds ? (
        <>
          <FormField label="CPL alert threshold (₹)" name="cplThreshold">
            <input
              id="cplThreshold"
              name="cplThreshold"
              inputMode="decimal"
              defaultValue={rupees(c.cplThresholdMinor)}
              className={inputClass}
            />
          </FormField>
          <FormField label="Daily spend alert (₹)" name="dailySpendThreshold">
            <input
              id="dailySpendThreshold"
              name="dailySpendThreshold"
              inputMode="decimal"
              defaultValue={rupees(c.dailySpendThresholdMinor)}
              className={inputClass}
            />
          </FormField>
          <FormField
            label="Minimum leads before CPL alerts"
            name="minLeadsForAlert"
            hint="Avoids false alarms on tiny samples."
          >
            <input
              id="minLeadsForAlert"
              name="minLeadsForAlert"
              type="number"
              min={1}
              defaultValue={c.minLeadsForAlert ?? 10}
              className={inputClass}
            />
          </FormField>
        </>
      ) : null}
    </>
  );
}

export function NewCampaignForm({
  clients,
  team,
  thresholds,
}: {
  clients: Opt[];
  team: Opt[];
  thresholds: boolean;
}) {
  return (
    <ActionForm action={createCampaignAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Fields c={{}} clients={clients} team={team} thresholds={thresholds} isNew />
      <div className="sm:col-span-2">
        <SubmitButton>Create campaign</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditCampaign({ c, team, thresholds }: { c: C; team: Opt[]; thresholds: boolean }) {
  return (
    <Dialog trigger="Edit campaign" title="Edit campaign" triggerSize="sm" wide>
      {(close) => (
        <ActionForm
          action={updateCampaignAction}
          onSuccess={close}
          successMessage="Campaign saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={c.id} />
          <Fields c={c} team={team} thresholds={thresholds} isNew={false} clients={[]} />
          <div className="sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ImportMetrics({ id }: { id: string }) {
  return (
    <Dialog trigger="Import metrics CSV" title="Import daily metrics" triggerSize="sm">
      {(close) => (
        <ActionForm action={importMetricsAction} onSuccess={close} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-[13.5px] text-ink-2">
            Columns: <code>date</code> (YYYY-MM-DD), <code>spend</code> (₹), <code>impressions</code>,{' '}
            <code>clicks</code>, and optionally <code>reach</code>, <code>leads</code>,{' '}
            <code>landing_page_views</code>. Existing days are replaced. Every row is validated before
            anything is saved.
          </p>
          <FormField label="CSV file" name="file" required>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className={cn(inputClass, 'py-1.5')}
            />
          </FormField>
          <SubmitButton>Import</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function RecordOutcome({
  clients,
  campaigns,
  defaultClient,
  defaultCampaign,
}: {
  clients: Opt[];
  campaigns: Array<{ id: string; name: string; clientId: string }>;
  defaultClient?: string;
  defaultCampaign?: string;
}) {
  return (
    <Dialog trigger="Record outcome" title="Record application / admission" triggerSize="sm">
      {(close) => (
        <ActionForm action={conversionAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Client" name="clientId" required>
            <select
              id="clientId"
              name="clientId"
              required
              defaultValue={defaultClient ?? ''}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Type" name="type">
            <select id="type" name="type" className={inputClass}>
              <option value="application">Application</option>
              <option value="admission">Admission</option>
              <option value="sale">Sale</option>
              <option value="form_submit">Form submission</option>
            </select>
          </FormField>
          <FormField
            label="Campaign (if attributable)"
            name="campaignId"
            hint="Only when there is evidence (lead ID, UTM, form source)."
          >
            <select
              id="campaignId"
              name="campaignId"
              defaultValue={defaultCampaign ?? ''}
              className={inputClass}
            >
              <option value="">Not attributed</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date" name="occurredAt" required>
            <input id="occurredAt" name="occurredAt" type="date" required className={inputClass} />
          </FormField>
          <FormField label="Source of record" name="source" required className="sm:col-span-2">
            <input
              id="source"
              name="source"
              required
              placeholder="e.g. Admissions office register, ERP export 14 Oct"
              className={inputClass}
            />
          </FormField>
          <FormField label="Notes" name="notes" className="sm:col-span-2">
            <textarea id="notes" name="notes" className={textareaClass} />
          </FormField>
          <label className="flex items-center gap-2 text-[13.5px] sm:col-span-2">
            <input type="checkbox" name="verified" className="h-4 w-4 accent-[var(--accent)]" /> Verified
            against the client’s records (only verified outcomes appear on reports)
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Save outcome</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function NewMonitor({ clients, campaigns, team }: { clients: Opt[]; campaigns: Opt[]; team: Opt[] }) {
  return (
    <Dialog trigger="Add monitor" title="Monitor a page" triggerVariant="primary" triggerSize="sm" wide>
      {(close) => (
        <ActionForm action={createMonitorAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" name="name" required>
            <input
              id="name"
              name="name"
              required
              className={inputClass}
              placeholder="Admissions landing page"
            />
          </FormField>
          <FormField label="URL" name="url" required>
            <input id="url" name="url" type="url" required className={inputClass} placeholder="https://" />
          </FormField>
          <FormField label="Expected HTTP status" name="expectedStatus">
            <input
              id="expectedStatus"
              name="expectedStatus"
              type="number"
              defaultValue={200}
              className={inputClass}
            />
          </FormField>
          <FormField
            label="Must contain text"
            name="expectedText"
            hint="e.g. the form’s submit button label."
          >
            <input id="expectedText" name="expectedText" className={inputClass} />
          </FormField>
          <FormField label="Client" name="clientId">
            <select id="clientId" name="clientId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Campaign" name="campaignId" hint="Enables the “spending but no leads” check.">
            <select id="campaignId" name="campaignId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Alert if no CRM leads for (hours)" name="conversionGapHours">
            <input
              id="conversionGapHours"
              name="conversionGapHours"
              type="number"
              min={1}
              className={inputClass}
              placeholder="24"
            />
          </FormField>
          <FormField label="Responsible owner" name="ownerId">
            <select id="ownerId" name="ownerId" className={inputClass} defaultValue="">
              <option value="">Me</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          <p className="text-[12.5px] text-muted sm:col-span-2">
            Checks never submit the page’s form, so they cannot create real leads or send messages. The CRM
            pipeline is tested separately with a flagged test lead.
          </p>
          <div className="sm:col-span-2">
            <SubmitButton>Add monitor</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function IncidentActions({ id, status }: { id: string; status: string }) {
  return (
    <div className="flex gap-1.5">
      {status === 'open' ? (
        <ActionForm action={incidentAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="acknowledge" />
          <SubmitButton size="sm" variant="secondary">
            Acknowledge
          </SubmitButton>
        </ActionForm>
      ) : null}
      {status === 'open' || status === 'acknowledged' ? (
        <Dialog trigger="Mark fixed" title="Mark incident fixed" triggerSize="sm">
          {(close) => (
            <ActionForm action={incidentAction} onSuccess={close} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="action" value="resolve" />
              <FormField label="What was fixed?" name="notes">
                <textarea id="notes" name="notes" className={textareaClass} />
              </FormField>
              <p className="text-[12.5px] text-muted">
                The incident closes automatically after the next successful check verifies the fix.
              </p>
              <SubmitButton>Mark fixed</SubmitButton>
            </ActionForm>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
