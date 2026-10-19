'use server';
import { runAction, type ActionState } from '@/server/action';
import { invalid } from '@/server/errors';
import {
  approveReport,
  generateReportAsUser,
  saveCommentary,
  submitDailyUpdate,
  submitReportForReview,
  type ReportType,
} from '@/server/services/reports';

export async function generateAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const type = String(fd.get('type')) as ReportType;
    const periodStart = String(fd.get('periodStart') ?? '');
    const periodEnd = String(fd.get('periodEnd') ?? '');
    if (!periodStart || !periodEnd) throw invalid('Choose the reporting period.');
    const r = await generateReportAsUser(actor, {
      type,
      periodStart,
      periodEnd,
      clientId: (fd.get('clientId') as string) || null,
    });
    return {
      ok: true,
      message: r.regenerated
        ? 'Report draft generated'
        : 'This report is already approved — opening the approved version',
      redirectTo: `/reports/${r.report.id}`,
    };
  }, '/reports');
}
export async function commentaryAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await saveCommentary(actor, String(fd.get('id')), String(fd.get('commentary') ?? ''));
    return { ok: true, message: 'Commentary saved' };
  }, '/reports');
}
export async function submitReviewAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await submitReportForReview(actor, String(fd.get('id')));
    return { ok: true, message: 'Sent for review' };
  }, '/reports');
}
export async function approveAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await approveReport(actor, String(fd.get('id')));
    return { ok: true, message: 'Approved — delivery is queued' };
  }, '/reports');
}
export async function dailyUpdateAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      await submitDailyUpdate(actor, String(fd.get('date')), {
        completed: fd.get('completed'),
        inProgress: fd.get('inProgress') || undefined,
        blockers: fd.get('blockers') || undefined,
        plannedNext: fd.get('plannedNext') || undefined,
      });
      return { ok: true, message: 'Daily update saved' };
    },
    ['/reports/daily', '/dashboard'],
  );
}
