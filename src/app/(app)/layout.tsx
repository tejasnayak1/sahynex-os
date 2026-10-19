import { eq } from 'drizzle-orm';
import { AppShell, type NavItem } from '@/components/client/shell';
import { db, schema } from '@/db';
import { can, canAny } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { approvalQueue } from '@/server/services/deliverables';
import { unreadCount } from '@/server/services/notifications';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const [unread, [org], queue] = await Promise.all([
    unreadCount(actor),
    db
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, actor.orgId)),
    approvalQueue(actor),
  ]);
  const nav: NavItem[] = [
    actor.clientId
      ? { href: '/dashboard', label: 'Shared with me', icon: 'Gauge' }
      : { href: '/home', label: 'Home', icon: 'House' },
    ...(can(actor, 'dashboard.executive') && !actor.clientId
      ? [{ href: '/dashboard', label: 'Business dashboard', icon: 'Gauge' as const }]
      : []),
    ...(canAny(actor, 'leads.read.all', 'leads.read.own')
      ? [{ href: '/leads', label: 'CRM & leads', icon: 'Users' as const }]
      : []),
    ...(canAny(actor, 'deals.read.all', 'deals.read.own')
      ? [{ href: '/pipeline', label: 'Sales pipeline', icon: 'KanbanSquare' as const }]
      : []),
    ...(canAny(actor, 'clients.read.all', 'clients.read.assigned') && !actor.clientId
      ? [{ href: '/clients', label: 'Clients', icon: 'Building2' as const }]
      : []),
    ...(canAny(actor, 'projects.read.all', 'projects.read.assigned') && !actor.clientId
      ? [{ href: '/projects', label: 'Projects', icon: 'Briefcase' as const }]
      : []),
    ...(canAny(actor, 'tasks.read.all', 'tasks.read.assigned')
      ? [{ href: '/tasks', label: 'Tasks & team', icon: 'ListChecks' as const }]
      : []),
    ...(can(actor, 'campaigns.read') && !actor.clientId
      ? [{ href: '/campaigns', label: 'Campaigns & performance', icon: 'Megaphone' as const }]
      : []),
    ...(can(actor, 'content.read')
      ? [{ href: '/content', label: 'Content & deliverables', icon: 'FileText' as const }]
      : []),
    ...(canAny(actor, 'approvals.internal', 'approvals.client')
      ? [
          {
            href: '/approvals',
            label: 'Approvals & revisions',
            icon: 'CheckCircle2' as const,
            badge: queue.length,
          },
        ]
      : []),
    ...(can(actor, 'reports.read')
      ? [{ href: '/reports', label: 'Reports & analytics', icon: 'BarChart3' as const }]
      : []),
    ...(can(actor, 'automation.read')
      ? [{ href: '/automation', label: 'Automation centre', icon: 'Workflow' as const }]
      : []),
    ...(can(actor, 'finance.read')
      ? [{ href: '/finance', label: 'Finance & commercials', icon: 'IndianRupee' as const }]
      : []),
    { href: '/notifications', label: 'Notifications', icon: 'Bell', badge: unread },
    { href: '/settings', label: 'Organisation & settings', icon: 'Settings' },
  ];
  const quick = [
    ...(can(actor, 'leads.write') ? [{ href: '/leads/new', label: 'Lead' }] : []),
    ...(can(actor, 'tasks.write') && !actor.clientId ? [{ href: '/tasks/new', label: 'Task' }] : []),
    ...(can(actor, 'deals.write') ? [{ href: '/deals/new', label: 'Deal' }] : []),
    ...(can(actor, 'clients.write') ? [{ href: '/clients/new', label: 'Client' }] : []),
    ...(can(actor, 'projects.write') ? [{ href: '/projects/new', label: 'Project' }] : []),
    ...(can(actor, 'content.write') ? [{ href: '/content/new', label: 'Deliverable' }] : []),
  ];
  return (
    <AppShell
      nav={nav}
      user={{ name: actor.name, role: actor.roleName }}
      unread={unread}
      quickCreate={quick}
      orgName={org?.name ?? ''}
    >
      {children}
    </AppShell>
  );
}
