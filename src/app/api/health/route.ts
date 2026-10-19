import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

/** Liveness + database readiness. Also reports worker freshness (last finished execution). */
export async function GET() {
  try {
    const r = await db.execute<{ last: Date | null; due: number }>(
      sql`select max(finished_at) as last, (select count(*)::int from automation_executions where status = 'queued' and run_after < now() - interval '5 minutes') as due from automation_executions`,
    );
    const row = r.rows[0];
    return NextResponse.json({
      status: 'ok',
      database: 'ok',
      worker: { lastExecutionFinishedAt: row?.last ?? null, overdueQueuedJobs: row?.due ?? 0 },
    });
  } catch {
    return NextResponse.json({ status: 'error', database: 'unreachable' }, { status: 503 });
  }
}
