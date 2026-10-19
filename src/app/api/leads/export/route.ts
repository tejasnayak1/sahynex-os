import Papa from 'papaparse';
import { NextResponse } from 'next/server';
import { can } from '@/server/actor';
import { audit } from '@/server/audit';
import { getCurrentActor } from '@/server/auth/current';
import { db } from '@/db';
import { listLeads } from '@/server/services/leads';
import { pageParams } from '@/server/validation';

/** CSV export of the current lead view. Contact details only with the export permission; audited. */
export async function GET(req: Request) {
  const actor = await getCurrentActor();
  if (!actor) return new NextResponse('Not signed in', { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const p = pageParams.parse({ ...sp, page: 1, pageSize: 200 });
  const pii = can(actor, 'leads.export_pii');
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await listLeads(actor, {
      ...p,
      page,
      stage: sp.stage,
      ownerId: sp.ownerId,
      clientId: sp.clientId,
      qualification: sp.qualification,
      sourceId: sp.sourceId,
    });
    for (const l of r.rows)
      rows.push({
        ref: l.ref,
        name: l.name,
        ...(pii ? { email: l.email, phone: l.phone } : {}),
        organisation: l.organisationName,
        client: l.clientName,
        interest: l.interest,
        source: l.sourceName,
        stage: l.stage,
        qualification: l.qualificationStatus,
        score: l.score,
        owner: l.ownerName,
        consent: l.consentMarketing,
        suppressed: l.suppressed,
        created: l.createdAt.toISOString(),
      });
    if (page * 200 >= r.total) break;
  }
  await audit(db, actor, 'lead.exported', 'lead', null, {
    after: { rows: rows.length, includesContactDetails: pii },
  });
  return new NextResponse(Papa.unparse(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
