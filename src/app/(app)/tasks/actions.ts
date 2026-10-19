'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import {
  addComment,
  addDependency,
  bulkUpdateTasks,
  createTask,
  logTime,
  removeDependency,
  setCollaborators,
  setTaskStatus,
  updateTask,
  type Task,
} from '@/server/services/tasks';

export async function createTaskAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const t = await createTask(actor, formToObject(fd));
    return {
      ok: true,
      message: `Task ${t.ref} created`,
      redirectTo: fd.get('stay') ? undefined : `/tasks/${t.id}`,
    };
  }, '/tasks');
}
export async function updateTaskAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateTask(actor, String(id), rest);
    return { ok: true, message: 'Task saved' };
  }, '/tasks');
}
export async function taskStatusAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const status = String(fd.get('status')) as Task['status'];
    await setTaskStatus(actor, String(fd.get('id')), status, (fd.get('note') as string) || null);
    return { ok: true, message: status === 'done' ? 'Task completed' : 'Status updated' };
  }, '/tasks');
}
export async function commentAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await addComment(actor, 'task', String(fd.get('id')), String(fd.get('body') ?? ''));
    return { ok: true, message: 'Comment added' };
  });
}
export async function dependencyAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const id = String(fd.get('id'));
    const other = String(fd.get('dependsOn') ?? '');
    if (fd.get('remove')) await removeDependency(actor, id, other);
    else await addDependency(actor, id, other);
    return { ok: true, message: fd.get('remove') ? 'Dependency removed' : 'Dependency added' };
  });
}
export async function collaboratorsAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setCollaborators(actor, String(fd.get('id')), fd.getAll('users').map(String));
    return { ok: true, message: 'Collaborators updated' };
  });
}
export async function timeAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const hours = Number(fd.get('hours') ?? 0);
    await logTime(actor, String(fd.get('id')), {
      minutes: Math.round(hours * 60),
      workDate: fd.get('workDate'),
      note: fd.get('note'),
    });
    return { ok: true, message: 'Time logged' };
  });
}

export async function bulkTaskAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const res = await bulkUpdateTasks(actor, {
      ids: fd.getAll('ids').map(String),
      status: fd.get('bulkStatus') ?? '',
      priority: fd.get('bulkPriority') ?? '',
      ownerId: fd.get('bulkOwnerId') ?? '',
    });
    const parts = [`${res.updated} task(s) updated`];
    if (res.unchanged) parts.push(`${res.unchanged} already matched`);
    if (res.failed.length) {
      const reasons = [...new Set(res.failed.map((f) => f.error))].slice(0, 2).join('; ');
      if (!res.updated && !res.unchanged) return { ok: false, error: `No tasks changed — ${reasons}` };
      return { ok: true, message: `${parts.join(', ')}. ${res.failed.length} skipped: ${reasons}` };
    }
    return { ok: true, message: parts.join(', ') };
  }, '/tasks');
}
