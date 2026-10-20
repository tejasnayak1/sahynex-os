import { and, asc, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { orgSettingsSchema } from '@/lib/org-settings';
import { ALL_PERMISSIONS, type Permission } from '@/lib/permissions';
import { actorUserId, assertCan, type Actor } from '../actor';
import { audit } from '../audit';
import { invalidateAllUserSessions } from '../auth/session';
import { hashPassword, passwordPolicyError } from '../auth/password';
import { randomToken, sha256 } from '../crypto';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { ADS_ADAPTERS, ga4Adapter } from '../integrations/adapters';
import type { Connection } from '../integrations/types';
import { parseTemplates, whatsappAdapter } from '../integrations/whatsapp';
import { instagramAdapter } from '../integrations/instagram';
import { aiAdapter, aiProvider } from '../integrations/ai';
import { bool, optUuid, parse, reqStr } from '../validation';

const {
  users,
  roles,
  rolePermissions,
  teams,
  apiKeys,
  integrationConnections,
  organisations,
  auditLogs,
  employeeProfiles,
  clients,
  clientContacts,
} = schema;

/* ------------------------------------------------------------------ users */

export async function listUsers(actor: Actor) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      acceptsLeads: users.acceptsLeads,
      roleKey: roles.key,
      roleName: roles.name,
      roleId: users.roleId,
      teamId: users.teamId,
      clientId: users.clientId,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.orgId, actor.orgId))
    .orderBy(asc(users.name));
}

/** Lightweight list for assignment dropdowns (internal, active people only). */
export async function teamOptions(orgId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), isNull(users.clientId)))
    .orderBy(asc(users.name));
}

const userSchema = z.object({
  name: reqStr(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  roleId: z.string().uuid('Choose a role'),
  teamId: optUuid,
  clientId: optUuid,
  acceptsLeads: bool.default(false),
});

/** Creates a user with a one-time temporary password, returned once to the admin to share securely. */
export async function createUser(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'settings.users');
  const input = parse(userSchema, raw);
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, input.roleId), eq(roles.orgId, actor.orgId)));
  if (!role) throw invalid('Unknown role.');
  if (role.key === 'client_reviewer' && !input.clientId)
    throw invalid('Client reviewers must be linked to a client.', { clientId: 'Required' });
  if (role.key !== 'client_reviewer' && input.clientId)
    throw invalid('Only client reviewers can be linked to a client.');
  if (role.key === 'ceo' && !actor.permissions.has('settings.roles'))
    throw forbidden('Only a super admin can create another super admin.');
  const temp = `Sx-${randomToken(9)}`;
  const ins = await db
    .insert(users)
    .values({
      orgId: actor.orgId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(temp),
      roleId: role.id,
      teamId: input.teamId ?? null,
      clientId: input.clientId ?? null,
      acceptsLeads: input.acceptsLeads,
    })
    .onConflictDoNothing()
    .returning();
  if (!ins[0]) throw invalid('A user with this email already exists.', { email: 'Already exists' });
  if (input.clientId) {
    await db
      .update(clientContacts)
      .set({ userId: ins[0].id })
      .where(
        and(
          eq(clientContacts.clientId, input.clientId),
          sql`lower(${clientContacts.email}) = ${input.email}`,
        ),
      );
  }
  await audit(db, actor, 'user.created', 'user', ins[0].id, {
    after: { email: input.email, role: role.key },
  });
  return { user: ins[0], temporaryPassword: temp };
}

export async function updateUser(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'settings.users');
  const input = parse(
    z.object({
      roleId: optUuid,
      teamId: optUuid,
      isActive: bool.optional(),
      acceptsLeads: bool.optional(),
      name: reqStr(200).optional(),
    }),
    raw,
  );
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.orgId, actor.orgId)));
  if (!u) throw notFound('User');
  if (id === actorUserId(actor) && (input.isActive === false || (input.roleId && input.roleId !== u.roleId)))
    throw precondition('You cannot deactivate yourself or change your own role.');
  if (input.roleId) {
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.orgId, actor.orgId)));
    if (!role) throw invalid('Unknown role.');
    if (role.key === 'ceo' && !actor.permissions.has('settings.roles')) throw forbidden();
  }
  const patch: Partial<typeof users.$inferInsert> = {};
  if ('roleId' in raw && input.roleId) patch.roleId = input.roleId;
  if ('teamId' in raw) patch.teamId = input.teamId ?? null;
  if ('isActive' in raw) patch.isActive = input.isActive;
  if ('acceptsLeads' in raw) patch.acceptsLeads = input.acceptsLeads;
  if ('name' in raw && input.name) patch.name = input.name;
  await db.update(users).set(patch).where(eq(users.id, id));
  if (patch.isActive === false || patch.roleId) await invalidateAllUserSessions(id);
  await audit(db, actor, 'user.updated', 'user', id, {
    before: { roleId: u.roleId, isActive: u.isActive, acceptsLeads: u.acceptsLeads },
    after: patch,
  });
}

export async function resetUserPassword(actor: Actor, id: string) {
  assertCan(actor, 'settings.users');
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.orgId, actor.orgId)));
  if (!u) throw notFound('User');
  const temp = `Sx-${randomToken(9)}`;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(temp), failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, id));
  await invalidateAllUserSessions(id);
  await audit(db, actor, 'user.password_reset', 'user', id);
  return temp;
}

export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  if (actor.kind !== 'user') throw forbidden();
  const { verifyPassword } = await import('../auth/password');
  const [u] = await db.select().from(users).where(eq(users.id, actor.id));
  if (!(await verifyPassword(u.passwordHash, current)))
    throw invalid('Current password is incorrect.', { current: 'Incorrect' });
  const err = passwordPolicyError(next);
  if (err) throw invalid(err, { next: err });
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, actor.id));
  await invalidateAllUserSessions(actor.id);
  await audit(db, actor, 'user.password_changed', 'user', actor.id);
}

/** A person's own job title (display only — it grants nothing). */
export async function setOwnJobTitle(actor: Actor, raw: unknown) {
  if (actor.kind !== 'user') throw forbidden();
  const title = typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
  await db
    .update(users)
    .set({ jobTitle: title || null })
    .where(eq(users.id, actor.id));
  await audit(db, actor, 'user.job_title_changed', 'user', actor.id, { after: { jobTitle: title || null } });
}

/* ------------------------------------------------------------------ roles */

export async function listRoles(orgId: string) {
  const rs = await db.select().from(roles).where(eq(roles.orgId, orgId)).orderBy(asc(roles.name));
  const perms = await db
    .select()
    .from(rolePermissions)
    .where(
      inArray(
        rolePermissions.roleId,
        rs.map((r) => r.id).length ? rs.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'],
      ),
    );
  return rs.map((r) => ({
    ...r,
    permissions: new Set(perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey as Permission)),
  }));
}

export async function setRolePermissions(actor: Actor, roleId: string, keys: string[]) {
  assertCan(actor, 'settings.roles');
  const valid = keys.filter((k): k is Permission => (ALL_PERMISSIONS as string[]).includes(k));
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.orgId, actor.orgId)));
  if (!role) throw notFound('Role');
  if (role.key === 'ceo' && !valid.includes('settings.roles'))
    throw precondition(
      'The super-admin role must keep “Edit roles and permissions”, or nobody could manage access.',
    );
  if (role.key === 'client_reviewer') {
    const allowed: Permission[] = ['approvals.client', 'reports.read', 'content.read'];
    if (valid.some((k) => !allowed.includes(k)))
      throw precondition(
        'External reviewers can only be granted client approval, report and content viewing permissions.',
      );
  }
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map(
      (r) => r.permissionKey,
    );
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (valid.length)
      await tx.insert(rolePermissions).values(valid.map((k) => ({ roleId, permissionKey: k })));
    await audit(tx, actor, 'role.permissions_changed', 'role', roleId, {
      before: { permissions: before },
      after: { permissions: valid },
    });
  });
}

/* ---------------------------------------------------------------- teams */

export async function listTeams(orgId: string) {
  return db.select().from(teams).where(eq(teams.orgId, orgId)).orderBy(asc(teams.name));
}

export async function createTeam(actor: Actor, name: string) {
  assertCan(actor, 'settings.users');
  const n = name?.trim();
  if (!n) throw invalid('Team name is required.');
  const ins = await db
    .insert(teams)
    .values({ orgId: actor.orgId, name: n })
    .onConflictDoNothing()
    .returning();
  if (!ins[0]) throw invalid('That team already exists.');
  return ins[0];
}

/* -------------------------------------------------------------- api keys */

export async function listApiKeys(actor: Actor) {
  assertCan(actor, 'settings.integrations');
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      clientName: clients.name,
    })
    .from(apiKeys)
    .leftJoin(clients, eq(clients.id, apiKeys.clientId))
    .where(eq(apiKeys.orgId, actor.orgId))
    .orderBy(desc(apiKeys.createdAt));
}

/** The plaintext key is returned once; only its SHA-256 hash is stored. */
export async function createApiKey(actor: Actor, name: string, clientId?: string | null) {
  assertCan(actor, 'settings.integrations');
  if (!name?.trim()) throw invalid('Give the key a name (e.g. “SCEM admissions landing page”).');
  if (clientId) {
    const [c] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.orgId, actor.orgId)));
    if (!c) throw invalid('Unknown client.');
  }
  const raw = `sx_live_${randomToken(24)}`;
  const [k] = await db
    .insert(apiKeys)
    .values({
      orgId: actor.orgId,
      name: name.trim(),
      prefix: raw.slice(0, 12),
      keyHash: sha256(raw),
      clientId: clientId || null,
      createdById: actorUserId(actor),
    })
    .returning();
  await audit(db, actor, 'api_key.created', 'api_key', k.id, { after: { name: k.name, prefix: k.prefix } });
  return { key: raw, record: k };
}

export async function revokeApiKey(actor: Actor, id: string) {
  assertCan(actor, 'settings.integrations');
  const [k] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, actor.orgId), isNull(apiKeys.revokedAt)))
    .returning();
  if (!k) throw notFound('API key');
  await audit(db, actor, 'api_key.revoked', 'api_key', id);
}

export async function authenticateApiKey(raw: string | null) {
  if (!raw || !raw.startsWith('sx_')) return null;
  const [k] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(raw)), isNull(apiKeys.revokedAt)));
  if (!k) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  return k;
}

/* ---------------------------------------------------------- integrations */

export const INTEGRATION_CATALOG: Array<{
  provider: Connection['provider'];
  label: string;
  description: string;
  supportsDemo: boolean;
}> = [
  {
    provider: 'meta_ads',
    label: 'Meta Ads',
    description:
      'Daily campaign spend, reach, clicks and platform leads via the Marketing API Insights edge.',
    supportsDemo: true,
  },
  {
    provider: 'google_ads',
    label: 'Google Ads',
    description: 'Daily campaign cost, impressions, clicks and conversions via the Google Ads API.',
    supportsDemo: true,
  },
  {
    provider: 'meta_lead_ads',
    label: 'Meta Lead Ads',
    description: 'Real-time leads from Meta lead forms via a verified webhook (leadgen).',
    supportsDemo: false,
  },
  {
    provider: 'ga4',
    label: 'Google Analytics 4',
    description: 'Connection health and key-event counts via the GA4 Data API.',
    supportsDemo: false,
  },
  {
    provider: 'website_forms',
    label: 'Website & landing-page forms',
    description: 'POST leads to /api/v1/leads with an API key (see docs/INTEGRATIONS.md).',
    supportsDemo: false,
  },
  {
    provider: 'email_smtp',
    label: 'Email (SMTP)',
    description: 'Outbound email for reports and high-severity alerts.',
    supportsDemo: false,
  },
  {
    provider: 'whatsapp',
    label: 'WhatsApp Business',
    description:
      'Send approved template messages to individual, consented leads (Cloud API). Manual, one lead at a time; never automated or bulk.',
    supportsDemo: true,
  },
  {
    provider: 'google_workspace',
    label: 'Google — Gmail & Calendar (personal Home page)',
    description:
      'Lets each person connect their own Google account (read-only) so Home shows their inbox highlights, LinkedIn message alerts and today’s calendar. Never sends, deletes or changes anything.',
    supportsDemo: true,
  },
  {
    provider: 'instagram',
    label: 'Instagram',
    description:
      'Daily follower count, posts and engagement for your Instagram professional account on the Home page (Instagram Graph API).',
    supportsDemo: true,
  },
  {
    provider: 'ai_assistant',
    label: 'AI assistant (daily brief)',
    description:
      'Writes each person’s morning brief — priorities, marketing ideas, social insights and trends — from the app’s own figures (free Google Gemini or Anthropic API).',
    supportsDemo: true,
  },
  {
    provider: 'n8n',
    label: 'n8n / Make (outbound webhooks)',
    description:
      'Signed webhooks for new leads, deal stage changes, approvals, handovers and approved reports. Inbound: use an API key with /api/v1/leads.',
    supportsDemo: false,
  },
];

export async function listIntegrations(actor: Actor) {
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.orgId, actor.orgId));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return INTEGRATION_CATALOG.map((c) => {
    const conn = byProvider.get(c.provider) ?? null;
    let missing: string[] = [];
    let setupSteps: string[] = [];
    let requiredConfig: Array<{ key: string; label: string; help: string; multiline?: boolean }> = [];
    if (c.provider === 'meta_ads' || c.provider === 'google_ads') {
      const a = ADS_ADAPTERS[c.provider];
      setupSteps = a.setupSteps;
      requiredConfig = a.requiredConfig;
      missing = a.checkConfig(conn ?? ({ config: {} } as Connection)).missing;
    } else if (c.provider === 'ga4') {
      setupSteps = ga4Adapter.setupSteps;
      requiredConfig = ga4Adapter.requiredConfig;
      missing = ga4Adapter.checkConfig(conn ?? ({ config: {} } as Connection)).missing;
    } else if (c.provider === 'meta_lead_ads') {
      setupSteps = [
        'In your Meta app, add the Webhooks product and subscribe the Page object to the “leadgen” field.',
        `Callback URL: ${process.env.APP_URL ?? 'https://<your-domain>'}/api/webhooks/meta-leads`,
        'Set META_VERIFY_TOKEN (any random string, also entered in Meta), META_APP_SECRET (for signature verification) and META_PAGE_ACCESS_TOKEN (leads_retrieval permission).',
        'Map each Facebook Page to a client below (pageId → client) so leads are attributed correctly.',
      ];
      requiredConfig = [
        {
          key: 'pageClientMap',
          label: 'Page → client map',
          help: 'Comma-separated pageId:clientId pairs. Leave a page unmapped to treat its leads as Sahynex prospects.',
        },
      ];
      missing = [
        'META_VERIFY_TOKEN',
        'META_APP_SECRET',
        'META_PAGE_ACCESS_TOKEN',
        'META_GRAPH_VERSION',
      ].filter((k) => !process.env[k]);
    } else if (c.provider === 'whatsapp') {
      setupSteps = whatsappAdapter.setupSteps;
      requiredConfig = whatsappAdapter.requiredConfig;
      missing = whatsappAdapter.checkConfig(conn ?? ({ config: {} } as Connection)).missing;
    } else if (c.provider === 'google_workspace') {
      setupSteps = [
        'In Google Cloud Console, create (or reuse) an OAuth client of type “Web application”.',
        `Add the authorised redirect URI: ${process.env.APP_URL ?? 'https://<your-domain>'}/api/google/callback`,
        'Enable the Gmail API and Google Calendar API. On the OAuth consent screen choose “Internal” if you use Google Workspace (no verification needed); otherwise add each teammate as a test user.',
        'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and APP_URL in the server environment, choose Live, then each person clicks “Connect Google” on their Home page.',
      ];
      missing = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'APP_URL'].filter(
        (k) => !process.env[k],
      );
    } else if (c.provider === 'instagram') {
      setupSteps = instagramAdapter.setupSteps;
      requiredConfig = instagramAdapter.requiredConfig;
      missing = instagramAdapter.checkConfig(conn ?? { config: {} }).missing;
    } else if (c.provider === 'ai_assistant') {
      setupSteps = aiAdapter.setupSteps;
      missing = aiAdapter.checkConfig().missing;
    } else if (c.provider === 'email_smtp') {
      setupSteps = [
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM (and SMTP_SECURE=true for port 465).',
      ];
      missing = ['SMTP_HOST', 'SMTP_FROM'].filter((k) => !process.env[k]);
    } else if (c.provider === 'n8n') {
      setupSteps = [
        'Create a Webhook trigger node in n8n (or a Custom webhook in Make) and copy its production URL.',
        'Set N8N_WEBHOOK_SECRET (16+ random characters) in the server environment; verify X-Sahynex-Signature (HMAC-SHA256 of the raw body) in your workflow.',
        'Paste the URL below, choose Live and save. Use X-Sahynex-Delivery to de-duplicate retries.',
      ];
      requiredConfig = [
        { key: 'webhookUrl', label: 'Webhook URL', help: 'Public https URL of your n8n / Make webhook.' },
      ];
      missing = ['N8N_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
    } else if (c.provider === 'website_forms') {
      setupSteps = [
        'Create an API key below (optionally scoped to a client).',
        'POST JSON to /api/v1/leads with header Authorization: Bearer <key>. See docs/INTEGRATIONS.md for fields.',
      ];
    }
    return { ...c, connection: conn, missing, setupSteps, requiredConfig };
  });
}

export async function configureIntegration(
  actor: Actor,
  provider: Connection['provider'],
  raw: { mode: string; config: Record<string, string>; accountLabel?: string },
) {
  assertCan(actor, 'settings.integrations');
  const input = parse(
    z.object({
      mode: z.enum(['disconnected', 'demo', 'live']),
      config: z.record(z.string(), z.string().max(2000)),
      accountLabel: z.string().max(200).optional(),
    }),
    raw,
  );
  const cat = INTEGRATION_CATALOG.find((c) => c.provider === provider);
  if (!cat) throw invalid('Unknown integration.');
  if (input.mode === 'demo' && !cat.supportsDemo) throw invalid('This integration has no demo mode.');
  if (provider === 'whatsapp' && input.mode !== 'disconnected') {
    const { errors } = parseTemplates(input.config.templates);
    if (errors.length) throw invalid(errors.slice(0, 3).join(' '), { cfg_templates: errors[0] });
  }
  if (provider === 'n8n' && input.mode === 'live') {
    const { assertPublicUrl } = await import('./monitoring');
    if (!input.config.webhookUrl) throw invalid('Enter the webhook URL.');
    await assertPublicUrl(input.config.webhookUrl);
  }
  // Reject anything that looks like a secret being pasted into non-secret config.
  for (const [k, v] of Object.entries(input.config))
    if (/token|secret|password|key$/i.test(k) || /^(EAA|ya29\.|AIza)/.test(v))
      throw invalid(`“${k}” looks like a secret. Secrets belong in the server environment, not here.`);
  const values = {
    mode: input.mode,
    status:
      input.mode === 'disconnected'
        ? ('disconnected' as const)
        : input.mode === 'demo'
          ? ('healthy' as const)
          : ('degraded' as const),
    config: input.config,
    accountLabel: input.accountLabel ?? null,
    lastError: input.mode === 'live' ? 'Not yet tested — press Test connection.' : null,
  };
  const [row] = await db
    .insert(integrationConnections)
    .values({ orgId: actor.orgId, provider, ...values })
    .onConflictDoUpdate({
      target: [integrationConnections.orgId, integrationConnections.provider],
      set: values,
    })
    .returning();
  await audit(db, actor, 'integration.configured', 'integration', row.id, {
    after: { provider, mode: input.mode, config: input.config },
  });
  return row;
}

/** Runs a real health check. Status is only "healthy" when the provider actually responded successfully. */
export async function testIntegration(actor: Actor, provider: Connection['provider']) {
  assertCan(actor, 'settings.integrations');
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.orgId, actor.orgId), eq(integrationConnections.provider, provider)));
  if (!conn || conn.mode === 'disconnected') throw precondition('Configure the integration first.');
  if (conn.mode === 'demo')
    return {
      ok: true,
      message: 'Demo mode — no external connection is made; data is synthetic and labelled DEMO.',
    };
  let result: { ok: boolean; message: string };
  try {
    if (provider === 'meta_ads' || provider === 'google_ads') {
      const a = ADS_ADAPTERS[provider];
      const cfg = a.checkConfig(conn);
      result = cfg.ok
        ? await a.healthCheck(conn)
        : { ok: false, message: `Missing: ${cfg.missing.join(', ')}` };
    } else if (provider === 'ga4') {
      const cfg = ga4Adapter.checkConfig(conn);
      result = cfg.ok
        ? await ga4Adapter.healthCheck(conn)
        : { ok: false, message: `Missing: ${cfg.missing.join(', ')}` };
    } else if (provider === 'whatsapp') {
      const cfg = whatsappAdapter.checkConfig(conn);
      result = cfg.ok
        ? await whatsappAdapter.healthCheck(conn)
        : { ok: false, message: `Missing: ${cfg.missing.join(', ')}` };
    } else if (provider === 'instagram') {
      const cfg = instagramAdapter.checkConfig(conn);
      result = cfg.ok
        ? await instagramAdapter.healthCheck(conn)
        : { ok: false, message: `Missing: ${cfg.missing.join(', ')}` };
    } else if (provider === 'ai_assistant') {
      const cfg = aiAdapter.checkConfig();
      result = cfg.ok
        ? {
            ok: true,
            message: `${aiProvider() === 'gemini' ? 'Gemini' : 'Anthropic'} API key present (model ${aiAdapter.model()}). Generate a brief from Home to confirm it works end to end.`,
          }
        : { ok: false, message: `Missing: ${cfg.missing.join(', ')}` };
    } else if (provider === 'google_workspace') {
      const missing = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'APP_URL'].filter(
        (k) => !process.env[k],
      );
      result = missing.length
        ? { ok: false, message: `Missing: ${missing.join(', ')}` }
        : { ok: true, message: 'OAuth client configured. Each person connects their own account from Home.' };
    } else if (provider === 'email_smtp') {
      const { mailConfigured } = await import('../mailer');
      result = mailConfigured()
        ? { ok: true, message: 'SMTP settings present (send a report to verify delivery).' }
        : { ok: false, message: 'SMTP_HOST / SMTP_FROM not set.' };
    } else if (provider === 'meta_lead_ads') {
      const missing = [
        'META_VERIFY_TOKEN',
        'META_APP_SECRET',
        'META_PAGE_ACCESS_TOKEN',
        'META_GRAPH_VERSION',
      ].filter((k) => !process.env[k]);
      result = missing.length
        ? { ok: false, message: `Missing: ${missing.join(', ')}` }
        : {
            ok: true,
            message: 'Webhook secrets present. Use Meta’s “Test” button on the webhook to verify end-to-end.',
          };
    } else if (provider === 'n8n') {
      result = process.env.N8N_WEBHOOK_SECRET
        ? {
            ok: true,
            message:
              'Secret present and URL is public. Trigger an event (e.g. create a test lead) and check the run log in the Automation centre.',
          }
        : { ok: false, message: 'N8N_WEBHOOK_SECRET is not set.' };
    } else result = { ok: true, message: 'Uses API keys; no external connection to test.' };
  } catch (e) {
    result = { ok: false, message: e instanceof Error ? e.message.slice(0, 500) : String(e) };
  }
  await db
    .update(integrationConnections)
    .set({
      status: result.ok ? 'healthy' : 'error',
      lastHealthCheckAt: new Date(),
      lastError: result.ok ? null : result.message,
    })
    .where(eq(integrationConnections.id, conn.id));
  await audit(db, actor, 'integration.tested', 'integration', conn.id, { after: result });
  return result;
}

/* -------------------------------------------------------- org settings */

export async function updateOrgSettings(
  actor: Actor,
  raw: { name?: string; timezone?: string; settings: unknown },
) {
  assertCan(actor, 'settings.org');
  const parsed = orgSettingsSchema.safeParse(raw.settings);
  if (!parsed.success)
    throw invalid(
      `Invalid settings: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
    );
  if (raw.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: raw.timezone });
    } catch {
      throw invalid('Unknown timezone.');
    }
  }
  const [before] = await db.select().from(organisations).where(eq(organisations.id, actor.orgId));
  await db
    .update(organisations)
    .set({
      settings: parsed.data,
      ...(raw.name ? { name: raw.name } : {}),
      ...(raw.timezone ? { timezone: raw.timezone } : {}),
    })
    .where(eq(organisations.id, actor.orgId));
  await audit(db, actor, 'org.settings_updated', 'organisation', actor.orgId, {
    before: before.settings,
    after: parsed.data,
  });
}

/* ------------------------------------------------------------- audit log */

export async function listAudit(
  actor: Actor,
  f: { q?: string; entityType?: string; page: number; pageSize: number },
) {
  assertCan(actor, 'audit.read');
  const where = and(
    eq(auditLogs.orgId, actor.orgId),
    f.entityType ? eq(auditLogs.entityType, f.entityType) : undefined,
    f.q ? ilike(auditLogs.action, `%${f.q.replace(/[%_]/g, '')}%`) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ a: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.a, actorName: r.actorName })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function userProfile(userId: string) {
  const [p] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, userId));
  return p ?? null;
}

export async function clientContactsForInvite(actor: Actor) {
  assertCan(actor, 'settings.users');
  return db
    .select({
      id: clientContacts.id,
      name: clientContacts.name,
      email: clientContacts.email,
      clientId: clientContacts.clientId,
      clientName: clients.name,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clients.id, clientContacts.clientId))
    .where(
      and(
        eq(clientContacts.orgId, actor.orgId),
        eq(clientContacts.isApprover, true),
        isNull(clientContacts.userId),
        ne(sql`coalesce(${clientContacts.email}, '')`, ''),
      ),
    );
}

/* ------------------------------------------------------------------ KPIs */

export async function listKpis(actor: Actor) {
  const { kpis, kpiRecords } = schema;
  const rows = await db
    .select({ k: kpis, clientName: clients.name })
    .from(kpis)
    .leftJoin(clients, eq(clients.id, kpis.clientId))
    .where(eq(kpis.orgId, actor.orgId))
    .orderBy(asc(kpis.name));
  const ids = rows.map((r) => r.k.id);
  const recs = ids.length
    ? await db
        .select()
        .from(kpiRecords)
        .where(inArray(kpiRecords.kpiId, ids))
        .orderBy(desc(kpiRecords.periodStart))
    : [];
  return rows.map((r) => ({
    ...r.k,
    clientName: r.clientName,
    latest: recs.find((x) => x.kpiId === r.k.id) ?? null,
  }));
}

export async function createKpi(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'settings.org');
  const input = parse(
    z.object({
      key: z.enum(['leads', 'qualified_leads', 'applications', 'admissions', 'custom']),
      name: reqStr(200),
      clientId: optUuid,
      target: z.coerce.number().min(0),
      definition: reqStr(1000),
    }),
    raw,
  );
  const [k] = await db
    .insert(schema.kpis)
    .values({
      orgId: actor.orgId,
      key: input.key,
      name: input.name,
      clientId: input.clientId ?? null,
      target: String(input.target),
      definition: input.definition,
      period: 'monthly',
    })
    .returning();
  await audit(db, actor, 'kpi.created', 'kpi', k.id, { after: { name: k.name, target: k.target } });
  return k;
}

export async function deleteKpi(actor: Actor, id: string) {
  assertCan(actor, 'settings.org');
  const [k] = await db
    .delete(schema.kpis)
    .where(and(eq(schema.kpis.id, id), eq(schema.kpis.orgId, actor.orgId)))
    .returning();
  if (!k) throw notFound('KPI');
  await audit(db, actor, 'kpi.deleted', 'kpi', id, { before: { name: k.name } });
}
