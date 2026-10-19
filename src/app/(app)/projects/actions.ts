'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import {
  addMilestone,
  applyTemplateAsUser,
  createProject,
  setMembers,
  setProjectStatus,
  toggleMilestone,
  updateProject,
  type Project,
} from '@/server/services/projects';

export async function createProjectAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const data = formToObject(fd);
    const p = await createProject(actor, data);
    if (data.templateKey) await applyTemplateAsUser(actor, p.id, String(data.templateKey));
    return { ok: true, message: `Project ${p.ref} created`, redirectTo: `/projects/${p.id}` };
  }, '/projects');
}
export async function updateProjectAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateProject(actor, String(id), rest);
    return { ok: true, message: 'Project saved' };
  }, '/projects');
}
export async function projectStatusAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setProjectStatus(actor, String(fd.get('id')), String(fd.get('status')) as Project['status']);
    return { ok: true, message: 'Status updated' };
  }, '/projects');
}
export async function membersAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setMembers(actor, String(fd.get('id')), fd.getAll('members').map(String));
    return { ok: true, message: 'Team updated' };
  }, '/projects');
}
export async function milestoneAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { projectId, ...rest } = formToObject(fd);
    await addMilestone(actor, String(projectId), rest);
    return { ok: true, message: 'Milestone added' };
  }, '/projects');
}
export async function toggleMilestoneAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await toggleMilestone(actor, String(fd.get('id')));
    return { ok: true };
  }, '/projects');
}
export async function applyTemplateAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const r = await applyTemplateAsUser(actor, String(fd.get('id')), String(fd.get('templateKey')));
    return {
      ok: true,
      message: r.created
        ? `${r.created} task(s) created`
        : 'Template already applied — no duplicate tasks created',
    };
  }, '/projects');
}
