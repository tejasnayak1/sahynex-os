/**
 * Minimal RFC 5545 (iCalendar) writer for meeting invites.
 *
 * - Times are written in UTC ("Z" form), so no VTIMEZONE block is needed and DST is unambiguous.
 * - A stable UID + increasing SEQUENCE lets calendar clients replace an event when it is
 *   rescheduled (METHOD:REQUEST) or remove it when cancelled (METHOD:CANCEL).
 * - Text values are escaped and long lines folded at 75 octets, as the RFC requires.
 */

export type IcsEvent = {
  uid: string;
  sequence: number;
  title: string;
  start: Date;
  end: Date;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer?: { name: string; email: string } | null;
  attendees?: string[];
  cancelled?: boolean;
  stamp?: Date;
};

export function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function icsEscape(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line to 75 octets per physical line (continuations start with one space). */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose one octet to the leading space
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n');
}

/** Strips characters that could break a parameter value (CN) or inject properties. */
function paramSafe(v: string): string {
  return v.replace(/[\r\n";:,]/g, ' ').trim();
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function buildIcs(e: IcsEvent): string {
  if (!(e.end > e.start)) throw new Error('Event end must be after its start.');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sahynex TechSolutions//Sahynex OS//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${icsEscape(e.uid)}`,
    `SEQUENCE:${Math.max(0, Math.floor(e.sequence))}`,
    `DTSTAMP:${icsDate(e.stamp ?? new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.url && /^https?:\/\//i.test(e.url)) lines.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
  if (e.organizer && EMAIL.test(e.organizer.email))
    lines.push(`ORGANIZER;CN=${paramSafe(e.organizer.name)}:mailto:${e.organizer.email}`);
  for (const a of e.attendees ?? [])
    if (EMAIL.test(a))
      lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
