'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass, textareaClass } from '@/components/ui';
import {
  collaboratorsAction,
  commentAction,
  dependencyAction,
  taskStatusAction,
  timeAction,
  updateTaskAction,
} from '../actions';

type Opt = { id: string; name: string };
type T = {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  priority: string;
  dueAt: string;
  effortPoints: number;
  status: string;
};

export function StatusControls({ id, status }: { id: string; status: string }) {
  const btn = (s: string, label: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <ActionForm action={taskStatusAction} key={s}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={s} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'todo' ? btn('in_progress', 'Start') : null}
      {status === 'blocked' ? btn('in_progress', 'Unblock & resume') : null}
      {['todo', 'in_progress'].includes(status) ? btn('in_review', 'Send for review') : null}
      {!['done', 'cancelled'].includes(status) ? (
        <Dialog trigger="Complete" title="Complete task" triggerVariant="primary" triggerSize="sm">
          {(close) => (
            <ActionForm action={taskStatusAction} onSuccess={close} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="done" />
              <FormField
                label="Completion note (optional)"
                name="note"
                hint="What was delivered, links, anything the next person needs."
              >
                <textarea id="note" name="note" className={textareaClass} />
              </FormField>
              <SubmitButton>Mark complete</SubmitButton>
            </ActionForm>
          )}
        </Dialog>
      ) : (
        btn('todo', 'Reopen')
      )}
      {!['done', 'cancelled', 'blocked'].includes(status) ? (
        <Dialog trigger="Report blocker" title="Report a blocker" triggerSize="sm" triggerVariant="ghost">
          {(close) => (
            <ActionForm action={taskStatusAction} onSuccess={close} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="blocked" />
              <FormField
                label="What is blocking this?"
                name="note"
                required
                hint="The project owner is notified."
              >
                <textarea id="note" name="note" required className={textareaClass} />
              </FormField>
              <SubmitButton variant="danger">Mark blocked</SubmitButton>
            </ActionForm>
          )}
        </Dialog>
      ) : null}
      {!['done', 'cancelled'].includes(status) ? btn('cancelled', 'Cancel task') : null}
    </div>
  );
}

export function EditTask({ t, team, canAssign }: { t: T; team: Opt[]; canAssign: boolean }) {
  return (
    <Dialog trigger="Edit" title="Edit task" triggerSize="sm" wide>
      {(close) => (
        <ActionForm
          action={updateTaskAction}
          onSuccess={close}
          successMessage="Task saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={t.id} />
          <FormField label="Title" name="title" className="sm:col-span-2">
            <input id="title" name="title" defaultValue={t.title} className={inputClass} />
          </FormField>
          {canAssign ? (
            <FormField label="Owner" name="ownerId">
              <select id="ownerId" name="ownerId" defaultValue={t.ownerId ?? ''} className={inputClass}>
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField label="Priority" name="priority">
            <select id="priority" name="priority" defaultValue={t.priority} className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </FormField>
          <FormField label="Due" name="dueAt">
            <input
              id="dueAt"
              name="dueAt"
              type="datetime-local"
              defaultValue={t.dueAt}
              className={inputClass}
            />
          </FormField>
          <FormField label="Effort points" name="effortPoints">
            <input
              id="effortPoints"
              name="effortPoints"
              type="number"
              min={1}
              max={100}
              defaultValue={t.effortPoints}
              className={inputClass}
            />
          </FormField>
          <FormField label="Description" name="description" className="sm:col-span-2">
            <textarea
              id="description"
              name="description"
              defaultValue={t.description ?? ''}
              className={textareaClass}
            />
          </FormField>
          <div className="sm:col-span-2">
            <SubmitButton>Save task</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CommentBox({ id }: { id: string }) {
  return (
    <ActionForm action={commentAction} resetOnSuccess className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="body" className="sr-only">
        Comment
      </label>
      <textarea id="body" name="body" required placeholder="Add a comment…" className={textareaClass} />
      <SubmitButton size="sm" variant="secondary">
        Comment
      </SubmitButton>
    </ActionForm>
  );
}

export function AddDependency({
  id,
  options,
}: {
  id: string;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <ActionForm action={dependencyAction} className="flex gap-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="dependsOn" className="sr-only">
        Depends on
      </label>
      <select id="dependsOn" name="dependsOn" required className={cn(inputClass, 'min-w-0 flex-1')}>
        <option value="">Waits on task…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <SubmitButton size="sm" variant="secondary">
        Add
      </SubmitButton>
    </ActionForm>
  );
}

export function RemoveDependency({ id, dependsOn }: { id: string; dependsOn: string }) {
  return (
    <ActionForm action={dependencyAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="dependsOn" value={dependsOn} />
      <input type="hidden" name="remove" value="1" />
      <SubmitButton size="sm" variant="ghost">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

export function Collaborators({ id, team, current }: { id: string; team: Opt[]; current: string[] }) {
  return (
    <Dialog trigger="Edit" title="Collaborators" triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <ActionForm action={collaboratorsAction} onSuccess={close} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <fieldset className="max-h-80 space-y-1.5 overflow-y-auto">
            {team.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  name="users"
                  value={m.id}
                  defaultChecked={current.includes(m.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {m.name}
              </label>
            ))}
          </fieldset>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function LogTime({ id, today }: { id: string; today: string }) {
  return (
    <ActionForm action={timeAction} resetOnSuccess className="flex flex-wrap gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor="hours">
        Hours
      </label>
      <input
        id="hours"
        name="hours"
        type="number"
        step="0.25"
        min="0.25"
        max="24"
        required
        placeholder="Hours"
        className={cn(inputClass, 'w-24')}
      />
      <label className="sr-only" htmlFor="workDate">
        Date
      </label>
      <input
        id="workDate"
        name="workDate"
        type="date"
        defaultValue={today}
        required
        className={cn(inputClass, 'w-40')}
      />
      <SubmitButton size="sm" variant="secondary">
        Log time
      </SubmitButton>
    </ActionForm>
  );
}
