# Automation inventory

Generated from `src/server/automation/registry.ts`. Every organisation gets each workflow on bootstrap; enable/disable, owner, schedule and settings are managed in the **Automation centre**. Business thresholds (SLAs, reminder timings, scoring weights, stage probabilities) live in **Settings → Organisation & rules**.

## How the engine works

- **Queue:** `automation_executions` in PostgreSQL. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so several workers can run safely.
- **Event triggers:** services call `emit()` inside the same database transaction as the business change (transactional outbox). If the transaction rolls back, nothing is queued.
- **Schedules:** cron expressions evaluated in the organisation timezone (DST-aware). Each slot is enqueued exactly once; after downtime a single catch-up run is queued, not a backlog.
- **Idempotency:** unique `(automation, idempotency_key)` per execution, plus idempotent side effects — tasks use `source_key`, notifications use `dedupe_key`. Retries never duplicate tasks or notifications.
- **Latest-state checks:** handlers re-read and lock the record before acting and skip if it has moved on (e.g. a deal already closed).
- **Retries:** transient errors (network, timeouts, HTTP 5xx/429) back off exponentially with jitter (honouring Retry-After), up to the automation's max attempts. Permanent errors (bad configuration, HTTP 4xx) fail immediately.
- **Dead-letter:** runs that exhaust retries are marked _failed_; the owner is notified, and after 3 consecutive failures the COO/CEO too. Failed runs can be inspected (logs, payload, error) and retried safely from the Automation centre.
- **Timeouts:** each run races its automation's timeout. Workers that die mid-run are detected by lock age and the job is re-queued.
- **Disconnected integrations:** sync workflows skip with a reason; they never record a successful sync or fabricate data.

## Workflows

### Lead capture, assignment & follow-up

- **ID:** `lead.new`
- **Trigger:** events `lead.created`
- **What it does:** When a lead arrives from any channel, assign an owner, notify them instantly and create a first-contact follow-up task.
- **Conditions:** Lead still exists and is not a test lead; Lead is not closed; Owner not already set (manual assignment is respected)
- **Actions:** Assign owner (client account owner, else round-robin); Notify owner; Create follow-up task due within the SLA; Set next action on the lead

### Lead follow-up reminders & escalation

- **ID:** `lead.overdue`
- **Trigger:** schedule `*/30 * * * *` (organisation timezone)
- **What it does:** Every 30 minutes, remind owners about leads not contacted within the SLA and escalate to managers when the escalation window passes. Also reminds owners of due next actions.
- **Conditions:** Lead is open (not converted/lost/unqualified); Not suppressed / opted out; Not a test lead; Still uncontacted at run time
- **Actions:** Notify owner once per lead, grouped into one notification per owner per run; Escalate to COO/CEO once per lead, as one consolidated notification per run; Remind owner when a scheduled next action is due

### Lead qualification & attribution

- **ID:** `lead.qualification`
- **Trigger:** events `lead.qualification_updated`
- **What it does:** When qualification answers change, apply the configured scoring rules, update status (preserving attribution) and trigger the next action for qualified leads.
- **Conditions:** Lead exists and is open; Disqualified leads stay disqualified
- **Actions:** Compute score from configured weights; Set qualification status / promote stage; Create next-step task for newly qualified leads; Notify owner

### Sales pipeline automation

- **ID:** `sales.pipeline`
- **Trigger:** events `deal.stage_changed`, `proposal.sent`
- **What it does:** On stage changes: create discovery and proposal-preparation tasks, notify the deal owner, and start the handover when a deal is won. On proposal sent: set the follow-up next action.
- **Conditions:** Deal still exists; Current stage still matches the event (stale events are ignored)
- **Actions:** Qualified → “Schedule discovery” task; Discovery completed / proposal preparation → “Prepare proposal” task; Won → handover task + notify operations; Proposal sent → next action on deal; Notify owner of changes made by others

### Proposal follow-up & stale deals

- **ID:** `sales.proposal_followup`
- **Trigger:** schedule `7 * * * *` (organisation timezone)
- **What it does:** Hourly: create follow-up tasks on the configured days after a proposal is sent, escalate proposals with no outcome, and alert owners of deals with no recent interaction. Stops automatically once a deal closes.
- **Conditions:** Proposal status is “sent” (not superseded / accepted / rejected); Deal is still open at run time
- **Actions:** Follow-up task on day 3 and 7 (configurable); Escalate to management after 14 days; Stale-deal alert after 14 days without interaction

### Project creation from won deal

- **ID:** `project.from_handover`
- **Trigger:** events `handover.approved`
- **What it does:** When a handover is approved, create or link the client, create the project, generate tasks and milestones from the chosen template, assign owners and notify the team.
- **Conditions:** Handover is approved; No project created for it yet
- **Actions:** Create or link client (with primary contact); Create project in “planning”; Generate tasks & milestones from template; Notify owner and team

### Task deadline reminders & overdue escalation

- **ID:** `tasks.reminders`
- **Trigger:** schedule `5 * * * *` (organisation timezone)
- **What it does:** Hourly: remind owners ahead of due dates and escalate tasks overdue beyond the configured window to the project owner (or operations lead).
- **Conditions:** Task is open; Reminder/escalation not already sent for the current due date
- **Actions:** Remind owner before the deadline (once); Escalate when overdue (once)

### Client approvals & revision tracking

- **ID:** `approvals.workflow`
- **Trigger:** events `deliverable.submitted`, `approval.decided`
- **What it does:** Routes deliverables for review, notifies reviewers, turns change requests into revision tasks, and unlocks publishing once the client approves. Never publishes automatically.
- **Conditions:** Approval still exists and matches the deliverable’s current version
- **Actions:** Notify reviewer (internal) or client reviewers; Changes requested → revision task for the creative owner; Client approved → “publish” handoff task (manual); Notify owner of every decision
- **Settings:** Revision task due (days)

### Approval reminders

- **ID:** `approvals.reminders`
- **Trigger:** schedule `20 * * * *` (organisation timezone)
- **What it does:** Hourly: remind reviewers about approvals waiting longer than the configured time (up to the maximum number of reminders), then escalate once to the project owner.
- **Conditions:** Approval still pending; Reminder interval elapsed since submission/last reminder; Fewer than the maximum reminders sent
- **Actions:** Notify reviewers; Escalate to project owner after the last reminder

### Campaign metrics refresh

- **ID:** `campaign.refresh`
- **Trigger:** schedule `15 */6 * * *` (organisation timezone)
- **What it does:** Every 6 hours, pull the last 7 days of daily metrics from connected ad platforms (re-pulling recent days captures late attribution). Disconnected platforms are skipped and reported — never filled with estimates.
- **Conditions:** Platform connection is Live (or explicitly Demo); Campaign has a platform campaign ID
- **Actions:** Fetch daily metrics; Upsert per campaign/day; Update data freshness; Record unmapped platform campaigns
- **Settings:** Days to re-pull

### Ad-spend & CPL alerts

- **ID:** `campaign.alerts`
- **Trigger:** schedule `35 * * * *` (organisation timezone)
- **What it does:** Hourly: check data freshness, then compare CPL over the evaluation window and yesterday’s spend against each campaign’s approved thresholds. CPL alerts only fire once the minimum lead sample is reached.
- **Conditions:** Campaign active with at least one threshold set; Data is fresh (stale data raises a missing-data alert instead); Minimum lead sample reached for CPL
- **Actions:** Missing-data alert; CPL above threshold alert; Daily spend above threshold alert; Spending without leads alert

### Landing-page & conversion monitoring

- **ID:** `monitoring.pages`
- **Trigger:** schedule `*/15 * * * *` (organisation timezone)
- **What it does:** Every 15 minutes: check each monitored page (status code + expected text), open/close incidents, detect campaigns spending without CRM leads, and run a safe CRM-ingestion self-test using a designated test lead (never notifies anyone).
- **Conditions:** Monitor is active; URL resolves to a public address (SSRF protection)
- **Actions:** Record check; Open incident & notify owner on failure; Mark recovered, then close after a verification check; Conversion-gap incident; CRM ingestion self-test
- **Settings:** Run CRM ingestion self-test

### Daily digest & KPI tracking

- **ID:** `reports.daily`
- **Trigger:** schedule `55 7 * * *` (organisation timezone)
- **What it does:** Each morning: build yesterday’s internal digest from validated data (leads, pipeline, delivery, campaigns, exceptions), deliver it to the configured roles, and record month-to-date KPI values.
- **Conditions:** Internal report — approved automatically (it is never shared externally)
- **Actions:** Generate digest for the previous day; Deliver in-app (and email if configured); Record month-to-date KPI actuals

### Weekly & monthly client reports

- **ID:** `reports.client`
- **Trigger:** schedule `10 6 * * *` (organisation timezone)
- **What it does:** Each morning: on Mondays, draft weekly campaign summaries; on the 1st, draft last month’s report for every active client with a monthly reporting cadence. Drafts are routed to the account owner for internal review — nothing is sent to a client without approval.
- **Conditions:** Monday → weekly summaries; 1st of month → monthly client reports; Client is active and has a project with monthly reporting
- **Actions:** Generate drafts from reconciled data; Notify account owner and approvers for review
- **Settings:** Weekly summary day (0=Sun … 6=Sat)

### Report delivery

- **ID:** `reports.deliver`
- **Trigger:** events `report.approved`
- **What it does:** When a report is approved, deliver it to its recipients (client approvers or internal roles) in-app and by email when SMTP is configured, and log the outcome.
- **Conditions:** Report status is approved at run time
- **Actions:** Notify portal users / internal recipients; Email when configured; Record delivery channel and any delivery warning

### Outbound webhooks (n8n / Make)

- **ID:** `integrations.outbound_webhook`
- **Trigger:** events `lead.created`, `deal.stage_changed`, `handover.approved`, `approval.decided`, `deliverable.submitted`, `report.approved`, `proposal.sent`, `task.completed`
- **What it does:** Forwards domain events (new lead, deal stage change, handover approved, approvals, report approved) to the webhook URL configured on the n8n / Make integration. Disabled unless that integration is Live.
- **Conditions:** n8n / Make integration is Live with a webhook URL; URL resolves to a public address; N8N_WEBHOOK_SECRET is set
- **Actions:** POST signed JSON event; Retry with backoff on network / 5xx / 429
- **Requires integration:** n8n

## Mapping to the required workflows

| Required workflow             | Implemented by                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. New lead                   | ingestion (`services/leads.ts#ingestLead`: validate, dedupe, store, source) + `lead.new` (assign, notify, follow-up task, log) |
| 2. Overdue lead               | `lead.overdue`                                                                                                                 |
| 3. Lead qualification         | `lead.qualification`                                                                                                           |
| 4. Campaign performance alert | `campaign.refresh` + `campaign.alerts`                                                                                         |
| 5. Landing-page failure       | `monitoring.pages`                                                                                                             |
| 6. New project                | `sales.pipeline` (won → handover task) + `project.from_handover`                                                               |
| 7. Approval and revision      | `approvals.workflow` + `approvals.reminders`                                                                                   |
| 8. Daily report               | `reports.daily`                                                                                                                |
| 9. Client report              | `reports.client` + `reports.deliver`                                                                                           |
| 10. Proposal follow-up        | `sales.pipeline` (proposal sent) + `sales.proposal_followup`                                                                   |
| Task reminders & escalation   | `tasks.reminders`                                                                                                              |
| External orchestration        | `integrations.outbound_webhook`                                                                                                |
