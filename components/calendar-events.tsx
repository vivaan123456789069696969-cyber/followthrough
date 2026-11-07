import Link from "next/link";
import type { ReactNode } from "react";
import type { AppContext } from "@/lib/data/context";
import { listEvents } from "@/lib/google/api";
import { hasFeature } from "@/lib/google/config";
import { plainError } from "@/lib/google/http";
import { loadIntegration, withToken } from "@/lib/google/integration";
import { createAdminClient } from "@/lib/supabase/admin";
import { longDate, meetingTime } from "@/lib/tasks/dates";
import { MeetingFromEvent } from "./google-forms";
import { Card } from "./ui";

const DAY = 24 * 60 * 60 * 1000;

function twoWeeksEitherSide() {
  const now = Date.now();
  return { timeMin: new Date(now - 14 * DAY).toISOString(), timeMax: new Date(now + 14 * DAY).toISOString() };
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="calendar-heading" className="flex flex-col gap-3">
      <h2 id="calendar-heading" className="text-xl font-semibold text-ink">
        From your calendar
      </h2>
      {children}
    </section>
  );
}

/**
 * Meetings from the last and next two weeks of the person's Google Calendar. Rendered in
 * its own Suspense boundary, so a slow Google never holds up the rest of the page.
 */
export async function CalendarEvents({ context }: { context: AppContext }) {
  const admin = createAdminClient();
  if (!admin) return null;
  const integration = await loadIntegration(admin, context.workspaceId, context.userId);
  if (!integration || integration.status !== "active" || !hasFeature(integration.scopes, "calendar")) return null;

  let events;
  let more = false;
  try {
    ({ events, more } = await withToken(admin, integration, (token) => listEvents(token, twoWeeksEitherSide())));
  } catch (error) {
    return (
      <Section>
        <Card className="p-5">
          <p className="text-ink-muted">{plainError(error)}</p>
        </Card>
      </Section>
    );
  }

  // Events already turned into meetings link to them instead of offering a second copy.
  const ids = events.map((event) => event.id);
  const { data: existing } = ids.length
    ? await context.supabase.from("meetings").select("id, external_event_id").in("external_event_id", ids)
    : { data: [] };
  const made = new Map((existing ?? []).map((meeting) => [meeting.external_event_id, meeting.id]));

  if (!events.length) {
    return (
      <Section>
        <Card className="p-5">
          <p className="text-ink-muted">No events in your calendar from the last or next two weeks.</p>
        </Card>
      </Section>
    );
  }

  return (
    <Section>
    <Card className="p-2">
      <ul className="flex flex-col">
        {events.map((event) => {
          const title = event.summary?.trim() || "Untitled event";
          // All-day events have a date and no time, so they show as just the date.
          const when = event.start?.dateTime
            ? meetingTime(event.start.dateTime, context.timezone)
            : event.start?.date
              ? `${longDate(event.start.date)}, all day`
              : null;
          const people = (event.attendees ?? [])
            .filter((person) => !person.self && !person.resource && person.displayName)
            .map((person) => person.displayName!.trim());
          const meetingId = made.get(event.id);
          return (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium break-words text-ink">{title}</span>
                {when ? <span className="text-sm text-ink-muted">{when}</span> : null}
                {people.length ? (
                  <span className="text-sm break-words text-ink-muted">
                    With {people.slice(0, 5).join(", ")}
                    {people.length > 5 ? ` and ${people.length - 5} more` : ""}
                  </span>
                ) : null}
              </div>
              {meetingId ? (
                <Link href={`/meetings/${meetingId}`} className="text-brand underline">
                  Open meeting<span className="sr-only"> {title}</span>
                </Link>
              ) : (
                <MeetingFromEvent eventId={event.id} title={title} />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
    {more ? <p className="text-sm text-ink-muted">Showing the first 200 events. Add others as meetings by hand.</p> : null}
    </Section>
  );
}
