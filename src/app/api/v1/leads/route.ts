import { NextResponse } from 'next/server';
import { systemActor } from '@/server/actor';
import { jsonError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { authenticateApiKey } from '@/server/services/admin';
import { ingestLead } from '@/server/services/leads';

/**
 * Lead ingestion API for website / landing-page forms and external tools (n8n, Make).
 * Auth: `Authorization: Bearer sx_live_…`. Keys scoped to a client attribute leads to that client.
 * Responses: 201 created, 200 updated/duplicate-flagged, 422 validation, 401 bad key, 429 rate limited.
 */
export async function POST(req: Request) {
  const key = await authenticateApiKey(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null);
  if (!key || !key.scopes.includes('leads:ingest'))
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid API key.' } },
      { status: 401 },
    );
  try {
    await rateLimit(`ingest:${key.id}`, 300, 60);
    const ct = req.headers.get('content-type') ?? '';
    let body: Record<string, unknown>;
    if (ct.includes('application/json')) body = (await req.json()) as Record<string, unknown>;
    else if (ct.includes('form'))
      body = Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>;
    else
      return NextResponse.json(
        { error: { code: 'VALIDATION', message: 'Send JSON or form data.' } },
        { status: 415 },
      );
    if (typeof body !== 'object' || !body || Array.isArray(body))
      return NextResponse.json(
        { error: { code: 'VALIDATION', message: 'Body must be an object.' } },
        { status: 422 },
      );
    // Honeypot field for website forms: bots fill hidden fields.
    if (body.website_url) return NextResponse.json({ outcome: 'ignored' }, { status: 200 });
    const actor = systemActor(key.orgId, `API key: ${key.name}`);
    const res = await ingestLead(
      actor,
      {
        ...body,
        name: String(body.name ?? ''),
        clientId: key.clientId ?? undefined,
        leadType: body.leadType ?? (key.clientId ? 'admission_enquiry' : 'client_prospect'),
      },
      String(body.sourceKey ?? 'website_form'),
    );
    return NextResponse.json(
      { outcome: res.outcome, leadRef: res.lead.ref, message: res.message },
      { status: res.outcome === 'created' ? 201 : 200 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
