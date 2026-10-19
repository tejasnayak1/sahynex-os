'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass, textareaClass } from '@/components/ui';
import { createTaskAction } from './actions';

type Opt = { id: string; name: string };
export function NewTaskForm({
  team,
  projects,
  defaults,
  canAssign,
  me,
}: {
  team: Opt[];
  projects: Array<{ id: string; name: string; ref: string }>;
  defaults: Record<string, string | undefined>;
  canAssign: boolean;
  me: string;
}) {
  return (
    <ActionForm action={createTaskAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {defaults.leadId ? <input type="hidden" name="leadId" value={defaults.leadId} /> : null}
      {defaults.dealId ? <input type="hidden" name="dealId" value={defaults.dealId} /> : null}
      <FormField label="Title" name="title" required className="sm:col-span-2">
        <input id="title" name="title" required autoFocus className={inputClass} />
      </FormField>
      <FormField label="Project" name="projectId">
        <select
          id="projectId"
          name="projectId"
          defaultValue={defaults.projectId ?? ''}
          className={inputClass}
        >
          <option value="">No project (internal / sales)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ref} · {p.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="Owner"
        name="ownerId"
        hint={canAssign ? undefined : 'You can create tasks for yourself.'}
      >
        <select id="ownerId" name="ownerId" defaultValue={me} disabled={!canAssign} className={inputClass}>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Priority" name="priority">
        <select id="priority" name="priority" defaultValue="medium" className={inputClass}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </FormField>
      <FormField label="Due" name="dueAt">
        <input id="dueAt" name="dueAt" type="datetime-local" className={inputClass} />
      </FormField>
      <FormField
        label="Effort points"
        name="effortPoints"
        hint="Relative size (1 = small). Used for workload, not as a score."
      >
        <input
          id="effortPoints"
          name="effortPoints"
          type="number"
          min={1}
          max={100}
          defaultValue={1}
          className={inputClass}
        />
      </FormField>
      <FormField label="Repeats" name="recurrence" hint="A new task is created when this one is completed.">
        <select id="recurrence" name="recurrence" defaultValue="" className={inputClass}>
          <option value="">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </FormField>
      <FormField label="Description" name="description" className="sm:col-span-2">
        <textarea id="description" name="description" className={textareaClass} />
      </FormField>
      <div className="sm:col-span-2">
        <SubmitButton>Create task</SubmitButton>
      </div>
    </ActionForm>
  );
}
