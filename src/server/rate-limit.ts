import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { AppError } from './errors';

/**
 * Fixed-window rate limiter stored in Postgres, so it holds across multiple app instances.
 * Returns remaining allowance; throws RATE_LIMITED when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  const count = Number(res.rows[0]?.count ?? 0);
  if (count > limit)
    throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  return limit - count;
}
