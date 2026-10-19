import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { isAppError } from '@/server/errors';
import { meetingIcs } from '@/server/services/meetings';

/** Calendar invite (.ics) for a meeting the signed-in person can see. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new NextResponse('Not signed in', { status: 401 });
  const { id } = await params;
  try {
    const { meeting, ics } = await meetingIcs(actor, id);
    const slug = meeting.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'meeting';
    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.ics"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (isAppError(e)) return new NextResponse('Not found', { status: 404 });
    throw e;
  }
}
