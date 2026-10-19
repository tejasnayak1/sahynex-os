'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { cn, inputClass, textareaClass } from '@/components/ui';
import { templateAction } from '../actions';

export function TemplateForm({
  t,
}: {
  t?: { key: string; name: string; description: string | null; items: unknown };
}) {
  return (
    <ActionForm action={templateAction} className="grid gap-3 sm:grid-cols-2">
      <FormField
        label="Key"
        name="key"
        required
        hint="lowercase_with_underscores; reusing a key updates that template."
      >
        <input id="key" name="key" required defaultValue={t?.key} readOnly={!!t} className={inputClass} />
      </FormField>
      <FormField label="Name" name="name" required>
        <input id="name" name="name" required defaultValue={t?.name} className={inputClass} />
      </FormField>
      <FormField label="Description" name="description" className="sm:col-span-2">
        <input
          id="description"
          name="description"
          defaultValue={t?.description ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField
        label="Tasks (JSON)"
        name="items"
        className="sm:col-span-2"
        hint='Each item: title, offsetDays (from project start), durationDays, optional priority, assignee ("project_owner" or a role key), effortPoints, milestone, dependsOn (indexes of earlier items).'
      >
        <textarea
          id="items"
          name="items"
          defaultValue={JSON.stringify(
            t?.items ?? [{ title: 'Kick-off', offsetDays: 0, durationDays: 1, assignee: 'project_owner' }],
            null,
            2,
          )}
          className={cn(textareaClass, 'min-h-72 font-mono text-[12.5px]')}
        />
      </FormField>
      <div>
        <SubmitButton size="sm">Save template</SubmitButton>
      </div>
    </ActionForm>
  );
}
