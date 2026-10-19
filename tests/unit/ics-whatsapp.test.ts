import { describe, expect, it } from 'vitest';
import { buildIcs, icsDate, icsEscape, icsFold } from '@/lib/ics';
import { buildTemplatePayload, parseTemplates, toWhatsAppRecipient } from '@/server/integrations/whatsapp';

const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('iCalendar invites', () => {
  const base = {
    uid: 'abc@sahynex-os',
    sequence: 0,
    title: 'Discovery meeting — Demo College',
    start: new Date('2026-11-03T05:30:00Z'), // 11:00 IST
    end: new Date('2026-11-03T06:15:00Z'),
    stamp: new Date('2026-10-19T10:00:00Z'),
  };

  it('writes UTC times, a stable UID and sequence, with CRLF line endings', () => {
    const ics = buildIcs(base);
    expect(icsDate(base.start)).toBe('20261103T053000Z');
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('UID:abc@sahynex-os\r\n');
    expect(ics).toContain('SEQUENCE:0\r\n');
    expect(ics).toContain('DTSTART:20261103T053000Z\r\n');
    expect(ics).toContain('DTEND:20261103T061500Z\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('marks cancellations so calendars remove the original event', () => {
    const ics = buildIcs({ ...base, sequence: 2, cancelled: true });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('escapes text and folds long lines at 75 octets (multi-byte safe)', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = 'DESCRIPTION:' + 'ಕನ್ನಡ ₹ agenda item, '.repeat(20);
    const folded = icsFold(long);
    for (const line of folded.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(long);
  });

  it('cannot be used to inject properties through names or attendee addresses', () => {
    const ics = buildIcs({
      ...base,
      organizer: { name: 'Evil\r\nATTENDEE:mailto:x@y.z', email: 'org@sahynex.test' },
      attendees: ['ok@example.com', 'bad@example.com\r\nX-INJECT:1', 'not-an-email'],
      description: 'Line 1\r\nX-INJECTED:1',
    });
    const lines = unfold(ics).split('\r\n');
    expect(lines.filter((l) => l.startsWith('ATTENDEE')).length).toBe(1);
    expect(lines.some((l) => l.startsWith('X-INJECT'))).toBe(false);
    expect(lines.find((l) => l.startsWith('ORGANIZER'))).toBe(
      'ORGANIZER;CN=Evil  ATTENDEE mailto x@y.z:mailto:org@sahynex.test',
    );
  });

  it('rejects an event that ends before it starts', () => {
    expect(() => buildIcs({ ...base, end: base.start })).toThrow(/after its start/);
  });
});

describe('WhatsApp templates', () => {
  it('parses the configured template list and reports unusable lines', () => {
    const { templates, errors } = parseTemplates(
      [
        '# comment',
        'admission_followup:en:first_name,institution|Admissions follow-up',
        'open_day_invite:kn',
        'Bad Name:en',
        'reminder:english',
        'thanks:en:password',
        'open_day_invite:kn',
      ].join('\n'),
    );
    expect(templates).toEqual([
      {
        name: 'admission_followup',
        language: 'en',
        params: ['first_name', 'institution'],
        label: 'Admissions follow-up',
      },
      { name: 'open_day_invite', language: 'kn', params: [], label: 'open day invite' },
    ]);
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toMatch(/unknown parameter password/);
    expect(errors.join(' ')).toMatch(/listed twice/);
  });

  it('formats recipients as digits with country code', () => {
    expect(toWhatsAppRecipient('+919845011111')).toBe('919845011111');
    expect(toWhatsAppRecipient(null)).toBeNull();
    expect(toWhatsAppRecipient('+12')).toBeNull();
  });

  it('builds the Cloud API template payload with body parameters in order', () => {
    const p = buildTemplatePayload(
      '919845011111',
      { name: 'admission_followup', language: 'en', params: ['first_name', 'institution'], label: 'x' },
      ['Kavya', 'Demo Institute'],
    );
    expect(p).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919845011111',
      type: 'template',
      template: {
        name: 'admission_followup',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Kavya' },
              { type: 'text', text: 'Demo Institute' },
            ],
          },
        ],
      },
    });
    expect(() =>
      buildTemplatePayload('91', { name: 'a', language: 'en', params: ['first_name'], label: 'a' }, []),
    ).toThrow(/mismatch/);
  });
});
