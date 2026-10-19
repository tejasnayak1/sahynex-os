'use server';
import { runAction, type ActionState } from '@/server/action';
import { disconnectGoogle, generateBrief } from '@/server/services/briefing';

export async function generateBriefAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await generateBrief(actor, { force: fd.get('force') === '1' });
    return { ok: true, message: 'Your brief is ready' };
  }, '/home');
}

export async function disconnectGoogleAction() {
  return runAction(async (actor) => {
    await disconnectGoogle(actor);
    return { ok: true, message: 'Google disconnected' };
  }, '/home');
}
