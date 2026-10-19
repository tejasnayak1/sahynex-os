// Dev helper: node scripts/shot.mjs <email> <outdir> <path...>  — logs in and screenshots pages.
import { chromium } from '@playwright/test';
const [email, out, ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium
  .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  .catch(() => chromium.launch());
const page = await browser.newPage({
  viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 1000) },
});
if (process.env.THEME)
  await page.addInitScript((t) => localStorage.setItem('sx.theme', t), process.env.THEME);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}/login`);
await page.fill('#email', email);
await page.fill('#password', process.env.PW ?? 'Demo-Sahynex-2026');
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
for (const p of paths) {
  const t = Date.now();
  const res = await page.goto(base + p, { timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const name = p.replace(/[^\w]+/g, '_') || 'root';
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL !== '0' });
  console.log(res?.status(), p, `${Date.now() - t}ms`);
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();
