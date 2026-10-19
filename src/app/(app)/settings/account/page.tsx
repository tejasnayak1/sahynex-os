import { DescList, Panel } from '@/components/ui';
import { requireActor } from '@/server/auth/current';
import { PasswordForm } from './form';

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
      </Panel>
      <Panel title="Change password">
        <PasswordForm />
        <p className="mt-3 text-[12.5px] text-muted">Changing your password signs you out on every device.</p>
      </Panel>
    </div>
  );
}
