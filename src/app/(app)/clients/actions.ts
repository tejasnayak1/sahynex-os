'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import { addContact, createClient, removeContact, updateClient } from '@/server/services/clients';

export async function createClientAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const c = await createClient(actor, formToObject(fd));
    return { ok: true, message: 'Client created', redirectTo: `/clients/${c.id}` };
  }, '/clients');
}
export async function updateClientAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, ...rest } = formToObject(fd);
    await updateClient(actor, String(id), rest);
    return { ok: true, message: 'Client saved' };
  }, '/clients');
}
export async function addContactAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { clientId, ...rest } = formToObject(fd);
    await addContact(actor, String(clientId), rest);
    return { ok: true, message: 'Contact added' };
  }, '/clients');
}
export async function removeContactAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await removeContact(actor, String(fd.get('id')));
    return { ok: true, message: 'Contact removed' };
  }, '/clients');
}
