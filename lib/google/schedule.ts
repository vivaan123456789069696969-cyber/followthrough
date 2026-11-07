import "server-only";
import { after } from "next/server";
import { tokenEncryptionConfigured } from "@/lib/crypto/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfig } from "./config";
import { openTaskIds, syncTask } from "./sync";

const crashed = (error: unknown) =>
  console.error(JSON.stringify({ event: "google_sync_crashed", reason: error instanceof Error ? error.message : "unknown" }));

/**
 * Syncs tasks to Google after the response is sent, so a slow or failing Google never
 * holds up the page. Anything that fails is retried by the scheduled job.
 * Callers have already checked the user can change these tasks.
 */
export function syncAfterResponse(taskIds: string[]) {
  if (!taskIds.length || !googleConfig()) return;
  after(async () => {
    const admin = createAdminClient();
    if (!admin) return;
    for (const taskId of taskIds) {
      try {
        await syncTask(admin, taskId);
      } catch (error) {
        crashed(error);
      }
    }
  });
}

/**
 * After connecting, reconnecting, or changing the list or destination: sends every open
 * task of this person, so ones from before the change aren't left out.
 */
export function syncAllOpenAfterResponse(workspaceId: string, userId: string) {
  if (!googleConfig()) return;
  after(async () => {
    const admin = createAdminClient();
    if (!admin) return;
    try {
      for (const taskId of await openTaskIds(admin, workspaceId, userId)) await syncTask(admin, taskId);
    } catch (error) {
      crashed(error);
    }
  });
}

/** True when everything a Google connection needs is set on the server, and the key is usable. */
export function googleReady(): boolean {
  return Boolean(googleConfig() && tokenEncryptionConfigured() && createAdminClient());
}
