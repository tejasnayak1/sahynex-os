import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('login: cover page, password toggle, remember me, honest errors, no fake sign-in methods', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: /Ideas today\. Greater outcomes tomorrow\./ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  for (const o of ['Plan', 'Execute', 'Track', 'Grow'])
    await expect(page.getByText(o, { exact: false }).first()).toBeVisible();
  // Google appears only when it is configured; Microsoft is never shown (not implemented).
  await expect(page.getByRole('link', { name: /Sign in with Google/ })).toHaveCount(0);
  await expect(page.getByText(/Microsoft/)).toHaveCount(0);
  await expect(page.getByLabel('Remember me')).toBeChecked();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText(/reset by your administrator/)).toBeVisible();

  const pw = page.getByLabel('Password', { exact: true });
  await pw.fill('wrong-password');
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(pw).toHaveAttribute('type', 'text');
  await page.getByLabel('Work email').fill('ceo@demo.sahynex.local');
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page.getByText(/incorrect/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expect(page).not.toHaveURL(/password=/);
});

test('tasks board: drag to a new column persists; a refused move snaps back with the reason', async ({
  page,
}) => {
  await login(page, 'ceo@demo.sahynex.local');
  // A fresh task with an early due date, so it sits at the top of To do.
  const title = `E2E drag me ${Date.now()}`;
  await page.goto('/tasks/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Due').fill('2026-01-01T10:00');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await page.goto('/tasks?view=board');
  const todo = page.locator('section[data-col=todo]');
  const card = todo.locator('li[tabindex="0"]', { hasText: title });

  const drag = async (from: typeof card, to: string) => {
    await expect(from).toBeVisible();
    await from.scrollIntoViewIfNeeded();
    const b = (await from.boundingBox())!;
    const d = (await page.locator(`section[data-col=${to}]`).boundingBox())!;
    await page.mouse.move(b.x + 30, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 40, { steps: 4 });
    await page.mouse.move(d.x + d.width / 2, d.y + 80, { steps: 10 });
    await page.mouse.up();
  };

  await drag(card, 'in_progress');
  await expect(
    page.locator('section[data-col=in_progress]').getByRole('link', { name: title }),
  ).toBeVisible();
  await expect(page.getByText('Task moved to In progress!')).toBeVisible();
  await page.reload();
  await expect(
    page.locator('section[data-col=in_progress]').getByRole('link', { name: title }),
  ).toBeVisible();

  // This task waits on an unfinished dependency, so the server refuses and the card returns.
  const waiting = todo.locator('li[tabindex="0"]', { hasText: 'Week-1 optimisation review' }).first();
  // (moved with the keyboard: Space to pick up, arrows to choose Done, Space to drop)
  await waiting.focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.getByText(/Waiting on/).first()).toBeVisible();
  await expect(todo.getByRole('link', { name: 'Week-1 optimisation review' }).first()).toBeVisible();
  await page.reload();
  await expect(todo.getByRole('link', { name: 'Week-1 optimisation review' }).first()).toBeVisible();

  // Keyboard alternative and the sound toggle (off by default, remembered).
  await expect(page.getByRole('switch', { name: /Sound off/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: /Sound off/ }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: /Sound on/ })).toHaveAttribute('aria-checked', 'true');
  const k = page.locator('section[data-col=in_progress] li[tabindex="0"]', { hasText: title });
  await k.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(todo.getByRole('link', { name: title })).toBeVisible();
});

test('client details: budgets save with their period; contacts edit in place', async ({ page }) => {
  await login(page, 'ceo@demo.sahynex.local');
  await page.goto('/clients');
  await page.locator('table a[href^="/clients/"]').first().click();
  await expect(page.getByRole('heading', { name: 'Marketing and branding budget' })).toBeVisible();
  for (const t of ['Overview', 'Projects', 'Tasks', 'Documents', 'Activity'])
    await expect(
      page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: t }),
    ).toBeVisible();

  await page.getByRole('button', { name: 'Edit marketing budget' }).click();
  const dlg = page.getByRole('dialog', { name: 'Marketing budget' });
  await dlg.getByLabel('Marketing budget', { exact: true }).fill('250000');
  await dlg.getByLabel('Marketing budget period').selectOption('monthly');
  await dlg.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText('Budgets saved').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('₹ 2,50,000').first()).toBeVisible();
  await expect(page.getByText('per month').first()).toBeVisible();
  // Inline period change keeps the amount.
  await page.getByLabel('Marketing budget period').selectOption('annual');
  await expect(page.getByText('Budgets saved').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('per year').first()).toBeVisible();
  await expect(page.getByText('₹ 2,50,000').first()).toBeVisible();

  // Notes timeline
  await page.getByRole('button', { name: 'Add note' }).click();
  const note = page.getByRole('dialog', { name: 'Add note' });
  await note.getByLabel('Title').fill('E2E budget discussion');
  await note.getByLabel('Note').fill('Discussed Q4 plan.');
  await note.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('E2E budget discussion').first()).toBeVisible();

  const who = `E2E Contact ${Date.now()}`;
  await page.getByRole('button', { name: 'Add contact' }).click();
  const add = page.getByRole('dialog', { name: 'Add contact' });
  await add.getByLabel('Name').fill(who);
  await add.getByLabel('Email').fill('e2e.contact@example.edu');
  await add.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByText('Contact added').first()).toBeVisible();

  await page.getByRole('button', { name: `Edit ${who}` }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${who}` });
  await edit.getByLabel('Designation').fill('Principal');
  await edit.getByLabel('Designated approver').check();
  await edit.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByText('Contact saved').first()).toBeVisible();
  await page.reload();
  const card = page.locator('li', { hasText: who });
  await expect(card.getByText('Principal', { exact: true })).toBeVisible();
  await expect(card.getByText('Approver')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('content: AI Creative Studio reviews the brief; only the person creates the deliverable', async ({
  page,
}) => {
  await login(page, 'ceo@demo.sahynex.local');
  await page.goto('/content/new');
  await expect(page.getByRole('heading', { name: 'AI Creative Studio' })).toBeVisible();
  await page.getByLabel('Project').selectOption({ index: 1 });
  await page.getByRole('radio', { name: 'Video' }).click();
  await page.getByLabel('Title').fill('E2E admissions reel');
  await page.locator('#brief').fill('Hook (first 3s):\nStory beats: campus life\nCTA:');
  const briefBefore = await page.locator('#brief').inputValue();
  await page.getByRole('button', { name: 'Generate AI suggestions' }).click();
  // The seed runs the AI assistant in Demo mode: a labelled, rule-based review.
  await expect(page.getByText('Sample · written by rules')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Brief analysis' })).toBeVisible();
  expect(await page.locator('#brief').inputValue()).toBe(briefBefore); // never changed by the AI
  await page.getByRole('button', { name: 'Create deliverable' }).click();
  await expect(page).toHaveURL(/\/content\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'E2E admissions reel' })).toBeVisible();
});
