'use server';
import { formToObject, runAction, type ActionState } from '@/server/action';
import { invalid } from '@/server/errors';
import { orgSettingsSchema } from '@/lib/org-settings';
import {
  changeOwnPassword,
  configureIntegration,
  createApiKey,
  createKpi,
  createTeam,
  createUser,
  deleteKpi,
  resetUserPassword,
  revokeApiKey,
  setRolePermissions,
  testIntegration,
  updateOrgSettings,
  updateUser,
} from '@/server/services/admin';
import { setHourlyCost } from '@/server/services/finance';
import { saveTemplate } from '@/server/services/projects';
import type { Connection } from '@/server/integrations/types';

const num = (fd: FormData, k: string) => Number(fd.get(k));

export async function orgSettingsAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const weights: Record<string, number> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('w_')) weights[k.slice(2)] = Number(v);
    const probs: Record<string, number> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('p_')) probs[k.slice(2)] = Number(v);
    const settings = orgSettingsSchema.parse({
      leads: {
        assignment: fd.get('assignment'),
        firstContactSlaHours: num(fd, 'firstContactSlaHours'),
        escalationAfterHours: num(fd, 'escalationAfterHours'),
        followUpTaskDueHours: num(fd, 'followUpTaskDueHours'),
        qualifyThreshold: num(fd, 'qualifyThreshold'),
        scoreWeights: weights,
      },
      sales: {
        staleDealDays: num(fd, 'staleDealDays'),
        proposalFollowUpDays: String(fd.get('proposalFollowUpDays') ?? '')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0),
        proposalEscalateDays: num(fd, 'proposalEscalateDays'),
        discountApprovalAbovePct: num(fd, 'discountApprovalAbovePct'),
        stageProbability: probs,
      },
      delivery: {
        taskReminderHoursBefore: num(fd, 'taskReminderHoursBefore'),
        overdueEscalationHours: num(fd, 'overdueEscalationHours'),
        approvalReminderHours: num(fd, 'approvalReminderHours'),
        maxApprovalReminders: num(fd, 'maxApprovalReminders'),
      },
      campaigns: { evaluationDays: num(fd, 'evaluationDays'), staleAfterHours: num(fd, 'staleAfterHours') },
      reports: { digestRecipientRoles: fd.getAll('digestRecipientRoles').map(String) },
    });
    await updateOrgSettings(actor, {
      name: String(fd.get('orgName') ?? '') || undefined,
      timezone: String(fd.get('timezone') ?? '') || undefined,
      settings,
    });
    return { ok: true, message: 'Organisation settings saved' };
  }, '/settings/organisation');
}

export async function createUserAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const r = await createUser(actor, formToObject(fd));
    return {
      ok: true,
      message: `${r.user.name} added. Share the temporary password securely; they should change it after signing in.`,
      secret: r.temporaryPassword,
    };
  }, '/settings/users');
}
export async function updateUserAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { id, hourly, capacity, ...rest } = formToObject(fd);
    await updateUser(actor, String(id), rest);
    if (hourly !== undefined || capacity !== undefined) {
      if (actor.permissions.has('finance.write')) await setHourlyCost(actor, String(id), hourly, capacity);
    }
    return { ok: true, message: 'User updated' };
  }, '/settings/users');
}
export async function resetPasswordAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const pw = await resetUserPassword(actor, String(fd.get('id')));
    return { ok: true, message: 'Password reset; all their sessions were signed out.', secret: pw };
  }, '/settings/users');
}
export async function createTeamAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await createTeam(actor, String(fd.get('name') ?? ''));
    return { ok: true, message: 'Team created' };
  }, '/settings/users');
}
export async function rolePermissionsAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await setRolePermissions(actor, String(fd.get('roleId')), fd.getAll('perm').map(String));
    return {
      ok: true,
      message: 'Role permissions saved — affected users get the change on their next request',
    };
  }, '/settings/roles');
}
export async function integrationAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      const provider = String(fd.get('provider')) as Connection['provider'];
      const config: Record<string, string> = {};
      for (const [k, v] of fd.entries())
        if (k.startsWith('cfg_') && String(v).trim()) config[k.slice(4)] = String(v).trim();
      await configureIntegration(actor, provider, {
        mode: String(fd.get('mode')),
        config,
        accountLabel: (fd.get('accountLabel') as string) || undefined,
      });
      return { ok: true, message: 'Integration saved' };
    },
    ['/settings/integrations', '/automation'],
  );
}
export async function testIntegrationAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      const r = await testIntegration(actor, String(fd.get('provider')) as Connection['provider']);
      if (!r.ok) return { ok: false, error: `Connection test failed: ${r.message}` };
      return { ok: true, message: r.message };
    },
    ['/settings/integrations', '/automation'],
  );
}
export async function createApiKeyAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const r = await createApiKey(actor, String(fd.get('name') ?? ''), (fd.get('clientId') as string) || null);
    return { ok: true, message: 'API key created', secret: r.key };
  }, '/settings/integrations');
}
export async function revokeApiKeyAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    await revokeApiKey(actor, String(fd.get('id')));
    return { ok: true, message: 'API key revoked' };
  }, '/settings/integrations');
}
export async function templateAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    let items: unknown;
    try {
      items = JSON.parse(String(fd.get('items') ?? '[]'));
    } catch {
      throw invalid('Task list is not valid JSON.', { items: 'Invalid JSON' });
    }
    await saveTemplate(actor, {
      key: String(fd.get('key') ?? ''),
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
      items,
    });
    return { ok: true, message: 'Template saved' };
  }, '/settings/templates');
}
export async function kpiAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      await createKpi(actor, formToObject(fd));
      return { ok: true, message: 'KPI target added' };
    },
    ['/settings/kpis', '/dashboard'],
  );
}
export async function deleteKpiAction(_: ActionState, fd: FormData) {
  return runAction(
    async (actor) => {
      await deleteKpi(actor, String(fd.get('id')));
      return { ok: true, message: 'KPI removed' };
    },
    ['/settings/kpis', '/dashboard'],
  );
}
export async function passwordAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    if (fd.get('next') !== fd.get('confirm'))
      throw invalid('The new passwords don’t match.', { confirm: 'Doesn’t match' });
    await changeOwnPassword(actor, String(fd.get('current') ?? ''), String(fd.get('next') ?? ''));
    return {
      ok: true,
      message: 'Password changed. Sign in again with your new password.',
      redirectTo: '/login',
    };
  });
}

export async function jobTitleAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const { setOwnJobTitle } = await import('@/server/services/admin');
    await setOwnJobTitle(actor, fd.get('jobTitle'));
    return { ok: true, message: 'Job title saved' };
  });
}
