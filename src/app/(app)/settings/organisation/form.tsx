'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Panel, inputClass } from '@/components/ui';
import type { OrgSettings } from '@/lib/org-settings';
import { orgSettingsAction } from '../actions';

const STAGES = [
  'new_prospect',
  'qualified',
  'discovery_completed',
  'proposal_preparation',
  'proposal_sent',
  'negotiation',
];

export function OrgSettingsForm({
  name,
  timezone,
  s,
  roles,
}: {
  name: string;
  timezone: string;
  s: OrgSettings;
  roles: Array<{ key: string; name: string }>;
}) {
  const n = (label: string, key: string, value: number, hint?: string, step = 1) => (
    <FormField label={label} name={key} hint={hint}>
      <input
        id={key}
        name={key}
        type="number"
        step={step}
        min={0}
        defaultValue={value}
        required
        className={inputClass}
      />
    </FormField>
  );
  return (
    <ActionForm action={orgSettingsAction} className="space-y-5">
      <Panel title="Organisation">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" name="orgName">
            <input id="orgName" name="orgName" defaultValue={name} className={inputClass} />
          </FormField>
          <FormField
            label="Timezone"
            name="timezone"
            hint="Schedules, report periods and dates use this timezone."
          >
            <input id="timezone" name="timezone" defaultValue={timezone} className={inputClass} />
          </FormField>
        </div>
      </Panel>
      <Panel title="Leads">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Assignment" name="assignment">
            <select
              id="assignment"
              name="assignment"
              defaultValue={s.leads.assignment}
              className={inputClass}
            >
              <option value="round_robin">Automatic (round-robin)</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          {n('First-contact SLA (hours)', 'firstContactSlaHours', s.leads.firstContactSlaHours)}
          {n('Escalate after (hours)', 'escalationAfterHours', s.leads.escalationAfterHours)}
          {n('Follow-up task due (hours)', 'followUpTaskDueHours', s.leads.followUpTaskDueHours)}
          {n('Qualified at score ≥', 'qualifyThreshold', s.leads.qualifyThreshold)}
        </div>
        <p className="mb-2 mt-4 text-[13px] font-medium text-ink-2">Qualification score weights</p>
        <div className="grid gap-3 sm:grid-cols-5">
          {Object.entries(s.leads.scoreWeights).map(([k, v]) => (
            <FormField key={k} label={k.replace(/_/g, ' ')} name={`w_${k}`}>
              <input
                id={`w_${k}`}
                name={`w_${k}`}
                type="number"
                min={0}
                max={100}
                defaultValue={v}
                className={inputClass}
              />
            </FormField>
          ))}
        </div>
      </Panel>
      <Panel title="Sales">
        <div className="grid gap-3 sm:grid-cols-3">
          {n('Stale deal after (days)', 'staleDealDays', s.sales.staleDealDays)}
          <FormField
            label="Proposal follow-up days"
            name="proposalFollowUpDays"
            hint="Comma-separated, e.g. 3, 7"
          >
            <input
              id="proposalFollowUpDays"
              name="proposalFollowUpDays"
              defaultValue={s.sales.proposalFollowUpDays.join(', ')}
              className={inputClass}
            />
          </FormField>
          {n('Escalate proposal after (days)', 'proposalEscalateDays', s.sales.proposalEscalateDays)}
          {n(
            'Discounts above this % need approval',
            'discountApprovalAbovePct',
            s.sales.discountApprovalAbovePct,
            undefined,
            0.5,
          )}
        </div>
        <p className="mb-2 mt-4 text-[13px] font-medium text-ink-2">Default win probability by stage (%)</p>
        <div className="grid gap-3 sm:grid-cols-6">
          {STAGES.map((k) => (
            <FormField key={k} label={k.replace(/_/g, ' ')} name={`p_${k}`}>
              <input
                id={`p_${k}`}
                name={`p_${k}`}
                type="number"
                min={0}
                max={100}
                defaultValue={s.sales.stageProbability[k] ?? 0}
                className={inputClass}
              />
            </FormField>
          ))}
          <input type="hidden" name="p_won" value="100" />
          <input type="hidden" name="p_lost" value="0" />
        </div>
      </Panel>
      <Panel title="Delivery">
        <div className="grid gap-3 sm:grid-cols-4">
          {n(
            'Task reminder before due (hours)',
            'taskReminderHoursBefore',
            s.delivery.taskReminderHoursBefore,
          )}
          {n(
            'Escalate overdue tasks after (hours)',
            'overdueEscalationHours',
            s.delivery.overdueEscalationHours,
          )}
          {n('Approval reminder every (hours)', 'approvalReminderHours', s.delivery.approvalReminderHours)}
          {n('Max approval reminders', 'maxApprovalReminders', s.delivery.maxApprovalReminders)}
        </div>
      </Panel>
      <Panel title="Campaigns & reporting">
        <div className="grid gap-3 sm:grid-cols-3">
          {n('CPL evaluation window (days)', 'evaluationDays', s.campaigns.evaluationDays)}
          {n('Data is stale after (hours)', 'staleAfterHours', s.campaigns.staleAfterHours)}
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Daily digest recipients</legend>
            <div className="flex flex-wrap gap-3">
              {roles
                .filter((r) => r.key !== 'client_reviewer')
                .map((r) => (
                  <label key={r.key} className="flex items-center gap-1.5 text-[13.5px]">
                    <input
                      type="checkbox"
                      name="digestRecipientRoles"
                      value={r.key}
                      defaultChecked={s.reports.digestRecipientRoles.includes(r.key)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {r.name}
                  </label>
                ))}
            </div>
          </fieldset>
        </div>
      </Panel>
      <SubmitButton>Save settings</SubmitButton>
    </ActionForm>
  );
}
