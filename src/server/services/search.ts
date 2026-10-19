import { and, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { can, type Actor } from '../actor';
import { clientScope, dealScope, deliverableScope, leadScope, projectScope, taskScope } from '../access';

const { leads, deals, clients, projects, tasks, deliverables } = schema;

export type SearchHit = {
  type: 'lead' | 'deal' | 'client' | 'project' | 'task' | 'deliverable';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

/** Global search across records the actor is permitted to see (scopes enforced in SQL). */
export async function globalSearch(actor: Actor, q: string): Promise<SearchHit[]> {
  const term = q.trim().replace(/[%_]/g, '');
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const lim = 6;
  const [l, d, c, p, t, dv] = await Promise.all([
    actor.clientId
      ? []
      : db
          .select({
            id: leads.id,
            title: leads.name,
            sub: sql<string>`${leads.ref} || coalesce(' · ' || ${leads.organisationName}, '')`,
          })
          .from(leads)
          .where(
            and(
              leadScope(actor),
              or(
                ilike(leads.name, like),
                ilike(leads.email, like),
                ilike(leads.phone, like),
                ilike(leads.ref, like),
                ilike(leads.organisationName, like),
              ),
            ),
          )
          .limit(lim),
    actor.clientId
      ? []
      : db
          .select({
            id: deals.id,
            title: deals.title,
            sub: sql<string>`${deals.ref} || ' · ' || ${deals.prospectName}`,
          })
          .from(deals)
          .where(
            and(
              dealScope(actor),
              or(ilike(deals.title, like), ilike(deals.prospectName, like), ilike(deals.ref, like)),
            ),
          )
          .limit(lim),
    db
      .select({ id: clients.id, title: clients.name, sub: clients.city })
      .from(clients)
      .where(and(clientScope(actor), ilike(clients.name, like)))
      .limit(lim),
    db
      .select({ id: projects.id, title: projects.name, sub: projects.ref })
      .from(projects)
      .where(and(projectScope(actor), or(ilike(projects.name, like), ilike(projects.ref, like))))
      .limit(lim),
    actor.clientId
      ? []
      : db
          .select({ id: tasks.id, title: tasks.title, sub: tasks.ref })
          .from(tasks)
          .where(and(taskScope(actor), or(ilike(tasks.title, like), ilike(tasks.ref, like))))
          .limit(lim),
    can(actor, 'content.read')
      ? db
          .select({ id: deliverables.id, title: deliverables.title, sub: deliverables.ref })
          .from(deliverables)
          .where(
            and(deliverableScope(actor), or(ilike(deliverables.title, like), ilike(deliverables.ref, like))),
          )
          .limit(lim)
      : [],
  ]);
  const map =
    (type: SearchHit['type'], base: string) => (r: { id: string; title: string; sub: string | null }) => ({
      type,
      id: r.id,
      title: r.title,
      subtitle: r.sub,
      href: `${base}/${r.id}`,
    });
  return [
    ...l.map(map('lead', '/leads')),
    ...d.map(map('deal', '/deals')),
    ...c.map(map('client', '/clients')),
    ...p.map(map('project', '/projects')),
    ...t.map(map('task', '/tasks')),
    ...dv.map(map('deliverable', '/content')),
  ];
}
