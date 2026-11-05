"use server";

import { redirect } from "next/navigation";
import { isValidTimezone } from "@/lib/auth/timezone";
import { requireSession } from "@/lib/auth/session";

export async function signOut() {
  const { supabase } = await requireSession();
  await supabase.auth.signOut();
  redirect("/");
}

/** Saves the browser's timezone at first sign-in. Never overwrites one already set. */
export async function saveDetectedTimezone(timezone: unknown) {
  if (!isValidTimezone(timezone)) return;

  const { supabase, userId } = await requireSession();
  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", userId).is("timezone", null);
  if (error) console.error(JSON.stringify({ event: "save_timezone_failed", code: error.code }));
}
