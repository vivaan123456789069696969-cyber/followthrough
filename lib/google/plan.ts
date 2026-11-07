import { hasFeature } from "./config";

// Decides what Google should show for one task. Pure, so every case is easy to test.

export type PlanTask = { id: string; status: "open" | "done" | "dismissed"; dueDate: string | null };
export type PlanIntegration = { status: string; scopes: string[]; calendarId: string | null; tasklistId: string | null } | null;
export type PlanSync = { provider: "google_tasks" | "google_calendar"; externalId: string | null } | undefined;

export type Step =
  | { provider: "google_tasks"; action: "upsert" }
  | { provider: "google_calendar"; action: "upsert" }
  | { provider: "google_calendar"; action: "delete"; externalId: string };

export function planSync(
  task: PlanTask,
  integration: PlanIntegration,
  destination: "app" | "google_tasks" | null,
  syncs: { tasks?: PlanSync; calendar?: PlanSync },
): Step[] {
  if (!integration || integration.status !== "active") return [];
  const steps: Step[] = [];

  // Google Tasks: only when it's the chosen destination, and a list is picked. Push-only:
  // done tasks are marked completed there; nothing is read back.
  if (destination === "google_tasks" && hasFeature(integration.scopes, "tasks") && integration.tasklistId) {
    const alreadyThere = Boolean(syncs.tasks?.externalId);
    // A task done or dismissed before it was ever sent doesn't need sending at all; one
    // already sent is completed there.
    if (task.status === "open" || alreadyThere) steps.push({ provider: "google_tasks", action: "upsert" });
  }

  // Due dates: an all-day event on the FollowThrough calendar while the task is open and
  // has a date. Done, dismissed or undated: the event is removed.
  if (hasFeature(integration.scopes, "deadlines") && integration.calendarId) {
    if (task.status === "open" && task.dueDate) steps.push({ provider: "google_calendar", action: "upsert" });
    else if (syncs.calendar?.externalId) steps.push({ provider: "google_calendar", action: "delete", externalId: syncs.calendar.externalId });
  }

  return steps;
}

export const MAX_ATTEMPTS = 8;

/** 1, 2, 4 ... minutes, at most 6 hours. After the last try it waits for the user's Retry. */
export function nextAttemptAt(attempts: number, now = Date.now()): string | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = Math.min(2 ** (attempts - 1), 360);
  return new Date(now + minutes * 60_000).toISOString();
}
