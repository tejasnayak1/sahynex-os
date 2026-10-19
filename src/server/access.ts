/**
 * Record-level access scoping. Every list/detail query for a protected entity MUST combine its
 * filters with the scope returned here. A scope of `NONE` means "no rows" (the user has no read
 * permission for that entity at all) — queries still run safely and return empty.
 *
 * These are SQL conditions, so authorisation is enforced at the data-access layer, not in the UI.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import { can, type Actor } from './actor';

const {
  leads,
  deals,
  clients,
  projects,
  projectMembers,
  tasks,
  taskCollaborators,
  campaigns,
  deliverables,
  reports,
} = schema;

export const NONE: SQL = sql`false`;

function myProjectIds(userId: string) {
  return sql`(select ${projects.id} from ${projects} where ${projects.ownerId} = ${userId}
    union select ${projectMembers.projectId} from ${projectMembers} where ${projectMembers.userId} = ${userId})`;
}

function myClientIds(userId: string) {
  return sql`(select ${clients.id} from ${clients} where ${clients.accountOwnerId} = ${userId}
    union select ${projects.clientId} from ${projects} where ${projects.id} in ${myProjectIds(userId)})`;
}

export function leadScope(actor: Actor): SQL {
  const base = and(eq(leads.orgId, actor.orgId), isNull(leads.deletedAt))!;
  if (actor.clientId) return NONE; // client reviewers never see CRM
  if (can(actor, 'leads.read.all')) return base;
  if (actor.kind === 'user' && can(actor, 'leads.read.own')) return and(base, eq(leads.ownerId, actor.id))!;
  return NONE;
}

export function dealScope(actor: Actor): SQL {
  const base = and(eq(deals.orgId, actor.orgId), isNull(deals.deletedAt))!;
  if (actor.clientId) return NONE;
  if (can(actor, 'deals.read.all')) return base;
  if (actor.kind === 'user' && can(actor, 'deals.read.own')) return and(base, eq(deals.ownerId, actor.id))!;
  return NONE;
}

export function clientScope(actor: Actor): SQL {
  const base = and(eq(clients.orgId, actor.orgId), isNull(clients.deletedAt))!;
  if (actor.clientId) return and(base, eq(clients.id, actor.clientId))!;
  if (can(actor, 'clients.read.all')) return base;
  if (actor.kind === 'user' && can(actor, 'clients.read.assigned'))
    return and(base, sql`${clients.id} in ${myClientIds(actor.id)}`)!;
  return NONE;
}

/** Client ids visible to the actor, as a subquery usable in `in (...)`. */
export function visibleClientIds(actor: Actor): SQL {
  return sql`(select ${clients.id} from ${clients} where ${clientScope(actor)})`;
}

export function projectScope(actor: Actor): SQL {
  const base = and(eq(projects.orgId, actor.orgId), isNull(projects.deletedAt))!;
  if (actor.clientId) return and(base, eq(projects.clientId, actor.clientId))!;
  if (can(actor, 'projects.read.all')) return base;
  if (actor.kind === 'user' && can(actor, 'projects.read.assigned'))
    return and(base, sql`${projects.id} in ${myProjectIds(actor.id)}`)!;
  return NONE;
}

export function visibleProjectIds(actor: Actor): SQL {
  return sql`(select ${projects.id} from ${projects} where ${projectScope(actor)})`;
}

export function taskScope(actor: Actor): SQL {
  const base = and(eq(tasks.orgId, actor.orgId), isNull(tasks.deletedAt))!;
  if (actor.clientId) return NONE;
  if (can(actor, 'tasks.read.all')) return base;
  if (actor.kind === 'user' && can(actor, 'tasks.read.assigned')) {
    return and(
      base,
      or(
        eq(tasks.ownerId, actor.id),
        eq(tasks.createdById, actor.id),
        sql`${tasks.id} in (select ${taskCollaborators.taskId} from ${taskCollaborators} where ${taskCollaborators.userId} = ${actor.id})`,
        sql`${tasks.projectId} in ${myProjectIds(actor.id)}`,
        // Sales tasks attached to leads/deals the actor can see
        can(actor, 'leads.read.all') ? sql`${tasks.leadId} is not null` : undefined,
        can(actor, 'deals.read.all') ? sql`${tasks.dealId} is not null` : undefined,
      ),
    )!;
  }
  return NONE;
}

export function campaignScope(actor: Actor): SQL {
  if (actor.clientId || !can(actor, 'campaigns.read')) return NONE;
  return and(eq(campaigns.orgId, actor.orgId), inArray(campaigns.clientId, visibleClientIds(actor)))!;
}

/** Client reviewers only see deliverables that have been explicitly submitted to them. */
export function deliverableScope(actor: Actor): SQL {
  const base = and(eq(deliverables.orgId, actor.orgId), isNull(deliverables.deletedAt))!;
  if (!can(actor, 'content.read')) return NONE;
  if (actor.clientId)
    return and(
      base,
      eq(deliverables.clientId, actor.clientId),
      inArray(deliverables.status, [
        'submitted_to_client',
        'changes_requested',
        'revised',
        'approved',
        'scheduled',
        'published',
      ]),
    )!;
  return and(base, inArray(deliverables.projectId, visibleProjectIds(actor)))!;
}

/** Reports: client reports follow client visibility; org-wide reports require management permissions. */
export function reportScope(actor: Actor): SQL {
  if (!can(actor, 'reports.read')) return NONE;
  const base = eq(reports.orgId, actor.orgId);
  if (actor.clientId)
    return and(
      base,
      eq(reports.clientId, actor.clientId),
      inArray(reports.status, ['approved', 'delivered']),
    )!;
  const clientReports = and(
    sql`${reports.clientId} is not null`,
    inArray(reports.clientId, visibleClientIds(actor)),
  );
  const orgTypes: Array<'daily_digest' | 'weekly_ops' | 'weekly_campaign' | 'pipeline' | 'executive'> = [];
  if (can(actor, 'dashboard.executive'))
    orgTypes.push('daily_digest', 'weekly_ops', 'weekly_campaign', 'pipeline');
  if (can(actor, 'finance.read')) orgTypes.push('executive');
  const orgReports = orgTypes.length
    ? and(isNull(reports.clientId), inArray(reports.type, orgTypes))
    : undefined;
  return and(base, or(clientReports, orgReports))!;
}
