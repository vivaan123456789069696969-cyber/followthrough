"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createCalendar, createTaskList, getEvent, listTaskLists } from "@/lib/google/api";
import { hasFeature } from "@/lib/google/config";
import { plainError } from "@/lib/google/http";
import { disconnect, GOOGLE_PERMISSIONS_URL, loadIntegration, withToken } from "@/lib/google/integration";
import { syncAllOpenAfterResponse } from "@/lib/google/schedule";
import { requeue, syncTask } from "@/lib/google/sync";
import { getAppContext } from "@/lib/data/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { middayInZone } from "@/lib/tasks/dates";

export type GoogleState = { error: string | null; saved: boolean };

const log = (event: string, reason?: string) => console.error(JSON.stringify({ event, reason: reason ?? "unknown" }));
const NOT_READY: GoogleState = { error: "Google isn't set up on this app yet.", saved: false };

/** The signed-in person's own connection. Every action starts here. */
async function own() {
  const context = await getAppContext();
  const admin = createAdminClient();
  if (!admin) return null;
  const integration = await loadIntegration(admin, context.workspaceId, context.userId);
  return { context, admin, integration };
}

export async function disconnectGoogle(): Promise<GoogleState> {
  const mine = await own();
  if (!mine) return NOT_READY;
  let revoked = true;
  if (mine.integration) {
    try {
      ({ revoked } = await disconnect(mine.admin, mine.integration));
    } catch (error) {
      log("google_disconnect_failed", error instanceof Error ? error.message : undefined);
      return { error: "We couldn't disconnect Google. Try again.", saved: false };
    }
  }
  revalidatePath("/", "layout");
  if (!revoked) {
    return {
      error: `Disconnected here, but Google couldn't be reached to remove access. You can remove FollowThrough at ${GOOGLE_PERMISSIONS_URL}.`,
      saved: true,
    };
  }
  return { error: null, saved: true };
}

/** Makes the FollowThrough calendar again, after it was deleted in Google. */
export async function remakeCalendar(): Promise<GoogleState> {
  const mine = await own();
  if (!mine) return NOT_READY;
  const { admin, integration, context } = mine;
  if (!integration || !hasFeature(integration.scopes, "deadlines")) return { error: "Turn on due dates in Calendar first.", saved: false };
  try {
    const calendarId = await withToken(admin, integration, (token) => createCalendar(token, context.timezone));
    const { error } = await admin.from("integrations").update({ calendar_id: calendarId }).eq("id", integration.id);
    if (error) throw new Error(`calendar_save_failed:${error.code}`);
  } catch (error) {
    log("google_calendar_remake_failed", error instanceof Error ? error.message : undefined);
    return { error: plainError(error, false), saved: false };
  }
  syncAllOpenAfterResponse(context.workspaceId, context.userId);
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

/** Picks the Google Tasks list, or makes one called FollowThrough. Only the person's own lists are accepted. */
export async function chooseTaskList(_previous: GoogleState, formData: FormData): Promise<GoogleState> {
  const choice = z.string().min(1).max(1024).safeParse(formData.get("tasklist"));
  if (!choice.success) return { error: "Choose a list.", saved: false };
  const mine = await own();
  if (!mine) return NOT_READY;
  const { admin, integration } = mine;
  if (!integration || !hasFeature(integration.scopes, "tasks")) return { error: "Connect Google Tasks first.", saved: false };

  try {
    let listId: string;
    if (choice.data === "new") {
      listId = (await withToken(admin, integration, (token) => createTaskList(token, "FollowThrough"))).id;
    } else {
      const lists = await withToken(admin, integration, (token) => listTaskLists(token));
      if (!lists.some((list) => list.id === choice.data)) return { error: "That list wasn't found in Google Tasks.", saved: false };
      listId = choice.data;
    }
    const { error } = await admin.from("integrations").update({ tasklist_id: listId }).eq("id", integration.id);
    if (error) throw new Error(`tasklist_save_failed:${error.code}`);
  } catch (error) {
    log("google_tasklist_failed", error instanceof Error ? error.message : undefined);
    return { error: plainError(error, false), saved: false };
  }
  // Open tasks waiting for a list are sent now; ones in an old list move to this one.
  syncAllOpenAfterResponse(mine.context.workspaceId, mine.context.userId);
  revalidatePath("/settings");
  return { error: null, saved: true };
}

/**
 * Makes a meeting from a calendar event. The event is read again from Google, so
 * nothing about it is taken from the browser. One meeting per event.
 */
export async function createMeetingFromEvent(_previous: GoogleState, formData: FormData): Promise<GoogleState> {
  const eventId = z.string().min(1).max(1024).safeParse(formData.get("event_id"));
  if (!eventId.success) return { error: "We couldn't find that event.", saved: false };
  const mine = await own();
  if (!mine) return NOT_READY;
  const { admin, integration, context } = mine;
  if (!integration || !hasFeature(integration.scopes, "calendar")) return { error: "Connect Google Calendar first.", saved: false };

  const existing = await context.supabase.from("meetings").select("id").eq("external_event_id", eventId.data).maybeSingle();
  if (existing.data) redirect(`/meetings/${existing.data.id}`);

  let meetingId: string;
  try {
    const event = await withToken(admin, integration, (token) => getEvent(token, eventId.data));
    // An all-day event has a date but no time: midday in the person's timezone keeps it on that day.
    const startsAt = event.start?.dateTime ?? (event.start?.date ? middayInZone(event.start.date, context.timezone) : null);
    if (!startsAt) return { error: "That event has no start time.", saved: false };
    const attendees = (event.attendees ?? [])
      .filter((person) => !person.self && !person.resource)
      // Display names only. Email addresses, or parts of them, aren't stored or sent to the AI.
      .map((person) => (person.displayName ?? "").trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 50);

    const { data, error } = await admin
      .from("meetings")
      .insert({
        workspace_id: context.workspaceId,
        title: (event.summary?.trim() || "Untitled event").slice(0, 200),
        starts_at: new Date(startsAt).toISOString(),
        attendees,
        source: "google_calendar",
        external_event_id: event.id,
      })
      .select("id")
      .single();
    if (error?.code === "23505") {
      // Made a moment ago, in another tab: open that one.
      const again = await context.supabase.from("meetings").select("id").eq("external_event_id", eventId.data).maybeSingle();
      if (!again.data) throw new Error("meeting_from_event_conflict");
      meetingId = again.data.id;
    } else {
      if (error || !data) throw new Error(`meeting_from_event_failed:${error?.code}`);
      meetingId = data.id;
    }
  } catch (error) {
    log("google_meeting_failed", error instanceof Error ? error.message : undefined);
    return { error: plainError(error, false), saved: false };
  }
  revalidatePath("/meetings");
  redirect(`/meetings/${meetingId}`);
}

/** The Retry button on a task: tries now, and shows what happened. */
export async function retrySync(_previous: GoogleState, formData: FormData): Promise<GoogleState> {
  const taskId = z.uuid().safeParse(formData.get("task_id"));
  if (!taskId.success) return { error: "We couldn't find this task.", saved: false };
  const mine = await own();
  if (!mine) return NOT_READY;
  // Row-level security decides whether this person may touch the task.
  const { data: task } = await mine.context.supabase.from("tasks").select("id").eq("id", taskId.data).maybeSingle();
  if (!task) return { error: "We couldn't find this task.", saved: false };

  // A try already running (another press, another tab) isn't started again, so repeated
  // presses can't pile up calls to Google.
  const { data: running } = await mine.admin
    .from("task_syncs")
    .select("id")
    .eq("task_id", task.id)
    .eq("state", "pending")
    .gt("updated_at", new Date(Date.now() - 20_000).toISOString())
    .limit(1);
  if (running?.length) return { error: "This is being sent now. Wait a moment, then check again.", saved: false };

  await requeue(mine.admin, task.id);
  await syncTask(mine.admin, task.id);
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
