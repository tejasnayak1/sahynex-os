# Architecture

## Overview

Sahynex OS is a single Next.js 16 (App Router, React 19, TypeScript) application backed by PostgreSQL, plus a long-running **worker** process from the same codebase. There are no microservices: the module boundaries live in code (`src/server/services/*`), and the only process split is web vs. worker, which lets automations keep running independently of user traffic.

```
            ┌──────────────── Browser ────────────────┐
            │  Server-rendered pages · small client   │
            │  islands (forms, dialogs, charts)       │
            └───────────────▲───────────┬─────────────┘
                            │ RSC / server actions / JSON routes
┌───────────────────────────┴───────────▼─────────────────────────────┐
│ Next.js web (stateless, scale horizontally)                         │
│  pages → services → access scopes → Drizzle → PostgreSQL            │
│  every business change + its domain event commit in one transaction │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ automation_executions (queue/outbox)
┌───────────────────────────▼─────────────────────────────────────────┐
│ Worker(s): enqueue due schedules → claim (SKIP LOCKED) → run → retry│
│  → integrations (Meta, Google Ads, GA4, SMTP, n8n webhooks, HTTP    │
│    page checks)                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer          | Location                            | Rules                                                                                                                               |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pages & UI     | `src/app/(app)/*`, `src/components` | Server components fetch through services; client components only for interaction. No database access in client code.                |
| Server actions | `src/app/**/actions.ts`             | Thin: parse `FormData`, call one service, return a typed `ActionState`. Wrapped by `runAction` (auth, error mapping, revalidation). |
| Services       | `src/server/services/*`             | All business rules and validation (Zod). Every function takes an `Actor` and calls `assertCan(...)`.                                |
| Access scopes  | `src/server/access.ts`              | SQL conditions that every list/detail query must include — record-level authorisation at the data layer.                            |
| Automation     | `src/server/automation/*`           | Event outbox, engine, workflow definitions.                                                                                         |
| Integrations   | `src/server/integrations/*`         | Adapter contract + Meta / Google Ads / GA4 implementations and a demo adapter.                                                      |
| Data           | `src/db/schema.ts`, `drizzle/`      | Drizzle ORM, SQL migrations, constraints and indexes.                                                                               |

## Security model

- **Authentication:** email + password (argon2id, OWASP parameters). Sessions are random 256-bit tokens; only their SHA-256 is stored. HttpOnly, SameSite=Lax, Secure (in production) cookies; 14-day sliding expiry. Accounts lock for 15 minutes after 5 failed attempts; Postgres-backed rate limits per IP and per email. Unknown emails take the same time as wrong passwords.
- **Authorisation:** permissions per role (editable), checked in services; **record-level scopes** in SQL (`.all`, `.own`, `.assigned`, client-reviewer scope). The UI hides what a role can't use, but nothing relies on that.
- **Client reviewers** are users bound to one client: they see only that client, only deliverables/versions explicitly submitted to them, and only approved/delivered reports. No CRM, campaigns, finance or tasks.
- **Sensitive fields:** project budgets/revenue are stripped unless `projects.commercials`; hourly costs only with finance permissions and redacted from audit logs.
- **CSRF:** server actions are protected by Next.js (POST + origin check); custom mutating route handlers check same-origin; cookies are SameSite=Lax.
- **Files:** uploaded content is type-sniffed (not trusted by extension/header), size-limited, stored outside the web root with random names, and served only through `/api/files/[id]` with a short-lived HMAC signature bound to the viewer **and** a fresh permission check, with `nosniff` and a sandboxing CSP. SVG/HTML uploads are rejected.
- **SSRF:** landing-page monitors and outbound webhooks resolve DNS and refuse private, loopback, link-local and metadata addresses (including on redirects).
- **Secrets:** read from environment/secret manager only. Integration settings refuse values that look like tokens. Secrets are never sent to the browser (checked by an e2e test against the client bundle).
- **Headers:** HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed.
- **Errors:** user-facing messages come only from typed `AppError`s; anything unexpected is logged server-side with a reference code and the user sees a generic message with that code.
- **Audit log:** privileged and consequential actions (auth, assignments, stage changes, approvals, budgets, invoices, role/permission edits, integration changes, exports, retries) with before/after diffs.

## Data model

All business tables carry `org_id` (tenant scope) and `created_at`/`updated_at`. Money is stored as integer minor units (paise). Derived metrics (CTR, CPC, CPL, weighted pipeline, margin) are **computed, never stored**, so each fact has one source of truth.

| Area                  | Tables                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisation & access | `organisations`, `users`, `sessions`, `roles`, `permissions`, `role_permissions`, `teams`, `employee_profiles`, `api_keys`, `rate_limits`, `saved_views`, `audit_logs`, `counters` |
| CRM & sales           | `lead_sources`, `leads`, `lead_activities`, `deals`, `deal_stage_history`, `proposals`, `contracts`, `handovers`, `meetings`                                                       |
| Clients & delivery    | `clients`, `client_contacts`, `projects`, `project_members`, `milestones`, `task_templates`, `tasks`, `task_dependencies`, `task_collaborators`, `comments`, `time_entries`        |
| Content & approvals   | `deliverables`, `assets` (versions), `approvals`, `revisions`                                                                                                                      |
| Marketing             | `campaigns`, `campaign_metrics` (one row per campaign per day), `conversion_events`, `monitored_pages`, `page_checks`, `incidents`                                                 |
| Reporting             | `reports` (frozen JSON content with definitions, sources, freshness), `daily_reports`, `kpis`, `kpi_records`                                                                       |
| Automation            | `automations`, `automation_executions`, `notifications`, `integration_connections`                                                                                                 |
| Finance               | `budgets`, `expenses`, `invoices`                                                                                                                                                  |

Key constraints (examples): unique lead `external_id` per org (idempotent webhooks); unique task `source_key` per org (idempotent automation tasks); unique notification `dedupe_key` per user; unique `(automation_id, idempotency_key)`; at most one pending approval per deliverable+stage; at most one open incident per page; unique report per type+period(+client). Indexes back every list filter and sort (owner, stage, due date, created date, campaign/date…). A 20,000-lead filtered/paginated query runs well under the 1.5 s test budget.

Human-readable references (`LD-0042`, `DL-0007`, `PRJ-0003`, `TK-0120`, `DV-0004`) come from a per-org counter row updated atomically.

## Metrics & attribution

- Platform metrics are stored exactly as reported (daily) with their `source` (`api`, `csv`, `manual`, `demo`). Attribution windows are recorded per campaign and shown, never mixed silently.
- **CPL uses CRM leads** attributed by campaign ID (lead ingestion or webhook mapping). Platform-reported leads are shown alongside, with a daily reconciliation table that flags gaps.
- Applications/admissions only count when recorded as **verified** conversion events with a source of record.
- Missing inputs make a derived metric **Unavailable** (never 0). Reports show definitions, sources and data freshness for every figure, and keep interpretation (commentary) separate from measured values.

## Key decisions

- **Postgres as the queue** instead of Redis/BullMQ: one dependency, transactional outbox semantics, `SKIP LOCKED` concurrency, and executions are queryable for the Automation centre.
- **Drizzle** for typed SQL close to the metal (scopes are composable SQL fragments).
- **Server components + server actions** keep secrets and business logic on the server; client JS is limited to interactive islands; charts are lazy-loaded.
- **Filters in the URL**: shareable, survive reloads, back/forward friendly; personal saved views persist them.
- **Human control for consequential actions**: nothing publishes, sends to clients, moves money or approves on a timer. Client reports require approval; reports containing demo data can't be approved for clients.
