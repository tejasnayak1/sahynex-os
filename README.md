# Sahynex OS

The internal operating system for **Sahynex TechSolutions Pvt. Ltd.** — one place for the whole business lifecycle:

Prospect → Lead → Discovery → Proposal → Client → Campaign → Project → Deliverables → Approval → Publishing → Performance → Reporting → Renewal → Revenue.

It combines a CRM and sales pipeline, project and task management, creative production with versioned client approvals, campaign performance and landing-page monitoring, reporting, an automation engine, and commercial tracking — with role-based access enforced on the server.

> **Demo vs real data.** The development seed creates fictional organisations ("Demo Institute of Technology" etc.), labels every demo record, and puts Meta/Google Ads in an explicit **Demo** mode that produces synthetic metrics marked _Demo data_ throughout the UI and reports. Production bootstrap creates no business data. Reports containing demo data cannot be approved for a client.

---

## Contents

- [Quick start (local)](#quick-start-local)
- [Demo accounts](#demo-accounts)
- [Everyday commands](#everyday-commands)
- [Project layout](#project-layout)
- [Modules](#modules)
- [Documentation](#documentation)

## Quick start (local)

Requirements: **Node.js 22**, **PostgreSQL 16** (14+ should work), npm.

```bash
npm ci
cp .env.example .env          # then set DATABASE_URL and SESSION_SECRET at minimum
createdb sahynex              # or create the database however you prefer

npm run db:migrate            # apply schema migrations
npm run db:seed               # DEMO data (refuses to run when NODE_ENV=production)

npm run dev                   # web app on http://localhost:3000
npm run worker                # in a second terminal: automation worker (schedules, events, retries)
```

The **worker must be running** for automations: lead assignment, follow-up tasks, reminders, escalations, approvals routing, report generation, metric syncs and monitoring.

For a clean (non-demo) organisation instead of the seed:

```bash
ORG_NAME="Sahynex TechSolutions Pvt. Ltd." ORG_SLUG=sahynex \
ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-strong-password' \
npm run db:bootstrap
```

`db:bootstrap` is idempotent: it creates the organisation, default roles, automations, task templates and integration placeholders if missing, and the first administrator only when the organisation has no users. It never overwrites roles, automation settings or templates that you have changed.

## Demo accounts

After `npm run db:seed`, every account uses the password printed by the seed (default `Demo-Sahynex-2026`, override with `DEMO_PASSWORD`):

| Email                                               | Role                                                       |
| --------------------------------------------------- | ---------------------------------------------------------- |
| ceo@demo.sahynex.local                              | CEO / Super Admin                                          |
| coo@demo.sahynex.local                              | COO / Operations Lead                                      |
| sales@demo.sahynex.local, bd@demo.sahynex.local     | Sales / Business Development (receive auto-assigned leads) |
| pm@demo.sahynex.local                               | Project Manager / Client Success                           |
| perf@demo.sahynex.local                             | Performance Marketing                                      |
| design@demo.sahynex.local, video@demo.sahynex.local | Design / Video / Content                                   |
| employee@demo.sahynex.local                         | Employee                                                   |
| reviewer@demo-institute.example                     | Client reviewer for _Demo Institute of Technology_         |

## Everyday commands

| Command                                                       | What it does                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                 | Next.js dev server                                                                                        |
| `npm run worker`                                              | Automation worker (run 1+ instances in production)                                                        |
| `npm run build` / `npm start`                                 | Production build / server                                                                                 |
| `npm run db:generate`                                         | Create a migration after editing `src/db/schema.ts`                                                       |
| `npm run db:migrate`                                          | Apply migrations                                                                                          |
| `npm run db:bootstrap`                                        | Idempotent production bootstrap (see above)                                                               |
| `npm run db:seed`                                             | Demo data (development only)                                                                              |
| `npm run typecheck` · `npm run lint` · `npm run format:check` | Static checks                                                                                             |
| `npm test`                                                    | Unit + integration tests (uses a throwaway `sahynex_test` database)                                       |
| `npm run test:e2e`                                            | Browser tests against a production build with a seeded `sahynex_e2e` database (run `npm run build` first) |
| `npm run docs:gen`                                            | Regenerate `docs/PERMISSIONS.md` and `docs/AUTOMATIONS.md` from code                                      |

Tests need a reachable PostgreSQL. Override with `TEST_DATABASE_URL` / `E2E_DATABASE_URL`; the user must be allowed to create databases. For Playwright in a sandbox with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Project layout

```
src/
  app/                 Next.js App Router
    (auth)/login       Sign-in
    (app)/…            Authenticated modules (one folder per module; server actions in actions.ts)
    api/               Route handlers: health, search, signed file downloads, lead ingestion API,
                       Meta Lead Ads webhook, cron tick, CSV export, logout
  components/          UI kit (server-safe) and client components (forms, dialogs, charts, shell)
  db/                  Drizzle schema, client, migrations runner, bootstrap, demo seed, default templates
  lib/                 Pure helpers: permissions catalogue, org settings schema, metrics, formatting
  server/
    access.ts          Record-level scoping (SQL conditions) — authorisation at the data layer
    actor.ts           Permission checks
    auth/              Sessions (hashed tokens), argon2id passwords, login with lockout
    services/          Business logic per module (no UI code)
    automation/        Durable workflow engine, event outbox, workflow definitions
    integrations/      Meta Ads, Google Ads, GA4 adapters + demo adapter
  worker/              Long-running worker process
drizzle/               SQL migrations
tests/                 unit/, integration/ (real Postgres), e2e/ (Playwright)
docs/                  Architecture, deployment, integrations, permissions, automations, troubleshooting
```

## Modules

Executive dashboard · CRM & leads (incl. consent-gated WhatsApp templates) · Sales pipeline (incl. discovery meetings with calendar invites) · Clients · Projects · Tasks & team (list, board, calendar, my tasks, workload) · Campaigns & performance (metrics, reconciliation, outcomes, landing-page monitoring) · Content & deliverables (calendar, versions) · Approvals & revisions · Reports & analytics (digests, client reports, daily updates, metric definitions) · Automation centre · Finance & commercials · Notifications · Organisation & settings (rules, users, roles, integrations & API keys, SOP templates, KPI targets, audit log).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, data model, security model, design decisions
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment, scaling, **backup and recovery**
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Meta, Google Ads, GA4, Meta Lead Ads, website forms API, n8n/Make, SMTP
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) — roles and permissions matrix (generated)
- [docs/AUTOMATIONS.md](docs/AUTOMATIONS.md) — automation inventory and engine behaviour (generated)
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [docs/STATUS.md](docs/STATUS.md) — implementation checklist, test results, known limitations, next steps
