'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass, textareaClass } from '@/components/ui';
import { createApiKeyAction, integrationAction, testIntegrationAction } from '../actions';

export function IntegrationConfig({
  provider,
  mode,
  config,
  supportsDemo,
  fields,
}: {
  provider: string;
  mode: string;
  config: Record<string, string>;
  supportsDemo: boolean;
  fields: Array<{ key: string; label: string; help: string; multiline?: boolean }>;
}) {
  return (
    <div className="space-y-3">
      <ActionForm action={integrationAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="provider" value={provider} />
        <FormField label="Mode" name="mode">
          <select id={`mode-${provider}`} name="mode" defaultValue={mode} className={inputClass}>
            <option value="disconnected">Disconnected</option>
            {supportsDemo ? <option value="demo">Demo (synthetic, labelled data)</option> : null}
            <option value="live">Live</option>
          </select>
        </FormField>
        {fields.map((f) => (
          <FormField
            key={f.key}
            label={f.label}
            name={`cfg_${f.key}`}
            hint={f.help}
            className={f.multiline ? 'sm:col-span-2' : undefined}
          >
            {f.multiline ? (
              <textarea
                id={`cfg_${f.key}-${provider}`}
                name={`cfg_${f.key}`}
                defaultValue={config[f.key] ?? ''}
                rows={4}
                spellCheck={false}
                className={`${textareaClass} font-mono text-[13px]`}
              />
            ) : (
              <input
                id={`cfg_${f.key}-${provider}`}
                name={`cfg_${f.key}`}
                defaultValue={config[f.key] ?? ''}
                className={inputClass}
              />
            )}
          </FormField>
        ))}
        <div className="sm:col-span-2">
          <SubmitButton size="sm">Save</SubmitButton>
        </div>
      </ActionForm>
      {mode !== 'disconnected' ? (
        <ActionForm action={testIntegrationAction}>
          <input type="hidden" name="provider" value={provider} />
          <SubmitButton size="sm" variant="secondary" pendingText="Testing…">
            Test connection
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function NewApiKey({ clients }: { clients: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm
      action={createApiKeyAction}
      resetOnSuccess
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <FormField label="Key name" name="name" required>
        <input
          id="name"
          name="name"
          required
          placeholder="e.g. Demo Institute admissions landing page"
          className={inputClass}
        />
      </FormField>
      <FormField label="Attribute leads to client" name="clientId">
        <select id="clientId" name="clientId" className={inputClass} defaultValue="">
          <option value="">Sahynex (own prospects)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <SubmitButton>Create key</SubmitButton>
    </ActionForm>
  );
}
