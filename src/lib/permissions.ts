/**
 * Permission catalogue and default role grants.
 *
 * Permissions are enforced on the server (services + data-access scoping), never only in the UI.
 * Scope suffixes:
 *   *.all       → every record in the organisation
 *   *.own       → records the user owns
 *   *.assigned  → records on projects/clients the user is a member/owner of
 * Roles are stored in the database (roles / role_permissions) and can be edited in Settings → Roles.
 * This file is the seed + the source of truth for which permission keys exist.
 */

export const PERMISSIONS = {
  // Dashboard
  'dashboard.executive': { module: 'Dashboard', description: 'View organisation-wide executive dashboard' },

  // CRM
  'leads.read.all': { module: 'CRM', description: 'View all leads' },
  'leads.read.own': { module: 'CRM', description: 'View leads assigned to me' },
  'leads.write': { module: 'CRM', description: 'Create and edit leads I can view' },
  'leads.assign': { module: 'CRM', description: 'Reassign lead owners' },
  'leads.import': { module: 'CRM', description: 'Bulk import leads from CSV' },
  'leads.delete': { module: 'CRM', description: 'Archive leads' },
  'leads.export_pii': { module: 'CRM', description: 'Export lead contact details' },
  'messaging.whatsapp': {
    module: 'CRM',
    description: 'Send approved WhatsApp templates to individual consented leads',
  },

  // Sales
  'deals.read.all': { module: 'Sales', description: 'View all deals' },
  'deals.read.own': { module: 'Sales', description: 'View deals I own' },
  'deals.write': { module: 'Sales', description: 'Create and edit deals I can view' },
  'deals.approve_commercials': { module: 'Sales', description: 'Approve discounts, contracts and handovers' },

  // Clients & projects
  'clients.read.all': { module: 'Clients', description: 'View all clients' },
  'clients.read.assigned': { module: 'Clients', description: 'View clients I own or work on' },
  'clients.write': { module: 'Clients', description: 'Create and edit clients' },
  'projects.read.all': { module: 'Projects', description: 'View all projects' },
  'projects.read.assigned': { module: 'Projects', description: 'View projects I am a member of' },
  'projects.write': { module: 'Projects', description: 'Create and edit projects I can view' },
  'projects.activate': { module: 'Projects', description: 'Move projects into active delivery' },
  'projects.commercials': { module: 'Projects', description: 'See project budgets and revenue' },

  // Tasks
  'tasks.read.all': { module: 'Tasks', description: 'View all tasks' },
  'tasks.read.assigned': { module: 'Tasks', description: 'View my tasks and tasks on my projects' },
  'tasks.write': { module: 'Tasks', description: 'Create and update tasks I can view' },
  'tasks.assign': { module: 'Tasks', description: 'Assign tasks to other people' },
  'tasks.templates': { module: 'Tasks', description: 'Manage task templates and SOPs' },
  'team.workload': { module: 'Tasks', description: 'View team workload and capacity' },

  // Campaigns
  'campaigns.read': {
    module: 'Campaigns',
    description: 'View campaigns and performance (scoped to visible clients)',
  },
  'campaigns.write': { module: 'Campaigns', description: 'Create campaigns, import metrics' },
  'campaigns.thresholds': { module: 'Campaigns', description: 'Configure spend and CPL thresholds' },
  'monitoring.manage': { module: 'Campaigns', description: 'Manage landing-page monitors and incidents' },

  // Content & approvals
  'content.read': { module: 'Content', description: 'View deliverables on visible projects' },
  'content.write': { module: 'Content', description: 'Create deliverables, upload versions' },
  'approvals.internal': { module: 'Approvals', description: 'Decide internal reviews' },
  'approvals.client': {
    module: 'Approvals',
    description:
      'Decide client approvals (client reviewers / account owners on behalf of client with record)',
  },

  // Reports
  'reports.read': { module: 'Reports', description: 'View reports for visible clients' },
  'reports.generate': { module: 'Reports', description: 'Generate report drafts' },
  'reports.approve': { module: 'Reports', description: 'Approve and deliver reports externally' },
  'daily_reports.team': { module: 'Reports', description: "View team members' daily reports" },

  // Automation
  'automation.read': { module: 'Automation', description: 'View automations and execution logs' },
  'automation.manage': {
    module: 'Automation',
    description: 'Enable/disable, configure and retry automations',
  },

  // Finance
  'finance.read': { module: 'Finance', description: 'View company-wide finances, revenue and margins' },
  'finance.write': { module: 'Finance', description: 'Record budgets, expenses and invoices' },

  // Admin
  'settings.org': { module: 'Settings', description: 'Edit organisation settings' },
  'settings.users': { module: 'Settings', description: 'Invite and manage users' },
  'settings.roles': { module: 'Settings', description: 'Edit roles and permissions' },
  'settings.integrations': { module: 'Settings', description: 'Manage integrations and API keys' },
  'audit.read': { module: 'Settings', description: 'View the audit log' },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleKey =
  | 'ceo'
  | 'coo'
  | 'sales'
  | 'project_manager'
  | 'performance_marketing'
  | 'creative'
  | 'employee'
  | 'client_reviewer';

const EMPLOYEE_BASE: Permission[] = [
  'tasks.read.assigned',
  'tasks.write',
  'projects.read.assigned',
  'clients.read.assigned',
  'content.read',
];

export const DEFAULT_ROLES: Record<
  RoleKey,
  { name: string; description: string; permissions: Permission[] }
> = {
  ceo: {
    name: 'CEO / Super Admin',
    description: 'Full access, including finance, roles and system settings.',
    permissions: ALL_PERMISSIONS,
  },
  coo: {
    name: 'COO / Operations Lead',
    description: 'Runs delivery: projects, tasks, workflows, capacity and operational reporting.',
    permissions: [
      'dashboard.executive',
      'leads.read.all',
      'deals.read.all',
      'clients.read.all',
      'clients.write',
      'projects.read.all',
      'projects.write',
      'projects.activate',
      'projects.commercials',
      'tasks.read.all',
      'tasks.write',
      'tasks.assign',
      'tasks.templates',
      'team.workload',
      'campaigns.read',
      'monitoring.manage',
      'content.read',
      'content.write',
      'approvals.internal',
      'reports.read',
      'reports.generate',
      'reports.approve',
      'daily_reports.team',
      'automation.read',
      'automation.manage',
      'settings.users',
      'audit.read',
    ],
  },
  sales: {
    name: 'Sales / Business Development',
    description: 'Prospects, qualification, pipeline, proposals and handover.',
    permissions: [
      'leads.read.all',
      'leads.write',
      'leads.assign',
      'leads.import',
      'leads.export_pii',
      'messaging.whatsapp',
      'deals.read.all',
      'deals.write',
      'clients.read.assigned',
      'tasks.read.assigned',
      'tasks.write',
      'reports.read',
    ],
  },
  project_manager: {
    name: 'Project Manager / Client Success',
    description: 'Assigned clients and projects, tasks, approvals and client reporting.',
    permissions: [
      'clients.read.assigned',
      'clients.write',
      'projects.read.assigned',
      'projects.write',
      'tasks.read.assigned',
      'tasks.write',
      'tasks.assign',
      'team.workload',
      'campaigns.read',
      'content.read',
      'content.write',
      'approvals.internal',
      'approvals.client',
      'reports.read',
      'reports.generate',
      'daily_reports.team',
      'automation.read',
      'leads.read.own',
    ],
  },
  performance_marketing: {
    name: 'Performance Marketing',
    description: 'Campaigns, spend, CPL, tracking and attribution for authorised clients.',
    permissions: [
      ...EMPLOYEE_BASE,
      'leads.read.all',
      'campaigns.read',
      'campaigns.write',
      'campaigns.thresholds',
      'monitoring.manage',
      'reports.read',
      'reports.generate',
      'automation.read',
    ],
  },
  creative: {
    name: 'Design / Video / Content',
    description: 'Assigned production work, uploads, revisions and submissions.',
    permissions: [...EMPLOYEE_BASE, 'content.write'],
  },
  employee: {
    name: 'Employee',
    description: 'Own tasks, daily reports, blockers and personal performance.',
    permissions: [...EMPLOYEE_BASE],
  },
  client_reviewer: {
    name: 'Client / External Reviewer',
    description:
      'Only explicitly shared deliverables, approvals and approved reports for their own organisation.',
    permissions: ['approvals.client', 'reports.read', 'content.read'],
  },
};

export const ROLE_KEYS = Object.keys(DEFAULT_ROLES) as RoleKey[];
