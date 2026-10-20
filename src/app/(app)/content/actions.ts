'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import { invalid } from '@/server/errors';
import {
  createDeliverable,
  decideApproval,
  markPublished,
  schedulePublication,
  submitForInternalReview,
  updateDeliverable,
  uploadVersion,
} from '@/server/services/deliverables';
import { fromDateTimeLocal } from '@/lib/format';

const R = ['/content', '/approvals'];

export async function createDeliverableAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const d = await createDeliverable(actor, formToObject(fd));
    return { ok: true, message: `Deliverable ${d.ref} created`, redirectTo: `/content/${d.id}` };
  }, R);
}
export async function updateDeliverableAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateDeliverable(actor, String(id), rest);
    return { ok: true, message: 'Saved' };
  }, R);
}
export async function uploadAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0)
      throw invalid('Choose a file to upload.', { file: 'Required' });
    const a = await uploadVersion(
      actor,
      String(fd.get('id')),
      { name: file.name, data: Buffer.from(await file.arrayBuffer()) },
      (fd.get('note') as string) || null,
    );
    return { ok: true, message: `Version ${a.version} uploaded` };
  }, R);
}
export async function submitReviewAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await submitForInternalReview(actor, String(fd.get('id')), (fd.get('reviewerId') as string) || null);
    return { ok: true, message: 'Submitted for internal review' };
  }, R);
}
export async function decideAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const decision = String(fd.get('decision')) as 'approved' | 'changes_requested';
    const r = await decideApproval(
      actor,
      String(fd.get('approvalId')),
      decision,
      (fd.get('feedback') as string) || null,
    );
    return {
      ok: true,
      message:
        decision === 'changes_requested'
          ? 'Changes requested — a revision task was created'
          : r.status === 'submitted_to_client'
            ? 'Approved internally and sent to the client'
            : 'Approved',
    };
  }, R);
}
export async function scheduleAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const v = String(fd.get('publishAt') ?? '');
    if (!v) throw invalid('Choose a publish date and time.');
    await schedulePublication(actor, String(fd.get('id')), fromDateTimeLocal(v));
    return { ok: true, message: 'Scheduled' };
  }, R);
}
export async function publishedAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await markPublished(actor, String(fd.get('id')), (fd.get('finalUrl') as string) || null);
    return { ok: true, message: 'Marked as published' };
  }, R);
}

export type CreativeResult =
  | { ok: true; review: import('@/server/services/creative').CreativeReview; demo: boolean; model: string }
  | { ok: false; error: string };

/** Runs the Creative Studio review. Returns data only — nothing is saved to the deliverable. */
export async function evaluateBriefAction(input: Record<string, string>): Promise<CreativeResult> {
  const { getCurrentActor } = await import('@/server/auth/current');
  const { evaluateBrief } = await import('@/server/services/creative');
  const { isAppError } = await import('@/server/errors');
  const actor = await getCurrentActor();
  if (!actor) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const r = await evaluateBrief(actor, input);
    return { ok: true, ...r };
  } catch (e) {
    if (isAppError(e)) return { ok: false, error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[creative studio]', msg);
    return {
      ok: false,
      error: /rate limit|429/i.test(msg)
        ? 'The AI is busy or over its free daily limit. Try again later, or continue manually.'
        : 'The AI didn’t respond properly. Try again, or continue manually.',
    };
  }
}
