'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { inputClass } from '@/components/ui';
import { createTeamAction, createUserAction, resetPasswordAction, updateUserAction } from '../actions';

type Opt = { id: string; name: string };
export function NewUser({
  roles,
  teams,
  clients,
}: {
  roles: Array<{ id: string; name: string; key: string }>;
  teams: Opt[];
  clients: Opt[];
}) {
  return (
    <Dialog trigger="Add user" title="Add user" triggerVariant="primary" triggerSize="sm" wide>
      {() => (
        <ActionForm action={createUserAction} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" name="name" required>
            <input id="name" name="name" required className={inputClass} />
          </FormField>
          <FormField label="Email" name="email" required>
            <input id="email" name="email" type="email" required className={inputClass} />
          </FormField>
          <FormField label="Role" name="roleId" required>
            <select id="roleId" name="roleId" required className={inputClass} defaultValue="">
              <option value="">Choose…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Team" name="teamId">
            <select id="teamId" name="teamId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Client (external reviewers only)"
            name="clientId"
            hint="Client reviewers only see items shared with this client."
          >
            <select id="clientId" name="clientId" className={inputClass} defaultValue="">
              <option value="">— Internal user —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
            <input type="checkbox" name="acceptsLeads" className="h-4 w-4 accent-[var(--accent)]" /> Receives
            automatically assigned leads
          </label>
          <p className="text-[12.5px] text-muted sm:col-span-2">
            A one-time temporary password is shown after saving. Share it through a private channel.
          </p>
          <div className="sm:col-span-2">
            <SubmitButton>Add user</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
export function EditUser({
  u,
  roles,
  teams,
  finance,
  cost,
}: {
  u: {
    id: string;
    name: string;
    roleId: string;
    teamId: string | null;
    isActive: boolean;
    acceptsLeads: boolean;
  };
  roles: Array<{ id: string; name: string }>;
  teams: Opt[];
  finance: boolean;
  cost: { hourly: number | null; capacity: number } | null;
}) {
  return (
    <Dialog trigger="Edit" title={`Edit ${u.name}`} triggerSize="sm" triggerVariant="ghost">
      {(close) => (
        <div className="space-y-4">
          <ActionForm action={updateUserAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={u.id} />
            <FormField label="Name" name="name">
              <input id="name" name="name" defaultValue={u.name} className={inputClass} />
            </FormField>
            <FormField label="Role" name="roleId">
              <select id="roleId" name="roleId" defaultValue={u.roleId} className={inputClass}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Team" name="teamId">
              <select id="teamId" name="teamId" defaultValue={u.teamId ?? ''} className={inputClass}>
                <option value="">—</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="space-y-1.5 self-end pb-1 text-[13.5px]">
              <label className="flex items-center gap-2">
                <input type="hidden" name="isActive" value="false" />
                <input
                  type="checkbox"
                  name="isActive"
                  value="true"
                  defaultChecked={u.isActive}
                  className="h-4 w-4 accent-[var(--accent)]"
                />{' '}
                Active
              </label>
              <label className="flex items-center gap-2">
                <input type="hidden" name="acceptsLeads" value="false" />
                <input
                  type="checkbox"
                  name="acceptsLeads"
                  value="true"
                  defaultChecked={u.acceptsLeads}
                  className="h-4 w-4 accent-[var(--accent)]"
                />{' '}
                Receives leads
              </label>
            </div>
            {finance ? (
              <>
                <FormField
                  label="Hourly cost (₹) — confidential"
                  name="hourly"
                  hint="Used only for labour cost in profitability."
                >
                  <input
                    id="hourly"
                    name="hourly"
                    inputMode="decimal"
                    defaultValue={cost?.hourly != null ? cost.hourly / 100 : ''}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Weekly capacity (hours)" name="capacity">
                  <input
                    id="capacity"
                    name="capacity"
                    type="number"
                    min={0}
                    max={80}
                    defaultValue={cost?.capacity ?? 40}
                    className={inputClass}
                  />
                </FormField>
              </>
            ) : null}
            <p className="text-[12.5px] text-muted sm:col-span-2">
              Changing role or deactivating signs the person out of all sessions.
            </p>
            <div className="sm:col-span-2">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm action={resetPasswordAction} className="border-t border-line pt-3">
            <input type="hidden" name="id" value={u.id} />
            <SubmitButton
              variant="secondary"
              size="sm"
              confirm={`Reset ${u.name}'s password? They will be signed out everywhere.`}
            >
              Reset password
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </Dialog>
  );
}
export function NewTeam() {
  return (
    <ActionForm action={createTeamAction} resetOnSuccess className="flex gap-2">
      <label htmlFor="teamname" className="sr-only">
        Team name
      </label>
      <input id="teamname" name="name" required placeholder="New team name" className={inputClass} />
      <SubmitButton size="md" variant="secondary">
        Add team
      </SubmitButton>
    </ActionForm>
  );
}
