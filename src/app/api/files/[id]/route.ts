import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { canAccessAsset } from '@/server/services/deliverables';
import { getObject, verifyFileSignature } from '@/server/storage';

/** Signed, time-limited, user-bound download. Permission is re-checked on every request. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await getCurrentActor();
  if (!actor) return new NextResponse('Not signed in', { status: 401 });
  const url = new URL(req.url);
  if (!verifyFileSignature(id, actor.id, url.searchParams.get('exp'), url.searchParams.get('sig')))
    return new NextResponse('Link expired. Reload the page to get a fresh link.', { status: 403 });
  const asset = await canAccessAsset(actor, id);
  if (!asset) return new NextResponse('Not found', { status: 404 });
  const data = await getObject(asset.storageKey);
  const inline =
    asset.mimeType.startsWith('image/') ||
    asset.mimeType === 'application/pdf' ||
    asset.mimeType.startsWith('video/');
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(data.length),
      'Content-Disposition': `${inline && url.searchParams.get('download') !== '1' ? 'inline' : 'attachment'}; filename="${asset.fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
