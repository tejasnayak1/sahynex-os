/** Production bootstrap: `npm run db:bootstrap`. Requires ORG_NAME, ORG_SLUG, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD. */
import { loadEnv } from '../lib/load-env';

loadEnv();

async function main() {
  const { db, getPool } = await import('./index');
  const { bootstrapOrg } = await import('./bootstrap-lib');
  const need = ['ORG_NAME', 'ORG_SLUG'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
  const admin =
    process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
      ? {
          email: process.env.ADMIN_EMAIL,
          name: process.env.ADMIN_NAME ?? 'Administrator',
          password: process.env.ADMIN_PASSWORD,
        }
      : undefined;
  const r = await bootstrapOrg(db, {
    name: process.env.ORG_NAME!,
    slug: process.env.ORG_SLUG!,
    timezone: process.env.ORG_TIMEZONE,
    currency: process.env.ORG_CURRENCY,
    admin,
  });
  console.log(
    `Bootstrap complete for organisation ${r.orgId}.${admin ? ' Administrator ensured (created only if the org had no users).' : ''}`,
  );
  await getPool().end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
