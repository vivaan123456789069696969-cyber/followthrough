import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton } from "@/components/button-styles";
import { TaskDetail } from "@/components/task-detail";
import { TaskRow } from "@/components/task-row";
import { Card, EmptyState } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { listTasks } from "@/lib/data/tasks";
import { byUrgency, isWaitingOnOthers, myOpenTasks } from "@/lib/tasks/logic";

export const metadata: Metadata = { title: "My tasks · FollowThrough" };

const VIEWS = [
  { key: "mine", label: "Mine" },
  { key: "waiting", label: "Waiting on others" },
  { key: "done", label: "Done" },
] as const;

const EMPTY = {
  mine: { title: "No open tasks", body: "Tasks you own, and ones nobody owns yet, show up here." },
  waiting: { title: "Nothing to wait for", body: "Tasks you give to someone else show up here." },
  done: { title: "Nothing finished yet", body: "Tasks you mark done show up here." },
};

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string; task?: string }> }) {
  const context = await getAppContext();
  const params = await searchParams;
  const view = VIEWS.find((item) => item.key === params.view)?.key ?? "mine";
  const tasks = await listTasks(context, { status: view === "done" ? "done" : "open" });

  const shown =
    view === "mine"
      ? myOpenTasks(tasks, context.userId)
      : view === "waiting"
        ? tasks.filter(isWaitingOnOthers).sort(byUrgency)
        : tasks;

  const base = view === "mine" ? "/my-tasks" : `/my-tasks?view=${view}`;
  const withTask = (id: string) => `${base}${base.includes("?") ? "&" : "?"}task=${id}`;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">My tasks</h1>
        <Link href={`/tasks/new?return_to=${encodeURIComponent(base)}`} className={primaryButton}>
          Add task
        </Link>
      </header>

      <nav aria-label="Task views" className="flex flex-wrap gap-2">
        {VIEWS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "mine" ? "/my-tasks" : `/my-tasks?view=${item.key}`}
            aria-current={view === item.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 font-medium ${
              view === item.key ? "bg-sage-100 text-brand underline underline-offset-4" : "text-ink-muted hover:bg-sage-100"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <Card className="p-2">
          <ul className="flex flex-col">
            {shown.map((task) => (
              <TaskRow key={task.id} task={task} today={context.today} href={withTask(task.id)} />
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState {...EMPTY[view]} href={`/tasks/new?return_to=${encodeURIComponent(base)}`} action="Add a task" />
      )}

      {params.task ? <TaskDetail context={context} id={params.task} closeHref={base} /> : null}
    </main>
  );
}
