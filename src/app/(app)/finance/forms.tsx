'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { inputClass } from '@/components/ui';
import { budgetAction, expenseAction, invoiceAction, invoiceStatusAction } from './actions';

type Opt = { id: string; name: string };
export function NewInvoice({
  clients,
  projects,
}: {
  clients: Opt[];
  projects: Array<{ id: string; name: string; ref: string }>;
}) {
  return (
    <Dialog trigger="Record invoice" title="Record invoice" triggerSize="sm" triggerVariant="primary" wide>
      {(close) => (
        <ActionForm action={invoiceAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Client" name="clientId" required>
            <select id="clientId" name="clientId" required className={inputClass} defaultValue="">
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Project" name="projectId">
            <select id="projectId" name="projectId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref} · {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Invoice number" name="number" required>
            <input id="number" name="number" required className={inputClass} />
          </FormField>
          <div />
          <FormField label="Issue date" name="issueDate" required>
            <input id="issueDate" name="issueDate" type="date" required className={inputClass} />
          </FormField>
          <FormField label="Due date" name="dueDate" required>
            <input id="dueDate" name="dueDate" type="date" required className={inputClass} />
          </FormField>
          <FormField label="Agency fee (₹, excl. tax)" name="amount" required hint="Counts as revenue.">
            <input id="amount" name="amount" required inputMode="decimal" className={inputClass} />
          </FormField>
          <FormField label="Tax (₹)" name="tax">
            <input id="tax" name="tax" inputMode="decimal" className={inputClass} />
          </FormField>
          <FormField
            label="Pass-through (₹)"
            name="passThrough"
            hint="Media spend billed at cost — not revenue."
          >
            <input id="passThrough" name="passThrough" inputMode="decimal" className={inputClass} />
          </FormField>
          <div className="sm:col-span-2">
            <SubmitButton>Save invoice</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
export function InvoiceStatus({ id, status }: { id: string; status: string }) {
  return (
    <Dialog trigger="Update" title="Update invoice status" triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <ActionForm action={invoiceStatusAction} onSuccess={close} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <FormField label="Status" name="status">
            <select
              id="status"
              name="status"
              defaultValue={status === 'overdue' ? 'sent' : status}
              className={inputClass}
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid in full</option>
              <option value="void">Void</option>
            </select>
          </FormField>
          <FormField
            label="Amount received so far (₹)"
            name="paid"
            hint="For partial payments. This records money received; it does not move money."
          >
            <input id="paid" name="paid" inputMode="decimal" className={inputClass} />
          </FormField>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}
export function NewExpense({ projects }: { projects: Array<{ id: string; name: string; ref: string }> }) {
  return (
    <Dialog trigger="Record expense" title="Record expense" triggerSize="sm" triggerVariant="primary" wide>
      {(close) => (
        <ActionForm action={expenseAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Project" name="projectId">
            <select id="projectId" name="projectId" className={inputClass} defaultValue="">
              <option value="">Company overhead</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref} · {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Category" name="category">
            <select id="category" name="category" className={inputClass}>
              <option value="production">Production</option>
              <option value="freelancer">Freelancer</option>
              <option value="software">Software</option>
              <option value="travel">Travel</option>
              <option value="ad_spend_passthrough">Ad spend (pass-through)</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Description" name="description" required className="sm:col-span-2">
            <input id="description" name="description" required className={inputClass} />
          </FormField>
          <FormField label="Vendor" name="vendor">
            <input id="vendor" name="vendor" className={inputClass} />
          </FormField>
          <FormField label="Amount (₹)" name="amount" required>
            <input id="amount" name="amount" required inputMode="decimal" className={inputClass} />
          </FormField>
          <FormField label="Date" name="incurredOn" required>
            <input id="incurredOn" name="incurredOn" type="date" required className={inputClass} />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
            <input type="checkbox" name="isPassThrough" className="h-4 w-4 accent-[var(--accent)]" /> Billed
            to client at cost (pass-through)
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Save expense</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
export function NewBudget({
  clients,
  projects,
  campaigns,
}: {
  clients: Opt[];
  projects: Array<{ id: string; name: string; ref: string }>;
  campaigns: Opt[];
}) {
  return (
    <Dialog trigger="New budget" title="New budget" triggerSize="sm" triggerVariant="primary" wide>
      {(close) => (
        <ActionForm action={budgetAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Type" name="type">
            <select id="type" name="type" className={inputClass}>
              <option value="project">Project budget</option>
              <option value="campaign">Campaign media budget</option>
              <option value="client_retainer">Client retainer</option>
            </select>
          </FormField>
          <FormField label="Amount (₹)" name="amount" required>
            <input id="amount" name="amount" required inputMode="decimal" className={inputClass} />
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
          <FormField label="Project" name="projectId">
            <select id="projectId" name="projectId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref} · {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Campaign" name="campaignId">
            <select id="campaignId" name="campaignId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <div />
          <FormField label="Period start" name="periodStart" required>
            <input id="periodStart" name="periodStart" type="date" required className={inputClass} />
          </FormField>
          <FormField label="Period end" name="periodEnd" required>
            <input id="periodEnd" name="periodEnd" type="date" required className={inputClass} />
          </FormField>
          <div className="sm:col-span-2">
            <SubmitButton>Save budget</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
