'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { ActionButton } from '@/components/client/auto-submit';
import { inputClass } from '@/components/ui';
import { configAction, retryAction, runNowAction } from '../actions';

export function ConfigForm({
  automationKey,
  cron,
  fields,
  config,
  ownerId,
  team,
}: {
  automationKey: string;
  cron?: string;
  fields: Array<{ key: string; label: string; type: 'number' | 'text' | 'boolean'; help?: string }>;
  config: Record<string, unknown>;
  ownerId: string | null;
  team: Array<{ id: string; name: string }>;
}) {
  return (
    <ActionForm action={configAction} className="grid gap-3">
      <input type="hidden" name="key" value={automationKey} />
      <FormField label="Accountable owner" name="ownerId" hint="Receives failure alerts.">
        <select id="ownerId" name="ownerId" defaultValue={ownerId ?? ''} className={inputClass}>
          <option value="">No owner (alerts go to COO/CEO)</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      {cron !== undefined ? (
        <FormField
          label="Schedule (cron, organisation timezone)"
          name="cron"
          hint="minute hour day-of-month month day-of-week, e.g. 55 7 * * * = 07:55 daily"
        >
          <input id="cron" name="cron" defaultValue={cron} className={inputClass} />
        </FormField>
      ) : null}
      {fields.map((f) =>
        f.type === 'boolean' ? (
          <label key={f.key} className="flex items-start gap-2 text-[13.5px]">
            <input
              type="checkbox"
              name={`cfg_${f.key}`}
              defaultChecked={Boolean(config[f.key])}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              {f.label}
              {f.help ? <span className="block text-[12.5px] text-muted">{f.help}</span> : null}
            </span>
          </label>
        ) : (
          <FormField key={f.key} label={f.label} name={`cfg_${f.key}`} hint={f.help}>
            <input
              id={`cfg_${f.key}`}
              name={`cfg_${f.key}`}
              type={f.type === 'number' ? 'number' : 'text'}
              defaultValue={String(config[f.key] ?? '')}
              className={inputClass}
            />
          </FormField>
        ),
      )}
      <p className="text-[12.5px] text-muted">
        Business thresholds (SLAs, reminder timings, scoring) are shared settings in Settings → Organisation.
      </p>
      <div>
        <SubmitButton size="sm">Save settings</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RunNow({ automationKey }: { automationKey: string }) {
  return (
    <ActionButton action={runNowAction} hidden={{ key: automationKey }} size="md">
      Run now
    </ActionButton>
  );
}
export function Retry({ executionId }: { executionId: string }) {
  return (
    <ActionButton
      action={retryAction}
      hidden={{ executionId }}
      confirm="Retry this run? Workflows re-check the latest record state, so completed steps are not duplicated."
    >
      Retry
    </ActionButton>
  );
}
