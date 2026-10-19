import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { clientScope, projectScope } from '../access';
import { audit, diff } from '../audit';
import { invalid, notFound } from '../errors';
import {
  bool,
  optDate,
  optStr,
  optUuid,
  parse,
  reqStr,
  strArray,
  type PageParams,
  type Paged,
} from '../validation';

const { clients, clientContacts, users, projects, campaigns, contracts, deals } = schema;
export type Client = typeof clients.$inferSelect;

const clientSchema = z.object({
  name: reqStr(200),
  legalName: optStr(300),
  orgType: z
    .enum(['educational_institution', 'company', 'media', 'community', 'government', 'other'])
    .default('educational_institution'),
  status: z.enum(['onboarding', 'active', 'paused', 'churned']).default('onboarding'),
  accountOwnerId: optUuid,
  services: strArray.default([]),
  commercialTerms: optStr(10000),
  contractStart: optDate,
  contractEnd: optDate,
  renewalDate: optDate,
  website: optStr(500),
  city: optStr(120),
  notes: optStr(20000),
});

export async function createClient(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'clients.write');
  const input = parse(clientSchema, raw);
  if (input.contractStart && input.contractEnd && input.contractEnd < input.contractStart)
    throw invalid('Contract end must be after start.');
  return db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.orgId, actor.orgId), sql`lower(${clients.name}) = lower(${input.name})`));
    if (dup.length) throw invalid('A client with this name already exists.', { name: 'Already exists' });
    const [c] = await tx
      .insert(clients)
      .values({
        orgId: actor.orgId,
        ...input,
        accountOwnerId: input.accountOwnerId ?? actorUserId(actor),
        legalName: input.legalName ?? null,
      })
      .returning();
    await audit(tx, actor, 'client.created', 'client', c.id, { after: { name: c.name } });
    return c;
  });
}

export async function updateClient(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'clients.write');
  const input = parse(clientSchema.partial(), raw);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), clientScope(actor)))
      .for('update');
    if (!c) throw notFound('Client');
    const patch: Partial<Client> = {};
    for (const k of Object.keys(input) as (keyof typeof input)[])
      if (k in raw) (patch as Record<string, unknown>)[k] = input[k] ?? null;
    if ('services' in raw) patch.services = input.services ?? [];
    if (
      'accountOwnerId' in patch &&
      patch.accountOwnerId !== c.accountOwnerId &&
      !can(actor, 'clients.read.all')
    )
      throw invalid('Only operations leads can change the account owner.');
    const d = diff(c as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!d.changed) return c;
    const [u] = await tx.update(clients).set(patch).where(eq(clients.id, id)).returning();
    await audit(tx, actor, 'client.updated', 'client', id, { before: d.before, after: d.after });
    return u;
  });
}

const contactSchema = z.object({
  name: reqStr(200),
  email: optStr(320),
  phone: optStr(40),
  designation: optStr(200),
  isPrimary: bool.default(false),
  isApprover: bool.default(false),
});

export async function addContact(actor: Actor, clientId: string, raw: Record<string, unknown>) {
  assertCan(actor, 'clients.write');
  const input = parse(contactSchema, raw);
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw invalid('Invalid email.', { email: 'Invalid' });
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), clientScope(actor)));
    if (!c) throw notFound('Client');
    if (input.isPrimary)
      await tx.update(clientContacts).set({ isPrimary: false }).where(eq(clientContacts.clientId, clientId));
    const [ct] = await tx
      .insert(clientContacts)
      .values({
        orgId: actor.orgId,
        clientId,
        ...input,
        email: input.email ?? null,
        phone: input.phone ?? null,
        designation: input.designation ?? null,
      })
      .returning();
    await audit(tx, actor, 'client.contact_added', 'client', clientId, {
      after: { name: ct.name, isApprover: ct.isApprover },
    });
    return ct;
  });
}

export async function removeContact(actor: Actor, contactId: string) {
  assertCan(actor, 'clients.write');
  await db.transaction(async (tx) => {
    const [ct] = await tx
      .select({ id: clientContacts.id, clientId: clientContacts.clientId })
      .from(clientContacts)
      .innerJoin(clients, eq(clients.id, clientContacts.clientId))
      .where(and(eq(clientContacts.id, contactId), clientScope(actor)));
    if (!ct) throw notFound('Contact');
    await tx.delete(clientContacts).where(eq(clientContacts.id, contactId));
    await audit(tx, actor, 'client.contact_removed', 'client', ct.clientId, { before: { contactId } });
  });
}

export type ClientFilters = PageParams & { status?: string; ownerId?: string; renewalWithinDays?: number };

export async function listClients(
  actor: Actor,
  f: ClientFilters,
): Promise<Paged<Client & { ownerName: string | null; activeProjects: number }>> {
  const conds: (SQL | undefined)[] = [clientScope(actor)];
  if (f.q)
    conds.push(
      or(
        ilike(clients.name, `%${f.q.replace(/[%_]/g, '')}%`),
        ilike(clients.city, `%${f.q.replace(/[%_]/g, '')}%`),
      ),
    );
  if (f.status) conds.push(eq(clients.status, f.status as Client['status']));
  if (f.ownerId) conds.push(eq(clients.accountOwnerId, f.ownerId));
  if (f.renewalWithinDays)
    conds.push(
      sql`${clients.renewalDate} <= current_date + ${f.renewalWithinDays}::int and ${clients.renewalDate} >= current_date`,
    );
  const where = and(...conds);
  const sortCol =
    { name: clients.name, renewal: clients.renewalDate, createdAt: clients.createdAt }[f.sort ?? 'name'] ??
    clients.name;
  const active = sql<number>`(select count(*)::int from ${projects} p where p.client_id = ${clients.id} and p.status = 'active' and p.deleted_at is null)`;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ c: clients, ownerName: users.name, activeProjects: active })
      .from(clients)
      .leftJoin(users, eq(users.id, clients.accountOwnerId))
      .where(where)
      .orderBy(f.dir === 'desc' ? sql`${sortCol} desc nulls last` : sql`${sortCol} asc nulls last`)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(clients)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.c, ownerName: r.ownerName, activeProjects: r.activeProjects })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getClient(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Client');
  const [r] = await db
    .select({ c: clients, ownerName: users.name })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.accountOwnerId))
    .where(and(eq(clients.id, id), clientScope(actor)));
  if (!r) throw notFound('Client');
  const [contacts, projs, camps, ctrs, dealRows] = await Promise.all([
    db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, id))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.name)),
    db
      .select({ p: projects, ownerName: users.name })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.ownerId))
      .where(and(eq(projects.clientId, id), projectScope(actor)))
      .orderBy(desc(projects.createdAt)),
    can(actor, 'campaigns.read')
      ? db.select().from(campaigns).where(eq(campaigns.clientId, id)).orderBy(desc(campaigns.createdAt))
      : Promise.resolve([]),
    can(actor, 'projects.commercials')
      ? db.select().from(contracts).where(eq(contracts.clientId, id)).orderBy(desc(contracts.startDate))
      : Promise.resolve([]),
    can(actor, 'deals.read.all')
      ? db
          .select()
          .from(deals)
          .where(and(eq(deals.clientId, id), isNull(deals.deletedAt)))
          .orderBy(desc(deals.createdAt))
      : Promise.resolve([]),
  ]);
  return {
    client: r.c,
    ownerName: r.ownerName,
    contacts,
    projects: projs.map((p) => ({ ...p.p, ownerName: p.ownerName })),
    campaigns: camps,
    contracts: ctrs,
    deals: dealRows,
  };
}

export async function clientOptions(actor: Actor) {
  return db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(clientScope(actor))
    .orderBy(asc(clients.name))
    .limit(500);
}

export async function upcomingRenewals(actor: Actor, days = 60) {
  return db
    .select({ id: clients.id, name: clients.name, renewalDate: clients.renewalDate, ownerName: users.name })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.accountOwnerId))
    .where(
      and(
        clientScope(actor),
        sql`${clients.renewalDate} between current_date and current_date + ${days}::int`,
        inArray(clients.status, ['active', 'onboarding']),
      ),
    )
    .orderBy(asc(clients.renewalDate));
}
