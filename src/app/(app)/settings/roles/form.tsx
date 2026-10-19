'use client';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
import { rolePermissionsAction } from '../actions';

export function RoleForm({
  roleId,
  granted,
  catalogue,
  editable,
}: {
  roleId: string;
  granted: string[];
  catalogue: Array<{ module: string; items: Array<{ key: string; description: string }> }>;
  editable: boolean;
}) {
  return (
    <ActionForm action={rolePermissionsAction} className="space-y-3">
      <input type="hidden" name="roleId" value={roleId} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {catalogue.map((g) => (
          <fieldset key={g.module}>
            <legend className="mb-1 text-[13px] font-semibold">{g.module}</legend>
            {g.items.map((p) => (
              <label key={p.key} className="flex items-start gap-2 py-0.5 text-[13px]">
                <input
                  type="checkbox"
                  name="perm"
                  value={p.key}
                  defaultChecked={granted.includes(p.key)}
                  disabled={!editable}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  {p.description}
                  <code className="ml-1 text-[11px] text-faint">{p.key}</code>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {editable ? (
        <SubmitButton size="sm" confirm="Save permission changes for this role?">
          Save role
        </SubmitButton>
      ) : null}
    </ActionForm>
  );
}
