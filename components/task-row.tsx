import Link from "next/link";
import type { TaskRowData } from "@/lib/data/tasks";
import { dueLabel } from "@/lib/tasks/dates";
import { isSnoozed, needsDate, needsOwner } from "@/lib/tasks/logic";
import { Badge } from "./ui";

function DueBadge({ due, today }: { due: string | null; today: string }) {
  const { label, tone } = dueLabel(due, today);
  if (tone === "none") return null;
  if (tone === "overdue") return <Badge tone="warm"><span aria-hidden="true">!</span> {label}</Badge>;
  if (tone === "today") return <Badge tone="lime"><span aria-hidden="true">●</span> {label}</Badge>;
  return <Badge tone="plain">{label}</Badge>;
}

export function TaskRow({ task, today, href }: { task: TaskRowData; today: string; href: string }) {
  const done = task.status === "done";
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        className="flex min-h-11 flex-col gap-1.5 rounded-xl p-3 transition-colors duration-150 hover:bg-sage-100 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <span className="min-w-0">
          <span className={`block font-medium break-words text-ink ${done ? "line-through" : ""}`}>{task.title}</span>
          {task.meeting_title || task.owner_name ? (
            <span className="block text-sm break-words text-ink-muted">
              {[task.meeting_title, task.owner_name ? `Owner: ${task.owner_name}` : null].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-wrap gap-1.5">
          {done ? <Badge tone="plain"><span aria-hidden="true">✓</span> Done</Badge> : <DueBadge due={task.due_date} today={today} />}
          {needsOwner(task) ? <Badge tone="warm">Needs owner</Badge> : null}
          {needsDate(task) ? <Badge tone="warm">Needs date</Badge> : null}
          {task.owner_contact_id && !done ? <Badge tone="lilac">Waiting</Badge> : null}
          {!done && isSnoozed(task, today) ? <Badge tone="plain">Snoozed</Badge> : null}
        </span>
      </Link>
    </li>
  );
}
