import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarEvents } from "@/components/calendar-events";
import { googleReady } from "@/lib/google/schedule";
import { primaryButton } from "@/components/button-styles";
import { Card, EmptyState } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { listMeetings } from "@/lib/data/meetings";
import { listTasks } from "@/lib/data/tasks";
import { dueLabel, meetingTime } from "@/lib/tasks/dates";

export const metadata: Metadata = { title: "Meetings · FollowThrough" };

/** "2 open actions · next due Fri", or nothing for a meeting with no open actions. */
function actionSummary(dueDates: (string | null)[] | undefined, today: string): string {
  if (!dueDates?.length) return "";
  const count = `${dueDates.length} open ${dueDates.length === 1 ? "action" : "actions"}`;
  const next = dueDates.filter((due): due is string => due !== null).sort()[0];
  if (!next) return `${count} · no dates`;
  const due = dueLabel(next, today);
  return due.tone === "overdue" ? `${count} · ${due.label.toLowerCase()}` : `${count} · next due ${due.label}`;
}

export default async function MeetingsPage() {
  const context = await getAppContext();
  const [meetings, open] = await Promise.all([listMeetings(context), listTasks(context, { status: "open" })]);
  const openByMeeting = new Map<string, (string | null)[]>();
  for (const task of open) {
    if (task.meeting_id) openByMeeting.set(task.meeting_id, [...(openByMeeting.get(task.meeting_id) ?? []), task.due_date]);
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Meetings</h1>
        <Link href="/meetings/new" className={primaryButton}>
          Add meeting
        </Link>
      </header>

      {meetings.length ? (
        <Card className="p-2">
          <ul className="flex flex-col">
            {meetings.map((meeting) => (
              <li key={meeting.id}>
                <Link href={`/meetings/${meeting.id}`} className="flex min-h-11 flex-col gap-0.5 rounded-xl p-3 transition-colors duration-150 hover:bg-sage-100">
                  <span className="font-medium break-words text-ink">{meeting.title}</span>
                  <span className="text-sm text-ink-muted">{meetingTime(meeting.starts_at, context.timezone)}</span>
                  <span className="text-sm text-ink-muted">{actionSummary(openByMeeting.get(meeting.id), context.today)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState title="No meetings yet" body="Add a meeting, then bring in its notes." href="/meetings/new" action="Add a meeting" />
      )}

      {googleReady() ? (
        // Shows only when Calendar events are turned on; nothing while it loads.
        <Suspense fallback={null}>
          <CalendarEvents context={context} />
        </Suspense>
      ) : null}
    </main>
  );
}
