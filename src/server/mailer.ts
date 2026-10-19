import nodemailer, { type Transporter } from 'nodemailer';

export type MailResult = { status: 'sent' | 'not_configured' | 'failed'; error?: string; messageId?: string };

let transport: Transporter | null | undefined;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransport() {
  if (transport !== undefined) return transport;
  transport = mailConfigured()
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      })
    : null;
  return transport;
}

/** Sends an email if SMTP is configured. Never pretends to succeed when it is not. */
export async function sendMail(msg: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** iCalendar invite (METHOD:REQUEST / CANCEL) — sent as a calendar part mail clients recognise. */
  icalEvent?: { method: 'REQUEST' | 'CANCEL'; filename: string; content: string };
}): Promise<MailResult> {
  const t = getTransport();
  if (!t) return { status: 'not_configured' };
  try {
    const info = await t.sendMail({ from: process.env.SMTP_FROM, ...msg });
    return { status: 'sent', messageId: info.messageId };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
