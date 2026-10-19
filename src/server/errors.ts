export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PRECONDITION';

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PRECONDITION: 412,
};

/** Errors whose message is safe to show to the end user. Anything else is logged and replaced. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('FORBIDDEN', msg);
export const notFound = (what = 'Record') =>
  new AppError('NOT_FOUND', `${what} not found or you do not have access.`);
export const invalid = (msg: string, fieldErrors?: Record<string, string>) =>
  new AppError('VALIDATION', msg, fieldErrors);
export const conflict = (msg: string) => new AppError('CONFLICT', msg);
export const precondition = (msg: string) => new AppError('PRECONDITION', msg);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Postgres unique-violation detection (pg error code 23505), including when wrapped by Drizzle. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const err = cur as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === '23505') return constraint ? err.constraint === constraint : true;
    cur = err.cause;
  }
  return false;
}
