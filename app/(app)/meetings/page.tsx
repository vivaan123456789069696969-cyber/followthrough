import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton } from "@/components/button-styles";
import { Card, EmptyState } from "@/components/ui";
import { getAppContext } from "@/lib/data/context";
import { listMeetings } from "@/lib/data/meetings";
import { meetingTime } from "@/lib/tasks/dates";

export const metadata: Metadata = { title: "Meetings · FollowThrough" };

export default async function MeetingsPage() {
  const context = await getAppContext();
  const meetings = await listMeetings(context);

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
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState title="No meetings yet" body="Add a meeting, then bring in its notes." href="/meetings/new" action="Add a meeting" />
      )}
    </main>
  );
}
