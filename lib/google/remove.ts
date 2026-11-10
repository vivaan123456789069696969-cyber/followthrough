import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { deadlineEventId, deleteEvent, deleteTask } from "./api";
import { loadIntegration, withToken } from "./integration";

/**
 * Takes a task's copies out of Google before the task itself is deleted (the sync records
 * go with the task, and with them the only way to find the copies).
 * Returns false when Google could not be reached, so the caller can keep the task and say so.
 * Nothing to remove, or no working connection to remove it with, counts as done.
 * The caller has already checked the task is the user's.
 */
export async function removeFromGoogle(admin: AdminClient, taskId: string): Promise<boolean> {
  const { data: task } = await admin.from("tasks").select("workspace_id, created_by").eq("id", taskId).maybeSingle();
  if (!task?.created_by) return true;

  const { data: syncs } = await admin.from("task_syncs").select("provider, external_id, container_id").eq("task_id", taskId);
  const integration = await loadIntegration(admin, task.workspace_id, task.created_by);
  // Disconnected or needing to reconnect: the tokens are gone or unusable, so nothing can be removed.
  if (!integration || integration.status !== "active") return true;

  try {
    await withToken(admin, integration, async (token) => {
      for (const sync of syncs ?? []) {
        if (sync.provider === "google_tasks" && sync.external_id && sync.container_id) {
          await deleteTask(token, sync.container_id, sync.external_id);
        }
      }
      // The deadline event has a fixed id, so it is found even if its record was never saved.
      const calendarId = (syncs ?? []).find((sync) => sync.provider === "google_calendar")?.container_id ?? integration.calendar_id;
      if (calendarId && (syncs ?? []).some((sync) => sync.provider === "google_calendar")) {
        await deleteEvent(token, calendarId, deadlineEventId(taskId));
      }
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "google_remove_failed", reason: error instanceof Error ? error.message : "unknown" }));
    return false;
  }
}
