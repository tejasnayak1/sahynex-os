# Deployment guide

Sahynex OS needs three things in production:

1. **PostgreSQL 14+** (16 recommended) — managed (e.g. AWS RDS, Google Cloud SQL, DigitalOcean, Neon, Supabase) or self-hosted.
2. **The web app** — `next start` behind HTTPS. Stateless; run one or more instances.
3. **The worker** — `npx tsx src/worker/index.ts` (or `npm run worker`). Run at least one, always on. Multiple workers are safe.

Plus a **persistent volume for uploaded files** (`STORAGE_DIR`) shared by web and worker, and included in backups.

The verified path is a Linux VM/VPS with Node 22 (below). A `Dockerfile` and `docker-compose.yml` are included as a reference topology but were **not built** in the original environment (container registry access was blocked) — build and test them before relying on them.

## 1. Provision

- Node.js 22 LTS, `git`, a reverse proxy with TLS (Caddy or Nginx + Let's Encrypt).
- PostgreSQL database and a user that owns it. Enable automated backups and point-in-time recovery if your provider offers it.
- A directory for uploads, e.g. `/var/lib/sahynex/storage`, owned by the service user, on a backed-up disk.

## 2. Configure

Create `/etc/sahynex/env` (mode 600) from `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET` (`openssl rand -base64 48`), `APP_URL`, `STORAGE_DIR`. Set `DATABASE_SSL=true` for providers that require TLS. Leave integration variables empty until you connect them (see INTEGRATIONS.md). Never set `MONITOR_ALLOW_PRIVATE=true` or `SEED_DEMO`/`ALLOW_DEMO_SEED` in production.

## 3. Build, migrate, bootstrap

```bash
git clone <repo> /opt/sahynex-os && cd /opt/sahynex-os
npm ci
set -a; . /etc/sahynex/env; set +a
npm run build
npm run db:migrate
ORG_NAME="Sahynex TechSolutions Pvt. Ltd." ORG_SLUG=sahynex ORG_TIMEZONE=Asia/Kolkata \
ADMIN_EMAIL=you@sahynex.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='…' npm run db:bootstrap
```

Sign in as the administrator, change the password (Settings → My account), then add users in Settings → Users & teams. Temporary passwords are shown once; share them privately.

## 4. Run as services (systemd example)

`/etc/systemd/system/sahynex-web.service`:

```ini
[Unit]
Description=Sahynex OS web
After=network.target
[Service]
User=sahynex
WorkingDirectory=/opt/sahynex-os
EnvironmentFile=/etc/sahynex/env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/sahynex-worker.service`: same, with `ExecStart=/usr/bin/npx tsx src/worker/index.ts`. The worker stops gracefully on SIGTERM (finishes the current job).

Reverse proxy (Caddy): `os.example.com { reverse_proxy 127.0.0.1:3000 }`. Ensure the proxy sets `X-Forwarded-For` (used for rate limits and audit IPs). Uploads are capped at 25 MB; raise the proxy body limit to ~30 MB.

**Serverless / no long-running process?** Use `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET` instead of the worker. Each call recovers stale jobs, enqueues due schedules and processes up to 20 jobs.

## 5. Health and monitoring

- `GET /api/health` → `{"status":"ok","database":"ok","worker":{"lastExecutionFinishedAt":…,"overdueQueuedJobs":n}}`. Alert if it isn't 200, or if `overdueQueuedJobs` > 0 for more than a few minutes (worker down).
- The Automation centre shows worker status, queue depth, retries and failed runs; failures notify the automation owner (and CEO/COO after 3 in a row).
- Logs: web logs to stdout; worker logs structured JSON lines (`{"ts","level","msg",…}`).

## 6. Upgrades

```bash
cd /opt/sahynex-os && git pull && npm ci && npm run build
npm run db:migrate        # forward-only migrations; take a backup first
npm run db:bootstrap      # adds new permissions/automations/templates; never overwrites your settings
sudo systemctl restart sahynex-web sahynex-worker
```

## 7. Backup and recovery

**What to back up:** the PostgreSQL database (everything except files) and `STORAGE_DIR` (uploaded creative versions). Secrets live in your env/secret manager — back those up separately and securely.

**Database — daily logical backup** (in addition to provider snapshots/PITR):

```bash
# /etc/cron.d/sahynex-backup  (runs 02:30 daily, keeps 14 days)
30 2 * * * sahynex pg_dump --format=custom --no-owner "$DATABASE_URL" > /backups/sahynex-$(date +\%F).dump && find /backups -name 'sahynex-*.dump' -mtime +14 -delete
```

**Files:** `rsync -a --delete /var/lib/sahynex/storage/ backup-host:/backups/sahynex-storage/` (or sync to S3/GCS with versioning). Run after the database dump so files are never older than DB references.

Copy backups off the server (different provider/region). Encrypt them at rest.

**Restore drill (do this quarterly):**

```bash
createdb sahynex_restore
pg_restore --no-owner --dbname=sahynex_restore /backups/sahynex-YYYY-MM-DD.dump
rsync -a backup-host:/backups/sahynex-storage/ /var/lib/sahynex/storage-restore/
# Point a staging instance at sahynex_restore + storage-restore, run `npm run db:migrate`, sign in, open a few
# deliverables (file downloads), dashboards and reports. Record how long it took (your actual RTO).
```

**Full recovery:** stop web and worker → restore database (or PITR to just before the incident) → restore files → `npm run db:migrate` → start web, then worker. Queued automation runs resume; scheduled automations queue one catch-up run, not a backlog. Sessions created after the backup are invalid, so users sign in again.

**Retention & deletion:** leads can be archived (soft delete) from the UI; to permanently erase a person's data on request, delete their lead rows (activities cascade) after exporting anything legally required, and note the request in your records. Audit logs should be retained per your policy (they redact secrets and hourly costs).

## 8. Scaling notes

- Web is stateless; add instances behind the proxy. Rate limits and sessions are in Postgres, so they work across instances.
- Add worker instances for throughput; jobs are claimed with `SKIP LOCKED`.
- Postgres connection pool per process is `DATABASE_POOL_MAX` (default 10). Size the database's `max_connections` for (web instances + workers) × pool.
- For multiple servers, `STORAGE_DIR` must be shared storage, or implement the object-storage driver (S3/GCS) — the storage interface is in `src/server/storage.ts` (`putObject`/`getObject`), and signed URLs already go through the app.
