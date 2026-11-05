import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** Verifies the session for a protected page. The proxy checks too; this is the second lock. */
export async function requireSession() {
  if (!getSupabaseEnv()) redirect("/sign-in");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  return { supabase, userId, email: data.claims.email ?? null };
}

export type Session = Awaited<ReturnType<typeof requireSession>>;

export async function getProfile({ supabase, userId }: Pick<Session, "supabase" | "userId">) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, timezone, onboarding_done")
    .eq("id", userId)
    .single();
  if (error) throw new Error("Could not load profile");
  return data;
}
