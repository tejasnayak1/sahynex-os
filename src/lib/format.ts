/** Display formatting. Money is stored in minor units (paise). */

export function formatMoney(
  minor: number | null | undefined,
  currency = 'INR',
  opts: { compact?: boolean } = {},
): string {
  if (minor == null || Number.isNaN(minor)) return '—';
  const major = minor / 100;
  if (opts.compact && Math.abs(major) >= 100_000) {
    if (currency === 'INR') {
      if (Math.abs(major) >= 10_000_000) return `₹${(major / 10_000_000).toFixed(2)} Cr`;
      return `₹${(major / 100_000).toFixed(2)} L`;
    }
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(major);
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(major) >= 1000 ? 0 : 2,
  }).format(major);
}

export const formatNumber = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'));
export const formatPercent = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : `${(n * 100).toFixed(digits)}%`;

const TZ = 'Asia/Kolkata';

export function formatDate(d: Date | string | null | undefined, tz = TZ): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? (d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d)) : d;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: typeof d === 'string' && d.length === 10 ? 'UTC' : tz,
  }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined, tz = TZ): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(d));
}

export function relativeTime(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return '—';
  const diff = (new Date(d).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(new Date(d));
}

/** Value for <input type="datetime-local"> in the given timezone. */
export function toDateTimeLocal(d: Date | null | undefined, tz = TZ): string {
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export const humanize = (s: string | null | undefined) =>
  s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—';

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(tz = TZ, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - at.getTime();
}

/** Interprets a naive "YYYY-MM-DDTHH:mm" (from <input type="datetime-local">) as wall-clock time in `tz`. */
export function fromDateTimeLocal(s: string, tz = TZ): Date {
  const [d, t = '00:00'] = s.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se = 0] = t.split(':').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, da, h, mi, se));
  const off1 = tzOffsetMs(tz, guess);
  const first = new Date(guess.getTime() - off1);
  const off2 = tzOffsetMs(tz, first);
  return off1 === off2 ? first : new Date(guess.getTime() - off2);
}
