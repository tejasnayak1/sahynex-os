import { and, eq, sql } from 'drizzle-orm';
import { schema, type DBOrTx } from '@/db';

/**
 * Domain events — the transactional outbox.
 *
 * Call `emit` inside the same transaction as the business change. For every enabled automation
 * subscribed to the event, a queued execution row is inserted. The unique (automation, idempotency
 * key) constraint makes emission idempotent: emitting the same event twice never queues twice.
 * The worker (src/worker) picks executions up; nothing is lost if the app process dies after commit.
 */
export type DomainEvent =
  | 'lead.created'
  | 'lead.qualification_updated'
  | 'deal.stage_changed'
  | 'proposal.sent'
  | 'handover.approved'
  | 'deliverable.submitted'
  | 'approval.decided'
  | 'task.completed'
  | 'report.approved';

export async function emit(
  tx: DBOrTx,
  orgId: string,
  event: DomainEvent,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<number> {
  const subs = await tx
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(
      and(
        eq(schema.automations.orgId, orgId),
        eq(schema.automations.enabled, true),
        sql`${schema.automations.trigger}->>'type' = 'event'`,
        sql`${schema.automations.trigger}->'events' ? ${event}`,
      ),
    );
  if (!subs.length) return 0;
  const rows = await tx
    .insert(schema.automationExecutions)
    .values(
      subs.map((s) => ({
        orgId,
        automationId: s.id,
        idempotencyKey: `${event}:${dedupeKey}`,
        payload: { event, ...payload },
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.automationExecutions.id });
  return rows.length;
}
