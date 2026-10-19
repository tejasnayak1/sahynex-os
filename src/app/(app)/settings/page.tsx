import { redirect } from 'next/navigation';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';

export default async function SettingsIndex() {
  const actor = await requireActor();
  redirect(
    can(actor, 'settings.org')
      ? '/settings/organisation'
      : can(actor, 'settings.users')
        ? '/settings/users'
        : '/settings/account',
  );
}
