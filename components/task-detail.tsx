import Link from "next/link";
import { setTaskDone } from "@/app/(app)/tasks/actions";
import type { AppContext } from "@/lib/data/context";
import { getTask, listContacts } from "@/lib/data/tasks";
import { addDays, dueLabel, longDate, meetingTime } from "@/lib/tasks/dates";
import { secondaryButton } from "./button-styles";
import { DeleteTaskForm } from "./delete-task-form";
import { Drawer } from "./drawer";
import { RetrySync } from "./google-forms";
import { SnoozeForm } from "./snooze-form";
import { SubmitButton } from "./submit-button";
import { TaskForm } from "./task-form";
import { Badge } from "./ui";

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  done: "Marked done",
  reopened: "Reopened",
  snoozed: "Snooze changed",
  synced: "Synced",
  reminded: "Reminder sent",
};

const SYNC_NAMES: Record<string, string> = { google_tasks: "Google Tasks", google_calendar: "Due date in Calendar" };

export async function TaskDetail({ context, id, closeHref }: { context: AppContext; id: string; closeHref: string }) {
  const [task, contacts] = await Promise.all([getTask(context, id), listContacts(context)]);

  if (!task) {
    return (
      <Drawer label="Task" closeHref={closeHref}>
        <p>We couldn&apos;t find this task.</p>
      </Drawer>
    );
  }

  const owner = task.owner_user_id ? "You" : (task.owner_name ?? "Not decided yet");
  const open = task.status === "open";

  return (
    <Drawer label="Task details" closeHref={closeHref}>
      <div className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight break-words">{task.title}</h2>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-ink-muted">Owner</dt>
          <dd>{owner}</dd>
          <dt className="text-ink-muted">Due</dt>
          <dd>{task.due_date ? `${longDate(task.due_date)} (${dueLabel(task.due_date, context.today).label})` : "No date"}</dd>
          <dt className="text-ink-muted">Status</dt>
          <dd>
            <Badge tone="plain">{open ? "Open" : task.status === "done" ? "Done" : "Dismissed"}</Badge>
          </dd>
          {task.snoozed_until && task.snoozed_until > context.today ? (
            <>
              <dt className="text-ink-muted">Snoozed</dt>
              <dd>Until {longDate(task.snoozed_until)}</dd>
            </>
          ) : null}
          {task.meeting_id ? (
            <>
              <dt className="text-ink-muted">From</dt>
              <dd>
                <Link href={`/meetings/${task.meeting_id}`} className="text-brand underline">
                  {task.meeting_title ?? "Meeting"}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>

        {task.description ? <p className="break-words whitespace-pre-wrap">{task.description}</p> : null}

        {task.source_quote ? (
          <figure className="rounded-lg bg-sage-100 p-4">
            <blockquote className="break-words">&ldquo;{task.source_quote}&rdquo;</blockquote>
            {task.source_href ? (
              <figcaption className="mt-2">
                <Link href={task.source_href} className="text-brand underline">
                  Open in notes
                </Link>
              </figcaption>
            ) : null}
          </figure>
        ) : null}

        <form action={setTaskDone}>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="done" value={open ? "true" : "false"} />
          <input type="hidden" name="return_to" value={closeHref} />
          {open ? (
            <SubmitButton pendingLabel="Saving">Mark done</SubmitButton>
          ) : (
            <SubmitButton pendingLabel="Saving" className={secondaryButton}>
              Reopen
            </SubmitButton>
          )}
        </form>

        {open ? (
          <SnoozeForm id={task.id} returnTo={closeHref} minDate={addDays(context.today, 1)} snoozedUntil={task.snoozed_until} />
        ) : null}

        <details className="rounded-lg border border-line p-3">
          <summary className="min-h-8 cursor-pointer font-medium">Edit details</summary>
          <div className="mt-4">
            <TaskForm returnTo={closeHref} contacts={contacts} task={task} />
          </div>
        </details>

        {task.syncs.length ? (
          <section aria-labelledby="sync-heading" className="flex flex-col gap-2">
            <h3 id="sync-heading" className="font-semibold">
              Google
            </h3>
            <ul className="flex flex-col gap-3">
              {task.syncs.map((sync) => (
                <li key={sync.provider} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{SYNC_NAMES[sync.provider]}</span>
                    {sync.state === "ok" ? (
                      <Badge tone="lime">Synced</Badge>
                    ) : sync.state === "pending" ? (
                      <Badge tone="plain">Waiting to sync</Badge>
                    ) : (
                      <Badge tone="warm">Not synced</Badge>
                    )}
                  </div>
                  {sync.state === "failed" ? (
                    <p className="text-sm text-ink-muted">{sync.last_error ?? "This couldn't be sent to Google."}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {/* One Retry for the whole task: it tries everything that didn't go through. */}
            {task.syncs.some((sync) => sync.state === "failed") ? <RetrySync taskId={task.id} /> : null}
          </section>
        ) : null}

        <DeleteTaskForm id={task.id} returnTo={closeHref} hasGoogle={task.syncs.some((sync) => sync.state === "ok")} />

        <section aria-labelledby="activity-heading">
          <h3 id="activity-heading" className="mb-2 font-semibold">
            Activity
          </h3>
          {task.events.length ? (
            <ul className="flex flex-col gap-1 text-sm text-ink-muted">
              {task.events.map((event) => (
                <li key={event.id}>
                  {EVENT_LABELS[event.type] ?? event.type} · {meetingTime(event.created_at, context.timezone)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No activity yet.</p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
