import { sql } from 'drizzle-orm';
import type { DBOrTx } from '@/db';

/** Atomically allocates the next human-readable reference, e.g. LD-0042. Safe under concurrency. */
export async function nextRef(tx: DBOrTx, orgId: string, prefix: string): Promise<string> {
  const res = await tx.execute<{ value: number }>(sql`
    insert into counters (org_id, key, value) values (${orgId}, ${prefix}, 1)
    on conflict (org_id, key) do update set value = counters.value + 1
    returning value`);
  const n = Number(res.rows[0].value);
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
