import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

/** Recreates the test database from migrations once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sahynex_test';
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  const admin = new Client({ connectionString: url.replace(`/${dbName}`, '/postgres') });
  await admin.connect();
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await pool.end();
}
