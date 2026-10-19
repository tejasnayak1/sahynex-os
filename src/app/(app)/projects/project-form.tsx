'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { InlineSelect } from '@/components/client/auto-submit';
import { Dialog } from '@/components/client/dialog';
import { inputClass, textareaClass } from '@/components/ui';
import {
  applyTemplateAction,
  createProjectAction,
  membersAction,
  milestoneAction,
  projectStatusAction,
  updateProjectAction,
} from './actions';

type Opt = { id: string; name: string };
type P = {
  id?: string;
  clientId?: string;
  name?: string;
  scope?: string | null;
  objectives?: string | null;
  ownerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetMinor?: number | null;
  revenueMinor?: number | null;
  reportingCadence?: string;
  approvalRequired?: boolean;
  risks?: string | null;
};

function Fields({ p, team, commercials }: { p: P; team: Opt[]; commercials: boolean }) {
  return (
    <>
      <FormField label="Project name" name="name" required>
        <input id="name" name="name" required defaultValue={p.name} className={inputClass} />
      </FormField>
      <FormField label="Owner" name="ownerId">
        <select id="ownerId" name="ownerId" defaultValue={p.ownerId ?? ''} className={inputClass}>
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
          defaultValue={p.startDate ?? ''}
          className={inputClass}
        />
      </FormField>
      <FormField label="End" name="endDate">
        <input
          id="endDate"
          name="endDate"
          type="date"
          defaultValue={p.endDate ?? ''}
          className={inputClass}
        />
      </FormField>
      {commercials ? (
        <>
          <FormField label="Budget (₹)" name="budget">
            <input
              id="budget"
              name="budget"
              inputMode="decimal"
              defaultValue={p.budgetMinor != null ? p.budgetMinor / 100 : ''}
              className={inputClass}
            />
          </FormField>
          <FormField label="Contract value (₹)" name="revenue">
            <input
              id="revenue"
              name="revenue"
              inputMode="decimal"
              defaultValue={p.revenueMinor != null ? p.revenueMinor / 100 : ''}
              className={inputClass}
            />
          </FormField>
        </>
      ) : null}
      <FormField label="Reporting cadence" name="reportingCadence">
        <select
          id="reportingCadence"
          name="reportingCadence"
          defaultValue={p.reportingCadence ?? 'monthly'}
          className={inputClass}
        >
          <option value="monthly">Monthly client report</option>
          <option value="weekly">Weekly</option>
          <option value="none">None</option>
        </select>
      </FormField>
      <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
        <input type="hidden" name="approvalRequired" value="false" />
        <input
          type="checkbox"
          name="approvalRequired"
          value="true"
          defaultChecked={p.approvalRequired ?? true}
          className="h-4 w-4 accent-[var(--accent)]"
        />{' '}
        Deliverables need client approval
      </label>
      <FormField label="Scope" name="scope" className="sm:col-span-2">
        <textarea id="scope" name="scope" defaultValue={p.scope ?? ''} className={textareaClass} />
      </FormField>
      <FormField label="Objectives" name="objectives" className="sm:col-span-2">
        <textarea
          id="objectives"
          name="objectives"
          defaultValue={p.objectives ?? ''}
          className={textareaClass}
        />
      </FormField>
      <FormField label="Risks & dependencies" name="risks" className="sm:col-span-2">
        <textarea id="risks" name="risks" defaultValue={p.risks ?? ''} className={textareaClass} />
      </FormField>
    </>
  );
}

export function NewProjectForm({
  clients,
  team,
  templates,
  commercials,
  clientId,
}: {
  clients: Opt[];
  team: Opt[];
  templates: Array<{ key: string; name: string }>;
  commercials: boolean;
  clientId?: string;
}) {
  return (
    <ActionForm action={createProjectAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField label="Client" name="clientId" required>
        <select id="clientId" name="clientId" required defaultValue={clientId ?? ''} className={inputClass}>
          <option value="">Choose…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="Task template"
        name="templateKey"
        hint="Generates tasks, owners, dependencies and milestones."
      >
        <select id="templateKey" name="templateKey" className={inputClass} defaultValue="">
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <Fields p={{}} team={team} commercials={commercials} />
      <p className="text-[12.5px] text-muted sm:col-span-2">
        New projects start in planning. A project can move to active delivery once scope, owner, dates, a work
        plan and approved commercials are recorded.
      </p>
      <div className="sm:col-span-2">
        <SubmitButton>Create project</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditProject({ p, team, commercials }: { p: P; team: Opt[]; commercials: boolean }) {
  return (
    <Dialog trigger="Edit project" title="Edit project" triggerSize="sm" wide>
      {(close) => (
        <ActionForm
          action={updateProjectAction}
          onSuccess={close}
          successMessage="Project saved"
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={p.id} />
          <Fields p={p} team={team} commercials={commercials} />
          <div className="sm:col-span-2">
            <SubmitButton>Save project</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ProjectStatus({ id, status }: { id: string; status: string }) {
  return (
    <InlineSelect
      action={projectStatusAction}
      name="status"
      value={status}
      label="Project status"
      hidden={{ id }}
      options={[
        { value: 'planning', label: 'Planning' },
        { value: 'active', label: 'Active delivery' },
        { value: 'on_hold', label: 'On hold' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ]}
    />
  );
}

export function Members({ id, team, members }: { id: string; team: Opt[]; members: string[] }) {
  return (
    <Dialog trigger="Edit team" title="Project team" triggerSize="sm">
      {(close) => (
        <ActionForm action={membersAction} onSuccess={close} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <fieldset className="max-h-80 space-y-1.5 overflow-y-auto">
            <legend className="mb-1 text-[13px] text-muted">
              Members can see this project and its tasks.
            </legend>
            {team.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  name="members"
                  value={t.id}
                  defaultChecked={members.includes(t.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {t.name}
              </label>
            ))}
          </fieldset>
          <SubmitButton>Save team</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function AddMilestone({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={milestoneAction} resetOnSuccess className="flex flex-wrap gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="sr-only" htmlFor="mname">
        Milestone
      </label>
      <input
        id="mname"
        name="name"
        required
        placeholder="New milestone"
        className={inputClass + ''}
        style={{ flex: '1 1 160px', width: 'auto' }}
      />
      <label className="sr-only" htmlFor="mdue">
        Due
      </label>
      <input id="mdue" name="dueDate" type="date" className={inputClass} style={{ width: 160 }} />
      <SubmitButton size="sm" variant="secondary">
        Add
      </SubmitButton>
    </ActionForm>
  );
}

export function ApplyTemplate({
  id,
  templates,
}: {
  id: string;
  templates: Array<{ key: string; name: string }>;
}) {
  return (
    <ActionForm action={applyTemplateAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor="templateKey">
        Template
      </label>
      <select
        id="templateKey"
        name="templateKey"
        required
        className={inputClass}
        style={{ flex: '1 1 180px', width: 'auto' }}
      >
        {templates.map((t) => (
          <option key={t.key} value={t.key}>
            {t.name}
          </option>
        ))}
      </select>
      <SubmitButton size="sm" variant="secondary">
        Generate tasks
      </SubmitButton>
    </ActionForm>
  );
}
