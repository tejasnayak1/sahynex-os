import { PageHeader, Panel } from '@/components/ui';
import { db } from '@/db';
import { formatDate, todayIn } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { getOrg } from '@/server/services/org';
import { dailyUpdates } from '@/server/services/reports';
import { DailyUpdateForm } from '../forms';
import { FilterForm } from '@/components/client/filter-form';

export const metadata = { title: 'Daily updates' };

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('tasks.read.assigned', 'tasks.read.all');
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const today = todayIn(org.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const team = can(actor, 'daily_reports.team');
  const updates = await dailyUpdates(actor, date, team);
  const mine = updates.find((u) => u.d.userId === actor.id);
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Reports & analytics', href: '/reports' }, { label: 'Daily updates' }]}
        title="Daily updates"
        description={`${formatDate(date)}${team ? ' · your update and your team’s' : ''}`}
        actions={
          <FilterForm action="/reports/daily" className="flex gap-2">
            <label htmlFor="date" className="sr-only">
              Date
            </label>
            <input
              id="date"
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              className="h-9 rounded-md border border-line-strong bg-surface px-2"
            />
            <button className="h-9 rounded-md border border-line-strong bg-surface px-3 font-medium">
              Go
            </button>
          </FilterForm>
        }
      />
      {!actor.clientId && date === today ? (
        <Panel title="Your update" className="mb-5">
          <DailyUpdateForm date={date} existing={mine?.d} />
        </Panel>
      ) : null}
      {team ? (
        <Panel title={`Team updates (${updates.length})`} bodyClassName="p-0">
          {updates.length ? (
            <ul className="divide-y divide-line">
              {updates.map(({ d, name }) => (
                <li key={d.id} className="grid gap-3 px-4 py-3 md:grid-cols-[180px_1fr]">
                  <span className="font-medium">{name}</span>
                  <dl className="grid gap-2 text-[13.5px] sm:grid-cols-2">
                    <div>
                      <dt className="text-[12.5px] text-muted">Completed</dt>
                      <dd className="whitespace-pre-line">{d.completed}</dd>
                    </div>
                    {d.inProgress ? (
                      <div>
                        <dt className="text-[12.5px] text-muted">In progress</dt>
                        <dd className="whitespace-pre-line">{d.inProgress}</dd>
                      </div>
                    ) : null}
                    {d.blockers ? (
                      <div>
                        <dt className="text-[12.5px] text-bad">Blockers</dt>
                        <dd className="whitespace-pre-line">{d.blockers}</dd>
                      </div>
                    ) : null}
                    {d.plannedNext ? (
                      <div>
                        <dt className="text-[12.5px] text-muted">Next</dt>
                        <dd className="whitespace-pre-line">{d.plannedNext}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-muted">No updates submitted for this day.</p>
          )}
        </Panel>
      ) : null}
    </>
  );
}
