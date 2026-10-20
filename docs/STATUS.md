# Status, verification and known limitations

_Last verified: 19 October 2026 (second session: independent re-verification of everything below, then the additions listed under “Session 2”), in the build environment described below._

## Implementation checklist

| Phase                    | Scope                                                                                                                                                                                                                                                                                                                                                       | Status                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1 Foundation             | PostgreSQL schema (50+ tables, FKs, unique constraints, indexes, migrations), argon2id auth, hashed sessions, lockout & rate limits, RBAC + record-level scopes, audit log, app shell, design system (light/dark), org settings                                                                                                                             | ✅                                    |
| 2 CRM & sales            | Lead capture (manual, CSV import, API, Meta Lead Ads webhook), validation, safe dedupe, round-robin / account-owner assignment, qualification scoring, consent & suppression, activity timeline, pipeline board/list, proposals (versioned), discount approval, lost reasons, handover, discovery meetings + .ics invites, consent-gated WhatsApp templates | ✅                                    |
| 3 Clients & operations   | Clients, contacts/approvers, projects with readiness gate, members, milestones, SOP templates, tasks (list, board, calendar, my tasks, workload), dependencies, recurrence, collaborators, comments, time logging, deliverables with versions, internal + client approvals, revisions                                                                       | ✅                                    |
| 4 Marketing intelligence | Adapter contract, Meta Ads / Google Ads / GA4 adapters, demo adapter, CSV metric import, metric normalisation, platform-vs-CRM reconciliation, freshness, CPL/spend alerts with minimum samples, verified outcomes, landing-page & conversion monitoring with incidents                                                                                     | ✅ (live APIs unverified — see below) |
| 5 Reporting & automation | Durable Postgres-backed engine (idempotency, backoff, dead-letter, timeouts, stale-lock recovery, timezone-aware cron), 16 workflows, Automation centre (enable/disable, schedules, config, owner, run logs, safe retry), notifications, daily digest, weekly/monthly reports with review & approval, daily updates, KPI targets                            | ✅                                    |
| 6 Commercial controls    | Budgets with approval, budget vs actual, expenses (direct vs pass-through), invoices & collections, renewals, project profitability with explicit estimate caveats                                                                                                                                                                                          | ✅                                    |
| 7 Hardening & release    | Unit, integration, e2e, accessibility and security tests; production build; docs; deployment, backup/recovery                                                                                                                                                                                                                                               | ✅                                    |

## Verification results

All run against PostgreSQL 16 and Node 22.22 in the build environment:

| Check                                                                             | Result                             |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| `npm run typecheck` (TypeScript strict)                                           | ✅ no errors                       |
| `npm run lint` (ESLint, Next core-web-vitals + TypeScript rules)                  | ✅ no errors or warnings           |
| `npm run format:check` (Prettier)                                                 | ✅                                 |
| `npm test` — unit + integration on a real Postgres                                | ✅ **119 tests passed** (11 files) |
| `npm run build` (Next.js production build)                                        | ✅ 58 routes, no warnings          |
| `npm run test:e2e` — Playwright against the production build + worker + seeded DB | ✅ **14 tests passed**             |
| Accessibility (axe, WCAG 2.0/2.1/2.2 A & AA, 14 key pages)                        | ✅ no serious/critical violations  |
| Manual visual review (screenshots of every module; light, dark, mobile)           | ✅                                 |
| `npm audit --omit=dev` (production dependencies)                                  | ✅ 0 vulnerabilities               |

What the tests cover, mapped to the acceptance criteria:

- **Functional:** lead create/retrieve; dedupe (update, conflict flagging, external-ID idempotency, per-client separation); assignment (round-robin, account owner); reminders stop on close/suppression; qualification → reporting; CSV import/validation/replace, demo vs. live sync, reconciliation; alert thresholds + minimum sample + stale-data pause; page failure → incident → reopen → verified close; handover → project → exactly the template's tasks, dependencies and milestones (idempotent re-run); task permissions; approval/revision version history; report periods in org timezone; proposal follow-ups stop after closure; failed workflows inspectable and safely retryable.
- **Security:** employees blocked from finance; budgets hidden without commercial permission; client isolation (clients, deliverables, unsubmitted work, files, reports, search); no self-escalation; role change revokes sessions; lockout + no user enumeration; hashed API keys; secrets refused in integration config; unauthenticated pages/APIs refused (e2e); no secrets in the client bundle (e2e); signed, user-bound, expiring file URLs; content-sniffed uploads; SSRF guard.
- **Reliability:** duplicate events → one execution/task/notification; concurrent schedulers enqueue each slot once; two workers never claim the same job; transient retry with backoff → dead-letter + alert; timeouts; disabled automations don't run; missing data never becomes zero; stale metrics flagged; DST-correct scheduling and date entry; 20,000-lead filtered pagination well within budget.
- **UX (e2e):** vertical slice (sign in → create lead → automatic owner + follow-up task → log call → dashboard); validation errors keep the user's input; role-aware navigation and 403 page; client approval flow; Ctrl+K search; handover approval creating a project; mobile drawer with no horizontal page scroll; search-as-you-type and instant dropdown filters kept in the URL; bulk task edits + inline status/priority; scheduling a meeting from a deal and downloading its invite (refused without a session).
- **Session 2 additions (integration/unit):** bulk task edits apply per task through the normal rules (dependencies, ownership, `tasks.assign`), report failures individually, never offer “blocked” in bulk; meetings create a calendar task, close the discovery to-do, version invites on reschedule/cancel, only record outcomes after the start, advance deals through normal stage rules, are invisible to people without deal/lead access, and never claim an email was sent without SMTP; WhatsApp is refused when disconnected, misconfigured, without consent, for opted-out leads, without a valid number, for unknown templates or without the permission, blocks repeats for 24 h, logs demo sends as “[Demo — not sent]”, calls the documented Cloud API endpoint in Live mode and records real success/failure; ICS output is RFC 5545-folded, escaped and injection-safe.

## Integrations: connected vs awaiting credentials

| Integration                    | State                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Website/landing-page forms API | Working; tested end to end                                                                                                                                                                                                                                               |
| Meta Ads, Google Ads, GA4      | Implemented to the official APIs; **awaiting credentials — never exercised against live accounts** (no credentials, and outbound access to those APIs was restricted in the build environment). Verify with _Test connection_ + a manual refresh before relying on them. |
| Meta Lead Ads webhook          | Implemented (verification, signature, idempotent ingest); **awaiting credentials, not exercised against Meta**                                                                                                                                                           |
| n8n / Make outbound webhooks   | Implemented; signing and retries tested through the engine, not against a real n8n instance                                                                                                                                                                              |
| SMTP email                     | Implemented; not tested against a real SMTP server (in-app delivery is tested)                                                                                                                                                                                           |
| WhatsApp Business              | Implemented to the official Cloud API (template sends, health check), consent-gated and audited; **awaiting credentials, never exercised against a live WhatsApp account**. Demo mode works and is seeded.                                                               |

The demo seed puts Meta Ads and Google Ads in **Demo** mode; every synthetic figure is labelled.

## Known limitations

- **Dev-tooling advisories:** `npm audit` (including dev dependencies) reports 9 advisories in build/lint tooling only (`braces`/`micromatch` via `eslint-config-next`, an old `esbuild` via `drizzle-kit`). None ship in the production runtime (`npm audit --omit=dev` is clean); upgrade those tools when patched releases are available.

- **Live ad-platform APIs are unverified** (above). API versions are configuration (`META_GRAPH_VERSION`, `GOOGLE_ADS_API_VERSION`) because both platforms retire versions; set current ones.
- **One ad account per platform per organisation.** Agencies with an account per client should extend `integration_connections` to multiple rows (per client) — the adapters already take the account from the connection's config.
- **Publishing is a manual handoff.** No social/CMS publishing APIs are integrated; approved items create a "publish" task and are marked published with the live link.
- **WhatsApp** supports manual, one-lead-at-a-time template sends only: no inbound messages/replies, no bulk or automated sending (deliberate). Existing installations must grant `messaging.whatsapp` to roles in Settings → Roles (new installations give it to Sales).
- **Calendar:** meetings produce RFC 5545 invites (download or SMTP email); there is no two-way Google/Microsoft calendar sync.
- **Fonts** load from Google Fonts at runtime; in a network-restricted environment the UI falls back to the system font stack (seen in this build environment as a blocked request, harmless).
- **File storage** ships with a local-disk driver. Multi-server deployments need shared storage or an S3/GCS driver (`src/server/storage.ts`).
- **No password-reset email flow**; administrators reset passwords (temporary password shown once). No SSO / 2FA yet.
- **Single organisation per deployment in the UI.** The data model is multi-tenant (`org_id` everywhere) but there is no org switcher or self-serve signup.
- **Real-time updates** use page refreshes after actions (no websockets); notifications update on navigation.
- **AI-generated commentary** is not included; commentary is written by people and kept separate from measured figures.
- **Docker files** are a reference and were not built (registry access blocked). The VM/systemd path was verified (production build + `next start` + worker).
- **Labour cost** in profitability depends on time logging and hourly costs; projects without them are labelled _Estimate_ with the missing inputs listed.

## Recommended next steps

1. Connect Meta Ads and Google Ads with real credentials in a staging copy; validate a week of numbers against Ads Manager, then switch production to Live.
2. Point the admissions landing pages' forms at `/api/v1/leads` with per-client API keys (and/or the Meta Lead Ads webhook) and run one test submission per form.
3. Configure SMTP and the backup cron + quarterly restore drill (DEPLOYMENT.md).
4. Add SSO (Google Workspace) and TOTP 2FA for administrators.
5. Add an S3/GCS storage driver before running more than one web server.
6. Per-client ad-account connections.
7. Connect WhatsApp Business (staging first), send one template to an internal number, then grant `messaging.whatsapp` to Sales.
8. Optional: Google Workspace calendar sync for meetings (today: .ics invites).

## Session 2 (19 Oct 2026) — what changed

Re-verified the existing build from a clean database before changing anything (all checks passed as recorded), then closed the gaps found in an audit against the brief:

- **Debounced, instant filters** on every list (search applies ~350 ms after typing; dropdowns/checkboxes apply immediately; client-side navigation; filters stay in the URL; Apply remains as a no-JS fallback).
- **Task bulk actions** (status, priority, reassign) with select-all, a live selected count and confirmation; **inline priority/status editing** in the task list. Select-all also added to leads.
- **Discovery meetings** (new `meetings` table, migration `0002_meetings`): schedule from a deal or lead, calendar task for the organiser, reschedule/cancel with versioned `.ics` invites, optional SMTP email, outcome recording that can advance the deal to “Discovery completed”.
- **WhatsApp Business adapter** (Cloud API) with the safeguards listed under Integrations, a new `messaging.whatsapp` permission, and a seeded Demo mode.
- **Fixes:** every dialog's accessible name was broken (an `aria-labelledby` id built from a title containing spaces) — now uses a generated id; duplicate screen-reader announcement of selection counts; lead rows with a “Possible duplicate” badge wrapped the reference mid-word; file-storage build warnings removed.

## Session 3 (20 Oct 2026) — simpler interface

- **Home page** (`/home`) is now where everyone lands: today's tasks with one-click _Done_, leads to follow up, today's meetings, approvals waiting, quick-add buttons and the daily-update nudge. Executives also get a one-line 30-day summary linking to the Business dashboard.
- **Business dashboard** (renamed from Executive dashboard) shows four headline numbers, _Needs attention_ (top 6, rest behind "Show more") and targets; everything else is under **Show more numbers**.
- **List pages**: only search is always visible; other filters sit behind **Filters** (opens automatically when a filter is active). Bulk-action bars appear only after rows are ticked. The leads table has five columns (interest moved under the name).
- Fixed a test that used UTC dates and failed between 00:00 and 05:30 IST.
- Verified: typecheck, lint, format, 119/119 unit+integration, production build, 14/14 e2e (including accessibility on the new Home page).

## Session 4 (20 Oct 2026) — daily briefing Home page

- **Executive dashboard restored** exactly as before (layout, title, menu label); only the landing page changed.
- **New Home page** for everyone: greeting with a one-line summary of the day and the next thing on the calendar, today's task progress ring, an **AI morning brief** (summary, priorities, ideas, social insights, trends — labelled as suggestions), today's schedule (Google Calendar + meetings booked in Sahynex OS), tasks with progress and one-click Done, calls to make (tap to call), inbox highlights, LinkedIn messages (from LinkedIn's email alerts — LinkedIn offers no API for reading messages) and Instagram today (followers and change, posts in 24h, engagement, best recent post).
- **New integrations** (Settings → Integrations, each with Demo mode): Google Gmail & Calendar (per-person OAuth, read-only, refresh tokens encrypted with AES-256-GCM), Instagram Graph API (daily snapshots), AI assistant (Anthropic Messages API; one brief per person per day, refresh on request, max 6/day; facts sent are stored with the brief). None verified against live accounts in the build environment.
- Migration `0003_personal_briefing` (enum values + `user_google_connections`, `instagram_snapshots`, `ai_briefs`).
- Verified: typecheck, lint, format, 136/136 unit+integration (17 new), production build, 15/15 e2e including accessibility on Home.

## Session 5 (20 Oct 2026) — UI/UX redesign of five areas

- **Login**: new cover ("Turn ambition into measurable growth."), four outcome indicators (no figures), show/hide password. Only password sign-in exists, so no social-login buttons; password resets stay with administrators.
- **Client details (every client)**: grouped cards (at a glance, account, budgets, contract, projects, campaigns, commercial history, notes, contacts, reports). New **marketing** and **branding budgets** with an explicit monthly/annual period (migration `0004_client_budgets`: four nullable columns + `budget_period` enum; existing clients show "Not set"). Contacts can be **edited in place** (`updateContact`, same record-level checks as add/remove, audited). Edit dialogs warn before discarding unsaved changes.
- **Tasks board**: pointer (mouse/touch) drag-and-drop and a keyboard alternative (Space, arrows, Space). A card only stays moved after the server confirms; refusals (e.g. unfinished dependencies) snap back with the reason. Dropping on Blocked asks for the required note. Optional sound (off by default), sparkle on forward moves, confetti on Done; all respect reduced motion. The status dropdown remains.
- **Home**: the brief is split into **Daily briefing** (summary, at-a-glance, priorities, follow-ups & alerts) and **Marketing intelligence** (Marketing news and Platform updates from public RSS feeds with publisher, date and link; Strategies & ideas labelled as AI). The AI may add "what it means" only for headlines it was given (others are discarded). All Home lists are nested sub-cards. Feeds: Search Engine Land, Google Ads & Commerce blog, Social Media Today, Meta Newsroom, YouTube blog (checked live 20 Oct 2026). Indian education news sites block automated readers, so none is included by default; add one with `MARKET_NEWS_FEEDS`.
- **Content → New deliverable**: two-panel **AI Creative Studio** (evaluate brief, three editable concepts, compare, hooks/caption/CTAs/hashtags/structure, explicit "Use…/Add to brief", restore original brief). It never creates, submits, approves or publishes; uses the existing AI provider (Gemini/Claude) server-side, rate-limited, audited; Demo mode gives a labelled rule-based check.
- **Tests**: 160 unit/integration (new: budgets, contact editing and isolation, feed parsing and caching, headline filtering, creative studio incl. provider failure) and 19 Playwright e2e incl. axe checks on `/content/new` and `/clients` — all passing.
- **Known limits**: live Gemini output for the Creative Studio and the RSS feeds could not be exercised from the build environment (no outbound access); both are covered with mocked responses. Board drag-and-drop on touch screens works with horizontal drags; vertical swipes scroll the page.

### Session 5b (20 Oct 2026): matched to the approved reference images

- **Look and feel**: dark navy is now the default theme (light still available from the account menu). New sidebar with the Sahynex mark and short labels (plus Search). Top bar has a centred search and your name and job title.
- **Job title**: set it in Settings → My account (display only). Database migration `0005_redesign_fields` adds `users.job_title`, plus `deliverables.objective` and `deliverables.priority`. All new columns are nullable or have defaults.
- **Login**: the "Ideas today. Greater outcomes tomorrow." photo layout (the photo is cleaned from the supplied reference image and stored in `public/brand/`).
  - **Remember me**: unticked means the session ends when the browser closes.
  - **Forgot password?** explains that administrators reset passwords.
  - **Sign in with Google** appears only when the Google OAuth keys are set. It works only for existing, active accounts with a Google-verified email, and reuses the existing redirect URI with a cookie-pinned state.
  - **Microsoft is not shown**: it isn't implemented.
- **Home**: light "Your daily briefing" card (summary plus meetings, tasks, unread email and calls; priorities and follow-ups fold out) and "Marketing intelligence" card (latest news, strategy ideas, platform updates) with **View all insights** going to `/home/insights`.
  - The 30-day strip now shows the change in leads against the previous 30 days.
  - Every list uses rich rows: tasks have tick-to-complete, priority and due pills; calls show avatar, phone and a call button; Instagram shows post thumbnails (`media_url`/`thumbnail_url`), posts this month and recent likes. "⋮" menus only offer real actions.
- **Client page**: logo tile, status, tabs (Overview, Projects, Tasks, Campaigns, Reports, Finance, Documents, Activity), account card with an inline budget period selector and per-budget edit, projects table with task-based progress, contacts with Edit/Remove/⋮, and a **Notes timeline** (stored as client comments; add or delete).
- **Tasks board**: filter row (search, client, project, assignee, due, priority, status), coloured card edges, avatars for owner and collaborators, comment counts, "Completed x ago". Dragging shows a tilted card, sparkles and a "Drop here" zone. A "Task moved to …!" notice (confetti on Done) appears after a move, plus a floating sound switch. The status dropdown on cards was removed; keyboard moving and the task page still change status.
- **Creative Studio**: format chips, multi-channel chips, audience presets, priority and campaign objective.
  - Brief analysis has a checklist and a 0–10 score (AI opinion). Three concept tabs with a typographic **layout preview** built from the concept's own words (no generated images).
  - Editable hook, caption, CTA and hashtags; variations (short caption, student life, placement focus, carousel, reel script); **Use this content** fills the form; **Create deliverable** remains the only way to create.
- **Tests**: 169 unit and integration tests, 20 Playwright tests (including axe on `/login`, a client page, `/home/insights` and `/content/new`), production build, lint and format all pass.
