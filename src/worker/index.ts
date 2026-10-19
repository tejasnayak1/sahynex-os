/**
 * Background worker: `npm run worker`. Run one or more instances alongside the web app.
 * Each tick: recover stale locks → enqueue due schedules → process queued executions.
 * Multiple workers are safe (row locks with SKIP LOCKED).
 */
import { loadEnv } from '../lib/load-env';

loadEnv();

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 5000);
let stopping = false;

function log(level: 'info' | 'error', msg: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }));
}

async function main() {
  const { drainQueue, enqueueDueSchedules, recoverStaleLocks, WORKER_ID } = await import(
    '../server/automation/engine'
  );
  const { purgeExpiredSessions } = await import('../server/auth/session');
  const { getPool } = await import('../db');
  log('info', 'worker started', { worker: WORKER_ID, tickMs: TICK_MS });
  let lastPurge = 0;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log('info', `received ${sig}, finishing current job then exiting`);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  while (!stopping) {
    const started = Date.now();
    try {
      const recovered = await recoverStaleLocks();
      const scheduled = await enqueueDueSchedules();
      const processed = await drainQueue(25);
      if (recovered || scheduled || processed)
        log('info', 'tick', { recovered, scheduled, processed, ms: Date.now() - started });
      if (Date.now() - lastPurge > 3_600_000) {
        await purgeExpiredSessions();
        lastPurge = Date.now();
      }
    } catch (e) {
      log('error', 'tick failed', { error: e instanceof Error ? e.message : String(e) });
    }
    if (!stopping) await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await getPool().end();
  log('info', 'worker stopped');
}

main().catch((e) => {
  log('error', 'worker crashed', { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
