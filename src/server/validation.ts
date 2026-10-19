import { z, type ZodType } from 'zod';
import { fromDateTimeLocal } from '@/lib/format';
import { invalid } from './errors';

export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = issue.path.join('.') || '_';
    fieldErrors[k] ??= issue.message;
  }
  const first = Object.entries(fieldErrors)[0];
  throw invalid(
    first ? (first[0] === '_' ? first[1] : `${humanize(first[0])}: ${first[1]}`) : 'Invalid input.',
    fieldErrors,
  );
}

const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** Form helpers: empty strings from HTML forms become undefined/null. */
export const optStr = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
    z.string().max(max).optional(),
  );
export const reqStr = (max = 500) => z.string().trim().min(1, 'Required').max(max);
export const optUuid = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().uuid().optional(),
);
export const optDate = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
);
export const optDateTime = z.preprocess(
  (v) =>
    v === '' || v == null
      ? undefined
      : v instanceof Date
        ? v
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(v))
          ? fromDateTimeLocal(String(v), process.env.APP_TIMEZONE ?? 'Asia/Kolkata')
          : new Date(String(v)),
  z
    .date()
    .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date')
    .optional(),
);
/** Rupees (decimal) in a form → paise (integer). */
export const optMoney = z.preprocess((v) => {
  if (v === '' || v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}, z.number().int().min(0, 'Must be zero or more').max(1e15).optional());
export const optInt = (min = 0, max = 1e9) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().int().min(min).max(max).optional(),
  );
export const bool = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());
export const strArray = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v
      : typeof v === 'string'
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
  z.array(z.string().max(100)).max(50),
);

export const pageParams = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
  q: optStr(200),
  sort: optStr(50),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type PageParams = z.infer<typeof pageParams>;
export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number };
