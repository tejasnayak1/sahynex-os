import { pageParams, type PageParams } from '@/server/validation';

export type SP = Record<string, string | undefined>;

/** Normalises Next's searchParams (string | string[]) into single strings. */
export async function readParams(p: Promise<Record<string, string | string[] | undefined>>): Promise<SP> {
  const raw = await p;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

export function paging(sp: SP, defaults: Partial<PageParams> = {}): PageParams {
  const r = pageParams.safeParse({
    ...defaults,
    ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== '' && v !== undefined)),
  });
  return r.success ? r.data : pageParams.parse(defaults);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Date range from ?from&to or a preset (?range=7d|30d|90d|mtd), in YYYY-MM-DD. */
export function dateRange(sp: SP, tz = 'Asia/Kolkata', fallback = '30d') {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (valid(sp.from) && valid(sp.to) && sp.from! <= sp.to!)
    return { from: sp.from!, to: sp.to!, preset: 'custom' };
  const preset = sp.range ?? fallback;
  const t = new Date(`${today}T00:00:00Z`);
  if (preset === 'mtd') return { from: `${today.slice(0, 8)}01`, to: today, preset };
  const days = { '7d': 7, '30d': 30, '90d': 90 }[preset] ?? 30;
  return { from: iso(new Date(t.getTime() - (days - 1) * 86_400_000)), to: today, preset };
}
