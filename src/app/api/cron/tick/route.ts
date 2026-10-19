import { NextResponse } from 'next/server';
import { safeEqual } from '@/server/crypto';
import { drainQueue, enqueueDueSchedules, recoverStaleLocks } from '@/server/automation/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Alternative to the long-running worker for platforms with HTTP cron (e.g. every minute).
 * Requires `Authorization: Bearer $CRON_SECRET`. Processes a bounded batch per call.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || secret.length < 24 || !safeEqual(got, secret))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const recovered = await recoverStaleLocks();
  const scheduled = await enqueueDueSchedules();
  const processed = await drainQueue(20);
  return NextResponse.json({ recovered, scheduled, processed });
}
