# Integrations

Every integration follows the same contract (`src/server/integrations/types.ts`): **mode** (Disconnected / Demo / Live), **status** (only _Healthy_ after a real successful test or sync), credential configuration (secrets from the environment, non-secret IDs in Settings), health check, error handling (transient vs. permanent), data mapping, rate-limit handling (HTTP 429 + Retry-After → backoff), sync status and last successful sync time, and manual re-sync (Automation centre → _Campaign metrics refresh_ → Run now).

| Integration                   | Status in this release                                                                                                     | Where                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Website / landing-page forms  | **Implemented & tested end to end** (API key → `/api/v1/leads`)                                                            | Settings → Integrations & API keys |
| Meta Ads (Insights)           | Implemented against the documented API; **not exercised against a live account** (no credentials in the build environment) | Settings → Integrations            |
| Google Ads                    | Same as above                                                                                                              | Settings → Integrations            |
| Google Analytics 4 (Data API) | Same as above (connection test + key-event counts)                                                                         | Settings → Integrations            |
| Meta Lead Ads (webhook)       | Implemented (verification, signature check, Graph fetch, idempotent ingest); **not exercised against Meta**                | `/api/webhooks/meta-leads`         |
| n8n / Make                    | Outbound signed webhooks implemented; inbound via the leads API                                                            | Settings → Integrations            |
| Email (SMTP)                  | Implemented (reports, delivery); not verified against a real SMTP server                                                   | env vars                           |
| WhatsApp Business (Cloud API) | Template sends implemented, consent-gated and audited; **not exercised against a live WhatsApp account**; Demo mode tested | Settings → Integrations, lead page |
| Demo mode (Meta/Google Ads)   | Implemented; synthetic data for demo campaigns only, labelled _Demo_                                                       | Settings → Integrations            |
| Calendar invites (.ics)       | Implemented & tested: RFC 5545 invites for meetings; optional email via SMTP; no calendar API sync                         | Deal and lead pages                |

Before relying on any Live integration, press **Test connection** and then run **Campaign metrics refresh** from the Automation centre and check the run log.

## Website & landing-page forms (lead ingestion API)

1. Settings → Integrations & API keys → **Create key**. Optionally attribute the key to a client (admissions forms) so leads land as that client's enquiries and are routed to the client's account owner. The key is shown once; only its hash is stored.
2. From your form backend (or n8n/Make), POST:

```http
POST /api/v1/leads
Authorization: Bearer sx_live_…
Content-Type: application/json

{
  "name": "Ananya Shetty",
  "email": "ananya@example.com",
  "phone": "9845012345",
  "interest": "B.E. Computer Science",
  "city": "Udupi",
  "consentMarketing": true,
  "consentSource": "LP checkbox v2",
  "utmSource": "facebook", "utmMedium": "paid_social", "utmCampaign": "ug-2027",
  "fbclid": "…", "gclid": "…", "landingPage": "https://…",
  "campaignId": "<Sahynex OS campaign UUID, optional>",
  "externalId": "<your form submission id, optional — makes retries idempotent>",
  "sourceKey": "website_form",
  "website_url": ""
}
```

Responses: `201 {"outcome":"created","leadRef":"LD-0042"}` · `200 {"outcome":"updated"|"flagged_duplicate"}` · `422` validation errors with field messages · `401` bad/revoked key · `429` rate limited (300/min per key). `website_url` is a honeypot: leave it in your form hidden and empty; bots that fill it are ignored. Form data (`application/x-www-form-urlencoded`) is also accepted.

Only send `consentMarketing: true` when the person ticked an explicit consent box.

## Meta Ads (Marketing API Insights)

Secrets (env): `META_ACCESS_TOKEN` (System User token with `ads_read` on the client ad accounts), `META_GRAPH_VERSION` (a currently supported version, e.g. from the Graph API changelog).
Settings: **Ad account ID** (numeric, without `act_`). One ad account per organisation connection in this release; campaigns are matched by **Platform campaign ID** set on each Sahynex campaign.

Sync: every 6 hours the last 7 days are re-pulled at `level=campaign, time_increment=1` (`spend, impressions, reach, clicks, actions`). `actions` of type `lead` / `onsite_conversion.lead_grouped` / `offsite_conversion.fb_pixel_lead` become _platform leads_; `landing_page_view` becomes landing-page views. Spend is converted to minor units of the account currency. Platform campaigns not mapped to a Sahynex campaign are listed in the run log, not stored.

## Google Ads

Secrets: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` (scope `https://www.googleapis.com/auth/adwords`), `GOOGLE_ADS_API_VERSION`.
Settings: **Customer ID** (10 digits, no dashes) and, if you access it via a manager account, **Manager (MCC) ID**.
Query: `GoogleAdsService.Search` with `campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions`. `cost_micros` ÷ 10,000 → minor units. `conversions` are reported as platform leads (Google's attribution model).

## Google Analytics 4

Secrets: `GA4_REFRESH_TOKEN` (scope `analytics.readonly`) plus the shared Google OAuth client. Settings: **Property ID**. Used for connection health and key-event counts (e.g. `generate_lead`) via `properties/{id}:runReport`.

## Meta Lead Ads (webhook)

1. In the Meta app add **Webhooks**, subscribe the **Page** object to `leadgen`, callback `https://<APP_URL>/api/webhooks/meta-leads`, verify token = `META_VERIFY_TOKEN`.
2. Env: `META_VERIFY_TOKEN`, `META_APP_SECRET` (to verify `X-Hub-Signature-256`), `META_PAGE_ACCESS_TOKEN` (with `leads_retrieval`), `META_GRAPH_VERSION`.
3. Settings → Meta Lead Ads: mode **Live**, and **Page → client map** as `pageId:clientUUID,pageId2:clientUUID2`. Unmapped pages create Sahynex prospects.

Each leadgen event is fetched from the Graph API and ingested with `externalId = meta:<leadgen_id>`, so Meta's retries never create duplicates. Leads are linked to a Sahynex campaign when the Meta campaign ID matches a campaign's Platform campaign ID. Failures return 500 so Meta retries.

## n8n / Make (outbound webhooks)

Env: `N8N_WEBHOOK_SECRET` (16+ chars). Settings: **Webhook URL** (public https). Events: `lead.created`, `deal.stage_changed`, `proposal.sent`, `handover.approved`, `deliverable.submitted`, `approval.decided`, `task.completed`, `report.approved`.

```json
{
  "id": "<delivery id>",
  "event": "lead.created",
  "occurredAt": "…",
  "orgId": "…",
  "data": { "leadId": "…", "channel": "website_form" }
}
```

Headers: `X-Sahynex-Signature: sha256=<HMAC-SHA256(raw body, secret)>`, `X-Sahynex-Delivery` (use for idempotency), `X-Sahynex-Event`. Payloads carry IDs, not personal data. Retries use exponential backoff; failures appear in the Automation centre.

## Email (SMTP)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Used for report delivery. Without SMTP, reports are delivered in-app and the report shows a delivery note — it is never marked as emailed.

## WhatsApp Business (Cloud API)

Official endpoints only: `POST https://graph.facebook.com/{META_GRAPH_VERSION}/{phone-number-id}/messages` (type `template`) and `GET …/{phone-number-id}?fields=display_phone_number,verified_name,quality_rating` for the health check.

1. In Meta Business Manager, set up a WhatsApp Business Account and a business phone number; get your message templates approved in WhatsApp Manager.
2. Create a System User with `whatsapp_business_messaging`, generate a permanent token and set `WHATSAPP_ACCESS_TOKEN` (and `META_GRAPH_VERSION`).
3. In **Settings → Integrations → WhatsApp Business**, enter the **Phone number ID** and list the approved templates, one per line: `name:language:params|Label`, e.g. `admission_followup:en:first_name,institution|Admissions follow-up`. Parameters fill `{{1}}`, `{{2}}`… in order from `first_name`, `full_name`, `institution`, `interest`, `owner_name`.
4. Choose **Live**, press **Test connection**, then send one template to an internal test lead.
5. Grant the **Send approved WhatsApp templates** permission (`messaging.whatsapp`) to the roles that should send. New installations give it to Sales; on an existing installation an administrator adds it in **Settings → Roles**.

Safeguards (enforced on the server and covered by tests): manual, one lead at a time — there is no bulk or automated WhatsApp sending; only leads with recorded consent who have not opted out and have a valid mobile number; only templates listed in Settings; the same template cannot be re-sent to a lead within 24 hours; 60 sends per person per hour; every attempt is logged on the lead timeline with its real outcome (sent with WhatsApp message ID, failed with the error, or `[Demo — not sent]`). Template sends do **not** mark a lead as contacted — a human conversation does. Inbound messages/replies are not handled (no webhook).

**Demo mode** sends nothing and logs a clearly labelled attempt, so the flow can be tried without an account.

## Meetings and calendar invites

Sales can schedule discovery (and other) meetings from a deal or a lead. Each meeting becomes a task on the organiser's calendar, closes the automation's “Schedule discovery meeting” to-do, and offers an RFC 5545 invite (`/api/meetings/{id}/ics`, permission-checked) with a stable UID and sequence, so reschedules replace and cancellations remove the original calendar event. Ticking **Email a calendar invite** sends it through SMTP; without SMTP the person is told nothing was sent. There is no two-way Google/Microsoft calendar sync.

## Adding another provider

Implement `AdsAdapter` (`checkConfig`, `healthCheck`, `fetchDailyMetrics`) in `src/server/integrations/adapters.ts`, add it to `ADS_ADAPTERS` and `INTEGRATION_CATALOG`, add the enum value via a migration, and extend `campaign.refresh`. Use `apiFetch` so errors are classified for retries.
