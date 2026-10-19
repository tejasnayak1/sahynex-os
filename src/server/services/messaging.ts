import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { leadScope } from '../access';
import { audit } from '../audit';
import { conflict, invalid, notFound, precondition } from '../errors';
import {
  parseTemplates,
  toWhatsAppRecipient,
  whatsappAdapter,
  type WhatsAppTemplate,
} from '../integrations/whatsapp';
import { rateLimit } from '../rate-limit';

const { leads, leadActivities, integrationConnections, users, clients } = schema;

export const WHATSAPP_SENDS_PER_USER_PER_HOUR = 60;
const RESEND_WINDOW_HOURS = 24;

export type WhatsAppAvailability =
  | { state: 'disconnected' }
  | { state: 'misconfigured'; missing: string[] }
  | { state: 'ready'; mode: 'demo' | 'live'; templates: WhatsAppTemplate[] };

/** What the lead page should offer. Never reports "ready" for a connection that cannot send. */
export async function whatsappAvailability(actor: Actor): Promise<WhatsAppAvailability> {
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(eq(integrationConnections.orgId, actor.orgId), eq(integrationConnections.provider, 'whatsapp')),
    );
  if (!conn || conn.mode === 'disconnected') return { state: 'disconnected' };
  const { templates } = parseTemplates(conn.config.templates);
  if (conn.mode === 'live') {
    const cfg = whatsappAdapter.checkConfig(conn);
    if (!cfg.ok) return { state: 'misconfigured', missing: cfg.missing };
  } else if (!templates.length) return { state: 'misconfigured', missing: ['templates'] };
  return { state: 'ready', mode: conn.mode, templates };
}

/** Why this lead cannot receive a WhatsApp template right now, or null if it can. */
export function whatsappBlocker(lead: {
  suppressed: boolean;
  consentMarketing: boolean;
  phoneNormalized: string | null;
  deletedAt?: Date | null;
}): string | null {
  if (lead.deletedAt) return 'This lead is archived.';
  if (lead.suppressed) return 'This person has opted out of communications.';
  if (!lead.consentMarketing) return 'No recorded consent to be contacted. Record consent first.';
  if (!toWhatsAppRecipient(lead.phoneNormalized)) return 'No valid mobile number on this lead.';
  return null;
}

/**
 * Sends one approved template to one lead. Manual, per-lead only — there is deliberately no bulk or
 * automated WhatsApp sending. Every attempt is logged on the lead's timeline with its real outcome.
 */
export async function sendWhatsAppTemplate(
  actor: Actor,
  leadId: string,
  templateKey: string,
): Promise<{ status: 'sent' | 'demo'; messageId?: string; template: WhatsAppTemplate }> {
  assertCan(actor, 'leads.write');
  assertCan(actor, 'messaging.whatsapp');
  const userId = actorUserId(actor);
  if (!userId) throw invalid('WhatsApp messages are sent by a person.');

  const avail = await whatsappAvailability(actor);
  if (avail.state === 'disconnected')
    throw precondition(
      'WhatsApp Business is not connected. An administrator can connect it in Settings → Integrations.',
    );
  if (avail.state === 'misconfigured')
    throw precondition(`WhatsApp Business is not fully configured (missing: ${avail.missing.join(', ')}).`);
  const template = avail.templates.find((t) => `${t.name}:${t.language}` === templateKey);
  if (!template) throw invalid('Choose one of the approved templates.', { template: 'Unknown template' });

  await rateLimit(`wa-send:${userId}`, WHATSAPP_SENDS_PER_USER_PER_HOUR, 3600);

  // Phase 1 (transaction): re-check the lead's latest state, block duplicates, record a pending attempt.
  const { activityId, to, values } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        lead: leads,
        ownerName: users.name,
        clientName: clients.name,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(clients, eq(clients.id, leads.clientId))
      .where(and(eq(leads.id, leadId), leadScope(actor)))
      .for('update', { of: leads });
    if (!row) throw notFound('Lead');
    const blocker = whatsappBlocker(row.lead);
    if (blocker) throw precondition(blocker);

    const [recent] = await tx
      .select({ id: leadActivities.id })
      .from(leadActivities)
      .where(
        and(
          eq(leadActivities.leadId, leadId),
          eq(leadActivities.type, 'whatsapp'),
          sql`${leadActivities.meta}->>'template' = ${templateKey}`,
          sql`coalesce(${leadActivities.meta}->>'status', '') in ('pending', 'sent', 'demo')`,
          gt(leadActivities.createdAt, sql`now() - make_interval(hours => ${RESEND_WINDOW_HOURS})`),
        ),
      )
      .limit(1);
    if (recent) throw conflict(`“${template.label}” was already sent to this lead in the last 24 hours.`);

    const l = row.lead;
    const source: Record<string, string | null> = {
      first_name: l.name.trim().split(/\s+/)[0] ?? null,
      full_name: l.name.trim(),
      institution: row.clientName ?? l.organisationName ?? null,
      interest: l.interest ?? null,
      owner_name: row.ownerName ?? null,
    };
    const values = template.params.map((p) => source[p]?.trim() ?? '');
    const missing = template.params.filter((_, i) => !values[i]);
    if (missing.length)
      throw precondition(`This template needs ${missing.join(', ')}, which this lead does not have.`);

    const demo = avail.mode === 'demo';
    const [a] = await tx
      .insert(leadActivities)
      .values({
        orgId: actor.orgId,
        leadId,
        actorId: userId,
        type: 'whatsapp',
        body: demo
          ? `[Demo — not sent] WhatsApp template “${template.label}”`
          : `WhatsApp template “${template.label}” — sending…`,
        meta: { template: templateKey, status: demo ? 'demo' : 'pending', demo },
      })
      .returning({ id: leadActivities.id });
    await audit(tx, actor, demo ? 'whatsapp.demo_logged' : 'whatsapp.send_requested', 'lead', leadId, {
      after: { template: templateKey },
    });
    return { activityId: a.id, to: toWhatsAppRecipient(l.phoneNormalized)!, values };
  });

  if (avail.mode === 'demo') return { status: 'demo', template };

  // Phase 2: call WhatsApp outside the transaction, then record the real outcome.
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(eq(integrationConnections.orgId, actor.orgId), eq(integrationConnections.provider, 'whatsapp')),
    );
  try {
    const { messageId } = await whatsappAdapter.sendTemplate(conn, to, template, values);
    await db
      .update(leadActivities)
      .set({
        body: `WhatsApp template “${template.label}” sent`,
        meta: { template: templateKey, status: 'sent', messageId },
      })
      .where(eq(leadActivities.id, activityId));
    await audit(db, actor, 'whatsapp.sent', 'lead', leadId, { after: { template: templateKey, messageId } });
    return { status: 'sent', messageId, template };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 400) : String(e);
    await db
      .update(leadActivities)
      .set({
        body: `WhatsApp template “${template.label}” failed`,
        meta: { template: templateKey, status: 'failed', error: message },
      })
      .where(eq(leadActivities.id, activityId));
    await db
      .update(integrationConnections)
      .set({ status: 'error', lastError: message })
      .where(eq(integrationConnections.id, conn.id));
    await audit(db, actor, 'whatsapp.failed', 'lead', leadId, {
      after: { template: templateKey, error: message },
    });
    throw precondition(`WhatsApp did not accept the message: ${message}`);
  }
}

export function canSendWhatsApp(actor: Actor) {
  return can(actor, 'messaging.whatsapp') && can(actor, 'leads.write');
}
