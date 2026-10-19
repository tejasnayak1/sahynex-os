import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { forbidden, invalid, notFound } from '../errors';
import type { Actor } from '../actor';

const MODULES = ['leads', 'tasks', 'pipeline', 'projects', 'content', 'campaigns'] as const;

/** Personal saved filters. The query string is re-validated by each list page, so nothing here is trusted. */
export async function listSavedViews(actor: Actor, module: string) {
  if (actor.kind !== 'user') return [];
  return db
    .select()
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.userId, actor.id), eq(schema.savedViews.module, module)))
    .orderBy(asc(schema.savedViews.name));
}

export async function saveView(actor: Actor, module: string, name: string, query: string) {
  if (actor.kind !== 'user') throw forbidden();
  if (!(MODULES as readonly string[]).includes(module)) throw invalid('Unknown module.');
  const n = name.trim();
  if (!n || n.length > 60) throw invalid('Give the view a short name (up to 60 characters).');
  const q = new URLSearchParams(query);
  q.delete('page');
  const existing = await listSavedViews(actor, module);
  if (existing.length >= 20) throw invalid('You can keep up to 20 saved views per list.');
  const [v] = await db
    .insert(schema.savedViews)
    .values({ orgId: actor.orgId, userId: actor.id, module, name: n, query: q.toString().slice(0, 2000) })
    .returning();
  return v;
}

export async function deleteView(actor: Actor, id: string) {
  if (actor.kind !== 'user') throw forbidden();
  const [v] = await db
    .delete(schema.savedViews)
    .where(and(eq(schema.savedViews.id, id), eq(schema.savedViews.userId, actor.id)))
    .returning();
  if (!v) throw notFound('Saved view');
}
