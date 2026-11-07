"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isValidTimezone } from "@/lib/auth/timezone";
import type { Database } from "@/lib/supabase/types";

export type SettingsState = { error: string | null; saved: boolean };

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const logFailure = (event: string, code?: string) => console.error(JSON.stringify({ event, code: code ?? "unknown" }));

const DESTINATION = z.enum(["app", "google_tasks", "later"]);
// A "use server" file may only export functions, so the choices live here and in the form.
const RETENTION = z.enum(["keep", "30", "90", "180", "365"]);

async function updateProfile(values: ProfileUpdate, event: string): Promise<SettingsState> {
  const { supabase, userId } = await requireSession();
  const { data, error } = await supabase.from("profiles").update(values).eq("id", userId).select("id");
  // No row updated means nothing was saved, so it mustn't say "Saved."
  if (error || !data?.length) {
    logFailure(event, error?.code ?? "no_profile");
    return { error: "We couldn't save this. Try again.", saved: false };
  }
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

const toDestination = (choice: z.infer<typeof DESTINATION>) => (choice === "later" ? null : choice);

/** Finishing or skipping setup both lead to the app. Skipping changes nothing else. */
export async function finishSetup(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const values: ProfileUpdate = { onboarding_done: true };
  if (formData.get("intent") !== "skip") {
    const choice = DESTINATION.safeParse(formData.get("task_destination"));
    if (!choice.success) return { error: "Choose where tasks should go, or skip for now.", saved: false };
    values.task_destination = toDestination(choice.data);
  }
  const result = await updateProfile(values, "finish_setup_failed");
  if (result.error) return result;
  redirect("/my-day");
}

export async function saveName(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const name = z.string().trim().max(100, "Keep your name under 100 characters.").safeParse(formData.get("full_name") ?? "");
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Check your name.", saved: false };
  return updateProfile({ full_name: name.data || null }, "save_name_failed");
}

export async function saveTimezone(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const timezone = formData.get("timezone");
  if (!isValidTimezone(timezone)) return { error: "Choose a timezone from the list.", saved: false };
  return updateProfile({ timezone }, "save_timezone_failed");
}

export async function saveDestination(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const choice = DESTINATION.safeParse(formData.get("task_destination"));
  if (!choice.success) return { error: "Choose where tasks should go.", saved: false };
  return updateProfile({ task_destination: toDestination(choice.data) }, "save_destination_failed");
}

export async function saveRetention(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const choice = RETENTION.safeParse(formData.get("note_retention"));
  if (!choice.success) return { error: "Choose how long to keep notes.", saved: false };
  return updateProfile({ note_retention_days: choice.data === "keep" ? null : Number(choice.data) }, "save_retention_failed");
}

/**
 * Deletes the account and everything in it, then signs out. The word "delete" must be
 * typed first, so it can't happen by a stray click.
 */
export async function deleteAccount(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (typed !== "delete") return { error: "Type delete to confirm.", saved: false };

  const { supabase } = await requireSession();
  // Phase 5: revoke Google access here first, once accounts can connect Google.
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    logFailure("delete_account_failed", error.code);
    return { error: "We couldn't delete your account. Nothing was deleted. Try again.", saved: false };
  }

  // The account is gone, so only this device's cookies are left to clear.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/?account=deleted");
}
