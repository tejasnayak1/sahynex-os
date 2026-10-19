'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import type { MailResult } from '@/server/mailer';
import {
  cancelMeeting,
  completeMeeting,
  rescheduleMeeting,
  scheduleMeeting,
} from '@/server/services/meetings';

function mailNote(mail: MailResult | null): string {
  if (!mail) return '';
  if (mail.status === 'sent') return ' Invite emailed to attendees.';
  if (mail.status === 'not_configured')
    return ' Email is not configured (SMTP), so no invite was sent — download the .ics and send it yourself.';
  return ` The invite email failed (${mail.error ?? 'unknown error'}) — download the .ics and send it yourself.`;
}

export async function scheduleMeetingAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { mail } = await scheduleMeeting(actor, formToObject(fd));
    return { ok: true, message: `Meeting scheduled and added to your calendar.${mailNote(mail)}` };
  });
}

export async function rescheduleMeetingAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    const { mail } = await rescheduleMeeting(actor, String(id), rest);
    return { ok: true, message: `Meeting updated.${mailNote(mail)}` };
  });
}

export async function cancelMeetingAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    const { mail } = await cancelMeeting(actor, String(id), rest);
    return { ok: true, message: `Meeting cancelled.${mailNote(mail)}` };
  });
}

export async function completeMeetingAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await completeMeeting(actor, String(id), rest);
    return { ok: true, message: 'Meeting outcome recorded' };
  });
}
