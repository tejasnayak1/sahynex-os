/** Regenerates docs/PERMISSIONS.md and docs/AUTOMATIONS.md from the source of truth: `npx tsx scripts/gen-docs.ts`. */
import { writeFileSync } from 'node:fs';
import { DEFAULT_ROLES, PERMISSIONS, ROLE_KEYS } from '../src/lib/permissions';
import { WORKFLOWS } from '../src/server/automation/registry';

const short: Record<string, string> = {
  ceo: 'CEO',
  coo: 'COO',
  sales: 'Sales',
  project_manager: 'PM',
  performance_marketing: 'Perf',
  creative: 'Creative',
  employee: 'Employee',
  client_reviewer: 'Client',
};
let p = `# Roles & permissions matrix\n\nGenerated from \`src/lib/permissions.ts\` (the seed for each organisation's roles). Administrators can change grants per role in **Settings → Roles & permissions**; this table shows the defaults.\n\nEnforcement happens on the server: every service function checks permissions (\`assertCan\`) and every list/detail query is combined with a record-level scope from \`src/server/access.ts\`. Hiding navigation is a convenience only.\n\n## Roles\n\n`;
for (const k of ROLE_KEYS)
  p += `- **${DEFAULT_ROLES[k].name}** (\`${k}\`) — ${DEFAULT_ROLES[k].description}\n`;
p += `\n## Record-level scopes\n\n| Scope suffix | Meaning |\n|---|---|\n| \`.all\` | Every record in the organisation |\n| \`.own\` | Records the user owns |\n| \`.assigned\` | Records on clients/projects the user owns or is a project member of |\n| Client reviewer | Only their own client; only deliverables explicitly submitted to the client; only approved/delivered reports |\n\n## Matrix\n\n| Permission | Module | ${ROLE_KEYS.map((k) => short[k]).join(' | ')} |\n|---|---|${ROLE_KEYS.map(() => ':-:').join('|')}|\n`;
for (const [key, def] of Object.entries(PERMISSIONS))
  p += `| ${def.description} (\`${key}\`) | ${def.module} | ${ROLE_KEYS.map((k) => ((DEFAULT_ROLES[k].permissions as string[]).includes(key) ? '●' : '')).join(' | ')} |\n`;
writeFileSync('docs/PERMISSIONS.md', p);

let a = `# Automation inventory\n\nGenerated from \`src/server/automation/registry.ts\`. Every organisation gets each workflow on bootstrap; enable/disable, owner, schedule and settings are managed in the **Automation centre**. Business thresholds (SLAs, reminder timings, scoring weights, stage probabilities) live in **Settings → Organisation & rules**.\n\n## How the engine works\n\n- **Queue:** \`automation_executions\` in PostgreSQL. Workers claim jobs with \`FOR UPDATE SKIP LOCKED\`, so several workers can run safely.\n- **Event triggers:** services call \`emit()\` inside the same database transaction as the business change (transactional outbox). If the transaction rolls back, nothing is queued.\n- **Schedules:** cron expressions evaluated in the organisation timezone (DST-aware). Each slot is enqueued exactly once; after downtime a single catch-up run is queued, not a backlog.\n- **Idempotency:** unique \`(automation, idempotency_key)\` per execution, plus idempotent side effects — tasks use \`source_key\`, notifications use \`dedupe_key\`. Retries never duplicate tasks or notifications.\n- **Latest-state checks:** handlers re-read and lock the record before acting and skip if it has moved on (e.g. a deal already closed).\n- **Retries:** transient errors (network, timeouts, HTTP 5xx/429) back off exponentially with jitter (honouring Retry-After), up to the automation's max attempts. Permanent errors (bad configuration, HTTP 4xx) fail immediately.\n- **Dead-letter:** runs that exhaust retries are marked *failed*; the owner is notified, and after 3 consecutive failures the COO/CEO too. Failed runs can be inspected (logs, payload, error) and retried safely from the Automation centre.\n- **Timeouts:** each run races its automation's timeout. Workers that die mid-run are detected by lock age and the job is re-queued.\n- **Disconnected integrations:** sync workflows skip with a reason; they never record a successful sync or fabricate data.\n\n## Workflows\n\n`;
for (const w of WORKFLOWS) {
  a += `### ${w.name}\n\n- **ID:** \`${w.key}\`\n- **Trigger:** ${w.trigger.type === 'schedule' ? `schedule \`${w.trigger.cron}\` (organisation timezone)` : `events ${w.trigger.events.map((e) => `\`${e}\``).join(', ')}`}\n- **What it does:** ${w.description}\n- **Conditions:** ${w.conditions.join('; ')}\n- **Actions:** ${w.actions.join('; ')}\n${w.requiresIntegration ? `- **Requires integration:** ${w.requiresIntegration}\n` : ''}${w.configFields?.length ? `- **Settings:** ${w.configFields.map((f) => f.label).join(', ')}\n` : ''}\n`;
}
a += `## Mapping to the required workflows\n\n| Required workflow | Implemented by |\n|---|---|\n| 1. New lead | ingestion (\`services/leads.ts#ingestLead\`: validate, dedupe, store, source) + \`lead.new\` (assign, notify, follow-up task, log) |\n| 2. Overdue lead | \`lead.overdue\` |\n| 3. Lead qualification | \`lead.qualification\` |\n| 4. Campaign performance alert | \`campaign.refresh\` + \`campaign.alerts\` |\n| 5. Landing-page failure | \`monitoring.pages\` |\n| 6. New project | \`sales.pipeline\` (won → handover task) + \`project.from_handover\` |\n| 7. Approval and revision | \`approvals.workflow\` + \`approvals.reminders\` |\n| 8. Daily report | \`reports.daily\` |\n| 9. Client report | \`reports.client\` + \`reports.deliver\` |\n| 10. Proposal follow-up | \`sales.pipeline\` (proposal sent) + \`sales.proposal_followup\` |\n| Task reminders & escalation | \`tasks.reminders\` |\n| External orchestration | \`integrations.outbound_webhook\` |\n`;
writeFileSync('docs/AUTOMATIONS.md', a);
console.log('docs regenerated');
