import 'server-only';
import { refresh, revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { UserActor } from './actor';
import { getCurrentActor } from './auth/current';
import { isAppError } from './errors';

export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
  /** One-time secrets (e.g. new API key) shown to the user once. */
  secret?: string;
  /** Monotonic marker so the client can react to repeated identical results. */
  at?: number;
} | null;

/**
 * Wraps a server action: authenticates, runs the service call, converts AppErrors into user-facing
 * messages and never leaks stack traces. Unexpected errors are logged server-side with a reference.
 */
export async function runAction(
  fn: (actor: UserActor) => Promise<Exclude<ActionState, null> | void>,
  revalidate?: string | string[],
): Promise<ActionState> {
  const actor = await getCurrentActor();
  if (!actor)
    return {
      ok: false,
      error: 'Your session has expired. Sign in again.',
      redirectTo: '/login',
      at: Date.now(),
    };
  try {
    const res = (await fn(actor)) ?? { ok: true };
    for (const p of [revalidate ?? []].flat()) revalidatePath(p);
    // Always re-render the current page so the person sees the result of what they just did.
    if (!res.redirectTo) refresh();
    return { ...res, at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (isAppError(e)) return { ok: false, error: e.message, fieldErrors: e.fieldErrors, at: Date.now() };
    const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
    console.error(`[action error ${ref}]`, e);
    return {
      ok: false,
      error: `Something went wrong and nothing was saved. If it keeps happening, report reference ${ref}.`,
      at: Date.now(),
    };
  }
}

/** FormData → plain object, keeping only fields actually present in the form (so partial updates work). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$ACTION')) continue;
    if (typeof v !== 'string') continue;
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      if (Array.isArray(out[key])) (out[key] as string[]).push(v);
      else out[key] = [v];
    } else out[k] = v;
  }
  return out;
}
