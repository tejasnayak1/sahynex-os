import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { PageHeader } from '@/components/ui';
import { SettingsNav } from './nav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const items = [
    ...(can(actor, 'settings.org')
      ? [{ href: '/settings/organisation', label: 'Organisation & rules' }]
      : []),
    ...(can(actor, 'settings.users') ? [{ href: '/settings/users', label: 'Users & teams' }] : []),
    ...(can(actor, 'settings.roles') || can(actor, 'settings.users')
      ? [{ href: '/settings/roles', label: 'Roles & permissions' }]
      : []),
    ...(can(actor, 'settings.integrations')
      ? [{ href: '/settings/integrations', label: 'Integrations & API keys' }]
      : []),
    ...(can(actor, 'tasks.templates')
      ? [{ href: '/settings/templates', label: 'Task templates (SOPs)' }]
      : []),
    ...(can(actor, 'settings.org') ? [{ href: '/settings/kpis', label: 'KPI targets' }] : []),
    ...(can(actor, 'audit.read') ? [{ href: '/settings/audit', label: 'Audit log' }] : []),
    { href: '/settings/account', label: 'My account' },
  ];
  return (
    <>
      <PageHeader title="Organisation & settings" />
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav items={items} />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
