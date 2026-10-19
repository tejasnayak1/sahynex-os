/**
 * Idempotent bootstrap: permission catalogue, organisation, default roles, automations, task templates
 * and integration placeholders. Safe to run on every deploy — it only inserts what is missing and never
 * overwrites roles, automations or templates that administrators have customised.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from './index';
import * as schema from './schema';
import { DEFAULT_TEMPLATES } from './defaults';
import { DEFAULT_ROLES, PERMISSIONS, type RoleKey } from '../lib/permissions';
import { WORKFLOWS } from '../server/automation/registry';
import { nextCronRun } from '../server/automation/engine';
import { hashPassword, passwordPolicyError } from '../server/auth/password';

export async function bootstrapOrg(
  db: DB,
  opts: {
    name: string;
    slug: string;
    timezone?: string;
    currency?: string;
    admin?: { email: string; name: string; password: string };
  },
) {
  // 1. Permission catalogue (upsert descriptions).
  for (const [key, p] of Object.entries(PERMISSIONS)) {
    await db
      .insert(schema.permissions)
      .values({ key, module: p.module, description: p.description })
      .onConflictDoUpdate({
        target: schema.permissions.key,
        set: { module: p.module, description: p.description },
      });
  }
  // 2. Organisation.
  let [org] = await db.select().from(schema.organisations).where(eq(schema.organisations.slug, opts.slug));
  if (!org)
    [org] = await db
      .insert(schema.organisations)
      .values({
        name: opts.name,
        slug: opts.slug,
        timezone: opts.timezone ?? 'Asia/Kolkata',
        currency: opts.currency ?? 'INR',
      })
      .returning();

  // 3. Roles: create missing roles with default grants. Existing roles are left as administrators configured them.
  const roleIds: Record<string, string> = {};
  for (const [key, def] of Object.entries(DEFAULT_ROLES) as [RoleKey, (typeof DEFAULT_ROLES)[RoleKey]][]) {
    const [existing] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.orgId, org.id), eq(schema.roles.key, key)));
    if (existing) {
      roleIds[key] = existing.id;
      // The super-admin role always holds every permission, including ones added in later releases.
      if (key === 'ceo')
        for (const p of def.permissions)
          await db
            .insert(schema.rolePermissions)
            .values({ roleId: existing.id, permissionKey: p })
            .onConflictDoNothing();
      continue;
    }
    const [r] = await db
      .insert(schema.roles)
      .values({ orgId: org.id, key, name: def.name, description: def.description, isSystem: true })
      .returning();
    roleIds[key] = r.id;
    await db
      .insert(schema.rolePermissions)
      .values(def.permissions.map((p) => ({ roleId: r.id, permissionKey: p })))
      .onConflictDoNothing();
  }

  // 4. Automations from the registry (missing ones only).
  for (const w of WORKFLOWS) {
    const [existing] = await db
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(and(eq(schema.automations.orgId, org.id), eq(schema.automations.key, w.key)));
    if (existing) {
      // Keep descriptive metadata in sync with the code; never touch enabled/config/schedule/owner.
      await db
        .update(schema.automations)
        .set({
          name: w.name,
          description: w.description,
          conditions: w.conditions,
          actions: w.actions,
          requiresIntegration: w.requiresIntegration ?? null,
        })
        .where(eq(schema.automations.id, existing.id));
      continue;
    }
    await db.insert(schema.automations).values({
      orgId: org.id,
      key: w.key,
      name: w.name,
      description: w.description,
      trigger: w.trigger,
      conditions: w.conditions,
      actions: w.actions,
      config: w.defaultConfig,
      maxAttempts: w.maxAttempts ?? 5,
      timeoutSeconds: w.timeoutSeconds ?? 60,
      requiresIntegration: w.requiresIntegration ?? null,
      nextRunAt: w.trigger.type === 'schedule' ? nextCronRun(w.trigger.cron, org.timezone, new Date()) : null,
    });
  }

  // 5. Task templates.
  for (const t of DEFAULT_TEMPLATES)
    await db
      .insert(schema.taskTemplates)
      .values({ orgId: org.id, ...t })
      .onConflictDoNothing();

  // 6. Integration placeholders (disconnected).
  for (const provider of schema.integrationProvider.enumValues)
    await db.insert(schema.integrationConnections).values({ orgId: org.id, provider }).onConflictDoNothing();

  // 7. First administrator (only when the org has no users yet).
  if (opts.admin) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(eq(schema.users.orgId, org.id));
    if (n === 0) {
      const err = passwordPolicyError(opts.admin.password);
      if (err) throw new Error(`ADMIN_PASSWORD rejected: ${err}`);
      const [admin] = await db
        .insert(schema.users)
        .values({
          orgId: org.id,
          email: opts.admin.email.toLowerCase(),
          name: opts.admin.name,
          passwordHash: await hashPassword(opts.admin.password),
          roleId: roleIds.ceo,
        })
        .returning();
      await db
        .update(schema.automations)
        .set({ ownerId: admin.id })
        .where(and(eq(schema.automations.orgId, org.id), sql`${schema.automations.ownerId} is null`));
    }
  }
  return { orgId: org.id, roleIds };
}
