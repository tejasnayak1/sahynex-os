'use server';
import { runAction, type ActionState } from '@/server/action';
import { deleteView, saveView } from '@/server/services/views';

export async function saveViewAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      await saveView(
        actor,
        String(fd.get('module')),
        String(fd.get('name') ?? ''),
        String(fd.get('query') ?? ''),
      );
      return { ok: true, message: 'View saved' };
    },
    [String(fd.get('path') ?? '/')],
  );
}
export async function deleteViewAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      await deleteView(actor, String(fd.get('id')));
      return { ok: true, message: 'View removed' };
    },
    [String(fd.get('path') ?? '/')],
  );
}
