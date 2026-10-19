import { addDays, addHours, differenceInCalendarDays } from 'date-fns';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createProjectFromHandover } from '../../services/projects';
import { notify, usersWithRoles } from '../../services/notifications';
import { createSystemTask } from '../../services/tasks';
import type { WorkflowDefinition } from '../types';

const { deals, proposals } = schema;
const OPEN = sql`${deals.stage} not in ('won','lost')`;

/** Stage-driven sales automation (discovery & proposal tasks, stage notifications, won → handover). */
export const salesPipeline: WorkflowDefinition = {
  key: 'sales.pipeline',
  name: 'Sales pipeline automation',
  description:
    'On stage changes: create discovery and proposal-preparation tasks, notify the deal owner, and start the handover when a deal is won. On proposal sent: set the follow-up next action.',
  trigger: { type: 'event', events: ['deal.stage_changed', 'proposal.sent'] },
  conditions: ['Deal still exists', 'Current stage still matches the event (stale events are ignored)'],
  actions: [
    'Qualified → “Schedule discovery” task',
    'Discovery completed / proposal preparation → “Prepare proposal” task',
    'Won → handover task + notify operations',
    'Proposal sent → next action on deal',
    'Notify owner of changes made by others',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const dealId = String(ctx.payload.dealId);
    return ctx.db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.orgId, ctx.orgId)))
        .for('update');
      if (!d || d.deletedAt) return { status: 'skipped', summary: 'Deal not found.' };
      if (ctx.payload.event === 'proposal.sent') {
        if (d.stage === 'won' || d.stage === 'lost')
          return { status: 'skipped', summary: 'Deal already closed.' };
        const first = ctx.settings.sales.proposalFollowUpDays[0] ?? 3;
        await tx
          .update(deals)
          .set({ nextAction: 'Follow up on proposal', nextActionAt: addDays(ctx.now, first) })
          .where(eq(deals.id, d.id));
        return { status: 'succeeded', summary: `Next action set: follow up in ${first} day(s).` };
      }
      const to = String(ctx.payload.to);
      if (d.stage !== to)
        return { status: 'skipped', summary: `Deal has moved on to ${d.stage}; event for ${to} ignored.` };
      const actorId = ctx.payload.actorId ? String(ctx.payload.actorId) : null;
      if (actorId && actorId !== d.ownerId)
        await notify(tx, {
          orgId: ctx.orgId,
          userId: d.ownerId,
          type: 'deal.stage',
          title: `${d.title} moved to ${to.replace(/_/g, ' ')}`,
          link: `/deals/${d.id}`,
          dedupeKey: `deal-stage:${ctx.execution.idempotencyKey}`,
        });
      const base = { orgId: ctx.orgId, ownerId: d.ownerId, dealId: d.id, clientId: d.clientId };
      if (to === 'qualified') {
        await createSystemTask(tx, {
          ...base,
          sourceKey: `deal-discovery:${d.id}`,
          title: `Schedule discovery meeting: ${d.prospectName}`,
          dueAt: addDays(ctx.now, 2),
          priority: 'high',
        });
        return { status: 'succeeded', summary: 'Discovery task created.' };
      }
      if (to === 'discovery_completed' || to === 'proposal_preparation') {
        await tx
          .update(schema.tasks)
          .set({ status: 'done', completedAt: ctx.now, completionNote: 'Discovery completed' })
          .where(
            and(
              eq(schema.tasks.sourceKey, `deal-discovery:${d.id}`),
              sql`${schema.tasks.status} in ('todo','in_progress')`,
            ),
          );
        await createSystemTask(tx, {
          ...base,
          sourceKey: `deal-proposal:${d.id}`,
          title: `Prepare proposal: ${d.title}`,
          dueAt: addDays(ctx.now, 3),
          priority: 'high',
          effortPoints: 3,
        });
        return { status: 'succeeded', summary: 'Proposal preparation task created.' };
      }
      if (to === 'won') {
        await createSystemTask(tx, {
          ...base,
          sourceKey: `deal-handover:${d.id}`,
          title: `Complete handover: ${d.title}`,
          description:
            'Record scope, deliverables, owner, dates and budget in the Handover tab, then submit for approval.',
          dueAt: addDays(ctx.now, 2),
          priority: 'urgent',
          effortPoints: 2,
        });
        for (const m of await usersWithRoles(tx, ctx.orgId, ['coo', 'ceo']))
          await notify(tx, {
            orgId: ctx.orgId,
            userId: m.id,
            type: 'deal.won',
            title: `Deal won: ${d.title}`,
            body: 'Handover to operations has started.',
            link: `/deals/${d.id}`,
            dedupeKey: `deal-won:${d.id}`,
          });
        return { status: 'succeeded', summary: 'Handover task created; operations notified.' };
      }
      return { status: 'succeeded', summary: 'No stage-specific actions.' };
    });
  },
};

/** Workflow 10 — Proposal follow-up & stale-deal alerts. */
export const proposalFollowUp: WorkflowDefinition = {
  key: 'sales.proposal_followup',
  name: 'Proposal follow-up & stale deals',
  description:
    'Hourly: create follow-up tasks on the configured days after a proposal is sent, escalate proposals with no outcome, and alert owners of deals with no recent interaction. Stops automatically once a deal closes.',
  trigger: { type: 'schedule', cron: '7 * * * *' },
  conditions: [
    'Proposal status is “sent” (not superseded / accepted / rejected)',
    'Deal is still open at run time',
  ],
  actions: [
    'Follow-up task on day 3 and 7 (configurable)',
    'Escalate to management after 14 days',
    'Stale-deal alert after 14 days without interaction',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const s = ctx.settings.sales;
    let followups = 0;
    let escalations = 0;
    let stale = 0;
    const sent = await ctx.db
      .select({ p: proposals, d: deals })
      .from(proposals)
      .innerJoin(deals, eq(deals.id, proposals.dealId))
      .where(and(eq(proposals.orgId, ctx.orgId), eq(proposals.status, 'sent'), OPEN, isNull(deals.deletedAt)))
      .limit(1000);
    const managers = await usersWithRoles(ctx.db, ctx.orgId, ['ceo', 'coo']);
    for (const { p, d } of sent) {
      const days = differenceInCalendarDays(ctx.now, p.sentAt!);
      for (const fd of s.proposalFollowUpDays) {
        if (days >= fd) {
          const { created } = await createSystemTask(ctx.db, {
            orgId: ctx.orgId,
            sourceKey: `deal-followup:${p.id}:${fd}`,
            title: `Follow up on proposal v${p.version}: ${d.title}`,
            ownerId: d.ownerId,
            dealId: d.id,
            clientId: d.clientId,
            dueAt: addHours(ctx.now, 4),
            priority: 'high',
          });
          if (created) {
            followups++;
            await notify(ctx.db, {
              orgId: ctx.orgId,
              userId: d.ownerId,
              type: 'deal.followup',
              title: `Proposal follow-up due: ${d.title}`,
              body: `Sent ${days} day(s) ago.`,
              link: `/deals/${d.id}`,
              dedupeKey: `deal-followup:${p.id}:${fd}`,
            });
          }
        }
      }
      if (days >= s.proposalEscalateDays)
        for (const m of managers)
          if (
            await notify(ctx.db, {
              orgId: ctx.orgId,
              userId: m.id,
              type: 'deal.escalated',
              severity: 'warning',
              title: `No decision ${days} days after proposal: ${d.title}`,
              link: `/deals/${d.id}`,
              dedupeKey: `deal-escalate:${p.id}`,
            })
          )
            escalations++;
    }
    const staleDeals = await ctx.db
      .update(deals)
      .set({ staleAlertedAt: ctx.now })
      .where(
        and(
          eq(deals.orgId, ctx.orgId),
          OPEN,
          isNull(deals.deletedAt),
          isNull(deals.staleAlertedAt),
          lt(deals.lastInteractionAt, addDays(ctx.now, -s.staleDealDays)),
        ),
      )
      .returning();
    for (const d of staleDeals) {
      await notify(ctx.db, {
        orgId: ctx.orgId,
        userId: d.ownerId,
        type: 'deal.stale',
        severity: 'warning',
        title: `Stale deal: ${d.title}`,
        body: `No interaction in ${s.staleDealDays}+ days.`,
        link: `/deals/${d.id}`,
        dedupeKey: `deal-stale:${d.id}:${ctx.now.toISOString().slice(0, 10)}`,
      });
      stale++;
    }
    const total = followups + escalations + stale;
    return {
      status: total ? 'succeeded' : 'skipped',
      summary: `${followups} follow-up(s), ${escalations} escalation(s), ${stale} stale-deal alert(s).`,
    };
  },
};

/** Workflow 6 — New project from an approved handover. */
export const projectFromHandover: WorkflowDefinition = {
  key: 'project.from_handover',
  name: 'Project creation from won deal',
  description:
    'When a handover is approved, create or link the client, create the project, generate tasks and milestones from the chosen template, assign owners and notify the team.',
  trigger: { type: 'event', events: ['handover.approved'] },
  conditions: ['Handover is approved', 'No project created for it yet'],
  actions: [
    'Create or link client (with primary contact)',
    'Create project in “planning”',
    'Generate tasks & milestones from template',
    'Notify owner and team',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const r = await ctx.db.transaction((tx) =>
      createProjectFromHandover(tx, ctx.orgId, String(ctx.payload.handoverId), ctx.log),
    );
    if ('skipped' in r && r.skipped) return { status: 'skipped', summary: r.skipped };
    return {
      status: 'succeeded',
      summary: `Project created with ${'tasksCreated' in r ? r.tasksCreated : 0} task(s).`,
      data: { projectId: r.projectId },
    };
  },
};
