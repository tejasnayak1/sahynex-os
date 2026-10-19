import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('search applies as you type, with the filter kept in the URL', async ({ page }) => {
  await login(page, 'sales@demo.sahynex.local');
  await page.goto('/leads');
  const firstName = (await page.locator('tbody tr td a').first().innerText()).split(' ')[0];
  await page.getByRole('searchbox', { name: 'Search' }).fill(firstName);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(firstName)}`));
  await expect(page.locator('tbody tr').first()).toContainText(firstName);
  // Other filters sit behind the Filters toggle (open automatically once a filter is active).
  await page.getByText('Hide filters').waitFor({ state: 'attached' });
  if (!(await page.getByRole('combobox', { name: 'Stage' }).isVisible()))
    await page.getByText('Filters', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Stage' }).selectOption('new');
  await expect(page).toHaveURL(/stage=new/);
});

test('bulk-edit selected tasks from the list, and edit a status inline', async ({ page }) => {
  await login(page, 'coo@demo.sahynex.local');
  await page.goto('/tasks');
  const rows = page.locator('tbody tr');
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('combobox', { name: 'Set priority of selected tasks' }).selectOption('urgent');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Apply to selected' }).click();
  // Rows that were already urgent are reported as "already matched", not re-written.
  await expect(page.getByText(/task\(s\) updated/)).toBeVisible();
  await expect(rows.nth(0).getByRole('combobox', { name: /^Priority of/ })).toHaveValue('urgent');
  await expect(rows.nth(1).getByRole('combobox', { name: /^Priority of/ })).toHaveValue('urgent');

  const status = rows.nth(2).getByRole('combobox', { name: /^Status of/ });
  await status.selectOption('in_review');
  await expect(page.getByText('Status updated')).toBeVisible();
  await expect(status).toHaveValue('in_review');
});

test('schedule a discovery meeting from a deal and download the calendar invite', async ({ page }) => {
  await login(page, 'sales@demo.sahynex.local');
  await page.goto('/pipeline?view=list');
  await page.getByRole('link', { name: 'Demo PU College — admissions' }).click();
  await page.getByRole('button', { name: 'Schedule meeting' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule a meeting' });
  await dialog.getByLabel('Location or video link').fill('https://meet.example.com/e2e');
  await dialog.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.getByText(/Meeting scheduled and added to your calendar/)).toBeVisible();
  await expect(page.getByText('Discovery meeting — Demo Pre-University College').first()).toBeVisible();
  const href = await page.getByRole('link', { name: 'Download invite (.ics)' }).first().getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('METHOD:REQUEST');
  // Not reachable without a session.
  const anon = await page.context().browser()!.newContext({ baseURL: 'http://localhost:3100' });
  expect((await anon.request.get(href!)).status()).toBe(401);
  await anon.close();
});
