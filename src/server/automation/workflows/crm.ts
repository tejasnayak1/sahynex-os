import { addHours } from 'date-fns';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { applyQualificationRules, pickOwner } from '../../services/leads';
import { notify, usersWithRoles } from '../../services/notifications';
import { createSystemTask } from '../../services/tasks';
import type { WorkflowDefinition } from '../types';

const { leads, leadActivities, users } = schema;
const CLOSED = ['converted', 'lost', 'unqualified'];

/** Workflow 1 — New lead: assign owner → notify → follow-up task → log. (Validation, dedupe, storage and source capture happen atomically at ingestion.) */
export const leadNew: WorkflowDefinition = {
  key: 'lead.new',
  name: 'Lead capture, assignment & follow-up',
  description:
    'When a lead arrives from any channel, assign an owner, notify them instantly and create a first-contact follow-up task.',
  trigger: { type: 'event', events: ['lead.created'] },
  conditions: [
    'Lead still exists and is not a test lead',
    'Lead is not closed',
    'Owner not already set (manual assignment is respected)',
  ],
  actions: [
    'Assign owner (client account owner, else round-robin)',
    'Notify owner',
    'Create follow-up task due within the SLA',
    'Set next action on the lead',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const leadId = String(ctx.payload.leadId);
    return ctx.db.transaction(async (tx) => {
      const [lead] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.orgId, ctx.orgId)))
        .for('update');
      if (!lead || lead.deletedAt) return { status: 'skipped', summary: 'Lead no longer exists.' };
      if (lead.isTest) return { status: 'skipped', summary: 'Test lead — no notifications or tasks.' };
      if (CLOSED.includes(lead.stage)) return { status: 'skipped', summary: `Lead already ${lead.stage}.` };
      let ownerId = lead.ownerId;
      if (!ownerId && ctx.settings.leads.assignment === 'round_robin') {
        ownerId = await pickOwner(tx, ctx.orgId, lead);
        if (ownerId) {
          await tx.update(leads).set({ ownerId }).where(eq(leads.id, lead.id));
          const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, ownerId));
          await tx.insert(leadActivities).values({
            orgId: ctx.orgId,
            leadId: lead.id,
            type: 'assignment',
            body: `Auto-assigned to ${u?.name ?? 'owner'}.`,
            meta: { to: ownerId, by: 'automation' },
          });
          ctx.log(`Assigned to ${u?.name}.`);
        }
      }
      if (!ownerId) {
        for (const m of await usersWithRoles(tx, ctx.orgId, ['coo', 'ceo']))
          await notify(tx, {
            orgId: ctx.orgId,
            userId: m.id,
            type: 'lead.unassigned',
            severity: 'warning',
            title: `Unassigned lead: ${lead.name} (${lead.ref})`,
            body: 'No team member is set to receive leads. Assign it manually.',
            link: `/leads/${lead.id}`,
            dedupeKey: `lead-unassigned:${lead.id}`,
          });
        return { status: 'succeeded', summary: 'No eligible owner; managers notified to assign manually.' };
      }
      await notify(tx, {
        orgId: ctx.orgId,
        userId: ownerId,
        type: 'lead.new',
        severity: 'high',
        title: `New lead: ${lead.name}${lead.organisationName ? ` (${lead.organisationName})` : ''}`,
        body: [lead.interest, lead.phone, lead.email].filter(Boolean).join(' · '),
        link: `/leads/${lead.id}`,
        dedupeKey: `lead-new:${lead.id}`,
      });
      if (lead.stage !== 'new')
        return {
          status: 'succeeded',
          summary: 'Owner notified; lead already contacted, no follow-up task needed.',
        };
      const due = addHours(ctx.now, ctx.settings.leads.followUpTaskDueHours);
      const { created } = await createSystemTask(tx, {
        orgId: ctx.orgId,
        sourceKey: `lead-followup:${lead.id}`,
        title: `Make first contact: ${lead.name}`,
        description: `New ${lead.leadType.replace(/_/g, ' ')} lead ${lead.ref}. Log the call/email on the lead to complete this task.`,
        ownerId,
        leadId: lead.id,
        clientId: lead.clientId,
        dueAt: due,
        priority: 'high',
      });
      if (!lead.nextActionAt)
        await tx
          .update(leads)
          .set({ nextActionAt: due, nextAction: 'Make first contact' })
          .where(eq(leads.id, lead.id));
      return {
        status: 'succeeded',
        summary: `Owner notified; follow-up task ${created ? 'created' : 'already existed'}.`,
        data: { ownerId },
      };
    });
  },
};

/** Workflow 2 — Overdue lead: remind owner after SLA, escalate after the escalation window. */
export const leadOverdue: WorkflowDefinition = {
  key: 'lead.overdue',
  name: 'Lead follow-up reminders & escalation',
  description:
    'Every 30 minutes, remind owners about leads not contacted within the SLA and escalate to managers when the escalation window passes. Also reminds owners of due next actions.',
  trigger: { type: 'schedule', cron: '*/30 * * * *' },
  conditions: [
    'Lead is open (not converted/lost/unqualified)',
    'Not suppressed / opted out',
    'Not a test lead',
    'Still uncontacted at run time',
  ],
  actions: [
    'Notify owner once per lead, grouped into one notification per owner per run',
    'Escalate to COO/CEO once per lead, as one consolidated notification per run',
    'Remind owner when a scheduled next action is due',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const s = ctx.settings.leads;
    let reminded = 0;
    let nextActions = 0;
    const escalatedNames: string[] = [];
    const overdue = await ctx.db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.orgId, ctx.orgId),
          eq(leads.stage, 'new'),
          eq(leads.isTest, false),
          eq(leads.suppressed, false),
          isNull(leads.deletedAt),
          isNull(leads.remindedAt),
          lt(leads.createdAt, addHours(ctx.now, -s.firstContactSlaHours)),
        ),
      )
      .limit(500);
    // Owner reminders: one consolidated notification per owner per run, each lead reminded once.
    await ctx.db.transaction(async (tx) => {
      const due = overdue.filter((l) => !l.remindedAt && l.ownerId);
      if (!due.length) return;
      const locked = await tx
        .select()
        .from(leads)
        .where(
          and(
            inArray(
              leads.id,
              due.map((l) => l.id),
            ),
            eq(leads.stage, 'new'),
            eq(leads.suppressed, false),
            isNull(leads.deletedAt),
            isNull(leads.remindedAt),
          ),
        )
        .for('update', { skipLocked: true });
      if (!locked.length) return;
      await tx
        .update(leads)
        .set({ remindedAt: ctx.now })
        .where(
          inArray(
            leads.id,
            locked.map((l) => l.id),
          ),
        );
      const byOwner = new Map<string, typeof locked>();
      for (const l of locked) byOwner.set(l.ownerId!, [...(byOwner.get(l.ownerId!) ?? []), l]);
      for (const [ownerId, ls] of byOwner) {
        await notify(tx, {
          orgId: ctx.orgId,
          userId: ownerId,
          type: 'lead.overdue',
          severity: 'warning',
          title:
            ls.length === 1
              ? `Lead waiting for first contact: ${ls[0].name}`
              : `${ls.length} leads waiting for first contact`,
          body: `Not contacted within ${s.firstContactSlaHours}h: ${ls
            .slice(0, 10)
            .map((l) => l.ref)
            .join(', ')}${ls.length > 10 ? ` and ${ls.length - 10} more` : ''}.`,
          link: ls.length === 1 ? `/leads/${ls[0].id}` : '/leads?view=mine',
          dedupeKey: `lead-overdue:${ctx.execution.id}:${ownerId}`,
        });
        reminded += ls.length;
      }
    });
    // Escalation: mark leads and notify managers in ONE transaction, with one consolidated notification
    // per manager — atomic, so a crash can never mark leads escalated without telling anyone.
    await ctx.db.transaction(async (tx) => {
      const toEscalate = await tx
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.orgId, ctx.orgId),
            eq(leads.stage, 'new'),
            eq(leads.isTest, false),
            eq(leads.suppressed, false),
            isNull(leads.deletedAt),
            isNull(leads.escalatedAt),
            lt(leads.createdAt, addHours(ctx.now, -s.escalationAfterHours)),
          ),
        )
        .limit(500)
        .for('update', { skipLocked: true });
      if (!toEscalate.length) return;
      await tx
        .update(leads)
        .set({ escalatedAt: ctx.now })
        .where(
          inArray(
            leads.id,
            toEscalate.map((l) => l.id),
          ),
        );
      await tx.insert(leadActivities).values(
        toEscalate.map((l) => ({
          orgId: ctx.orgId,
          leadId: l.id,
          type: 'system' as const,
          body: `Escalated to management: not contacted within ${s.escalationAfterHours}h.`,
        })),
      );
      escalatedNames.push(...toEscalate.map((l) => `${l.name} (${l.ref})`));
      for (const m of await usersWithRoles(tx, ctx.orgId, ['coo', 'ceo']))
        await notify(tx, {
          orgId: ctx.orgId,
          userId: m.id,
          type: 'lead.escalated',
          severity: 'high',
          title:
            escalatedNames.length === 1
              ? `Escalation: ${escalatedNames[0]} not contacted within ${s.escalationAfterHours}h`
              : `Escalation: ${escalatedNames.length} leads not contacted within ${s.escalationAfterHours}h`,
          body:
            escalatedNames.slice(0, 15).join(', ') +
            (escalatedNames.length > 15 ? ` and ${escalatedNames.length - 15} more` : ''),
          link: '/leads?view=new&sort=createdAt&dir=asc',
          dedupeKey: `lead-escalated:${ctx.execution.id}`,
        });
    });
    const due = await ctx.db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.orgId, ctx.orgId),
          sql`${leads.stage} not in ('new','converted','lost','unqualified')`,
          eq(leads.isTest, false),
          isNull(leads.deletedAt),
          lt(leads.nextActionAt, ctx.now),
          sql`${leads.ownerId} is not null`,
        ),
      )
      .limit(500);
    for (const l of due) {
      if (
        await notify(ctx.db, {
          orgId: ctx.orgId,
          userId: l.ownerId!,
          type: 'lead.next_action',
          title: `Follow up: ${l.name}`,
          body: l.nextAction ?? 'Scheduled follow-up is due.',
          link: `/leads/${l.id}`,
          dedupeKey: `lead-next:${l.id}:${l.nextActionAt!.toISOString()}`,
        })
      )
        nextActions++;
    }
    const escalated = escalatedNames.length;
    const total = reminded + escalated + nextActions;
    return {
      status: total ? 'succeeded' : 'skipped',
      summary: `${reminded} reminder(s), ${escalated} escalation(s), ${nextActions} next-action reminder(s).`,
    };
  },
};

/** Workflow 3 — Lead qualification. */
export const leadQualification: WorkflowDefinition = {
  key: 'lead.qualification',
  name: 'Lead qualification & attribution',
  description:
    'When qualification answers change, apply the configured scoring rules, update status (preserving attribution) and trigger the next action for qualified leads.',
  trigger: { type: 'event', events: ['lead.qualification_updated'] },
  conditions: ['Lead exists and is open', 'Disqualified leads stay disqualified'],
  actions: [
    'Compute score from configured weights',
    'Set qualification status / promote stage',
    'Create next-step task for newly qualified leads',
    'Notify owner',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const leadId = String(ctx.payload.leadId);
    return ctx.db.transaction(async (tx) => {
      const r = await applyQualificationRules(tx, ctx.orgId, leadId);
      if (!r) return { status: 'skipped', summary: 'Lead not found.' };
      const { before, after } = r;
      ctx.log(
        `Score ${after.score} (threshold ${ctx.settings.leads.qualifyThreshold}); status ${after.qualificationStatus}.`,
      );
      if (
        before.qualificationStatus !== 'qualified' &&
        after.qualificationStatus === 'qualified' &&
        after.ownerId &&
        !CLOSED.includes(after.stage)
      ) {
        const isProspect = !after.clientId;
        await createSystemTask(tx, {
          orgId: ctx.orgId,
          sourceKey: `lead-qualified:${after.id}`,
          title: isProspect
            ? `Book discovery meeting: ${after.organisationName ?? after.name}`
            : `Counselling call & programme details: ${after.name}`,
          ownerId: after.ownerId,
          leadId: after.id,
          clientId: after.clientId,
          dueAt: addHours(ctx.now, 24),
          priority: 'high',
        });
        await notify(tx, {
          orgId: ctx.orgId,
          userId: after.ownerId,
          type: 'lead.qualified',
          title: `Qualified: ${after.name} (score ${after.score})`,
          link: `/leads/${after.id}`,
          dedupeKey: `lead-qualified:${after.id}`,
        });
        await tx.insert(leadActivities).values({
          orgId: ctx.orgId,
          leadId: after.id,
          type: 'system',
          body: `Qualified automatically (score ${after.score}). Next step task created.`,
        });
        return { status: 'succeeded', summary: `Lead qualified (score ${after.score}); next step created.` };
      }
      return {
        status: 'succeeded',
        summary: `Score updated to ${after.score}; status ${after.qualificationStatus}.`,
      };
    });
  },
};
