import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { actorUserId, assertCan, type Actor } from '../actor';
import { projectScope } from '../access';
import { audit } from '../audit';
import { invalid, notFound, precondition } from '../errors';
import { bool, optMoney, optStr, optUuid, parse, reqStr } from '../validation';

const {
  budgets,
  expenses,
  invoices,
  clients,
  projects,
  campaigns,
  timeEntries,
  employeeProfiles,
  users,
  campaignMetrics,
} = schema;

/* --------------------------------------------------------------- budgets */

const budgetSchema = z.object({
  type: z.enum(['project', 'campaign', 'client_retainer']),
  clientId: optUuid,
  projectId: optUuid,
  campaignId: optUuid,
  amount: optMoney,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  notes: optStr(2000),
});

export async function createBudget(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'finance.write');
  const input = parse(budgetSchema, raw);
  if (input.amount === undefined) throw invalid('Enter an amount.', { amount: 'Required' });
  if (input.periodEnd < input.periodStart) throw invalid('Period end must be after the start.');
  if (input.type === 'project' && !input.projectId)
    throw invalid('Choose a project.', { projectId: 'Required' });
  if (input.type === 'campaign' && !input.campaignId)
    throw invalid('Choose a campaign.', { campaignId: 'Required' });
  let clientId = input.clientId ?? null;
  if (input.projectId)
    clientId =
      (
        await db
          .select({ c: projects.clientId })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId)))
      )[0]?.c ?? null;
  if (input.campaignId)
    clientId =
      (
        await db
          .select({ c: campaigns.clientId })
          .from(campaigns)
          .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.orgId, actor.orgId)))
      )[0]?.c ?? null;
  if (!clientId) throw invalid('Choose a client, project or campaign.');
  const [b] = await db
    .insert(budgets)
    .values({
      orgId: actor.orgId,
      type: input.type,
      clientId,
      projectId: input.projectId ?? null,
      campaignId: input.campaignId ?? null,
      amountMinor: input.amount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      notes: input.notes ?? null,
    })
    .returning();
  await audit(db, actor, 'budget.created', 'budget', b.id, {
    after: { amountMinor: b.amountMinor, type: b.type },
  });
  return b;
}

/** Approval of a budget is a consequential commercial action: requires deals.approve_commercials. */
export async function approveBudget(actor: Actor, id: string) {
  assertCan(actor, 'finance.write', 'deals.approve_commercials');
  const [b] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.orgId, actor.orgId)));
  if (!b) throw notFound('Budget');
  if (b.approvedAt) throw precondition('Already approved.');
  await db
    .update(budgets)
    .set({ approvedAt: new Date(), approvedById: actorUserId(actor) })
    .where(eq(budgets.id, id));
  await audit(db, actor, 'budget.approved', 'budget', id, { after: { amountMinor: b.amountMinor } });
}

export async function listBudgets(actor: Actor) {
  assertCan(actor, 'finance.read');
  return db
    .select({
      b: budgets,
      clientName: clients.name,
      projectName: projects.name,
      campaignName: campaigns.name,
    })
    .from(budgets)
    .leftJoin(clients, eq(clients.id, budgets.clientId))
    .leftJoin(projects, eq(projects.id, budgets.projectId))
    .leftJoin(campaigns, eq(campaigns.id, budgets.campaignId))
    .where(eq(budgets.orgId, actor.orgId))
    .orderBy(desc(budgets.periodStart))
    .limit(300);
}

/** Campaign budget vs actual spend (platform-reported) for the budget period. */
export async function campaignBudgetVsActual(actor: Actor) {
  assertCan(actor, 'finance.read');
  return db
    .select({
      budgetId: budgets.id,
      campaignName: campaigns.name,
      clientName: clients.name,
      amountMinor: budgets.amountMinor,
      periodStart: budgets.periodStart,
      periodEnd: budgets.periodEnd,
      approved: sql<boolean>`${budgets.approvedAt} is not null`,
      spentMinor: sql<
        number | null
      >`(select sum(m.spend_minor)::bigint from ${campaignMetrics} m where m.campaign_id = ${budgets.campaignId} and m.date between ${budgets.periodStart} and ${budgets.periodEnd})`,
    })
    .from(budgets)
    .innerJoin(campaigns, eq(campaigns.id, budgets.campaignId))
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .where(and(eq(budgets.orgId, actor.orgId), eq(budgets.type, 'campaign')))
    .orderBy(desc(budgets.periodStart));
}

/* -------------------------------------------------------------- expenses */

const expenseSchema = z.object({
  projectId: optUuid,
  clientId: optUuid,
  category: z.enum(['ad_spend_passthrough', 'production', 'freelancer', 'software', 'travel', 'other']),
  description: reqStr(300),
  vendor: optStr(200),
  amount: optMoney,
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  isPassThrough: bool.default(false),
});

export async function createExpense(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'finance.write');
  const input = parse(expenseSchema, raw);
  if (input.amount === undefined || input.amount <= 0)
    throw invalid('Enter an amount.', { amount: 'Required' });
  let clientId = input.clientId ?? null;
  if (input.projectId) {
    const [p] = await db
      .select({ c: projects.clientId })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.orgId, actor.orgId)));
    if (!p) throw invalid('Unknown project.');
    clientId = p.c;
  }
  const [e] = await db
    .insert(expenses)
    .values({
      orgId: actor.orgId,
      projectId: input.projectId ?? null,
      clientId,
      category: input.category,
      description: input.description,
      vendor: input.vendor ?? null,
      amountMinor: input.amount,
      incurredOn: input.incurredOn,
      isPassThrough: input.category === 'ad_spend_passthrough' ? true : input.isPassThrough,
      createdById: actorUserId(actor),
    })
    .returning();
  await audit(db, actor, 'expense.created', 'expense', e.id, {
    after: { amountMinor: e.amountMinor, category: e.category },
  });
  return e;
}

export async function listExpenses(actor: Actor) {
  assertCan(actor, 'finance.read');
  return db
    .select({ e: expenses, clientName: clients.name, projectName: projects.name })
    .from(expenses)
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .where(eq(expenses.orgId, actor.orgId))
    .orderBy(desc(expenses.incurredOn))
    .limit(300);
}

/* -------------------------------------------------------------- invoices */

const invoiceSchema = z.object({
  clientId: z.string().uuid('Choose a client'),
  projectId: optUuid,
  number: reqStr(60),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  amount: optMoney,
  tax: optMoney,
  passThrough: optMoney,
  notes: optStr(2000),
});

export async function createInvoice(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'finance.write');
  const input = parse(invoiceSchema, raw);
  if (input.amount === undefined) throw invalid('Enter the fee amount.', { amount: 'Required' });
  if (input.dueDate < input.issueDate) throw invalid('Due date must be on or after the issue date.');
  const [c] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), eq(clients.orgId, actor.orgId)));
  if (!c) throw invalid('Unknown client.');
  const ins = await db
    .insert(invoices)
    .values({
      orgId: actor.orgId,
      clientId: input.clientId,
      projectId: input.projectId ?? null,
      number: input.number,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      amountMinor: input.amount,
      taxMinor: input.tax ?? 0,
      passThroughMinor: input.passThrough ?? 0,
      notes: input.notes ?? null,
      status: 'draft',
    })
    .onConflictDoNothing()
    .returning();
  if (!ins[0]) throw invalid('An invoice with this number already exists.', { number: 'Duplicate' });
  await audit(db, actor, 'invoice.created', 'invoice', ins[0].id, {
    after: { number: input.number, amountMinor: input.amount },
  });
  return ins[0];
}

/** Records invoice status / payments. This only tracks money; it never moves money. */
export async function updateInvoiceStatus(actor: Actor, id: string, raw: { status: string; paid?: unknown }) {
  assertCan(actor, 'finance.write');
  const input = parse(
    z.object({
      status: z.enum(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void']),
      paid: optMoney,
    }),
    raw,
  );
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.orgId, actor.orgId)));
  if (!inv) throw notFound('Invoice');
  const total = inv.amountMinor + inv.taxMinor + inv.passThroughMinor;
  const paid = input.status === 'paid' ? total : (input.paid ?? inv.paidMinor);
  if (paid > total) throw invalid('Paid amount cannot exceed the invoice total.');
  if (input.status === 'partially_paid' && (paid <= 0 || paid >= total))
    throw invalid('Enter the amount received so far (less than the total).');
  await db
    .update(invoices)
    .set({ status: input.status, paidMinor: paid, paidAt: input.status === 'paid' ? new Date() : inv.paidAt })
    .where(eq(invoices.id, id));
  await audit(db, actor, 'invoice.status_changed', 'invoice', id, {
    before: { status: inv.status, paidMinor: inv.paidMinor },
    after: { status: input.status, paidMinor: paid },
  });
}

export async function listInvoices(actor: Actor) {
  assertCan(actor, 'finance.read');
  // Mark overdue on read (sent/partially paid past due date) so the list is always accurate.
  await db
    .update(invoices)
    .set({ status: 'overdue' })
    .where(
      and(
        eq(invoices.orgId, actor.orgId),
        inArray(invoices.status, ['sent', 'partially_paid']),
        sql`${invoices.dueDate} < current_date`,
      ),
    );
  return db
    .select({ i: invoices, clientName: clients.name, projectName: projects.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(eq(invoices.orgId, actor.orgId))
    .orderBy(desc(invoices.issueDate))
    .limit(300);
}

/* --------------------------------------------------------- profitability */

/**
 * Project profitability. Revenue = agency fees on non-void invoices for the project (excludes tax and
 * pass-through). Costs = non-pass-through expenses + labour (minutes × hourly cost) where configured.
 * The result is flagged as an ESTIMATE whenever any cost input is missing.
 */
export async function projectProfitability(actor: Actor) {
  assertCan(actor, 'finance.read');
  const rows = await db
    .select({
      id: projects.id,
      ref: projects.ref,
      name: projects.name,
      clientName: clients.name,
      status: projects.status,
      budgetMinor: projects.budgetMinor,
      contractMinor: projects.revenueMinor,
      invoicedMinor: sql<number>`coalesce((select sum(i.amount_minor) from ${invoices} i where i.project_id = ${projects.id} and i.status <> 'void'),0)::bigint`,
      expenseMinor: sql<number>`coalesce((select sum(e.amount_minor) from ${expenses} e where e.project_id = ${projects.id} and not e.is_pass_through),0)::bigint`,
      passThroughMinor: sql<number>`coalesce((select sum(e.amount_minor) from ${expenses} e where e.project_id = ${projects.id} and e.is_pass_through),0)::bigint`,
      labourMinor: sql<number>`coalesce((select sum(t.minutes * ep.hourly_cost_minor / 60.0) from ${timeEntries} t join ${employeeProfiles} ep on ep.user_id = t.user_id where t.project_id = ${projects.id} and ep.hourly_cost_minor is not null),0)::bigint`,
      minutesLogged: sql<number>`coalesce((select sum(t.minutes) from ${timeEntries} t where t.project_id = ${projects.id}),0)::int`,
      minutesWithoutRate: sql<number>`coalesce((select sum(t.minutes) from ${timeEntries} t left join ${employeeProfiles} ep on ep.user_id = t.user_id where t.project_id = ${projects.id} and ep.hourly_cost_minor is null),0)::int`,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(projectScope(actor), inArray(projects.status, ['planning', 'active', 'on_hold', 'completed'])))
    .orderBy(asc(clients.name), asc(projects.name));
  return rows.map((r) => {
    const revenue = Number(r.invoicedMinor);
    const costs = Number(r.expenseMinor) + Number(r.labourMinor);
    const caveats: string[] = [];
    if (r.minutesLogged === 0) caveats.push('No time logged — labour cost excluded');
    else if (r.minutesWithoutRate > 0)
      caveats.push(`${Math.round(r.minutesWithoutRate / 60)}h logged by people without an hourly cost`);
    if (revenue === 0) caveats.push('Nothing invoiced yet');
    return {
      ...r,
      invoicedMinor: revenue,
      expenseMinor: Number(r.expenseMinor),
      passThroughMinor: Number(r.passThroughMinor),
      labourMinor: Number(r.labourMinor),
      grossMarginMinor: revenue ? revenue - costs : null,
      grossMarginPct: revenue ? (revenue - costs) / revenue : null,
      isEstimate: caveats.length > 0,
      caveats,
    };
  });
}

export async function financeSummary(actor: Actor) {
  assertCan(actor, 'finance.read');
  const [inv] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.amountMinor} + ${invoices.taxMinor} + ${invoices.passThroughMinor} - ${invoices.paidMinor}) filter (where ${invoices.status} in ('sent','partially_paid','overdue')),0)::bigint`,
      overdue: sql<number>`coalesce(sum(${invoices.amountMinor} + ${invoices.taxMinor} + ${invoices.passThroughMinor} - ${invoices.paidMinor}) filter (where ${invoices.status} = 'overdue' or (${invoices.status} in ('sent','partially_paid') and ${invoices.dueDate} < current_date)),0)::bigint`,
      feesThisMonth: sql<number>`coalesce(sum(${invoices.amountMinor}) filter (where ${invoices.status} <> 'void' and date_trunc('month', ${invoices.issueDate}) = date_trunc('month', current_date)),0)::bigint`,
    })
    .from(invoices)
    .where(eq(invoices.orgId, actor.orgId));
  return {
    outstandingMinor: Number(inv.outstanding),
    overdueMinor: Number(inv.overdue),
    feesThisMonthMinor: Number(inv.feesThisMonth),
  };
}

export async function setHourlyCost(actor: Actor, userId: string, hourly: unknown, capacity?: unknown) {
  assertCan(actor, 'finance.write');
  const input = parse(
    z.object({
      hourly: optMoney,
      capacity: z.preprocess(
        (v) => (v === '' || v == null ? undefined : Number(v)),
        z.number().int().min(0).max(80).optional(),
      ),
    }),
    { hourly, capacity },
  );
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, actor.orgId)));
  if (!u) throw notFound('User');
  await db
    .insert(employeeProfiles)
    .values({
      userId,
      hourlyCostMinor: input.hourly ?? null,
      ...(input.capacity !== undefined ? { capacityHoursPerWeek: input.capacity } : {}),
    })
    .onConflictDoUpdate({
      target: employeeProfiles.userId,
      set: {
        hourlyCostMinor: input.hourly ?? null,
        ...(input.capacity !== undefined ? { capacityHoursPerWeek: input.capacity } : {}),
      },
    });
  await audit(db, actor, 'employee.cost_updated', 'user', userId, {
    after: { hourlyCostMinor: '[redacted]' },
  });
}
