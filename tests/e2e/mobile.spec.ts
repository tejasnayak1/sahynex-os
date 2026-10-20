import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('mobile: navigation drawer, no horizontal page scroll', async ({ page }) => {
  await login(page, 'pm@demo.sahynex.local');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Tasks', exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
