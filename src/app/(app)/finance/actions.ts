'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import {
  approveBudget,
  createBudget,
  createExpense,
  createInvoice,
  updateInvoiceStatus,
} from '@/server/services/finance';

export async function budgetAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await createBudget(actor, formToObject(fd));
    return { ok: true, message: 'Budget recorded — awaiting approval' };
  }, '/finance');
}
export async function approveBudgetAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await approveBudget(actor, String(fd.get('id')));
    return { ok: true, message: 'Budget approved' };
  }, '/finance');
}
export async function expenseAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await createExpense(actor, formToObject(fd));
    return { ok: true, message: 'Expense recorded' };
  }, '/finance');
}
export async function invoiceAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await createInvoice(actor, formToObject(fd));
    return { ok: true, message: 'Invoice recorded' };
  }, '/finance');
}
export async function invoiceStatusAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await updateInvoiceStatus(actor, String(fd.get('id')), {
      status: String(fd.get('status')),
      paid: fd.get('paid'),
    });
    return { ok: true, message: 'Invoice updated' };
  }, '/finance');
}
