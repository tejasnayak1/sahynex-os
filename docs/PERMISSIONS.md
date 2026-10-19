# Roles & permissions matrix

Generated from `src/lib/permissions.ts` (the seed for each organisation's roles). Administrators can change grants per role in **Settings → Roles & permissions**; this table shows the defaults.

Enforcement happens on the server: every service function checks permissions (`assertCan`) and every list/detail query is combined with a record-level scope from `src/server/access.ts`. Hiding navigation is a convenience only.

## Roles

- **CEO / Super Admin** (`ceo`) — Full access, including finance, roles and system settings.
- **COO / Operations Lead** (`coo`) — Runs delivery: projects, tasks, workflows, capacity and operational reporting.
- **Sales / Business Development** (`sales`) — Prospects, qualification, pipeline, proposals and handover.
- **Project Manager / Client Success** (`project_manager`) — Assigned clients and projects, tasks, approvals and client reporting.
- **Performance Marketing** (`performance_marketing`) — Campaigns, spend, CPL, tracking and attribution for authorised clients.
- **Design / Video / Content** (`creative`) — Assigned production work, uploads, revisions and submissions.
- **Employee** (`employee`) — Own tasks, daily reports, blockers and personal performance.
- **Client / External Reviewer** (`client_reviewer`) — Only explicitly shared deliverables, approvals and approved reports for their own organisation.

## Record-level scopes

| Scope suffix    | Meaning                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `.all`          | Every record in the organisation                                                                             |
| `.own`          | Records the user owns                                                                                        |
| `.assigned`     | Records on clients/projects the user owns or is a project member of                                          |
| Client reviewer | Only their own client; only deliverables explicitly submitted to the client; only approved/delivered reports |

## Matrix

| Permission                                                                                                       | Module     | CEO | COO | Sales | PM  | Perf | Creative | Employee | Client |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | :-: | :-: | :---: | :-: | :--: | :------: | :------: | :----: |
| View organisation-wide executive dashboard (`dashboard.executive`)                                               | Dashboard  |  ●  |  ●  |       |     |      |          |          |        |
| View all leads (`leads.read.all`)                                                                                | CRM        |  ●  |  ●  |   ●   |     |  ●   |          |          |        |
| View leads assigned to me (`leads.read.own`)                                                                     | CRM        |  ●  |     |       |  ●  |      |          |          |        |
| Create and edit leads I can view (`leads.write`)                                                                 | CRM        |  ●  |     |   ●   |     |      |          |          |        |
| Reassign lead owners (`leads.assign`)                                                                            | CRM        |  ●  |     |   ●   |     |      |          |          |        |
| Bulk import leads from CSV (`leads.import`)                                                                      | CRM        |  ●  |     |   ●   |     |      |          |          |        |
| Archive leads (`leads.delete`)                                                                                   | CRM        |  ●  |     |       |     |      |          |          |        |
| Export lead contact details (`leads.export_pii`)                                                                 | CRM        |  ●  |     |   ●   |     |      |          |          |        |
| Send approved WhatsApp templates to individual consented leads (`messaging.whatsapp`)                            | CRM        |  ●  |     |   ●   |     |      |          |          |        |
| View all deals (`deals.read.all`)                                                                                | Sales      |  ●  |  ●  |   ●   |     |      |          |          |        |
| View deals I own (`deals.read.own`)                                                                              | Sales      |  ●  |     |       |     |      |          |          |        |
| Create and edit deals I can view (`deals.write`)                                                                 | Sales      |  ●  |     |   ●   |     |      |          |          |        |
| Approve discounts, contracts and handovers (`deals.approve_commercials`)                                         | Sales      |  ●  |     |       |     |      |          |          |        |
| View all clients (`clients.read.all`)                                                                            | Clients    |  ●  |  ●  |       |     |      |          |          |        |
| View clients I own or work on (`clients.read.assigned`)                                                          | Clients    |  ●  |     |   ●   |  ●  |  ●   |    ●     |    ●     |        |
| Create and edit clients (`clients.write`)                                                                        | Clients    |  ●  |  ●  |       |  ●  |      |          |          |        |
| View all projects (`projects.read.all`)                                                                          | Projects   |  ●  |  ●  |       |     |      |          |          |        |
| View projects I am a member of (`projects.read.assigned`)                                                        | Projects   |  ●  |     |       |  ●  |  ●   |    ●     |    ●     |        |
| Create and edit projects I can view (`projects.write`)                                                           | Projects   |  ●  |  ●  |       |  ●  |      |          |          |        |
| Move projects into active delivery (`projects.activate`)                                                         | Projects   |  ●  |  ●  |       |     |      |          |          |        |
| See project budgets and revenue (`projects.commercials`)                                                         | Projects   |  ●  |  ●  |       |     |      |          |          |        |
| View all tasks (`tasks.read.all`)                                                                                | Tasks      |  ●  |  ●  |       |     |      |          |          |        |
| View my tasks and tasks on my projects (`tasks.read.assigned`)                                                   | Tasks      |  ●  |     |   ●   |  ●  |  ●   |    ●     |    ●     |        |
| Create and update tasks I can view (`tasks.write`)                                                               | Tasks      |  ●  |  ●  |   ●   |  ●  |  ●   |    ●     |    ●     |        |
| Assign tasks to other people (`tasks.assign`)                                                                    | Tasks      |  ●  |  ●  |       |  ●  |      |          |          |        |
| Manage task templates and SOPs (`tasks.templates`)                                                               | Tasks      |  ●  |  ●  |       |     |      |          |          |        |
| View team workload and capacity (`team.workload`)                                                                | Tasks      |  ●  |  ●  |       |  ●  |      |          |          |        |
| View campaigns and performance (scoped to visible clients) (`campaigns.read`)                                    | Campaigns  |  ●  |  ●  |       |  ●  |  ●   |          |          |        |
| Create campaigns, import metrics (`campaigns.write`)                                                             | Campaigns  |  ●  |     |       |     |  ●   |          |          |        |
| Configure spend and CPL thresholds (`campaigns.thresholds`)                                                      | Campaigns  |  ●  |     |       |     |  ●   |          |          |        |
| Manage landing-page monitors and incidents (`monitoring.manage`)                                                 | Campaigns  |  ●  |  ●  |       |     |  ●   |          |          |        |
| View deliverables on visible projects (`content.read`)                                                           | Content    |  ●  |  ●  |       |  ●  |  ●   |    ●     |    ●     |   ●    |
| Create deliverables, upload versions (`content.write`)                                                           | Content    |  ●  |  ●  |       |  ●  |      |    ●     |          |        |
| Decide internal reviews (`approvals.internal`)                                                                   | Approvals  |  ●  |  ●  |       |  ●  |      |          |          |        |
| Decide client approvals (client reviewers / account owners on behalf of client with record) (`approvals.client`) | Approvals  |  ●  |     |       |  ●  |      |          |          |   ●    |
| View reports for visible clients (`reports.read`)                                                                | Reports    |  ●  |  ●  |   ●   |  ●  |  ●   |          |          |   ●    |
| Generate report drafts (`reports.generate`)                                                                      | Reports    |  ●  |  ●  |       |  ●  |  ●   |          |          |        |
| Approve and deliver reports externally (`reports.approve`)                                                       | Reports    |  ●  |  ●  |       |     |      |          |          |        |
| View team members' daily reports (`daily_reports.team`)                                                          | Reports    |  ●  |  ●  |       |  ●  |      |          |          |        |
| View automations and execution logs (`automation.read`)                                                          | Automation |  ●  |  ●  |       |  ●  |  ●   |          |          |        |
| Enable/disable, configure and retry automations (`automation.manage`)                                            | Automation |  ●  |  ●  |       |     |      |          |          |        |
| View company-wide finances, revenue and margins (`finance.read`)                                                 | Finance    |  ●  |     |       |     |      |          |          |        |
| Record budgets, expenses and invoices (`finance.write`)                                                          | Finance    |  ●  |     |       |     |      |          |          |        |
| Edit organisation settings (`settings.org`)                                                                      | Settings   |  ●  |     |       |     |      |          |          |        |
| Invite and manage users (`settings.users`)                                                                       | Settings   |  ●  |  ●  |       |     |      |          |          |        |
| Edit roles and permissions (`settings.roles`)                                                                    | Settings   |  ●  |     |       |     |      |          |          |        |
| Manage integrations and API keys (`settings.integrations`)                                                       | Settings   |  ●  |     |       |     |      |          |          |        |
| View the audit log (`audit.read`)                                                                                | Settings   |  ●  |  ●  |       |     |      |          |          |        |
