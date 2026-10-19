# Troubleshooting

## Leads arrive but nobody is assigned / no follow-up tasks appear

- **Is the worker running?** Automation centre → _Worker_ card. If it says "No recent runs", start `npm run worker` (or check the service: `systemctl status sahynex-worker`). `/api/health` shows `overdueQueuedJobs` > 0 when it's down.
- **Is anyone set to receive leads?** Settings → Users & teams → edit a salesperson → _Receives leads_. With nobody eligible, the COO/CEO get an "Unassigned lead" notification.
- **Assignment set to manual?** Settings → Organisation & rules → Leads → Assignment.
- Client enquiries go to the client's **account owner**; set it on the client.
- Test/self-test leads never get owners or tasks — by design.

## An automation keeps failing

Automation centre → the automation → click the failed run: the log, error and payload are shown. Common causes: missing env vars (the error names them), an integration in Live mode without credentials, or an upstream API error. Fix the cause, then **Retry** (safe — workflows re-check current state and won't duplicate tasks or notifications). After 3 consecutive failures the CEO/COO are notified.

## Campaign data shows "Stale" or "Never synced"

- Settings → Integrations: is the platform **Live** (or Demo) and does **Test connection** pass?
- Each Sahynex campaign needs its **Platform campaign ID**. Unmapped platform campaigns are listed in the _Campaign metrics refresh_ run log.
- Data older than _Data is stale after (hours)_ (Settings → Organisation & rules) is flagged and CPL alerts pause for that campaign until it refreshes.
- No API access? Import the platform's daily export via **Import metrics CSV** on the campaign.

## CPL looks wrong / differs from Ads Manager

Sahynex CPL = spend ÷ **CRM leads** attributed to the campaign. Ads Manager CPL uses the platform's own leads and attribution window. Compare both on the campaign page; the reconciliation table shows daily gaps. Large gaps usually mean the form → CRM connection is broken, or the campaign ID isn't passed with leads.

## "Unavailable" instead of a number

Intentional: an input is missing or a denominator is zero. Sahynex never treats missing data as 0.

## Can't move a project to Active

The project page's _Delivery readiness_ panel lists what's missing: scope, owner, dates, a work plan (tasks/deliverables) and approved commercials (an approved handover or an approved budget in Finance).

## Can't mark a deal Won

The value must be set, and any discount above the approval threshold must be approved by a director (deal page banner).

## Client can't see a deliverable / report

Client reviewers see only deliverables **submitted to the client** (after internal approval) and only **approved/delivered** reports for their own client. Check the deliverable status and that the reviewer's user is linked to the right client.

## A report won't approve for a client

Reports that include demo data cannot be approved for clients. Connect real data and regenerate.

## Sign-in problems

- "Temporarily locked": 5 failed attempts lock the account for 15 minutes. An administrator can reset the password (Settings → Users), which also unlocks it.
- "Too many requests": rate limit (per IP/email over 15 minutes). Wait, or tune `LOGIN_RATE_LIMIT_*`.
- After role changes or deactivation, the user's sessions are revoked — they need to sign in again.

## File downloads say "Link expired"

Signed links last 10 minutes. Reload the page for fresh links.

## Emails aren't sent

Without SMTP settings, delivery is in-app only and the report shows a delivery note. Set `SMTP_*` and test by approving a report.

## "Something went wrong … reference ABC123"

An unexpected server error. Search the web or worker logs for `ABC123` to find the stack trace.

## Monitoring says a public page is "private"

The monitor resolves the hostname and refuses private/internal addresses (SSRF protection). If your DNS returns internal IPs from the server, monitor the public URL from a host that resolves publicly.

## Tests

- `npm test` needs a Postgres user that can create/drop databases (`TEST_DATABASE_URL`).
- `npm run test:e2e` needs `npm run build` first; it creates `sahynex_e2e`, seeds demo data and runs a worker. In sandboxes with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH`.
