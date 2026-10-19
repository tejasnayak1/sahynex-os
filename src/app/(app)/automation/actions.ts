'use server';
import { runAction, type ActionState } from '@/server/action';
import { invalid } from '@/server/errors';
import { getWorkflow } from '@/server/automation/registry';
import {
  retryExecution,
  runNow,
  setAutomationEnabled,
  updateAutomationConfig,
} from '@/server/automation/engine';

export async function toggleAutomationAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const enabled = fd.get('enabled') === 'true';
    await setAutomationEnabled(actor, String(fd.get('key')), enabled);
    return { ok: true, message: enabled ? 'Automation enabled' : 'Automation disabled' };
  }, '/automation');
}
export async function runNowAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await runNow(actor, String(fd.get('key')));
    return { ok: true, message: 'Queued — the worker will run it within a few seconds' };
  }, '/automation');
}
export async function retryAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await retryExecution(actor, String(fd.get('executionId')));
    return { ok: true, message: 'Retry queued' };
  }, '/automation');
}
export async function configAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const key = String(fd.get('key'));
    const def = getWorkflow(key);
    if (!def) throw invalid('Unknown automation.');
    const config: Record<string, unknown> = {};
    for (const f of def.configFields ?? []) {
      const raw = fd.get(`cfg_${f.key}`);
      if (f.type === 'boolean') config[f.key] = raw === 'on';
      else if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) throw invalid(`${f.label} must be a positive number.`);
        config[f.key] = n;
      } else config[f.key] = String(raw ?? '');
    }
    const cron = fd.get('cron');
    await updateAutomationConfig(actor, key, {
      config,
      cron: cron ? String(cron).trim() : undefined,
      ownerId: (fd.get('ownerId') as string) || null,
    });
    return { ok: true, message: 'Automation settings saved' };
  }, '/automation');
}
