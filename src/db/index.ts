import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query surface as the db; services accept either. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DBOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __sahynexPool?: Pool; __sahynexDb?: DB };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. See .env.example.');
  return new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
}

export function getPool(): Pool {
  if (!globalForDb.__sahynexPool) globalForDb.__sahynexPool = createPool();
  return globalForDb.__sahynexPool;
}

export const db: DB = globalForDb.__sahynexDb ?? drizzle(getPool(), { schema });
globalForDb.__sahynexDb = db;

export { schema };
