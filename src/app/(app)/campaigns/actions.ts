'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import { invalid } from '@/server/errors';
import {
  createCampaign,
  importMetricsCsv,
  recordConversion,
  updateCampaign,
  verifyConversion,
} from '@/server/services/campaigns';
import { createMonitor, setMonitorActive, updateIncident } from '@/server/services/monitoring';

export async function createCampaignAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const c = await createCampaign(actor, formToObject(fd));
    return { ok: true, message: 'Campaign created', redirectTo: `/campaigns/${c.id}` };
  }, '/campaigns');
}
export async function updateCampaignAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateCampaign(actor, String(id), rest);
    return { ok: true, message: 'Campaign saved' };
  }, '/campaigns');
}
export async function importMetricsAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) throw invalid('Choose a CSV file.');
    if (file.size > 2 * 1024 * 1024) throw invalid('CSV must be 2 MB or smaller.');
    const r = await importMetricsCsv(actor, String(fd.get('id')), await file.text());
    return { ok: true, message: `${r.imported} day(s) of metrics imported` };
  }, '/campaigns');
}
export async function conversionAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await recordConversion(actor, formToObject(fd), fd.get('verified') === 'on');
    return { ok: true, message: 'Outcome recorded' };
  }, '/campaigns');
}
export async function verifyConversionAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await verifyConversion(actor, String(fd.get('id')));
    return { ok: true, message: 'Verified' };
  }, '/campaigns');
}
export async function createMonitorAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await createMonitor(actor, formToObject(fd));
    return { ok: true, message: 'Monitor added — first check runs within 15 minutes' };
  }, '/campaigns/monitoring');
}
export async function toggleMonitorAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setMonitorActive(actor, String(fd.get('id')), fd.get('active') === 'true');
    return { ok: true, message: 'Monitor updated' };
  }, '/campaigns/monitoring');
}
export async function incidentAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const a = String(fd.get('action')) as 'acknowledge' | 'resolve';
    await updateIncident(actor, String(fd.get('id')), a, (fd.get('notes') as string) || null);
    return {
      ok: true,
      message: a === 'resolve' ? 'Marked fixed — the next successful check will close it' : 'Acknowledged',
    };
  }, '/campaigns/monitoring');
}
