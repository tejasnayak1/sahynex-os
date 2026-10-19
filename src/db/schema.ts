/**
 * Sahynex OS — relational data model.
 *
 * Conventions
 * - Every business table carries `orgId` (tenant scope) and created/updated timestamps.
 * - Money is stored in minor units (paise) as bigint → number. Currency lives on the organisation.
 * - Derived metrics (CTR, CPC, CPL, weighted pipeline, margin) are NEVER stored; they are computed
 *   from their source rows so there is one source of truth (see src/server/services/metrics.ts).
 * - Soft deletion uses `deletedAt` on records users can archive.
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ enums */

export const leadStage = pgEnum('lead_stage', [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
  'lost',
]);
export const qualificationStatus = pgEnum('qualification_status', ['pending', 'qualified', 'disqualified']);
export const leadType = pgEnum('lead_type', ['client_prospect', 'admission_enquiry', 'partnership', 'other']);
export const activityType = pgEnum('activity_type', [
  'note',
  'call',
  'email',
  'whatsapp',
  'meeting',
  'stage_change',
  'assignment',
  'system',
]);
export const dealStage = pgEnum('deal_stage', [
  'new_prospect',
  'qualified',
  'discovery_completed',
  'proposal_preparation',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
]);
export const proposalStatus = pgEnum('proposal_status', [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'superseded',
]);
export const handoverStatus = pgEnum('handover_status', ['draft', 'submitted', 'approved', 'rejected']);
export const clientStatus = pgEnum('client_status', ['onboarding', 'active', 'paused', 'churned']);
export const orgType = pgEnum('org_type', [
  'educational_institution',
  'company',
  'media',
  'community',
  'government',
  'other',
]);
export const projectStatus = pgEnum('project_status', [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);
export const cadence = pgEnum('reporting_cadence', ['none', 'weekly', 'monthly']);
export const taskStatus = pgEnum('task_status', [
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]);
export const priority = pgEnum('priority', ['low', 'medium', 'high', 'urgent']);
export const platform = pgEnum('ad_platform', ['meta', 'google_ads', 'ga4', 'other']);
export const metricSource = pgEnum('metric_source', ['api', 'csv', 'manual', 'demo']);
export const conversionType = pgEnum('conversion_type', ['form_submit', 'application', 'admission', 'sale']);
export const pageStatus = pgEnum('page_status', ['unknown', 'up', 'down']);
export const incidentStatus = pgEnum('incident_status', ['open', 'acknowledged', 'resolved', 'closed']);
export const deliverableFormat = pgEnum('deliverable_format', [
  'poster',
  'reel',
  'testimonial',
  'brand_film',
  'aftermovie',
  'landing_page',
  'newsletter',
  'social_post',
  'admission_campaign',
  'other',
]);
export const deliverableStatus = pgEnum('deliverable_status', [
  'draft',
  'internal_review',
  'submitted_to_client',
  'changes_requested',
  'revised',
  'approved',
  'scheduled',
  'published',
]);
export const approvalStage = pgEnum('approval_stage', ['internal', 'client']);
export const approvalDecision = pgEnum('approval_decision', [
  'pending',
  'approved',
  'changes_requested',
  'withdrawn',
]);
export const reportType = pgEnum('report_type', [
  'daily_digest',
  'weekly_ops',
  'weekly_campaign',
  'monthly_client',
  'executive',
  'pipeline',
]);
export const reportStatus = pgEnum('report_status', [
  'draft',
  'in_review',
  'approved',
  'delivered',
  'failed',
]);
export const executionStatus = pgEnum('execution_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead',
  'skipped',
]);
export const integrationProvider = pgEnum('integration_provider', [
  'meta_ads',
  'meta_lead_ads',
  'google_ads',
  'ga4',
  'website_forms',
  'email_smtp',
  'whatsapp',
  'n8n',
  'google_workspace',
  'instagram',
  'ai_assistant',
]);
export const integrationMode = pgEnum('integration_mode', ['disconnected', 'demo', 'live']);
export const integrationStatus = pgEnum('integration_status', [
  'disconnected',
  'healthy',
  'degraded',
  'error',
]);
export const expenseCategory = pgEnum('expense_category', [
  'ad_spend_passthrough',
  'production',
  'freelancer',
  'software',
  'travel',
  'other',
]);
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
]);
export const meetingStatus = pgEnum('meeting_status', ['scheduled', 'completed', 'cancelled', 'no_show']);
export const budgetType = pgEnum('budget_type', ['project', 'campaign', 'client_retainer']);

/* ----------------------------------------------------------- organisation */

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  currency: text('currency').notNull().default('INR'),
  /** Configurable business rules (SLAs, thresholds, assignment strategy). See src/lib/org-settings.ts */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_org_key').on(t.orgId, t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    leadId: uuid('lead_user_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('teams_org_name').on(t.orgId, t.name)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    teamId: uuid('team_id').references(() => teams.id),
    /** Set only for external client reviewers — they are scoped to this client. */
    clientId: uuid('client_id').references((): AnyPgColumn => clients.id),
    isActive: boolean('is_active').notNull().default(true),
    /** Eligible for automatic lead assignment (round-robin). */
    acceptsLeads: boolean('accepts_leads').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    lastAssignedAt: ts('last_assigned_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_org_email').on(t.orgId, t.email), index('users_role').on(t.roleId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only ever lives in the user's cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const employeeProfiles = pgTable('employee_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  phone: text('phone'),
  capacityHoursPerWeek: integer('capacity_hours_per_week').notNull().default(40),
  /** Restricted: visible only with finance.read. Used for labour-cost allocation. */
  hourlyCostMinor: money('hourly_cost_minor'),
  joinedOn: date('joined_on'),
  ...timestamps,
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['leads:ingest']::text[]`),
    /** Leads ingested through this key are attributed to this client (admissions forms) when set. */
    clientId: uuid('client_id').references((): AnyPgColumn => clients.id),
    createdById: uuid('created_by_id').references(() => users.id),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    ...timestamps,
  },
  (t) => [index('api_keys_org').on(t.orgId)],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull().default(0),
});

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    name: text('name').notNull(),
    query: text('query').notNull(),
    ...timestamps,
  },
  (t) => [index('saved_views_user_module').on(t.userId, t.module)],
);

/* ---------------------------------------------------------------- clients */

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    orgType: orgType('org_type').notNull().default('educational_institution'),
    status: clientStatus('status').notNull().default('onboarding'),
    accountOwnerId: uuid('account_owner_id').references(() => users.id),
    services: text('services')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    commercialTerms: text('commercial_terms'),
    contractStart: date('contract_start'),
    contractEnd: date('contract_end'),
    renewalDate: date('renewal_date'),
    website: text('website'),
    city: text('city'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clients_org_name').on(t.orgId, t.name),
    index('clients_owner').on(t.accountOwnerId),
    index('clients_renewal').on(t.renewalDate),
  ],
);

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    designation: text('designation'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isApprover: boolean('is_approver').notNull().default(false),
    /** Linked portal login for this contact, if one has been invited. */
    userId: uuid('user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [index('client_contacts_client').on(t.clientId)],
);

/* ------------------------------------------------------------------- CRM */

export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('lead_sources_org_key').on(t.orgId, t.key)],
);

export type Touch = {
  at: string;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landingPage?: string | null;
};

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ref: text('ref').notNull(),
    /** Null = Sahynex's own sales prospect. Set = enquiry generated for a client (e.g. admissions). */
    clientId: uuid('client_id').references(() => clients.id),
    name: text('name').notNull(),
    email: text('email'),
    emailNormalized: text('email_normalized'),
    phone: text('phone'),
    phoneNormalized: text('phone_normalized'),
    organisationName: text('organisation_name'),
    leadType: leadType('lead_type').notNull().default('client_prospect'),
    interest: text('interest'),
    city: text('city'),
    sourceId: uuid('source_id').references(() => leadSources.id),
    campaignId: uuid('campaign_id').references((): AnyPgColumn => campaigns.id),
    externalId: text('external_id'),
    firstTouch: jsonb('first_touch').$type<Touch>(),
    latestTouch: jsonb('latest_touch').$type<Touch>(),
    ownerId: uuid('owner_id').references(() => users.id),
    stage: leadStage('stage').notNull().default('new'),
    qualificationStatus: qualificationStatus('qualification_status').notNull().default('pending'),
    qualificationData: jsonb('qualification_data').$type<Record<string, unknown>>().notNull().default({}),
    score: integer('score'),
    consentMarketing: boolean('consent_marketing').notNull().default(false),
    consentCapturedAt: ts('consent_captured_at'),
    consentSource: text('consent_source'),
    suppressed: boolean('suppressed').notNull().default(false),
    suppressedReason: text('suppressed_reason'),
    lastContactAt: ts('last_contact_at'),
    nextActionAt: ts('next_action_at'),
    nextAction: text('next_action'),
    lossReason: text('loss_reason'),
    convertedDealId: uuid('converted_deal_id'),
    /** Possible duplicate with conflicting data — flagged for human review, never auto-merged. */
    possibleDuplicateOfId: uuid('possible_duplicate_of_id'),
    remindedAt: ts('reminded_at'),
    escalatedAt: ts('escalated_at'),
    isTest: boolean('is_test').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leads_org_ref').on(t.orgId, t.ref),
    index('leads_org_email').on(t.orgId, t.emailNormalized),
    index('leads_org_phone').on(t.orgId, t.phoneNormalized),
    index('leads_org_stage').on(t.orgId, t.stage),
    index('leads_owner').on(t.ownerId),
    index('leads_next_action').on(t.nextActionAt),
    index('leads_campaign').on(t.campaignId),
    index('leads_client').on(t.clientId),
    index('leads_created').on(t.orgId, t.createdAt),
    uniqueIndex('leads_org_external')
      .on(t.orgId, t.externalId)
      .where(sql`external_id is not null`),
  ],
);

export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id),
    type: activityType('type').notNull(),
    body: text('body'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('lead_activities_lead').on(t.leadId, t.createdAt)],
);

/* ----------------------------------------------------------------- sales */

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ref: text('ref').notNull(),
    title: text('title').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    leadId: uuid('lead_id').references(() => leads.id),
    prospectName: text('prospect_name').notNull(),
    prospectOrgType: orgType('prospect_org_type').notNull().default('educational_institution'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    services: text('services')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    valueMinor: money('value_minor').notNull().default(0),
    probability: integer('probability').notNull().default(10),
    stage: dealStage('stage').notNull().default('new_prospect'),
    expectedCloseDate: date('expected_close_date'),
    lastInteractionAt: ts('last_interaction_at'),
    nextAction: text('next_action'),
    nextActionAt: ts('next_action_at'),
    lostReason: text('lost_reason'),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }),
    discountApprovedById: uuid('discount_approved_by_id').references(() => users.id),
    discountApprovedAt: ts('discount_approved_at'),
    contractStart: date('contract_start'),
    contractEnd: date('contract_end'),
    renewalDate: date('renewal_date'),
    wonAt: ts('won_at'),
    closedAt: ts('closed_at'),
    staleAlertedAt: ts('stale_alerted_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deals_org_ref').on(t.orgId, t.ref),
    index('deals_org_stage').on(t.orgId, t.stage),
    index('deals_owner').on(t.ownerId),
  ],
);

export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    fromStage: dealStage('from_stage'),
    toStage: dealStage('to_stage').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('deal_stage_history_deal').on(t.dealId)],
);

/**
 * Discovery and sales meetings. A meeting belongs to a deal or a lead, has one organiser, and keeps
 * a stable calendar UID plus a sequence number so updated or cancelled invites replace the original
 * event in the attendee's calendar instead of duplicating it.
 */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    purpose: text('purpose').notNull().default('discovery'),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    location: text('location'),
    attendees: text('attendees')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    agenda: text('agenda'),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    status: meetingStatus('status').notNull().default('scheduled'),
    outcome: text('outcome'),
    taskId: uuid('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    icsUid: text('ics_uid').notNull(),
    sequence: integer('sequence').notNull().default(0),
    inviteEmailedAt: ts('invite_emailed_at'),
    ...timestamps,
  },
  (t) => [
    index('meetings_deal').on(t.dealId, t.startAt),
    index('meetings_lead').on(t.leadId, t.startAt),
    index('meetings_org_start').on(t.orgId, t.startAt),
    uniqueIndex('meetings_ics_uid').on(t.icsUid),
    check('meetings_subject', sql`deal_id is not null or lead_id is not null`),
    check('meetings_time_order', sql`end_at > start_at`),
  ],
);

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    valueMinor: money('value_minor').notNull(),
    status: proposalStatus('status').notNull().default('draft'),
    summary: text('summary'),
    documentUrl: text('document_url'),
    sentAt: ts('sent_at'),
    respondedAt: ts('responded_at'),
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('proposals_deal_version').on(t.dealId, t.version)],
);

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    dealId: uuid('deal_id').references(() => deals.id),
    title: text('title').notNull(),
    billingType: text('billing_type').notNull().default('retainer'),
    valueMinor: money('value_minor').notNull().default(0),
    startDate: date('start_date'),
    endDate: date('end_date'),
    renewalDate: date('renewal_date'),
    status: text('status').notNull().default('draft'),
    approvedById: uuid('approved_by_id').references(() => users.id),
    approvedAt: ts('approved_at'),
    ...timestamps,
  },
  (t) => [index('contracts_client').on(t.clientId)],
);

/** Formal sales → operations handover. A project cannot go active until this is approved. */
export const handovers = pgTable(
  'handovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    status: handoverStatus('status').notNull().default('draft'),
    projectName: text('project_name').notNull(),
    scope: text('scope'),
    deliverablesSummary: text('deliverables_summary'),
    proposedOwnerId: uuid('proposed_owner_id').references(() => users.id),
    targetStart: date('target_start'),
    targetEnd: date('target_end'),
    budgetMinor: money('budget_minor'),
    templateKey: text('template_key'),
    commercialApproved: boolean('commercial_approved').notNull().default(false),
    submittedById: uuid('submitted_by_id').references(() => users.id),
    submittedAt: ts('submitted_at'),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    projectId: uuid('project_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('handovers_deal').on(t.dealId)],
);

/* -------------------------------------------------------------- projects */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ref: text('ref').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    scope: text('scope'),
    objectives: text('objectives'),
    ownerId: uuid('owner_id').references(() => users.id),
    status: projectStatus('status').notNull().default('planning'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    budgetMinor: money('budget_minor'),
    revenueMinor: money('revenue_minor'),
    reportingCadence: cadence('reporting_cadence').notNull().default('monthly'),
    approvalRequired: boolean('approval_required').notNull().default(true),
    risks: text('risks'),
    handoverId: uuid('handover_id'),
    templateKey: text('template_key'),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('projects_org_ref').on(t.orgId, t.ref),
    index('projects_client').on(t.clientId),
    index('projects_status').on(t.orgId, t.status),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user').on(t.userId)],
);

export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dueDate: date('due_date'),
    completedAt: ts('completed_at'),
    ...timestamps,
  },
  (t) => [index('milestones_project').on(t.projectId)],
);

export type TemplateItem = {
  title: string;
  description?: string;
  offsetDays: number;
  durationDays: number;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  /** Who should own it: 'project_owner' or a role key. Falls back to the project owner. */
  assignee?: string;
  effortPoints?: number;
  milestone?: string;
  dependsOn?: number[];
};

export const taskTemplates = pgTable(
  'task_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    items: jsonb('items').$type<TemplateItem[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex('task_templates_org_key').on(t.orgId, t.key)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ref: text('ref').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    clientId: uuid('client_id').references(() => clients.id),
    leadId: uuid('lead_id').references(() => leads.id),
    dealId: uuid('deal_id').references(() => deals.id),
    deliverableId: uuid('deliverable_id').references((): AnyPgColumn => deliverables.id),
    milestoneId: uuid('milestone_id').references(() => milestones.id),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('todo'),
    priority: priority('priority').notNull().default('medium'),
    ownerId: uuid('owner_id').references(() => users.id),
    createdById: uuid('created_by_id').references(() => users.id),
    startAt: ts('start_at'),
    dueAt: ts('due_at'),
    completedAt: ts('completed_at'),
    effortPoints: integer('effort_points').notNull().default(1),
    blockerNote: text('blocker_note'),
    completionNote: text('completion_note'),
    recurrence: text('recurrence'),
    recurrenceParentId: uuid('recurrence_parent_id'),
    /** Idempotency key for automation-created tasks — prevents duplicates on retries. */
    sourceKey: text('source_key'),
    reminderSentAt: ts('reminder_sent_at'),
    overdueEscalatedAt: ts('overdue_escalated_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tasks_org_ref').on(t.orgId, t.ref),
    uniqueIndex('tasks_org_source_key')
      .on(t.orgId, t.sourceKey)
      .where(sql`source_key is not null`),
    index('tasks_owner_status').on(t.ownerId, t.status),
    index('tasks_project').on(t.projectId),
    index('tasks_due').on(t.orgId, t.dueAt),
    index('tasks_lead').on(t.leadId),
    index('tasks_deal').on(t.dealId),
  ],
);

export const taskCollaborators = pgTable(
  'task_collaborators',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('comments_entity').on(t.entityType, t.entityId)],
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id),
    minutes: integer('minutes').notNull(),
    workDate: date('work_date').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('time_entries_project').on(t.projectId), index('time_entries_user').on(t.userId, t.workDate)],
);

/* ------------------------------------------------------------- campaigns */

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    name: text('name').notNull(),
    platform: platform('platform').notNull(),
    externalId: text('external_id'),
    accountExternalId: text('account_external_id'),
    objective: text('objective'),
    status: text('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    budgetMinor: money('budget_minor'),
    /** Alert when CPL over the evaluation window exceeds this. Null = no CPL alert. */
    cplThresholdMinor: money('cpl_threshold_minor'),
    /** Alert when daily spend exceeds this. */
    dailySpendThresholdMinor: money('daily_spend_threshold_minor'),
    /** Minimum leads in the window before a CPL alert may fire (avoids noise on tiny samples). */
    minLeadsForAlert: integer('min_leads_for_alert').notNull().default(10),
    attributionWindow: text('attribution_window'),
    ownerId: uuid('owner_id').references(() => users.id),
    lastSyncedAt: ts('last_synced_at'),
    lastSyncError: text('last_sync_error'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('campaigns_org_platform_ext')
      .on(t.orgId, t.platform, t.externalId)
      .where(sql`external_id is not null`),
    index('campaigns_client').on(t.clientId),
  ],
);

export const campaignMetrics = pgTable(
  'campaign_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    spendMinor: money('spend_minor').notNull(),
    impressions: integer('impressions').notNull(),
    reach: integer('reach'),
    clicks: integer('clicks').notNull(),
    /** Platform-reported leads (platform attribution). CRM leads are counted separately. */
    platformLeads: integer('platform_leads'),
    landingPageViews: integer('landing_page_views'),
    source: metricSource('source').notNull(),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_metrics_campaign_date').on(t.campaignId, t.date),
    index('campaign_metrics_date').on(t.orgId, t.date),
  ],
);

export const conversionEvents = pgTable(
  'conversion_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id').references(() => clients.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    leadId: uuid('lead_id').references(() => leads.id),
    type: conversionType('type').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    valueMinor: money('value_minor'),
    verified: boolean('verified').notNull().default(false),
    verifiedById: uuid('verified_by_id').references(() => users.id),
    source: text('source').notNull(),
    externalId: text('external_id'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('conversion_events_client').on(t.clientId, t.type),
    index('conversion_events_campaign').on(t.campaignId),
  ],
);

export const monitoredPages = pgTable(
  'monitored_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id').references(() => clients.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    name: text('name').notNull(),
    url: text('url').notNull(),
    expectedStatus: integer('expected_status').notNull().default(200),
    expectedText: text('expected_text'),
    /** Alert if no CRM leads arrive from this page's campaign in N hours while spend continues. */
    conversionGapHours: integer('conversion_gap_hours'),
    ownerId: uuid('owner_id').references(() => users.id),
    isActive: boolean('is_active').notNull().default(true),
    lastCheckedAt: ts('last_checked_at'),
    lastStatus: pageStatus('last_status').notNull().default('unknown'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('monitored_pages_org').on(t.orgId)],
);

export const pageChecks = pgTable(
  'page_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => monitoredPages.id, { onDelete: 'cascade' }),
    checkedAt: ts('checked_at').notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    statusCode: integer('status_code'),
    responseMs: integer('response_ms'),
    error: text('error'),
  },
  (t) => [index('page_checks_page').on(t.pageId, t.checkedAt)],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    pageId: uuid('page_id').references(() => monitoredPages.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    status: incidentStatus('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id),
    openedAt: ts('opened_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
    resolvedAt: ts('resolved_at'),
    verifiedAt: ts('verified_at'),
    closedAt: ts('closed_at'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('incidents_org_status').on(t.orgId, t.status),
    // At most one unresolved incident per page — prevents duplicate incidents on repeated failures.
    uniqueIndex('incidents_open_page')
      .on(t.pageId)
      .where(sql`status in ('open','acknowledged','resolved') and page_id is not null`),
  ],
);

/* ------------------------------------------------- content & approvals */

export const deliverables = pgTable(
  'deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    ref: text('ref').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    title: text('title').notNull(),
    format: deliverableFormat('format').notNull().default('social_post'),
    channel: text('channel'),
    audience: text('audience'),
    brief: text('brief'),
    ownerId: uuid('owner_id').references(() => users.id),
    status: deliverableStatus('status').notNull().default('draft'),
    currentVersion: integer('current_version').notNull().default(0),
    revisionCount: integer('revision_count').notNull().default(0),
    dueAt: ts('due_at'),
    publishAt: ts('publish_at'),
    publishedAt: ts('published_at'),
    /** 'manual' unless a verified publishing integration exists for the channel. */
    publishMode: text('publish_mode').notNull().default('manual'),
    finalAssetId: uuid('final_asset_id'),
    finalUrl: text('final_url'),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deliverables_org_ref').on(t.orgId, t.ref),
    index('deliverables_project').on(t.projectId),
    index('deliverables_publish').on(t.orgId, t.publishAt),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    deliverableId: uuid('deliverable_id').references(() => deliverables.id),
    projectId: uuid('project_id').references(() => projects.id),
    clientId: uuid('client_id').references(() => clients.id),
    version: integer('version'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    uploadedById: uuid('uploaded_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('assets_deliverable').on(t.deliverableId)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    stage: approvalStage('stage').notNull(),
    assetId: uuid('asset_id').references(() => assets.id),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    submittedById: uuid('submitted_by_id').references(() => users.id),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
    decision: approvalDecision('decision').notNull().default('pending'),
    feedback: text('feedback'),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: ts('decided_at'),
    remindersSent: integer('reminders_sent').notNull().default(0),
    lastReminderAt: ts('last_reminder_at'),
  },
  (t) => [
    index('approvals_deliverable').on(t.deliverableId),
    index('approvals_pending').on(t.orgId, t.decision),
    uniqueIndex('approvals_one_pending')
      .on(t.deliverableId, t.stage)
      .where(sql`decision = 'pending'`),
  ],
);

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    approvalId: uuid('approval_id')
      .notNull()
      .references(() => approvals.id),
    fromVersion: integer('from_version').notNull(),
    toVersion: integer('to_version'),
    feedback: text('feedback'),
    taskId: uuid('task_id').references(() => tasks.id),
    resolvedAt: ts('resolved_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('revisions_approval').on(t.approvalId)],
);

/* -------------------------------------------------- reporting & KPIs */

export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reportDate: date('report_date').notNull(),
    completed: text('completed').notNull(),
    inProgress: text('in_progress'),
    blockers: text('blockers'),
    plannedNext: text('planned_next'),
    ...timestamps,
  },
  (t) => [uniqueIndex('daily_reports_user_date').on(t.userId, t.reportDate)],
);

export const kpis = pgTable(
  'kpis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull().default('count'),
    direction: text('direction').notNull().default('higher_is_better'),
    period: text('period').notNull().default('monthly'),
    clientId: uuid('client_id').references(() => clients.id),
    userId: uuid('user_id').references(() => users.id),
    target: numeric('target', { precision: 18, scale: 4 }),
    definition: text('definition').notNull(),
    ...timestamps,
  },
  (t) => [index('kpis_org').on(t.orgId)],
);

export const kpiRecords = pgTable(
  'kpi_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kpiId: uuid('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    value: numeric('value', { precision: 18, scale: 4 }),
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('kpi_records_kpi_period').on(t.kpiId, t.periodStart)],
);

export type ReportContent = {
  sections: Array<{
    title: string;
    metrics: Array<{
      key: string;
      label: string;
      value: number | null;
      display: string;
      definition: string;
      source: string;
      previous?: number | null;
    }>;
    notes?: string[];
  }>;
  exceptions: string[];
  freshness: Array<{ source: string; lastSuccessAt: string | null; stale: boolean }>;
  demoDataIncluded: boolean;
};

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    type: reportType('type').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    title: text('title').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: reportStatus('status').notNull().default('draft'),
    content: jsonb('content').$type<ReportContent>().notNull(),
    /** Human / AI-assisted interpretation. Kept separate from measured content. */
    commentary: text('commentary'),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    generatedById: uuid('generated_by_id').references(() => users.id),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    approvedAt: ts('approved_at'),
    deliveredAt: ts('delivered_at'),
    deliveryChannel: text('delivery_channel'),
    deliveryError: text('delivery_error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reports_unique_period')
      .on(t.orgId, t.type, t.periodStart, t.clientId)
      .where(sql`client_id is not null`),
    uniqueIndex('reports_unique_period_org')
      .on(t.orgId, t.type, t.periodStart)
      .where(sql`client_id is null`),
  ],
);

/* -------------------------------------------------------- automation */

export type AutomationTrigger = { type: 'event'; events: string[] } | { type: 'schedule'; cron: string };

export const automations = pgTable(
  'automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
    conditions: jsonb('conditions').$type<string[]>().notNull().default([]),
    actions: jsonb('actions').$type<string[]>().notNull().default([]),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    ownerId: uuid('owner_id').references(() => users.id),
    enabled: boolean('enabled').notNull().default(true),
    maxAttempts: integer('max_attempts').notNull().default(5),
    backoffBaseSeconds: integer('backoff_base_seconds').notNull().default(30),
    timeoutSeconds: integer('timeout_seconds').notNull().default(60),
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    lastSuccessAt: ts('last_success_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    requiresIntegration: text('requires_integration'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('automations_org_key').on(t.orgId, t.key),
    index('automations_next_run').on(t.nextRunAt),
  ],
);

export type ExecutionLog = { at: string; level: 'info' | 'warn' | 'error'; message: string; data?: unknown };

export const automationExecutions = pgTable(
  'automation_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id),
    idempotencyKey: text('idempotency_key').notNull(),
    status: executionStatus('status').notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    runAfter: ts('run_after').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    logs: jsonb('logs').$type<ExecutionLog[]>().notNull().default([]),
    result: jsonb('result').$type<Record<string, unknown>>(),
    retryOfId: uuid('retry_of_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('executions_idempotency').on(t.automationId, t.idempotencyKey),
    index('executions_due').on(t.status, t.runAfter),
    index('executions_automation').on(t.automationId, t.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    dedupeKey: text('dedupe_key'),
    emailStatus: text('email_status'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user').on(t.userId, t.readAt, t.createdAt),
    uniqueIndex('notifications_dedupe')
      .on(t.userId, t.dedupeKey)
      .where(sql`dedupe_key is not null`),
  ],
);

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    provider: integrationProvider('provider').notNull(),
    mode: integrationMode('mode').notNull().default('disconnected'),
    status: integrationStatus('status').notNull().default('disconnected'),
    accountLabel: text('account_label'),
    /** Non-secret configuration only (account IDs, property IDs). Secrets live in env / secret manager. */
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    lastHealthCheckAt: ts('last_health_check_at'),
    lastSuccessSyncAt: ts('last_success_sync_at'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [uniqueIndex('integrations_org_provider').on(t.orgId, t.provider)],
);

/* ------------------------------------------------- personal briefing */

/**
 * A person's own Google connection (Gmail + Calendar, read-only), used only for their Home page.
 * The refresh token is encrypted at rest (AES-256-GCM, see server/crypto.ts) and never sent to
 * the browser. One connection per user; disconnecting deletes the row.
 */
export const userGoogleConnections = pgTable('user_google_connections', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  googleEmail: text('google_email'),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scopes: text('scopes').notNull(),
  lastSyncAt: ts('last_sync_at'),
  lastError: text('last_error'),
  ...timestamps,
});

/** One row per Instagram account per day, so the Home page can show day-over-day change. */
export const instagramSnapshots = pgTable(
  'instagram_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    igUserId: text('ig_user_id').notNull(),
    username: text('username'),
    date: date('date').notNull(),
    followers: integer('followers'),
    mediaCount: integer('media_count'),
    /** Recent posts with platform-reported likes/comments at snapshot time. */
    recentMedia: jsonb('recent_media')
      .$type<
        Array<{
          id: string;
          caption: string | null;
          timestamp: string;
          likes: number | null;
          comments: number | null;
          permalink: string | null;
          type: string | null;
        }>
      >()
      .notNull()
      .default([]),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('instagram_snapshots_day').on(t.orgId, t.igUserId, t.date)],
);

/**
 * The AI-written daily brief, generated at most once per person per day (or on request) and
 * cached. `facts` keeps exactly what the model was given, so every statement can be traced.
 */
export const aiBriefs = pgTable(
  'ai_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
    model: text('model').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('ai_briefs_user_day').on(t.userId, t.date)],
);

/* ----------------------------------------------------------- finance */

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    type: budgetType('type').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    amountMinor: money('amount_minor').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    approvedById: uuid('approved_by_id').references(() => users.id),
    approvedAt: ts('approved_at'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('budgets_org').on(t.orgId)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    projectId: uuid('project_id').references(() => projects.id),
    clientId: uuid('client_id').references(() => clients.id),
    category: expenseCategory('category').notNull(),
    description: text('description').notNull(),
    vendor: text('vendor'),
    amountMinor: money('amount_minor').notNull(),
    incurredOn: date('incurred_on').notNull(),
    /** Pass-through costs (e.g. ad spend billed to client) are excluded from agency margin. */
    isPassThrough: boolean('is_pass_through').notNull().default(false),
    createdById: uuid('created_by_id').references(() => users.id),
    approvedById: uuid('approved_by_id').references(() => users.id),
    approvedAt: ts('approved_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('expenses_project').on(t.projectId), index('expenses_org_date').on(t.orgId, t.incurredOn)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    number: text('number').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    /** Agency fee (revenue). */
    amountMinor: money('amount_minor').notNull(),
    taxMinor: money('tax_minor').notNull().default(0),
    /** Pass-through amounts billed (e.g. media spend). Not revenue. */
    passThroughMinor: money('pass_through_minor').notNull().default(0),
    paidMinor: money('paid_minor').notNull().default(0),
    status: invoiceStatus('status').notNull().default('draft'),
    paidAt: ts('paid_at'),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('invoices_org_number').on(t.orgId, t.number), index('invoices_client').on(t.clientId)],
);

/* -------------------------------------------------------------- audit */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    actorId: uuid('actor_id').references(() => users.id),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_entity').on(t.entityType, t.entityId),
    index('audit_org_created').on(t.orgId, t.createdAt),
  ],
);

/** Per-org monotonic counters for human-readable references (LD-0001, DL-0001 …). */
export const counters = pgTable(
  'counters',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

/* --------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  profile: one(employeeProfiles, { fields: [users.id], references: [employeeProfiles.userId] }),
}));
export const rolesRelations = relations(roles, ({ many }) => ({ permissions: many(rolePermissions) }));
export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));
export const leadsRelations = relations(leads, ({ one, many }) => ({
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  client: one(clients, { fields: [leads.clientId], references: [clients.id] }),
  campaign: one(campaigns, { fields: [leads.campaignId], references: [campaigns.id] }),
  activities: many(leadActivities),
}));
export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, { fields: [leadActivities.leadId], references: [leads.id] }),
  actor: one(users, { fields: [leadActivities.actorId], references: [users.id] }),
}));
export const dealsRelations = relations(deals, ({ one, many }) => ({
  owner: one(users, { fields: [deals.ownerId], references: [users.id] }),
  client: one(clients, { fields: [deals.clientId], references: [clients.id] }),
  lead: one(leads, { fields: [deals.leadId], references: [leads.id] }),
  proposals: many(proposals),
  history: many(dealStageHistory),
  handover: one(handovers, { fields: [deals.id], references: [handovers.dealId] }),
}));
export const proposalsRelations = relations(proposals, ({ one }) => ({
  deal: one(deals, { fields: [proposals.dealId], references: [deals.id] }),
}));
export const dealStageHistoryRelations = relations(dealStageHistory, ({ one }) => ({
  deal: one(deals, { fields: [dealStageHistory.dealId], references: [deals.id] }),
  actor: one(users, { fields: [dealStageHistory.actorId], references: [users.id] }),
}));
export const handoversRelations = relations(handovers, ({ one }) => ({
  deal: one(deals, { fields: [handovers.dealId], references: [deals.id] }),
}));
export const clientsRelations = relations(clients, ({ one, many }) => ({
  owner: one(users, { fields: [clients.accountOwnerId], references: [users.id] }),
  contacts: many(clientContacts),
  projects: many(projects),
  campaigns: many(campaigns),
}));
export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  client: one(clients, { fields: [clientContacts.clientId], references: [clients.id] }),
}));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  members: many(projectMembers),
  milestones: many(milestones),
  tasks: many(tasks),
  deliverables: many(deliverables),
}));
export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));
export const milestonesRelations = relations(milestones, ({ one }) => ({
  project: one(projects, { fields: [milestones.projectId], references: [projects.id] }),
}));
export const tasksRelations = relations(tasks, ({ one }) => ({
  owner: one(users, { fields: [tasks.ownerId], references: [users.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  deal: one(deals, { fields: [tasks.dealId], references: [deals.id] }),
}));
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  client: one(clients, { fields: [campaigns.clientId], references: [clients.id] }),
  owner: one(users, { fields: [campaigns.ownerId], references: [users.id] }),
  metrics: many(campaignMetrics),
}));
export const campaignMetricsRelations = relations(campaignMetrics, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignMetrics.campaignId], references: [campaigns.id] }),
}));
export const deliverablesRelations = relations(deliverables, ({ one, many }) => ({
  project: one(projects, { fields: [deliverables.projectId], references: [projects.id] }),
  client: one(clients, { fields: [deliverables.clientId], references: [clients.id] }),
  owner: one(users, { fields: [deliverables.ownerId], references: [users.id] }),
  approvals: many(approvals),
  assets: many(assets),
  revisions: many(revisions),
}));
export const assetsRelations = relations(assets, ({ one }) => ({
  deliverable: one(deliverables, { fields: [assets.deliverableId], references: [deliverables.id] }),
  uploadedBy: one(users, { fields: [assets.uploadedById], references: [users.id] }),
}));
export const approvalsRelations = relations(approvals, ({ one }) => ({
  deliverable: one(deliverables, { fields: [approvals.deliverableId], references: [deliverables.id] }),
  reviewer: one(users, { fields: [approvals.reviewerId], references: [users.id] }),
  decidedBy: one(users, { fields: [approvals.decidedById], references: [users.id] }),
  asset: one(assets, { fields: [approvals.assetId], references: [assets.id] }),
}));
export const revisionsRelations = relations(revisions, ({ one }) => ({
  deliverable: one(deliverables, { fields: [revisions.deliverableId], references: [deliverables.id] }),
}));
export const automationsRelations = relations(automations, ({ one, many }) => ({
  owner: one(users, { fields: [automations.ownerId], references: [users.id] }),
  executions: many(automationExecutions),
}));
export const automationExecutionsRelations = relations(automationExecutions, ({ one }) => ({
  automation: one(automations, { fields: [automationExecutions.automationId], references: [automations.id] }),
}));
export const monitoredPagesRelations = relations(monitoredPages, ({ one, many }) => ({
  client: one(clients, { fields: [monitoredPages.clientId], references: [clients.id] }),
  owner: one(users, { fields: [monitoredPages.ownerId], references: [users.id] }),
  checks: many(pageChecks),
}));
export const pageChecksRelations = relations(pageChecks, ({ one }) => ({
  page: one(monitoredPages, { fields: [pageChecks.pageId], references: [monitoredPages.id] }),
}));
export const incidentsRelations = relations(incidents, ({ one }) => ({
  page: one(monitoredPages, { fields: [incidents.pageId], references: [monitoredPages.id] }),
  owner: one(users, { fields: [incidents.ownerId], references: [users.id] }),
}));
export const reportsRelations = relations(reports, ({ one }) => ({
  client: one(clients, { fields: [reports.clientId], references: [clients.id] }),
}));
export const invoicesRelations = relations(invoices, ({ one }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
}));
export const expensesRelations = relations(expenses, ({ one }) => ({
  project: one(projects, { fields: [expenses.projectId], references: [projects.id] }),
  client: one(clients, { fields: [expenses.clientId], references: [clients.id] }),
}));
export const budgetsRelations = relations(budgets, ({ one }) => ({
  client: one(clients, { fields: [budgets.clientId], references: [clients.id] }),
  project: one(projects, { fields: [budgets.projectId], references: [projects.id] }),
  campaign: one(campaigns, { fields: [budgets.campaignId], references: [campaigns.id] }),
}));
export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));
