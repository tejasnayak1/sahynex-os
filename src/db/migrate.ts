import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { loadEnv } from '../lib/load-env';

loadEnv();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
