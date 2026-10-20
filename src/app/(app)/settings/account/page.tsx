import { DescList, Panel } from '@/components/ui';
import { requireActor } from '@/server/auth/current';
import { JobTitleForm, PasswordForm } from './form';

export const metadata = { title: 'My account' };

export default async function AccountPage() {
  const actor = await requireActor();
  return (
    <div className="space-y-5">
      <Panel title="Profile">
        <DescList
          items={[
            ['Name', actor.name],
            ['Email', actor.email],
            ['Role', actor.roleName],
            ['Permissions', `${actor.permissions.size} granted`],
          ]}
        />
        <div className="mt-4 border-t border-line pt-4">
          <JobTitleForm value={actor.jobTitle ?? null} />
        </div>
      </Panel>
      <Panel title="Change password">
        <PasswordForm />
        <p className="mt-3 text-[12.5px] text-muted">Changing your password signs you out on every device.</p>
      </Panel>
    </div>
  );
}
