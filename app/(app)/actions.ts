"use server";

import { redirect } from "next/navigation";
import { isValidTimezone } from "@/lib/auth/timezone";
import { requireSession } from "@/lib/auth/session";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs out of this device. The session is cleared here even if Supabase can't be
 * reached, so this also works from the error page and during an outage.
 */
export async function signOut() {
  if (getSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.error(JSON.stringify({ event: "sign_out_failed", code: error.code ?? "unknown" }));
  }
  redirect("/");
}

/** Saves the browser's timezone at first sign-in. Never overwrites one already set. */
export async function saveDetectedTimezone(timezone: unknown) {
  if (!isValidTimezone(timezone)) return;

  const { supabase, userId } = await requireSession();
  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", userId).is("timezone", null);
  if (error) console.error(JSON.stringify({ event: "save_timezone_failed", code: error.code }));
}
