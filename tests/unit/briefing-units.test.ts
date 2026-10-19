import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { demoBrief, parseBrief } from '@/server/integrations/ai';
import {
  isLinkedInMessageEmail,
  parseCalendarEvent,
  parseGmailMessage,
  signState,
  verifyState,
} from '@/server/integrations/google-user';
import { demoSnapshot } from '@/server/integrations/instagram';

describe('token encryption', () => {
  it('round-trips, uses a fresh IV each time and detects tampering', () => {
    const a = encryptSecret('1//refresh-token');
    const b = encryptSecret('1//refresh-token');
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(decryptSecret(a)).toBe('1//refresh-token');
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

describe('Google OAuth state', () => {
  it('is bound to the user and expires', () => {
    const s = signState('user-1');
    expect(verifyState(s, 'user-1')).toBe(true);
    expect(verifyState(s, 'user-2')).toBe(false);
    expect(verifyState(s, 'user-1', Date.now() + 11 * 60_000)).toBe(false);
    expect(verifyState(`${s}x`, 'user-1')).toBe(false);
  });
});

describe('Gmail parsing', () => {
  it('extracts sender, subject, unread/important flags and decodes the snippet', () => {
    const m = parseGmailMessage({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
      snippet: 'Can we meet &amp; review the film&#39;s cut?',
      internalDate: '1760920000000',
      payload: {
        headers: [
          { name: 'From', value: '"Principal, SCEM" <Principal@Example.edu>' },
          { name: 'Subject', value: 'Campus film' },
        ],
      },
    });
    expect(m).toMatchObject({
      from: 'Principal, SCEM',
      fromEmail: 'principal@example.edu',
      subject: 'Campus film',
      snippet: "Can we meet & review the film's cut?",
      unread: true,
      important: true,
      link: 'https://mail.google.com/mail/u/0/#all/t1',
    });
    expect(parseGmailMessage({ id: 'x', payload: { headers: [] } }).subject).toBe('(no subject)');
  });

  it('recognises LinkedIn message alerts but not other LinkedIn mail or look-alike domains', () => {
    expect(
      isLinkedInMessageEmail({
        fromEmail: 'messages-noreply@linkedin.com',
        subject: 'Rahul sent you a message',
      }),
    ).toBe(true);
    expect(
      isLinkedInMessageEmail({ fromEmail: 'inmail-hit-reply@linkedin.com', subject: 'New InMail from Asha' }),
    ).toBe(true);
    expect(
      isLinkedInMessageEmail({ fromEmail: 'jobs-noreply@linkedin.com', subject: '10 new jobs for you' }),
    ).toBe(false);
    expect(isLinkedInMessageEmail({ fromEmail: 'x@notlinkedin.com', subject: 'sent you a message' })).toBe(
      false,
    );
  });
});

describe('Calendar parsing', () => {
  it('keeps timed and all-day events, drops cancelled and declined ones', () => {
    expect(
      parseCalendarEvent({
        id: 'e1',
        summary: 'Call with AITM',
        start: { dateTime: '2026-10-20T10:00:00+05:30' },
        end: { dateTime: '2026-10-20T10:30:00+05:30' },
        hangoutLink: 'https://meet.google.com/abc',
        attendees: [{ self: true, responseStatus: 'accepted' }, {}],
      }),
    ).toMatchObject({
      title: 'Call with AITM',
      allDay: false,
      meetLink: 'https://meet.google.com/abc',
      attendees: 2,
    });
    expect(parseCalendarEvent({ id: 'e2', start: { date: '2026-10-20' } })).toMatchObject({
      allDay: true,
      title: '(no title)',
    });
    expect(parseCalendarEvent({ id: 'e3', status: 'cancelled' })).toBeNull();
    expect(
      parseCalendarEvent({ id: 'e4', attendees: [{ self: true, responseStatus: 'declined' }] }),
    ).toBeNull();
  });
});

describe('AI brief', () => {
  it('parses the JSON brief even when wrapped in prose, and caps list lengths', () => {
    const b = parseBrief(
      'Here you go:\n{"summary":"Busy day.","priorities":["a","b","c","d"],"strategies":[{"title":"T","why":"W","action":"A"}],"social":["s"],"trends":[]}\nThanks',
    );
    expect(b.summary).toBe('Busy day.');
    expect(b.priorities).toEqual(['a', 'b', 'c']);
    expect(b.strategies).toEqual([{ title: 'T', why: 'W', action: 'A' }]);
    expect(() => parseBrief('no json here')).toThrow(/did not contain/);
    expect(() => parseBrief('{"priorities":[]}')).toThrow(/summary/);
  });

  it('sample brief uses only the given facts and reads naturally', () => {
    const b = demoBrief({
      overdueTasks: 1,
      dueToday: 1,
      leadsToContact: 2,
      newLeadsYesterday: 0,
      cplChangePct: 0.2,
      meetingsToday: 1,
      topPost: 'Open day',
      followerChange: null,
    });
    expect(b.summary).toContain('1 task due today');
    expect(b.summary).toContain('2 leads waiting');
    expect(b.strategies[2].why).toMatch(/flat/);
    expect(b.strategies[1].why).toContain('Open day');
  });
});

describe('Instagram sample data', () => {
  it('is deterministic per day and labelled', () => {
    const a = demoSnapshot('2026-10-20');
    expect(demoSnapshot('2026-10-20')).toEqual(a);
    expect(a.recentMedia.every((m) => m.caption?.startsWith('DEMO'))).toBe(true);
  });
});
