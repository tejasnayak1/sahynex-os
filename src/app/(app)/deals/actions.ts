'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import {
  approveDiscount,
  changeDealStage,
  createDeal,
  createProposal,
  decideHandover,
  markProposalSent,
  recordProposalResponse,
  saveHandover,
  submitHandover,
  updateDeal,
  type Deal,
} from '@/server/services/deals';

const R = ['/pipeline', '/deals'];

export async function createDealAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const d = await createDeal(actor, formToObject(fd));
    return { ok: true, message: `Deal ${d.ref} created`, redirectTo: `/deals/${d.id}` };
  }, R);
}
export async function updateDealAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    if (!('services' in rest) && fd.has('services_present')) rest.services = [];
    delete rest.services_present;
    await updateDeal(actor, String(id), rest);
    return { ok: true, message: 'Deal saved' };
  }, R);
}
export async function dealStageAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const stage = String(fd.get('stage')) as Deal['stage'];
    await changeDealStage(actor, String(fd.get('id')), stage, {
      lostReason: (fd.get('lostReason') as string) || null,
      note: (fd.get('note') as string) || null,
    });
    return { ok: true, message: stage === 'won' ? 'Marked won — handover started' : 'Stage updated' };
  }, R);
}
export async function approveDiscountAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await approveDiscount(actor, String(fd.get('id')));
    return { ok: true, message: 'Discount approved' };
  }, R);
}
export async function createProposalAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { dealId, ...rest } = formToObject(fd);
    const p = await createProposal(actor, String(dealId), rest);
    return { ok: true, message: `Proposal v${p.version} drafted` };
  }, R);
}
export async function sendProposalAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await markProposalSent(actor, String(fd.get('proposalId')));
    return { ok: true, message: 'Marked as sent — follow-ups scheduled' };
  }, R);
}
export async function proposalResponseAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const accepted = fd.get('accepted') === 'true';
    await recordProposalResponse(actor, String(fd.get('proposalId')), accepted);
    return { ok: true, message: accepted ? 'Proposal accepted' : 'Proposal rejected' };
  }, R);
}
export async function saveHandoverAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { dealId, intent, ...rest } = formToObject(fd);
    await saveHandover(actor, String(dealId), rest);
    if (intent === 'submit') {
      await submitHandover(actor, String(dealId));
      return { ok: true, message: 'Handover submitted for approval' };
    }
    return { ok: true, message: 'Handover saved' };
  }, R);
}
export async function decideHandoverAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      const approve = fd.get('decision') === 'approve';
      await decideHandover(actor, String(fd.get('dealId')), approve, (fd.get('note') as string) || null);
      return {
        ok: true,
        message: approve ? 'Approved — the project is being created' : 'Sent back for changes',
      };
    },
    [...R, '/projects'],
  );
}
