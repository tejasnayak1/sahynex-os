/**
 * Development / demo seed: `npm run db:seed`.
 *
 * Everything created here is DEMO data for fictional organisations, flagged `is_demo` where the table
 * supports it, and the Meta/Google connections are put in explicit DEMO mode. Refuses to run when
 * NODE_ENV=production unless ALLOW_DEMO_SEED=true is set deliberately.
 */
import { addDays, addHours, format, subDays } from 'date-fns';
import { deflateSync } from 'node:zlib';
import { and, eq, sql } from 'drizzle-orm';
import { loadEnv } from '../lib/load-env';

loadEnv();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Sahynex-2026';

/** Builds a simple placeholder PNG (diagonal two-tone poster) so demo deliverables have a visible preview. */
function placeholderPng(
  w: number,
  h: number,
  a: [number, number, number],
  b: [number, number, number],
): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const col = x / w + y / h < 1.1 ? a : b;
      raw.set(col, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG = placeholderPng(800, 1000, [14, 110, 116], [227, 241, 241]);

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true')
    throw new Error('Refusing to seed demo data in production.');
  const { db, getPool, schema } = await import('./index');
  const { bootstrapOrg } = await import('./bootstrap-lib');
  const { hashPassword } = await import('../server/auth/password');
  const { systemActor } = await import('../server/actor');
  const { ingestLead } = await import('../server/services/leads');
  const { demoMetrics } = await import('../server/integrations/adapters');
  const { upsertMetrics } = await import('../server/services/campaigns');
  const { applyTemplate } = await import('../server/services/projects');
  const { putObject } = await import('../server/storage');
  const { drainQueue } = await import('../server/automation/engine');
  const { nextRef } = await import('../server/refs');
  const { generateReport } = await import('../server/services/reports');

  const slug = process.env.ORG_SLUG ?? 'sahynex';
  const { orgId, roleIds } = await bootstrapOrg(db, {
    name: process.env.ORG_NAME ?? 'Sahynex TechSolutions Pvt. Ltd.',
    slug,
  });
  const [{ n: existingDemo }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.clients)
    .where(and(eq(schema.clients.orgId, orgId), eq(schema.clients.isDemo, true)));
  if (existingDemo > 0) {
    console.log('Demo data already present — skipping. (Drop and re-create the database to reseed.)');
    await getPool().end();
    return;
  }
  const r = rng(42);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const hash = await hashPassword(DEMO_PASSWORD);

  /* ------------------------------------------------------------ team */
  const [teamGrowth] = await db
    .insert(schema.teams)
    .values({ orgId, name: 'Growth' })
    .onConflictDoNothing()
    .returning();
  const [teamStudio] = await db
    .insert(schema.teams)
    .values({ orgId, name: 'Studio' })
    .onConflictDoNothing()
    .returning();
  const mk = async (
    email: string,
    name: string,
    role: string,
    extra: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const [u] = await db
      .insert(schema.users)
      .values({ orgId, email, name, passwordHash: hash, roleId: roleIds[role], ...extra })
      .onConflictDoNothing()
      .returning();
    return u ?? (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
  };
  const ceo = await mk('ceo@demo.sahynex.local', 'Asha Rao (Demo CEO)', 'ceo');
  const coo = await mk('coo@demo.sahynex.local', 'Vikram Shenoy (Demo COO)', 'coo', {
    teamId: teamGrowth?.id,
  });
  const sales = await mk('sales@demo.sahynex.local', 'Neha Kamath (Demo Sales)', 'sales', {
    teamId: teamGrowth?.id,
    acceptsLeads: true,
  });
  const sales2 = await mk('bd@demo.sahynex.local', 'Rohan Pai (Demo BD)', 'sales', {
    teamId: teamGrowth?.id,
    acceptsLeads: true,
  });
  const pm = await mk('pm@demo.sahynex.local', 'Divya Bhat (Demo PM)', 'project_manager', {
    teamId: teamStudio?.id,
  });
  const perf = await mk(
    'perf@demo.sahynex.local',
    'Karthik Nayak (Demo Performance)',
    'performance_marketing',
    { teamId: teamGrowth?.id },
  );
  const design = await mk('design@demo.sahynex.local', 'Meera D’Souza (Demo Designer)', 'creative', {
    teamId: teamStudio?.id,
  });
  const video = await mk('video@demo.sahynex.local', 'Arjun Hegde (Demo Video)', 'creative', {
    teamId: teamStudio?.id,
  });
  const emp = await mk('employee@demo.sahynex.local', 'Sneha Prabhu (Demo Developer)', 'employee', {
    teamId: teamStudio?.id,
  });
  for (const [u, cost] of [
    [ceo, null],
    [coo, 120000],
    [sales, 70000],
    [sales2, 60000],
    [pm, 80000],
    [perf, 75000],
    [design, 60000],
    [video, 65000],
    [emp, 70000],
  ] as const)
    await db
      .insert(schema.employeeProfiles)
      .values({
        userId: u.id,
        title: u.name.replace(/.*\(Demo (.*)\)/, '$1'),
        hourlyCostMinor: cost,
        capacityHoursPerWeek: 40,
      })
      .onConflictDoNothing();
  await db.update(schema.automations).set({ ownerId: coo.id }).where(eq(schema.automations.orgId, orgId));
  await db
    .update(schema.automations)
    .set({ ownerId: perf.id })
    .where(
      and(
        eq(schema.automations.orgId, orgId),
        sql`${schema.automations.key} like 'campaign.%' or ${schema.automations.key} = 'monitoring.pages'`,
      ),
    );
  await db
    .update(schema.automations)
    .set({ ownerId: sales.id })
    .where(
      and(
        eq(schema.automations.orgId, orgId),
        sql`${schema.automations.key} like 'sales.%' or ${schema.automations.key} like 'lead.%'`,
      ),
    );

  /* --------------------------------------------------------- clients */
  const clientDefs = [
    {
      name: 'Demo Institute of Technology',
      city: 'Mangaluru',
      services: ['Performance marketing', 'Admissions campaigns', 'Social media'],
      owner: pm.id,
      status: 'active' as const,
    },
    {
      name: 'Demo College of Management',
      city: 'Udupi',
      services: ['Branding', 'Brand film', 'Website'],
      owner: pm.id,
      status: 'active' as const,
    },
    {
      name: 'Demo Coastal Foods Co.',
      city: 'Mangaluru',
      services: ['Social media', 'Performance marketing'],
      owner: pm.id,
      status: 'onboarding' as const,
      orgType: 'company' as const,
    },
  ];
  const clientRows = [];
  for (const c of clientDefs) {
    const [row] = await db
      .insert(schema.clients)
      .values({
        orgId,
        name: c.name,
        city: c.city,
        services: c.services,
        accountOwnerId: c.owner,
        status: c.status,
        orgType: c.orgType ?? 'educational_institution',
        isDemo: true,
        contractStart: format(subDays(new Date(), 120), 'yyyy-MM-dd'),
        contractEnd: format(addDays(new Date(), 245), 'yyyy-MM-dd'),
        renewalDate: format(addDays(new Date(), c.status === 'active' ? 25 : 200), 'yyyy-MM-dd'),
        commercialTerms: 'DEMO — monthly retainer + media pass-through at cost.',
      })
      .returning();
    clientRows.push(row);
  }
  const [dit, dcm, dcf] = clientRows;
  const reviewer = await mk(
    'reviewer@demo-institute.example',
    'Dr. Kavya Shetty (Demo Client Reviewer)',
    'client_reviewer',
    { clientId: dit.id },
  );
  await db.insert(schema.clientContacts).values([
    {
      orgId,
      clientId: dit.id,
      name: 'Dr. Kavya Shetty',
      email: 'reviewer@demo-institute.example',
      designation: 'Admissions Director',
      isPrimary: true,
      isApprover: true,
      userId: reviewer.id,
    },
    {
      orgId,
      clientId: dit.id,
      name: 'Prakash Alva',
      email: 'principal@demo-institute.example',
      designation: 'Principal',
      isApprover: false,
    },
    {
      orgId,
      clientId: dcm.id,
      name: 'Lavanya Kini',
      email: 'marketing@demo-college.example',
      designation: 'Marketing Head',
      isPrimary: true,
      isApprover: true,
    },
  ]);

  /* -------------------------------------------------------- projects */
  const mkProject = async (
    clientId: string,
    name: string,
    ownerId: string,
    template: string,
    startOffset: number,
    status: 'planning' | 'active',
    budget: number,
    revenue: number,
    members: string[],
  ) => {
    const [p] = await db
      .insert(schema.projects)
      .values({
        orgId,
        ref: await nextRef(db, orgId, 'PRJ'),
        clientId,
        name,
        ownerId,
        status,
        isDemo: true,
        startDate: format(subDays(new Date(), -startOffset), 'yyyy-MM-dd'),
        endDate: format(addDays(new Date(), 60 + startOffset), 'yyyy-MM-dd'),
        scope: `DEMO scope for ${name}.`,
        objectives: 'DEMO objectives: qualified enquiries within target CPL; on-time creative delivery.',
        budgetMinor: budget,
        revenueMinor: revenue,
        reportingCadence: 'monthly',
      })
      .returning();
    for (const m of new Set([ownerId, ...members]))
      await db
        .insert(schema.projectMembers)
        .values({ projectId: p.id, userId: m, role: m === ownerId ? 'owner' : 'member' })
        .onConflictDoNothing();
    await applyTemplate(db, orgId, p.id, template, coo.id);
    await db.update(schema.tasks).set({ isDemo: true }).where(eq(schema.tasks.projectId, p.id));
    await db.insert(schema.budgets).values({
      orgId,
      type: 'project',
      clientId,
      projectId: p.id,
      amountMinor: budget,
      periodStart: p.startDate!,
      periodEnd: p.endDate!,
      approvedById: ceo.id,
      approvedAt: new Date(),
      notes: 'DEMO approved budget',
    });
    return p;
  };
  const pAdm = await mkProject(
    dit.id,
    'Admissions 2026 — Engineering UG',
    pm.id,
    'admissions_campaign',
    -21,
    'active',
    6_00_000_00,
    9_00_000_00,
    [perf.id, design.id, video.id],
  );
  const pFilm = await mkProject(
    dcm.id,
    'Campus brand film',
    pm.id,
    'brand_film',
    -5,
    'active',
    4_50_000_00,
    6_00_000_00,
    [video.id, design.id],
  );
  await mkProject(
    dcf.id,
    'Social retainer — onboarding month',
    pm.id,
    'social_retainer_month',
    7,
    'planning',
    1_20_000_00,
    1_80_000_00,
    [design.id, emp.id],
  );
  // Mark some template tasks as done/in progress for realism.
  const admTasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, pAdm.id))
    .orderBy(schema.tasks.startAt);
  for (const [i, t] of admTasks.entries()) {
    if (i < 6)
      await db
        .update(schema.tasks)
        .set({ status: 'done', completedAt: addDays(t.dueAt!, -1) })
        .where(eq(schema.tasks.id, t.id));
    else if (i === 6)
      await db.update(schema.tasks).set({ status: 'in_progress' }).where(eq(schema.tasks.id, t.id));
    else if (i === 7)
      await db
        .update(schema.tasks)
        .set({ status: 'blocked', blockerNote: 'DEMO: waiting for client to confirm thank-you page URL' })
        .where(eq(schema.tasks.id, t.id));
  }
  for (const u of [perf, design, pm])
    await db.insert(schema.timeEntries).values({
      orgId,
      userId: u.id,
      projectId: pAdm.id,
      minutes: 600 + Math.floor(r() * 900),
      workDate: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
      note: 'DEMO time',
    });

  /* ------------------------------------------------------- campaigns */
  const mkCampaign = async (
    clientId: string,
    projectId: string,
    name: string,
    platformKey: 'meta' | 'google_ads',
    ext: string,
    budget: number,
    cpl: number,
    daily: number,
  ) =>
    (
      await db
        .insert(schema.campaigns)
        .values({
          orgId,
          clientId,
          projectId,
          name,
          platform: platformKey,
          externalId: ext,
          objective: platformKey === 'meta' ? 'Lead generation' : 'Search — enquiries',
          status: 'active',
          startDate: format(subDays(new Date(), 60), 'yyyy-MM-dd'),
          budgetMinor: budget,
          cplThresholdMinor: cpl,
          dailySpendThresholdMinor: daily,
          minLeadsForAlert: 10,
          ownerId: perf.id,
          isDemo: true,
          attributionWindow:
            platformKey === 'meta' ? '7-day click, 1-day view' : 'Google Ads default (data-driven)',
        })
        .returning()
    )[0];
  // Budgets are for a 90-day flight; thresholds are in paise (₹1,200 CPL = 1_200_00).
  const cMeta = await mkCampaign(
    dit.id,
    pAdm.id,
    'DEMO · UG Engineering · Meta Lead Ads',
    'meta',
    'demo_meta_1001',
    2_70_000_00,
    1_200_00,
    3_400_00,
  );
  const cGoogle = await mkCampaign(
    dit.id,
    pAdm.id,
    'DEMO · UG Engineering · Google Search',
    'google_ads',
    'demo_gads_2002',
    1_80_000_00,
    1_500_00,
    2_300_00,
  );
  const cBrand = await mkCampaign(
    dcm.id,
    pFilm.id,
    'DEMO · MBA awareness · Meta',
    'meta',
    'demo_meta_1003',
    90_000_00,
    2_000_00,
    1_150_00,
  );
  for (const c of [cMeta, cGoogle, cBrand]) {
    const rows = demoMetrics(
      [c],
      format(subDays(new Date(), 60), 'yyyy-MM-dd'),
      format(subDays(new Date(), 1), 'yyyy-MM-dd'),
    );
    await upsertMetrics(db, orgId, c.id, rows, 'demo');
    await db.update(schema.campaigns).set({ lastSyncedAt: new Date() }).where(eq(schema.campaigns.id, c.id));
    await db.insert(schema.budgets).values({
      orgId,
      type: 'campaign',
      clientId: c.clientId,
      campaignId: c.id,
      amountMinor: c.budgetMinor!,
      periodStart: format(subDays(new Date(), 60), 'yyyy-MM-dd'),
      periodEnd: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      approvedById: ceo.id,
      approvedAt: new Date(),
      notes: 'DEMO media budget',
    });
  }
  for (const provider of ['meta_ads', 'google_ads'] as const)
    await db
      .update(schema.integrationConnections)
      .set({ mode: 'demo', status: 'healthy', accountLabel: 'DEMO account', lastSuccessSyncAt: new Date() })
      .where(
        and(
          eq(schema.integrationConnections.orgId, orgId),
          eq(schema.integrationConnections.provider, provider),
        ),
      );

  // WhatsApp in Demo mode: sends are logged on the lead timeline as "[Demo — not sent]"; nothing leaves.
  await db
    .update(schema.integrationConnections)
    .set({
      mode: 'demo',
      status: 'healthy',
      accountLabel: 'DEMO number',
      config: {
        templates: [
          'admission_followup:en:first_name,institution|Admissions follow-up (demo)',
          'open_day_invite:en:first_name|Open-day invite (demo)',
        ].join('\n'),
      },
    })
    .where(
      and(
        eq(schema.integrationConnections.orgId, orgId),
        eq(schema.integrationConnections.provider, 'whatsapp'),
      ),
    );

  // Briefing sources in Demo mode: sample inbox/calendar, Instagram numbers and a rule-based
  // (not AI) brief — all labelled DEMO on the Home page.
  for (const provider of ['google_workspace', 'instagram', 'ai_assistant'] as const)
    await db
      .insert(schema.integrationConnections)
      .values({ orgId, provider, mode: 'demo', status: 'healthy', accountLabel: 'DEMO' })
      .onConflictDoUpdate({
        target: [schema.integrationConnections.orgId, schema.integrationConnections.provider],
        set: { mode: 'demo', status: 'healthy', accountLabel: 'DEMO' },
      });

  /* ------------------------------------------------------------ leads */
  const sources = ['meta_lead_ads', 'google_ads', 'website', 'referral', 'walk_in', 'instagram_dm'];
  const firstNames = [
    'Aditya',
    'Bhavya',
    'Chaitra',
    'Deepak',
    'Esha',
    'Farhan',
    'Gagan',
    'Harini',
    'Ishaan',
    'Jyothi',
    'Kiran',
    'Lakshmi',
    'Manoj',
    'Nisha',
    'Omkar',
    'Pooja',
    'Rahul',
    'Sahana',
    'Tanvi',
    'Uday',
    'Varsha',
    'Yash',
  ];
  const last = [
    'Shetty',
    'Rao',
    'Kamath',
    'Pai',
    'Bhat',
    'Nayak',
    'Hegde',
    'Acharya',
    'Kini',
    'Salian',
    'Poojary',
    'Fernandes',
  ];
  const programmes = [
    'B.E. Computer Science',
    'B.E. AI & ML',
    'B.E. Electronics',
    'B.E. Mechanical',
    'MBA',
    'B.E. Civil',
  ];
  const leadSources = new Map<string, string>();
  for (const s of sources) {
    const [row] = await db
      .insert(schema.leadSources)
      .values({
        orgId,
        key: s,
        name: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        channel: s,
      })
      .onConflictDoUpdate({ target: [schema.leadSources.orgId, schema.leadSources.key], set: { key: s } })
      .returning();
    leadSources.set(s, row.id);
  }
  const weighted = [
    'meta_lead_ads',
    'meta_lead_ads',
    'meta_lead_ads',
    'meta_lead_ads',
    'meta_lead_ads',
    'google_ads',
    'google_ads',
    'google_ads',
    'website',
    'website',
    'referral',
    'walk_in',
    'instagram_dm',
  ];
  for (let i = 0; i < 320; i++) {
    const daysAgo = Math.floor(r() * 45);
    const created = addHours(subDays(new Date(), daysAgo), -Math.floor(r() * 10));
    const src = pick(weighted);
    const campaign =
      src === 'meta_lead_ads' ? (r() < 0.8 ? cMeta : cBrand) : src === 'google_ads' ? cGoogle : null;
    const client = campaign ? (campaign.clientId === dit.id ? dit : dcm) : dit;
    const fn = pick(firstNames);
    const ln = pick(last);
    const stageRoll = r();
    const stage =
      daysAgo < 1
        ? 'new'
        : stageRoll < 0.15
          ? 'new'
          : stageRoll < 0.55
            ? 'contacted'
            : stageRoll < 0.8
              ? 'qualified'
              : stageRoll < 0.9
                ? 'unqualified'
                : 'lost';
    const qualified = stage === 'qualified';
    const phone = `+9198${String(10000000 + Math.floor(r() * 89999999))}`;
    await db.insert(schema.leads).values({
      orgId,
      ref: await nextRef(db, orgId, 'LD'),
      clientId: client.id,
      name: `${fn} ${ln}`,
      email: `${fn}.${ln}${i}@example.com`.toLowerCase(),
      emailNormalized: `${fn}.${ln}${i}@example.com`.toLowerCase(),
      phone,
      phoneNormalized: phone,
      leadType: 'admission_enquiry',
      interest: client.id === dcm.id ? 'MBA' : pick(programmes.slice(0, 5)),
      city: pick(['Mangaluru', 'Udupi', 'Kundapura', 'Puttur', 'Karwar', 'Bhatkal']),
      sourceId: leadSources.get(src),
      campaignId: campaign?.id ?? null,
      firstTouch: { at: created.toISOString(), source: src, campaign: campaign?.name ?? null },
      latestTouch: { at: created.toISOString(), source: src, campaign: campaign?.name ?? null },
      ownerId: pick([sales.id, sales2.id]),
      stage: stage as 'new',
      qualificationStatus: qualified ? 'qualified' : stage === 'unqualified' ? 'disqualified' : 'pending',
      score: qualified ? 70 + Math.floor(r() * 30) : Math.floor(r() * 55),
      consentMarketing: r() < 0.7,
      consentCapturedAt: created,
      consentSource: src,
      lastContactAt: stage === 'new' ? null : addHours(created, 2),
      nextActionAt:
        stage === 'contacted' || stage === 'qualified' ? addDays(new Date(), Math.floor(r() * 5) - 2) : null,
      nextAction:
        stage === 'contacted'
          ? 'Share fee structure & campus visit dates'
          : stage === 'qualified'
            ? 'Counselling call'
            : null,
      lossReason:
        stage === 'lost'
          ? pick(['Chose another college', 'Not eligible', 'Fees'])
          : stage === 'unqualified'
            ? 'Not eligible for programme'
            : null,
      isDemo: true,
      createdAt: created,
      updatedAt: created,
    });
  }
  // B2B prospects for Sahynex itself.
  const prospects = [
    ['Demo Polytechnic', 'Principal', 'Admissions campaign for diploma intake'],
    ['Demo Nursing College', 'Director', 'Website redesign + social media'],
    ['Demo Hospital Group', 'Marketing Manager', 'Brand film and performance marketing'],
    ['Demo Pre-University College', 'Correspondent', 'Admissions leads for PU science'],
  ];
  for (const [org, title, interest] of prospects) {
    const res = await ingestLead(
      systemActor(orgId, 'Demo seed'),
      {
        name: `${title}, ${org}`,
        organisationName: org,
        email: `${org.toLowerCase().replace(/\W+/g, '.')}@example.org`,
        leadType: 'client_prospect',
        interest,
        sourceKey: pick(['website', 'referral', 'linkedin']),
        consentMarketing: true,
      },
      'demo_seed',
    );
    await db.update(schema.leads).set({ isDemo: true }).where(eq(schema.leads.id, res.lead.id));
  }
  // A flagged duplicate for the review queue.
  await ingestLead(
    systemActor(orgId, 'Demo seed'),
    {
      name: 'Correspondent (different person)',
      organisationName: 'Demo Pre-University College',
      email: 'demo.pre.university.college@example.org',
      phone: '+919845012345',
      leadType: 'client_prospect',
      sourceKey: 'website',
    },
    'demo_seed',
  );

  /* ------------------------------------------------------------ deals */
  const dealDefs: Array<
    [
      string,
      string,
      string,
      number,
      (
        | 'new_prospect'
        | 'qualified'
        | 'discovery_completed'
        | 'proposal_preparation'
        | 'proposal_sent'
        | 'negotiation'
        | 'won'
        | 'lost'
      ),
      string,
    ]
  > = [
    [
      'Demo Polytechnic — diploma admissions',
      'Demo Polytechnic',
      sales.id,
      4_80_000_00,
      'proposal_sent',
      'Performance marketing,Landing page',
    ],
    [
      'Demo Nursing College — website',
      'Demo Nursing College',
      sales2.id,
      3_50_000_00,
      'discovery_completed',
      'Website',
    ],
    [
      'Demo Hospital Group — brand film',
      'Demo Hospital Group',
      sales.id,
      6_00_000_00,
      'negotiation',
      'Brand film',
    ],
    [
      'Demo PU College — admissions',
      'Demo Pre-University College',
      sales2.id,
      2_40_000_00,
      'qualified',
      'Performance marketing',
    ],
    [
      'Demo Arts College — social retainer',
      'Demo Arts College',
      sales.id,
      1_80_000_00,
      'new_prospect',
      'Social media',
    ],
    [
      'Demo Institute — MBA add-on',
      'Demo Institute of Technology',
      sales.id,
      2_00_000_00,
      'won',
      'Performance marketing',
    ],
    ['Demo Law College — rebrand', 'Demo Law College', sales2.id, 5_00_000_00, 'lost', 'Branding'],
  ];
  const probs: Record<string, number> = {
    new_prospect: 10,
    qualified: 20,
    discovery_completed: 35,
    proposal_preparation: 45,
    proposal_sent: 60,
    negotiation: 75,
    won: 100,
    lost: 0,
  };
  for (const [title, prospect, owner, value, stage, services] of dealDefs) {
    const created = subDays(new Date(), 10 + Math.floor(r() * 30));
    const [d] = await db
      .insert(schema.deals)
      .values({
        orgId,
        ref: await nextRef(db, orgId, 'DL'),
        title,
        prospectName: prospect,
        ownerId: owner,
        services: services.split(','),
        valueMinor: value,
        probability: probs[stage],
        stage,
        clientId: prospect === dit.name ? dit.id : null,
        contactName: 'Demo contact',
        contactEmail: `contact@${prospect.toLowerCase().replace(/\W+/g, '-')}.example`,
        expectedCloseDate: format(addDays(new Date(), 10 + Math.floor(r() * 40)), 'yyyy-MM-dd'),
        lastInteractionAt:
          stage === 'discovery_completed'
            ? subDays(new Date(), 18)
            : subDays(new Date(), Math.floor(r() * 6)),
        nextAction: stage === 'won' || stage === 'lost' ? null : 'Follow up',
        nextActionAt: stage === 'won' || stage === 'lost' ? null : addDays(new Date(), 2),
        wonAt: stage === 'won' ? subDays(new Date(), 3) : null,
        closedAt: stage === 'won' || stage === 'lost' ? subDays(new Date(), 3) : null,
        lostReason: stage === 'lost' ? 'Budget moved to next academic year' : null,
        isDemo: true,
        createdAt: created,
      })
      .returning();
    await db
      .insert(schema.dealStageHistory)
      .values({ dealId: d.id, fromStage: null, toStage: stage, actorId: owner, createdAt: created });
    if (['proposal_sent', 'negotiation', 'won'].includes(stage))
      await db.insert(schema.proposals).values({
        orgId,
        dealId: d.id,
        version: 1,
        title: `${title} — proposal`,
        valueMinor: value,
        status: stage === 'won' ? 'accepted' : 'sent',
        sentAt: subDays(new Date(), stage === 'proposal_sent' ? 8 : 15),
        createdById: owner,
        summary: 'DEMO proposal',
      });
    if (stage === 'won')
      await db.insert(schema.handovers).values({
        orgId,
        dealId: d.id,
        status: 'draft',
        projectName: 'MBA admissions add-on',
        scope: 'DEMO: Meta + Google lead generation for MBA intake.',
        proposedOwnerId: pm.id,
        templateKey: 'admissions_campaign',
      });
  }

  /* ---------------------------------------------------- deliverables */
  const mkDeliverable = async (
    projectId: string,
    clientId: string,
    title: string,
    fmt: 'poster' | 'reel' | 'landing_page' | 'brand_film',
    ownerId: string,
    status: 'draft' | 'internal_review' | 'submitted_to_client' | 'approved' | 'published',
    publishIn: number,
  ) => {
    const [d] = await db
      .insert(schema.deliverables)
      .values({
        orgId,
        ref: await nextRef(db, orgId, 'DV'),
        projectId,
        clientId,
        title,
        format: fmt,
        ownerId,
        status: 'draft',
        channel: fmt === 'reel' ? 'Instagram' : fmt === 'poster' ? 'Instagram / print' : 'Web',
        brief: 'DEMO brief',
        dueAt: addDays(new Date(), publishIn - 2),
        publishAt: addDays(new Date(), publishIn),
        isDemo: true,
      })
      .returning();
    if (status === 'draft') return d;
    const stored = await putObject(orgId, PNG, `${title.replace(/\W+/g, '-').toLowerCase()}-v1.png`);
    const [asset] = await db
      .insert(schema.assets)
      .values({
        orgId,
        deliverableId: d.id,
        projectId,
        clientId,
        version: 1,
        uploadedById: ownerId,
        ...stored,
      })
      .returning();
    await db.update(schema.deliverables).set({ currentVersion: 1 }).where(eq(schema.deliverables.id, d.id));
    const [internal] = await db
      .insert(schema.approvals)
      .values({
        orgId,
        deliverableId: d.id,
        version: 1,
        stage: 'internal',
        assetId: asset.id,
        submittedById: ownerId,
        submittedAt: subDays(new Date(), 3),
      })
      .returning();
    if (status === 'internal_review') {
      await db.update(schema.deliverables).set({ status }).where(eq(schema.deliverables.id, d.id));
      return d;
    }
    await db
      .update(schema.approvals)
      .set({
        decision: 'approved',
        decidedById: pm.id,
        decidedAt: subDays(new Date(), 2),
        feedback: 'Looks good.',
      })
      .where(eq(schema.approvals.id, internal.id));
    const [client] = await db
      .insert(schema.approvals)
      .values({
        orgId,
        deliverableId: d.id,
        version: 1,
        stage: 'client',
        assetId: asset.id,
        submittedById: pm.id,
        submittedAt: subDays(new Date(), status === 'submitted_to_client' ? 3 : 2),
      })
      .returning();
    if (status === 'submitted_to_client') {
      await db.update(schema.deliverables).set({ status }).where(eq(schema.deliverables.id, d.id));
      return d;
    }
    await db
      .update(schema.approvals)
      .set({ decision: 'approved', decidedById: reviewer.id, decidedAt: subDays(new Date(), 1) })
      .where(eq(schema.approvals.id, client.id));
    await db
      .update(schema.deliverables)
      .set({
        status,
        finalAssetId: asset.id,
        publishedAt: status === 'published' ? subDays(new Date(), 1) : null,
      })
      .where(eq(schema.deliverables.id, d.id));
    return d;
  };
  await mkDeliverable(pAdm.id, dit.id, 'Admissions open — hero poster', 'poster', design.id, 'published', -1);
  await mkDeliverable(pAdm.id, dit.id, 'Campus life reel (30s)', 'reel', video.id, 'submitted_to_client', 3);
  await mkDeliverable(
    pAdm.id,
    dit.id,
    'Placement highlights poster',
    'poster',
    design.id,
    'internal_review',
    5,
  );
  await mkDeliverable(pAdm.id, dit.id, 'Scholarship announcement poster', 'poster', design.id, 'draft', 9);
  await mkDeliverable(pFilm.id, dcm.id, 'Campus brand film — rough cut', 'brand_film', video.id, 'draft', 20);

  /* -------------------------------------------------- conversions/KPIs */
  for (let i = 0; i < 18; i++)
    await db.insert(schema.conversionEvents).values({
      orgId,
      clientId: dit.id,
      campaignId: pick([cMeta.id, cGoogle.id]),
      type: i < 12 ? 'application' : 'admission',
      occurredAt: subDays(new Date(), Math.floor(r() * 28)),
      verified: i < 15,
      verifiedById: i < 15 ? pm.id : null,
      source: 'DEMO — client admissions office export',
    });
  await db.insert(schema.kpis).values([
    {
      orgId,
      key: 'leads',
      name: 'Monthly enquiries — Demo Institute',
      clientId: dit.id,
      target: '120',
      period: 'monthly',
      definition: 'CRM leads for the client in the month (excluding test leads).',
    },
    {
      orgId,
      key: 'admissions',
      name: 'Monthly admissions — Demo Institute',
      clientId: dit.id,
      target: '10',
      period: 'monthly',
      definition: 'Verified admission conversion events in the month.',
    },
    {
      orgId,
      key: 'leads',
      name: 'Sahynex new prospects',
      target: '15',
      period: 'monthly',
      definition: 'Sahynex sales prospects (leads without a client) created in the month.',
    },
  ]);

  /* ---------------------------------------------------------- finance */
  const inv = [
    [dit.id, pAdm.id, 'DEMO-INV-001', 30, 3_00_000_00, 'paid'],
    [dit.id, pAdm.id, 'DEMO-INV-002', 2, 3_00_000_00, 'sent'],
    [dcm.id, pFilm.id, 'DEMO-INV-003', 40, 3_00_000_00, 'sent'],
  ] as const;
  for (const [clientId, projectId, number, daysAgo, amount, status] of inv)
    await db.insert(schema.invoices).values({
      orgId,
      clientId,
      projectId,
      number,
      issueDate: format(subDays(new Date(), daysAgo), 'yyyy-MM-dd'),
      dueDate: format(subDays(new Date(), daysAgo - 30), 'yyyy-MM-dd'),
      amountMinor: amount,
      taxMinor: Math.round(amount * 0.18),
      status,
      paidMinor: status === 'paid' ? Math.round(amount * 1.18) : 0,
      paidAt: status === 'paid' ? subDays(new Date(), daysAgo - 10) : null,
      isDemo: true,
    });
  await db.insert(schema.expenses).values([
    {
      orgId,
      projectId: pAdm.id,
      clientId: dit.id,
      category: 'freelancer',
      description: 'DEMO — freelance motion designer',
      amountMinor: 45_000_00,
      incurredOn: format(subDays(new Date(), 12), 'yyyy-MM-dd'),
      isDemo: true,
      createdById: coo.id,
    },
    {
      orgId,
      projectId: pFilm.id,
      clientId: dcm.id,
      category: 'production',
      description: 'DEMO — drone & gimbal rental',
      amountMinor: 28_000_00,
      incurredOn: format(subDays(new Date(), 4), 'yyyy-MM-dd'),
      isDemo: true,
      createdById: coo.id,
    },
    {
      orgId,
      projectId: pAdm.id,
      clientId: dit.id,
      category: 'ad_spend_passthrough',
      description: 'DEMO — Meta media spend (billed at cost)',
      amountMinor: 1_20_000_00,
      incurredOn: format(subDays(new Date(), 15), 'yyyy-MM-dd'),
      isPassThrough: true,
      isDemo: true,
      createdById: coo.id,
    },
  ]);

  /* ------------------------------------------------------- monitoring */
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  await db.insert(schema.monitoredPages).values([
    {
      orgId,
      clientId: dit.id,
      campaignId: cMeta.id,
      name: 'DEMO · Admissions landing page (health endpoint)',
      url: `${appUrl}/api/health`,
      expectedStatus: 200,
      expectedText: '"status":"ok"',
      conversionGapHours: 24,
      ownerId: perf.id,
    },
    {
      orgId,
      clientId: dit.id,
      name: 'DEMO · Broken thank-you page (intentionally failing)',
      url: `${appUrl}/demo-broken-thank-you`,
      expectedStatus: 200,
      ownerId: perf.id,
    },
  ]);

  // Run queued automations once so assignment/follow-up tasks exist for seeded live leads.
  await drainQueue(200);
  // A sample report for the demo client (draft — contains DEMO data, cannot be approved for the client).
  const lastMonthEnd = format(
    subDays(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 1),
    'yyyy-MM-dd',
  );
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  await generateReport(
    orgId,
    { type: 'monthly_client', clientId: dit.id, periodStart: lastMonthStart, periodEnd: lastMonthEnd },
    pm.id,
  );

  console.log(`\nDemo data seeded for organisation ${orgId}.`);
  console.log(`Sign in with any demo account, password: ${DEMO_PASSWORD}`);
  console.log(
    '  ceo@demo.sahynex.local · coo@ · sales@ · pm@ · perf@ · design@ · employee@demo.sahynex.local · reviewer@demo-institute.example',
  );
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
