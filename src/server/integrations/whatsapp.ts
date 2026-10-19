/**
 * WhatsApp Business Platform (Cloud API) adapter — official, documented endpoints only:
 *   - Send:   POST https://graph.facebook.com/{version}/{phone-number-id}/messages   (type: template)
 *   - Health: GET  https://graph.facebook.com/{version}/{phone-number-id}?fields=display_phone_number,verified_name,quality_rating
 *
 * Only pre-approved *template* messages are supported, because those are the only messages a business
 * may send to start a conversation. Free-form replies inside a 24-hour customer-service window are
 * out of scope (no inbound webhook is implemented).
 *
 * Secrets (WHATSAPP_ACCESS_TOKEN) live in the server environment; the phone-number ID and the list of
 * approved templates are non-secret connection config.
 *
 * Status: implemented to the public documentation, NOT exercised against a live WhatsApp Business
 * account from the build environment. Use "Test connection", then send one template to an internal
 * test number before using it with real leads.
 */
import { PermanentError } from '../automation/types';
import { apiFetch } from './http';
import type { Connection } from './types';

export const TEMPLATE_PARAMS = ['first_name', 'full_name', 'institution', 'interest', 'owner_name'] as const;
export type TemplateParam = (typeof TEMPLATE_PARAMS)[number];

export type WhatsAppTemplate = {
  /** Template name exactly as approved in WhatsApp Manager. */
  name: string;
  /** Template language code, e.g. en, en_US, kn, hi. */
  language: string;
  /** Values for {{1}}, {{2}}… in the template body, in order. */
  params: TemplateParam[];
  label: string;
};

/**
 * Parses the connection's template list. One template per line:
 *   name:language[:param,param…][|Label]
 * e.g. `admission_followup:en:first_name,institution|Admissions follow-up`
 * Returns the templates plus human-readable errors for lines that cannot be used.
 */
export function parseTemplates(raw: string | undefined | null): {
  templates: WhatsAppTemplate[];
  errors: string[];
} {
  const templates: WhatsAppTemplate[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, line0] of (raw ?? '').split(/\r?\n/).entries()) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    const [spec, labelPart] = line.split('|', 2);
    const [name, language, paramStr = ''] = spec.split(':').map((s) => s.trim());
    if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) {
      errors.push(`Line ${i + 1}: template names use lowercase letters, digits and underscores.`);
      continue;
    }
    if (!language || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) {
      errors.push(`Line ${i + 1}: language must look like "en" or "en_US".`);
      continue;
    }
    const params = paramStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const bad = params.filter((p) => !(TEMPLATE_PARAMS as readonly string[]).includes(p));
    if (bad.length) {
      errors.push(
        `Line ${i + 1}: unknown parameter ${bad.join(', ')} (allowed: ${TEMPLATE_PARAMS.join(', ')}).`,
      );
      continue;
    }
    const key = `${name}:${language}`;
    if (seen.has(key)) {
      errors.push(`Line ${i + 1}: ${key} is listed twice.`);
      continue;
    }
    seen.add(key);
    templates.push({
      name,
      language,
      params: params as TemplateParam[],
      label: labelPart?.trim() || name.replace(/_/g, ' '),
    });
  }
  return { templates, errors };
}

/** WhatsApp expects the recipient as digits with country code and no "+". */
export function toWhatsAppRecipient(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function buildTemplatePayload(to: string, t: WhatsAppTemplate, values: string[]) {
  if (values.length !== t.params.length) throw new Error('Template parameter count mismatch.');
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: t.name,
      language: { code: t.language },
      ...(values.length
        ? {
            components: [
              {
                type: 'body',
                parameters: values.map((text) => ({ type: 'text', text: text.slice(0, 1024) })),
              },
            ],
          }
        : {}),
    },
  };
}

const env = (k: string) => process.env[k]?.trim() || '';

export const whatsappAdapter = {
  provider: 'whatsapp' as const,
  label: 'WhatsApp Business',
  requiredEnv: ['WHATSAPP_ACCESS_TOKEN', 'META_GRAPH_VERSION'],
  requiredConfig: [
    {
      key: 'phoneNumberId',
      label: 'Phone number ID',
      help: 'WhatsApp Manager → API setup → Phone number ID (numeric; not the phone number itself).',
    },
    {
      key: 'templates',
      label: 'Approved templates',
      multiline: true,
      help: 'One per line: name:language:params|Label — e.g. admission_followup:en:first_name,institution|Admissions follow-up. Params fill {{1}}, {{2}}… from: first_name, full_name, institution, interest, owner_name.',
    },
  ],
  setupSteps: [
    'Create (or use) a WhatsApp Business Account in Meta Business Manager and add a business phone number.',
    'Get message templates approved in WhatsApp Manager (category Utility or Marketing as appropriate).',
    'Create a System User with the whatsapp_business_messaging permission and generate a permanent token; set WHATSAPP_ACCESS_TOKEN in the server environment (and META_GRAPH_VERSION).',
    'Enter the Phone number ID and list the approved templates below, choose Live and press Test connection.',
    'Send one template to an internal test lead first. Messages are only ever sent manually, one lead at a time, to leads with recorded consent who have not opted out.',
  ],
  checkConfig(conn: Pick<Connection, 'config'>) {
    const missing = this.requiredEnv.filter((k) => !env(k));
    if (!conn.config.phoneNumberId) missing.push('phoneNumberId');
    if (!parseTemplates(conn.config.templates).templates.length) missing.push('templates');
    return { ok: missing.length === 0, missing };
  },
  base(conn: Pick<Connection, 'config'>) {
    const id = conn.config.phoneNumberId ?? '';
    if (!/^\d{5,25}$/.test(id)) throw new PermanentError('WhatsApp phone number ID must be numeric.');
    return `https://graph.facebook.com/${env('META_GRAPH_VERSION')}/${id}`;
  },
  async healthCheck(conn: Pick<Connection, 'config'>) {
    const body = (await apiFetch(
      `${this.base(conn)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}` }, timeoutMs: 15_000 },
    )) as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
    return {
      ok: true,
      message: `Connected to ${body.verified_name ?? 'WhatsApp number'} (${body.display_phone_number ?? 'unknown'}), quality ${body.quality_rating ?? 'unknown'}.`,
    };
  },
  async sendTemplate(conn: Pick<Connection, 'config'>, to: string, t: WhatsAppTemplate, values: string[]) {
    const body = (await apiFetch(`${this.base(conn)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildTemplatePayload(to, t, values)),
      timeoutMs: 20_000,
    })) as { messages?: Array<{ id: string }> };
    const id = body.messages?.[0]?.id;
    if (!id) throw new PermanentError('WhatsApp accepted the request but returned no message ID.');
    return { messageId: id };
  },
};
