import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { NotesForm } from "@/components/notes-form";
import { ConfirmButton } from "@/components/submit-button";
import { TaskDetail } from "@/components/task-detail";
import { TaskRow } from "@/components/task-row";
import { Badge, Card } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { getMeeting, listNotes } from "@/lib/data/meetings";
import { listTasks } from "@/lib/data/tasks";
import { meetingTime } from "@/lib/tasks/dates";
import { byUrgency } from "@/lib/tasks/logic";
import { deleteMeeting, deleteNotes } from "../actions";

export const metadata: Metadata = { title: "Meeting · FollowThrough" };

const FORMAT_LABELS: Record<string, string> = {
  paste: "Pasted",
  txt: "Text file",
  md: "Markdown file",
  vtt: "Transcript",
  srt: "Transcript",
  docx: "Word file",
  wispr_import: "Wispr Flow import",
};

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const context = await getAppContext();
  const { id } = await params;
  const { task: openTask } = await searchParams;

  const meeting = await getMeeting(context, id);
  if (!meeting) notFound();
  const [notes, tasks] = await Promise.all([listNotes(context, id), listTasks(context, { meetingId: id })]);
  const path = `/meetings/${id}`;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight break-words text-ink">{meeting.title}</h1>
          <p className="mt-1 text-ink-muted">{meetingTime(meeting.starts_at, context.timezone)}</p>
          {meeting.attendees.length ? <p className="mt-1 break-words text-ink-muted">With {meeting.attendees.join(", ")}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${path}/edit`} className={secondaryButton}>
            Edit meeting
          </Link>
          <form action={deleteMeeting}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton className={secondaryButton} message="Delete this meeting and its notes? Tasks from it stay on your list.">
              Delete meeting
            </ConfirmButton>
          </form>
        </div>
      </header>

      <section aria-labelledby="actions-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="actions-heading" className="text-lg font-semibold text-ink">
            Actions
          </h2>
          <Link href={`/tasks/new?meeting=${id}&return_to=${encodeURIComponent(path)}`} className={primaryButton}>
            Add action
          </Link>
        </div>
        {tasks.length ? (
          <Card className="p-2">
            <ul className="flex flex-col">
              {[...tasks].sort(byUrgency).map((task) => (
                <TaskRow key={task.id} task={task} today={context.today} href={`${path}?task=${task.id}`} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-ink-muted">No actions from this meeting yet.</p>
        )}
      </section>

      <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
        <h2 id="notes-heading" className="text-lg font-semibold text-ink">
          Notes
        </h2>
        {notes.map((note, index) => (
          <Card key={note.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap gap-1.5">
                <Badge tone="plain">{FORMAT_LABELS[note.source_format] ?? "Notes"}</Badge>
                {note.has_timestamps ? <Badge tone="plain">Has timestamps</Badge> : null}
              </span>
              <form action={deleteNotes}>
                <input type="hidden" name="id" value={note.id} />
                <input type="hidden" name="meeting_id" value={id} />
                <ConfirmButton className={secondaryButton} message="Delete these notes? This can't be undone.">
                  Delete notes
                </ConfirmButton>
              </form>
            </div>
            <div tabIndex={0} role="region" aria-label={notes.length > 1 ? `Meeting notes ${index + 1}` : "Meeting notes"} className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-ink">
              {note.raw_text}
            </div>
          </Card>
        ))}
        <Card className="p-5">
          <NotesForm meetingId={id} />
        </Card>
      </section>

      {openTask ? <TaskDetail context={context} id={openTask} closeHref={path} /> : null}
    </main>
  );
}
