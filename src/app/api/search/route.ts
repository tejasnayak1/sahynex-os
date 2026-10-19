import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { jsonError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { globalSearch } from '@/server/services/search';

export async function GET(req: Request) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: { message: 'Not signed in.' } }, { status: 401 });
  try {
    await rateLimit(`search:${actor.id}`, 120, 60);
    const q = new URL(req.url).searchParams.get('q') ?? '';
    return NextResponse.json({ results: await globalSearch(actor, q.slice(0, 100)) });
  } catch (e) {
    return jsonError(e);
  }
}
