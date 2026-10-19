'use server';
import { runAction, type ActionState } from '@/server/action';
import { markRead } from '@/server/services/notifications';

export async function markReadAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      const all = fd.get('all') === '1';
      await markRead(actor, all ? 'all' : fd.getAll('ids').map(String));
      return { ok: true, message: all ? 'All marked as read' : undefined };
    },
    ['/notifications'],
  );
}
