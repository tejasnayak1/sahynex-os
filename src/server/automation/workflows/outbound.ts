import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { apiFetch } from '../../integrations/http';
import { assertPublicUrl } from '../../services/monitoring';
import type { WorkflowDefinition } from '../types';

/**
 * Outbound webhooks for external orchestration (n8n, Make, Zapier). Each domain event is POSTed as JSON
 * with an `X-Sahynex-Signature: sha256=<hmac>` header (HMAC-SHA256 of the raw body with N8N_WEBHOOK_SECRET)
 * and an `X-Sahynex-Delivery` id that receivers should use for idempotency. Payloads contain record IDs,
 * not personal data — receivers fetch details through the API they are authorised for.
 */
export const outboundWebhook: WorkflowDefinition = {
  key: 'integrations.outbound_webhook',
  name: 'Outbound webhooks (n8n / Make)',
  description:
    'Forwards domain events (new lead, deal stage change, handover approved, approvals, report approved) to the webhook URL configured on the n8n / Make integration. Disabled unless that integration is Live.',
  trigger: {
    type: 'event',
    events: [
      'lead.created',
      'deal.stage_changed',
      'handover.approved',
      'approval.decided',
      'deliverable.submitted',
      'report.approved',
      'proposal.sent',
      'task.completed',
    ],
  },
  conditions: [
    'n8n / Make integration is Live with a webhook URL',
    'URL resolves to a public address',
    'N8N_WEBHOOK_SECRET is set',
  ],
  actions: ['POST signed JSON event', 'Retry with backoff on network / 5xx / 429'],
  defaultConfig: {},
  requiresIntegration: 'n8n',
  handler: async (ctx) => {
    const [conn] = await ctx.db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.orgId, ctx.orgId),
          eq(schema.integrationConnections.provider, 'n8n'),
        ),
      );
    if (!conn || conn.mode !== 'live' || !conn.config.webhookUrl)
      return { status: 'skipped', summary: 'n8n / Make integration is not live — event not forwarded.' };
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!secret || secret.length < 16)
      return {
        status: 'skipped',
        summary: 'N8N_WEBHOOK_SECRET is not set — refusing to send unsigned webhooks.',
      };
    const url = (await assertPublicUrl(conn.config.webhookUrl)).toString();
    const { event, ...data } = ctx.payload;
    const body = JSON.stringify({
      id: ctx.execution.id,
      event,
      occurredAt: ctx.execution.createdAt.toISOString(),
      orgId: ctx.orgId,
      data,
    });
    const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sahynex-Signature': signature,
        'X-Sahynex-Delivery': ctx.execution.id,
        'X-Sahynex-Event': String(event),
      },
      body,
      timeoutMs: 15_000,
    });
    await ctx.db
      .update(schema.integrationConnections)
      .set({ status: 'healthy', lastSuccessSyncAt: new Date(), lastError: null })
      .where(eq(schema.integrationConnections.id, conn.id));
    return { status: 'succeeded', summary: `Delivered ${String(event)} to webhook.` };
  },
};
