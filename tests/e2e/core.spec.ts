import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('vertical slice: sign in → create lead → automatic owner + follow-up task → dashboard', async ({
  page,
}) => {
  await login(page, 'sales@demo.sahynex.local');
  await page.goto('/leads/new');
  await page.getByLabel('Full name').fill('E2E Prospect');
  await page.getByLabel('Organisation / institution').fill('E2E College');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.org`);
  await page.getByRole('button', { name: 'Create lead' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'E2E Prospect' })).toBeVisible();
  // The worker assigns an owner and creates the follow-up task within a few seconds.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Make first contact: E2E Prospect/)).toBeVisible({ timeout: 1000 });
    await expect(page.getByText(/Auto-assigned to/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByLabel('Lead owner')).not.toHaveValue('');
  // Log a call → contacted, task completed.
  await page.getByLabel('Activity type').selectOption('call');
  await page.getByLabel('What happened').fill('Called the principal; interested in a proposal.');
  await page.getByRole('button', { name: 'Log activity' }).click();
  await expect(page.getByText('Called the principal; interested in a proposal.')).toBeVisible();
  await expect(page.getByLabel('Lead stage')).toHaveValue('contacted');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
});

test('form validation shows actionable errors and keeps input', async ({ page }) => {
  await login(page, 'sales@demo.sahynex.local');
  await page.goto('/leads/new');
  await page.getByLabel('Full name').fill('No Contact Details');
  await page.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/email address or a phone number/i);
  await expect(page.getByLabel('Full name')).toHaveValue('No Contact Details');
});

test('unauthenticated access is refused for pages and APIs', async ({ page, request }) => {
  await page.goto('/finance');
  await expect(page).toHaveURL(/\/login\?next=%2Ffinance/);
  expect((await request.get('/api/search?q=demo')).status()).toBe(401);
  expect((await request.get('/api/files/00000000-0000-0000-0000-000000000000')).status()).toBe(401);
  expect((await request.get('/api/leads/export')).status()).toBe(401);
  expect(
    (await request.post('/api/v1/leads', { data: { name: 'x', email: 'x@example.com' } })).status(),
  ).toBe(401);
  expect((await request.post('/api/cron/tick')).status()).toBe(401);
  const wh = await request.post('/api/webhooks/meta-leads', { data: {} });
  expect([401, 503]).toContain(wh.status());
});

test('employees cannot reach finance or settings they lack, and navigation reflects role', async ({
  page,
}) => {
  await login(page, 'employee@demo.sahynex.local');
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Finance/ }),
  ).toHaveCount(0);
  await page.goto('/finance');
  await expect(page).toHaveURL(/\/forbidden/);
  await page.goto('/settings/users');
  await expect(page).toHaveURL(/\/forbidden/);
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/forbidden/);
});

test('client reviewer sees only their shared work and can approve it', async ({ page }) => {
  await login(page, 'reviewer@demo-institute.example');
  await page.goto('/approvals');
  await expect(page.getByRole('link', { name: 'Campus life reel (30s)' })).toBeVisible();
  await expect(page.getByText('Placement highlights poster')).toHaveCount(0); // still in internal review
  await page.getByRole('link', { name: 'Campus life reel (30s)' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: false }).first()).toBeVisible();
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/forbidden/);
  await page.goto('/campaigns');
  await expect(page).toHaveURL(/\/forbidden/);
});

test('website form API: key → create (201) → duplicate (200) → lead visible in CRM', async ({
  page,
  request,
}) => {
  await login(page, 'ceo@demo.sahynex.local');
  await page.goto('/settings/integrations');
  await page.getByLabel('Key name').fill('E2E landing page');
  await page.getByRole('button', { name: 'Create key' }).click();
  const key = (await page.locator('code.select-all').innerText()).trim();
  expect(key).toMatch(/^sx_live_/);
  const email = `api-${Date.now()}@example.com`;
  const first = await request.post('/api/v1/leads', {
    headers: { Authorization: `Bearer ${key}` },
    data: { name: 'API Person', email, utmSource: 'google', utmCampaign: 'e2e' },
  });
  expect(first.status()).toBe(201);
  const second = await request.post('/api/v1/leads', {
    headers: { Authorization: `Bearer ${key}` },
    data: { name: 'API Person', email },
  });
  expect(second.status()).toBe(200);
  expect((await second.json()).outcome).toBe('updated');
  const bad = await request.post('/api/v1/leads', {
    headers: { Authorization: `Bearer ${key}` },
    data: { name: '' },
  });
  expect(bad.status()).toBe(422);
  await page.goto(`/leads?q=${encodeURIComponent(email)}`);
  await expect(page.getByRole('link', { name: 'API Person' })).toBeVisible();
});

test('keyboard: Ctrl+K search finds permitted records and navigates', async ({ page }) => {
  await login(page, 'ceo@demo.sahynex.local');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('Demo Institute');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/\/dashboard$/);
});

test('handover approval creates a project with tasks', async ({ page }) => {
  await login(page, 'sales@demo.sahynex.local');
  await page.goto('/pipeline?view=list&stage=won');
  await page.getByRole('link', { name: 'Demo Institute — MBA add-on' }).click();
  await page.getByRole('link', { name: 'Handover' }).click();
  await page.getByLabel('Deliverables').fill('8 posters, 2 reels, landing page, monthly report');
  await page.getByLabel('Target start').fill('2026-11-01');
  await page.getByLabel('Target end').fill('2027-01-31');
  await page.getByLabel('Approved budget (₹)').fill('150000');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Awaiting approval')).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'ceo@demo.sahynex.local');
  await page.goto('/dashboard');
  await page.getByRole('link', { name: /Approve handover: MBA admissions add-on/ }).click();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Approve & create project' }).click();
  await expect(async () => {
    await page.reload();
    await page.getByRole('link', { name: 'Open the project' }).click({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'MBA admissions add-on' })).toBeVisible();
  await expect(page.getByText('Kick-off: objectives, intake targets, programmes, budget')).toBeVisible();
});

test('no server secrets are shipped to the browser', async () => {
  const dir = join(process.cwd(), '.next/static');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(dir);
  expect(files.length).toBeGreaterThan(10);
  const needles = [
    'postgres://',
    'SESSION_SECRET',
    'META_ACCESS_TOKEN',
    'META_APP_SECRET',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'SMTP_PASSWORD',
    'N8N_WEBHOOK_SECRET',
    'WHATSAPP_ACCESS_TOKEN',
    'argon2',
    'drizzle-orm',
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const n of needles) expect(src.includes(n), `${n} found in ${f}`).toBe(false);
  }
});
