'use server';
import Papa from 'papaparse';
import { formToObject, runAction, type ActionState } from '@/server/action';
import { assertCan } from '@/server/actor';
import { invalid } from '@/server/errors';
import {
  archiveLead,
  assignLead,
  changeLeadStage,
  convertLeadToDeal,
  ingestLead,
  logLeadActivity,
  resolveDuplicate,
  setLeadConsent,
  updateLead,
  updateQualification,
  QUALIFICATION_QUESTIONS,
} from '@/server/services/leads';
import type { Lead } from '@/server/services/leads';
import { sendWhatsAppTemplate } from '@/server/services/messaging';

export async function createLeadAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const data = formToObject(fd);
    const r = await ingestLead(actor, { ...data, name: String(data.name ?? '') }, 'manual');
    return { ok: true, message: r.message, redirectTo: `/leads/${r.lead.id}` };
  }, '/leads');
}

export async function updateLeadAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateLead(actor, String(id), rest);
    return { ok: true, message: 'Lead saved' };
  }, '/leads');
}

export async function stageAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await changeLeadStage(
      actor,
      String(fd.get('id')),
      String(fd.get('stage')) as Lead['stage'],
      (fd.get('reason') as string) || null,
    );
    return { ok: true, message: 'Stage updated' };
  }, '/leads');
}

export async function assignAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const owner = String(fd.get('ownerId') ?? '');
    if (!owner) throw invalid('Choose an owner.');
    await assignLead(actor, String(fd.get('id')), owner);
    return { ok: true, message: 'Owner updated' };
  }, '/leads');
}

export async function bulkAssignAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const ids = fd.getAll('ids').map(String);
    const owner = String(fd.get('ownerId') ?? '');
    if (!ids.length) throw invalid('Select at least one lead.');
    if (!owner) throw invalid('Choose an owner.');
    for (const id of ids) await assignLead(actor, id, owner);
    return { ok: true, message: `${ids.length} lead(s) reassigned` };
  }, '/leads');
}

export async function activityAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await logLeadActivity(actor, String(id), rest);
    return { ok: true, message: 'Activity logged' };
  });
}

export async function qualificationAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const answers = Object.fromEntries(QUALIFICATION_QUESTIONS.map((q) => [q.key, fd.get(q.key) === 'on']));
    await updateQualification(actor, String(fd.get('id')), answers, (fd.get('notes') as string) || null);
    return { ok: true, message: 'Qualification saved — score updates in a moment' };
  });
}

export async function consentAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setLeadConsent(actor, String(fd.get('id')), {
      consent: fd.get('consent') === 'on',
      suppressed: fd.get('suppressed') === 'on',
      reason: (fd.get('reason') as string) || null,
    });
    return { ok: true, message: 'Communication preferences saved' };
  });
}

export async function archiveAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await archiveLead(actor, String(fd.get('id')));
    return { ok: true, message: 'Lead archived', redirectTo: '/leads' };
  }, '/leads');
}

export async function duplicateAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const res = String(fd.get('resolution')) as 'distinct' | 'archive';
    await resolveDuplicate(actor, String(fd.get('id')), res);
    return {
      ok: true,
      message: res === 'archive' ? 'Duplicate archived' : 'Marked as a separate lead',
      redirectTo: res === 'archive' ? '/leads?duplicates=1' : undefined,
    };
  }, '/leads');
}

export async function convertAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      const d = await convertLeadToDeal(actor, String(fd.get('id')), {
        title: String(fd.get('title') ?? ''),
        valueRupees: String(fd.get('value') ?? ''),
        services: String(fd.get('services') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      return { ok: true, message: `Deal ${d.ref} created`, redirectTo: `/deals/${d.id}` };
    },
    ['/leads', '/pipeline'],
  );
}

/** CSV import: validates every row, reports per-row results; nothing is silently merged. */
export async function importLeadsAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    assertCan(actor, 'leads.import');
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) throw invalid('Choose a CSV file.');
    if (file.size > 5 * 1024 * 1024) throw invalid('CSV files must be 5 MB or smaller.');
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    if (!parsed.data.length) throw invalid('The file has no rows.');
    if (parsed.data.length > 2000) throw invalid('Import at most 2,000 rows at a time.');
    const clientId = (fd.get('clientId') as string) || undefined;
    const source = (fd.get('sourceKey') as string) || 'csv_import';
    const consentConfirmed = fd.get('consentConfirmed') === 'on';
    const col = (r: Record<string, string>, ...names: string[]) => {
      for (const n of names) {
        const k = Object.keys(r).find((x) => x.toLowerCase().replace(/[\s_-]/g, '') === n);
        if (k && r[k]?.trim()) return r[k].trim();
      }
      return undefined;
    };
    const counts = { created: 0, updated: 0, flagged_duplicate: 0, failed: 0 };
    const failures: string[] = [];
    for (const [i, r] of parsed.data.entries()) {
      try {
        const res = await ingestLead(
          actor,
          {
            name:
              col(r, 'name', 'fullname') ??
              [col(r, 'firstname'), col(r, 'lastname')].filter(Boolean).join(' '),
            email: col(r, 'email', 'emailaddress'),
            phone: col(r, 'phone', 'mobile', 'phonenumber', 'contactnumber'),
            organisationName: col(r, 'organisation', 'organization', 'company', 'institution'),
            interest: col(r, 'interest', 'course', 'programme', 'program', 'service'),
            city: col(r, 'city', 'location'),
            clientId,
            leadType: clientId ? 'admission_enquiry' : 'client_prospect',
            consentMarketing:
              consentConfirmed && /^(y|yes|true|1)$/i.test(col(r, 'consent', 'marketingconsent') ?? ''),
            consentSource: 'csv_import',
            utmCampaign: col(r, 'campaign', 'utmcampaign'),
            sourceKey: col(r, 'source') ?? source,
          },
          'csv_import',
        );
        counts[res.outcome]++;
      } catch (e) {
        counts.failed++;
        if (failures.length < 25)
          failures.push(`Row ${i + 2}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const summary = `Imported ${parsed.data.length} rows: ${counts.created} created, ${counts.updated} matched existing, ${counts.flagged_duplicate} flagged as possible duplicates, ${counts.failed} failed.`;
    if (counts.failed) return { ok: true, message: summary, error: failures.join('\n') };
    return { ok: true, message: summary, redirectTo: '/leads?sort=createdAt&dir=desc' };
  }, '/leads');
}

export async function whatsappAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const res = await sendWhatsAppTemplate(actor, String(fd.get('id')), String(fd.get('template') ?? ''));
    return {
      ok: true,
      message:
        res.status === 'demo'
          ? `Demo mode — nothing was sent. “${res.template.label}” was logged as a demo on the timeline.`
          : `“${res.template.label}” sent on WhatsApp`,
    };
  });
}
