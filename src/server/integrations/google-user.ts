/**
 * A person's own Google account — Gmail and Calendar, read-only — for their Home page.
 *
 * Official, documented endpoints only:
 *   OAuth 2.0:  https://accounts.google.com/o/oauth2/v2/auth  ·  https://oauth2.googleapis.com/token
 *   Gmail API:  GET https://gmail.googleapis.com/gmail/v1/users/me/messages (+ /messages/{id}, /labels/INBOX)
 *   Calendar:   GET https://www.googleapis.com/calendar/v3/calendars/primary/events
 *
 * Scopes are read-only. Nothing is ever sent, deleted or modified in the person's mailbox or
 * calendar. Message bodies are never fetched — only sender, subject, date and Gmail's snippet.
 *
 * Status: implemented to the public documentation; NOT exercised against a live Google account
 * from the build environment (no credentials). Demo mode returns clearly labelled sample data.
 */
import { PermanentError } from '../automation/types';
import { hmac, safeEqual } from '../crypto';
import { apiFetch } from './http';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const env = (k: string) => process.env[k]?.trim() || '';

export function googleConfigured(): { ok: boolean; missing: string[] } {
  const missing = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'APP_URL'].filter((k) => !env(k));
  return { ok: missing.length === 0, missing };
}

export const redirectUri = () => `${env('APP_URL').replace(/\/$/, '')}/api/google/callback`;

/* ------------------------------------------------------------ OAuth state */

/** Signed, expiring state bound to the user, so a callback cannot be replayed for someone else. */
export function signState(userId: string, now = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / 1000) + 600}.${Math.random().toString(36).slice(2, 10)}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmac(`google-oauth:${payload}`)}`;
}

export function verifyState(state: string, userId: string, now = Date.now()): boolean {
  const [b64, sig] = state.split('.');
  if (!b64 || !sig) return false;
  const payload = Buffer.from(b64, 'base64url').toString();
  if (!safeEqual(sig, hmac(`google-oauth:${payload}`))) return false;
  const [uid, exp] = payload.split('.');
  return uid === userId && Number(exp) * 1000 > now;
}

export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(code: string) {
  const body = (await apiFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })) as { refresh_token?: string; access_token?: string; scope?: string; id_token?: string };
  if (!body.refresh_token || !body.access_token)
    throw new PermanentError(
      'Google did not return a refresh token. Remove the app from your Google account and connect again.',
    );
  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    scope: body.scope ?? '',
    idToken: body.id_token,
  };
}

/** Email from the id_token payload (already verified by Google's token endpoint over TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()) as {
      email?: string;
    };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function accessTokenFor(refreshToken: string): Promise<string> {
  const body = (await apiFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    timeoutMs: 15_000,
  })) as { access_token?: string };
  if (!body.access_token) throw new PermanentError('Google did not return an access token.');
  return body.access_token;
}

export async function revoke(refreshToken: string) {
  await apiFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    timeoutMs: 10_000,
  }).catch(() => undefined);
}

/* ------------------------------------------------------------------ Gmail */

export type MailItem = {
  id: string;
  from: string;
  fromEmail: string | null;
  subject: string;
  snippet: string;
  date: string | null;
  unread: boolean;
  important: boolean;
  link: string;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

const decodeEntities = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export function parseGmailMessage(m: GmailMessage): MailItem {
  const h = (n: string) =>
    m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
  const fromRaw = h('From');
  const match = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const name = (match ? match[1] : fromRaw).trim();
  const email = match
    ? match[2].trim().toLowerCase()
    : /@/.test(fromRaw)
      ? fromRaw.trim().toLowerCase()
      : null;
  return {
    id: m.id,
    from: name || email || 'Unknown sender',
    fromEmail: email,
    subject: h('Subject').trim() || '(no subject)',
    snippet: decodeEntities(m.snippet ?? '').slice(0, 180),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    unread: (m.labelIds ?? []).includes('UNREAD'),
    important: (m.labelIds ?? []).includes('IMPORTANT'),
    link: `https://mail.google.com/mail/u/0/#all/${m.threadId ?? m.id}`,
  };
}

/** LinkedIn message/InMail notification emails (LinkedIn offers no API for reading messages). */
export function isLinkedInMessageEmail(mail: Pick<MailItem, 'fromEmail' | 'subject'>): boolean {
  if (!mail.fromEmail || !/(^|\.|@)linkedin\.com$/.test(mail.fromEmail.split('@')[1] ?? '')) return false;
  return /message|messaged|sent you|inmail|replied|conversation/i.test(mail.subject);
}

async function gmail<T>(token: string, path: string): Promise<T> {
  return (await apiFetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  })) as T;
}

async function listMail(token: string, q: string, max: number): Promise<MailItem[]> {
  const list = await gmail<{ messages?: Array<{ id: string }> }>(
    token,
    `messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const full = await Promise.all(
    ids.map((id) =>
      gmail<GmailMessage>(
        token,
        `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );
  return full.map(parseGmailMessage);
}

export async function fetchInbox(token: string) {
  const [inbox, linkedin, label] = await Promise.all([
    listMail(token, 'in:inbox newer_than:1d -category:promotions -category:social -category:forums', 12),
    listMail(token, 'from:linkedin.com newer_than:3d', 15),
    gmail<{ messagesUnread?: number }>(token, 'labels/INBOX'),
  ]);
  return {
    unreadCount: label.messagesUnread ?? null,
    recent: inbox.filter((m) => !isLinkedInMessageEmail(m)),
    linkedin: linkedin.filter(isLinkedInMessageEmail).slice(0, 6),
  };
}

/* --------------------------------------------------------------- Calendar */

export type CalendarItem = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  meetLink: string | null;
  link: string | null;
  attendees: number;
};

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

export function parseCalendarEvent(e: GEvent): CalendarItem | null {
  if (e.status === 'cancelled') return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  return {
    id: e.id,
    title: e.summary?.trim() || '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: !e.start?.dateTime,
    location: e.location ?? null,
    meetLink: e.hangoutLink ?? null,
    link: e.htmlLink ?? null,
    attendees: e.attendees?.length ?? 0,
  };
}

export async function fetchCalendar(token: string, from: Date, to: Date): Promise<CalendarItem[]> {
  const q = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
  });
  const body = (await apiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  })) as { items?: GEvent[] };
  return (body.items ?? []).map(parseCalendarEvent).filter((x): x is CalendarItem => x !== null);
}
