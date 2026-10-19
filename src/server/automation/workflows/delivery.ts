import { addDays, addHours } from 'date-fns';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema, type DBOrTx } from '@/db';
import { notify, usersWithRoles } from '../../services/notifications';
import { createSystemTask } from '../../services/tasks';
import type { WorkflowDefinition } from '../types';

const { deliverables, approvals, revisions, projects, users, tasks, clients } = schema;

async function clientReviewers(tx: DBOrTx, clientId: string) {
  return tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.isActive, true)));
}

/** Workflow 7 — Approval & revision. */
export const approvalsWorkflow: WorkflowDefinition = {
  key: 'approvals.workflow',
  name: 'Client approvals & revision tracking',
  description:
    'Routes deliverables for review, notifies reviewers, turns change requests into revision tasks, and unlocks publishing once the client approves. Never publishes automatically.',
  trigger: { type: 'event', events: ['deliverable.submitted', 'approval.decided'] },
  conditions: ['Approval still exists and matches the deliverable’s current version'],
  actions: [
    'Notify reviewer (internal) or client reviewers',
    'Changes requested → revision task for the creative owner',
    'Client approved → “publish” handoff task (manual)',
    'Notify owner of every decision',
  ],
  defaultConfig: { revisionDueDays: 2 },
  configFields: [{ key: 'revisionDueDays', label: 'Revision task due (days)', type: 'number' }],
  handler: async (ctx) => {
    const approvalId = String(ctx.payload.approvalId);
    return ctx.db.transaction(async (tx) => {
      const [ap] = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, approvalId), eq(approvals.orgId, ctx.orgId)));
      if (!ap) return { status: 'skipped', summary: 'Approval not found.' };
      const [d] = await tx
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, ap.deliverableId))
        .for('update');
      if (!d || d.deletedAt) return { status: 'skipped', summary: 'Deliverable not found.' };
      const [p] = await tx.select().from(projects).where(eq(projects.id, d.projectId));
      const link = `/content/${d.id}`;

      if (ctx.payload.event === 'deliverable.submitted') {
        if (ap.decision !== 'pending') return { status: 'skipped', summary: 'Already decided.' };
        const reviewers = ap.reviewerId ? [ap.reviewerId] : ([p?.ownerId].filter(Boolean) as string[]);
        if (!reviewers.length)
          for (const m of await usersWithRoles(tx, ctx.orgId, ['coo'])) reviewers.push(m.id);
        for (const r of reviewers)
          await notify(tx, {
            orgId: ctx.orgId,
            userId: r,
            type: 'approval.requested',
            title: `Review requested: ${d.title} (v${ap.version})`,
            link,
            dedupeKey: `approval-requested:${ap.id}:${r}`,
          });
        return {
          status: 'succeeded',
          summary: `Internal review requested from ${reviewers.length} reviewer(s).`,
        };
      }

      const decision = String(ctx.payload.decision);
      if (decision === 'changes_requested') {
        const [rev] = await tx.select().from(revisions).where(eq(revisions.approvalId, ap.id));
        const { task } = await createSystemTask(tx, {
          orgId: ctx.orgId,
          sourceKey: `revision:${ap.id}`,
          title: `Revise ${d.title} (v${ap.version} → v${ap.version + 1})`,
          description: `Feedback (${ap.stage}):\n${ap.feedback ?? ''}`,
          ownerId: d.ownerId,
          projectId: d.projectId,
          clientId: d.clientId,
          deliverableId: d.id,
          dueAt: addDays(ctx.now, Number(ctx.config.revisionDueDays ?? 2)),
          priority: 'high',
        });
        if (rev && !rev.taskId)
          await tx.update(revisions).set({ taskId: task.id }).where(eq(revisions.id, rev.id));
        if (d.ownerId)
          await notify(tx, {
            orgId: ctx.orgId,
            userId: d.ownerId,
            type: 'approval.changes',
            severity: 'warning',
            title: `Changes requested: ${d.title}`,
            body: ap.feedback ?? undefined,
            link,
            dedupeKey: `approval-changes:${ap.id}`,
          });
        return { status: 'succeeded', summary: 'Revision task created and owner notified.' };
      }
      // approved
      if (ap.stage === 'internal' && ctx.payload.clientApprovalId) {
        const reviewers = await clientReviewers(tx, d.clientId);
        for (const r of reviewers)
          await notify(tx, {
            orgId: ctx.orgId,
            userId: r.id,
            type: 'approval.requested',
            title: `Please review: ${d.title}`,
            link,
            dedupeKey: `client-review:${ctx.payload.clientApprovalId}:${r.id}`,
          });
        const [c] = await tx
          .select({ ownerId: clients.accountOwnerId })
          .from(clients)
          .where(eq(clients.id, d.clientId));
        const internalNotify = new Set([d.ownerId, c?.ownerId, p?.ownerId].filter(Boolean) as string[]);
        for (const u of internalNotify)
          await notify(tx, {
            orgId: ctx.orgId,
            userId: u,
            type: 'approval.sent_to_client',
            title: `Sent to client: ${d.title}`,
            body: reviewers.length
              ? `${reviewers.length} client reviewer(s) notified.`
              : 'No client portal reviewer — record the client’s decision on the deliverable when it arrives.',
            link,
            dedupeKey: `sent-to-client:${ctx.payload.clientApprovalId}:${u}`,
          });
        return {
          status: 'succeeded',
          summary: `Submitted to client; ${reviewers.length} portal reviewer(s) notified.`,
        };
      }
      if (d.status === 'approved') {
        if (d.ownerId) {
          await createSystemTask(tx, {
            orgId: ctx.orgId,
            sourceKey: `publish:${d.id}`,
            title: `Publish / hand off: ${d.title}`,
            description:
              'Approved. Publish manually on the target channel (or hand off to the client), then mark the deliverable as published with the live link.',
            ownerId: d.ownerId,
            projectId: d.projectId,
            clientId: d.clientId,
            deliverableId: d.id,
            dueAt: d.publishAt ?? addDays(ctx.now, 1),
            priority: 'medium',
          });
          await notify(tx, {
            orgId: ctx.orgId,
            userId: d.ownerId,
            type: 'approval.approved',
            title: `Approved: ${d.title}`,
            link,
            dedupeKey: `approved:${ap.id}`,
          });
        }
        return { status: 'succeeded', summary: 'Approved for publication; manual publishing task created.' };
      }
      return { status: 'skipped', summary: `No action for status ${d.status}.` };
    });
  },
};

/** Reminders for pending reviews. Reminders never approve anything. */
export const approvalReminders: WorkflowDefinition = {
  key: 'approvals.reminders',
  name: 'Approval reminders',
  description:
    'Hourly: remind reviewers about approvals waiting longer than the configured time (up to the maximum number of reminders), then escalate once to the project owner.',
  trigger: { type: 'schedule', cron: '20 * * * *' },
  conditions: [
    'Approval still pending',
    'Reminder interval elapsed since submission/last reminder',
    'Fewer than the maximum reminders sent',
  ],
  actions: ['Notify reviewers', 'Escalate to project owner after the last reminder'],
  defaultConfig: {},
  handler: async (ctx) => {
    const s = ctx.settings.delivery;
    const cutoff = addHours(ctx.now, -s.approvalReminderHours);
    const due = await ctx.db
      .update(approvals)
      .set({ remindersSent: sql`${approvals.remindersSent} + 1`, lastReminderAt: ctx.now })
      .where(
        and(
          eq(approvals.orgId, ctx.orgId),
          eq(approvals.decision, 'pending'),
          lt(approvals.remindersSent, s.maxApprovalReminders + 1),
          or(
            and(isNull(approvals.lastReminderAt), lt(approvals.submittedAt, cutoff)),
            lt(approvals.lastReminderAt, cutoff),
          ),
        ),
      )
      .returning();
    let n = 0;
    for (const ap of due) {
      const [d] = await ctx.db.select().from(deliverables).where(eq(deliverables.id, ap.deliverableId));
      if (!d) continue;
      const [p] = await ctx.db.select().from(projects).where(eq(projects.id, d.projectId));
      const link = `/content/${d.id}`;
      if (ap.remindersSent > s.maxApprovalReminders) {
        if (p?.ownerId)
          await notify(ctx.db, {
            orgId: ctx.orgId,
            userId: p.ownerId,
            type: 'approval.stuck',
            severity: 'high',
            title: `Approval stuck: ${d.title}`,
            body: `No ${ap.stage} decision after ${s.maxApprovalReminders} reminders. Follow up directly.`,
            link,
            dedupeKey: `approval-stuck:${ap.id}`,
          });
        n++;
        continue;
      }
      const recips =
        ap.stage === 'client'
          ? (await clientReviewers(ctx.db, d.clientId)).map((r) => r.id).concat(p?.ownerId ? [p.ownerId] : [])
          : ([ap.reviewerId ?? p?.ownerId].filter(Boolean) as string[]);
      for (const r of new Set(recips))
        await notify(ctx.db, {
          orgId: ctx.orgId,
          userId: r,
          type: 'approval.reminder',
          title: `Reminder: ${d.title} is awaiting ${ap.stage} review`,
          link,
          dedupeKey: `approval-reminder:${ap.id}:${ap.remindersSent}:${r}`,
        });
      n++;
    }
    return { status: n ? 'succeeded' : 'skipped', summary: `${n} reminder(s)/escalation(s) sent.` };
  },
};

/** Task deadline reminders & overdue escalation. */
export const taskReminders: WorkflowDefinition = {
  key: 'tasks.reminders',
  name: 'Task deadline reminders & overdue escalation',
  description:
    'Hourly: remind owners ahead of due dates and escalate tasks overdue beyond the configured window to the project owner (or operations lead).',
  trigger: { type: 'schedule', cron: '5 * * * *' },
  conditions: ['Task is open', 'Reminder/escalation not already sent for the current due date'],
  actions: ['Remind owner before the deadline (once)', 'Escalate when overdue (once)'],
  defaultConfig: {},
  handler: async (ctx) => {
    const s = ctx.settings.delivery;
    const open = inArray(tasks.status, ['todo', 'in_progress', 'blocked', 'in_review']);
    const remind = await ctx.db
      .update(tasks)
      .set({ reminderSentAt: ctx.now })
      .where(
        and(
          eq(tasks.orgId, ctx.orgId),
          open,
          isNull(tasks.deletedAt),
          isNull(tasks.reminderSentAt),
          sql`${tasks.ownerId} is not null`,
          sql`${tasks.dueAt} > ${ctx.now}`,
          lt(tasks.dueAt, addHours(ctx.now, s.taskReminderHoursBefore)),
        ),
      )
      .returning();
    for (const t of remind)
      await notify(ctx.db, {
        orgId: ctx.orgId,
        userId: t.ownerId!,
        type: 'task.due_soon',
        title: `Due soon: ${t.title}`,
        link: `/tasks/${t.id}`,
        dedupeKey: `task-due:${t.id}:${t.dueAt!.toISOString()}`,
      });
    const escalate = await ctx.db
      .update(tasks)
      .set({ overdueEscalatedAt: ctx.now })
      .where(
        and(
          eq(tasks.orgId, ctx.orgId),
          open,
          isNull(tasks.deletedAt),
          isNull(tasks.overdueEscalatedAt),
          lt(tasks.dueAt, addHours(ctx.now, -s.overdueEscalationHours)),
        ),
      )
      .returning();
    const coo = await usersWithRoles(ctx.db, ctx.orgId, ['coo']);
    for (const t of escalate) {
      const [p] = t.projectId
        ? await ctx.db
            .select({ ownerId: projects.ownerId })
            .from(projects)
            .where(eq(projects.id, t.projectId))
        : [];
      const to = new Set<string>();
      if (p?.ownerId && p.ownerId !== t.ownerId) to.add(p.ownerId);
      if (!to.size) coo.forEach((c) => to.add(c.id));
      if (t.ownerId) to.add(t.ownerId);
      for (const u of to)
        await notify(ctx.db, {
          orgId: ctx.orgId,
          userId: u,
          type: 'task.overdue',
          severity: 'warning',
          title: `Overdue: ${t.title}`,
          link: `/tasks/${t.id}`,
          dedupeKey: `task-overdue:${t.id}:${t.dueAt!.toISOString()}:${u}`,
        });
    }
    return {
      status: remind.length + escalate.length ? 'succeeded' : 'skipped',
      summary: `${remind.length} reminder(s), ${escalate.length} overdue escalation(s).`,
    };
  },
};
