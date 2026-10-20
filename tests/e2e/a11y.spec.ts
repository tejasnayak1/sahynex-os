import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PAGES = [
  '/home',
  '/dashboard',
  '/leads',
  '/pipeline',
  '/projects',
  '/tasks',
  '/tasks?view=board',
  '/campaigns',
  '/content',
  '/approvals',
  '/reports',
  '/automation',
  '/finance',
  '/settings/users',
  '/leads/new',
  '/content/new',
  '/clients',
  '/home/insights',
];

test('key pages have no serious or critical WCAG 2.x A/AA violations', async ({ page }) => {
  await login(page, 'ceo@demo.sahynex.local');
  const problems: string[] = [];
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
      problems.push(
        `${p}: ${v.id} (${v.impact}) — ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
      );
  }
  // A client detail page (the shared layout every client uses).
  await page.goto('/clients');
  await page.locator('table a[href^="/clients/"]').first().click();
  await page.waitForLoadState('networkidle');
  const rc = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  for (const v of rc.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
    problems.push(
      `client detail: ${v.id} — ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
    );
  expect(problems, problems.join('\n')).toEqual([]);
});

test('sign-in page has no serious or critical WCAG violations', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = r.violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map(
      (v) =>
        `${v.id} — ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    );
  expect(bad, bad.join('\n')).toEqual([]);
});
