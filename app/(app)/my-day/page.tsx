import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton } from "@/components/button-styles";
import { TaskDetail } from "@/components/task-detail";
import { TaskRow } from "@/components/task-row";
import { Card, EmptyState } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { listTasks } from "@/lib/data/tasks";
import { firstName, greeting, longDate } from "@/lib/tasks/dates";
import { computeStats, nextActions } from "@/lib/tasks/logic";

export const metadata: Metadata = { title: "My day · FollowThrough" };

function StatTile({ label, value, href, tone, mark }: { label: string; value: number; href: string; tone: string; mark: string }) {
  return (
    <Link href={href} className={`flex min-h-24 flex-col justify-between rounded-2xl p-4 transition-opacity duration-150 hover:opacity-90 ${tone}`}>
      <span className="text-3xl font-semibold">{value}</span>
      <span className="text-sm font-medium">
        <span aria-hidden="true">{mark}</span> {label}
      </span>
    </Link>
  );
}

export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const context = await getAppContext();
  const { task: openTask } = await searchParams;
  const tasks = await listTasks(context);

  const stats = computeStats(tasks, context.userId, context.today);
  const { visible, total } = nextActions(tasks, context.userId, context.today);
  const name = firstName(context.profile?.full_name);
  const hello = greeting(context.timezone);

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{name ? `${hello}, ${name}` : hello}</h1>
          <p className="mt-1 text-ink-muted">{longDate(context.today)}</p>
        </div>
        <Link href="/meetings/new" className={primaryButton}>
          Add meeting
        </Link>
      </header>

      <section aria-label="Summary" className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile label="Due soon" value={stats.dueSoon} href="/my-tasks" mark="●" tone="bg-lime text-on-lime" />
        <StatTile label="Overdue" value={stats.overdue} href="/my-tasks" mark="!" tone="bg-warm text-on-warm" />
        <StatTile label="Waiting on others" value={stats.waiting} href="/my-tasks?view=waiting" mark="…" tone="bg-lilac text-on-lilac" />
      </section>

      <section aria-labelledby="next-actions" className="flex flex-col gap-3">
        <h2 id="next-actions" className="text-lg font-semibold text-ink">
          Your next actions
        </h2>
        {visible.length ? (
          <Card className="p-2">
            <ul className="flex flex-col">
              {visible.map((task) => (
                <TaskRow key={task.id} task={task} today={context.today} href={`/my-day?task=${task.id}`} />
              ))}
            </ul>
            {total > visible.length || total > 0 ? (
              <p className="p-3">
                <Link href="/my-tasks" className="font-medium text-brand underline">
                  View all {total > visible.length ? `(${total})` : ""}
                </Link>
              </p>
            ) : null}
          </Card>
        ) : (
          <EmptyState
            title="Nothing needs you right now"
            body="Add a meeting and its notes, then turn what was agreed into tasks."
            href="/meetings/new"
            action="Add a meeting"
          />
        )}
      </section>

      {openTask ? <TaskDetail context={context} id={openTask} closeHref="/my-day" /> : null}
    </main>
  );
}
