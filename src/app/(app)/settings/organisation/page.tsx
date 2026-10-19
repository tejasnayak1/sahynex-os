import { db } from '@/db';
import { requirePagePermission } from '@/server/auth/current';
import { listRoles } from '@/server/services/admin';
import { getOrg } from '@/server/services/org';
import { OrgSettingsForm } from './form';

export const metadata = { title: 'Organisation settings' };

export default async function OrgSettingsPage() {
  const actor = await requirePagePermission('settings.org');
  const [org, roles] = await Promise.all([getOrg(db, actor.orgId), listRoles(actor.orgId)]);
  return (
    <OrgSettingsForm
      name={org.name}
      timezone={org.timezone}
      s={org.parsedSettings}
      roles={roles.map((r) => ({ key: r.key, name: r.name }))}
    />
  );
}
