import type { DBOrTx } from '@/db';
import { schema } from '@/db';
import type { Actor } from './actor';

type AuditInput = {
  orgId: string;
  actorId: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

const REDACT = new Set(['passwordHash', 'password', 'keyHash', 'token', 'hourlyCostMinor']);

function redact(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      REDACT.has(k) ? '[redacted]' : x instanceof Date ? x.toISOString() : x,
    ]),
  );
}

export async function writeAudit(tx: DBOrTx, a: AuditInput) {
  await tx.insert(schema.auditLogs).values({
    orgId: a.orgId,
    actorId: a.actorId,
    actorLabel: a.actorLabel ?? null,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId ?? null,
    before: a.before === undefined ? null : redact(a.before),
    after: a.after === undefined ? null : redact(a.after),
    ip: a.ip ?? null,
  });
}

export function audit(
  tx: DBOrTx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  change?: { before?: unknown; after?: unknown },
) {
  return writeAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.kind === 'user' ? actor.id : null,
    actorLabel: actor.kind === 'system' ? actor.name : null,
    action,
    entityType,
    entityId,
    before: change?.before,
    after: change?.after,
  });
}

/** Returns only the keys whose values changed — keeps audit rows small and meaningful. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const bv = before[k];
    const av = after[k];
    const same =
      bv instanceof Date && av instanceof Date
        ? bv.getTime() === av.getTime()
        : JSON.stringify(bv) === JSON.stringify(av);
    if (!same) {
      b[k] = bv;
      a[k] = av;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
