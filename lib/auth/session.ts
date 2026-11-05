import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

/** Verifies the session for a protected page. The proxy checks too; this is the second lock. */
export async function requireSession() {
  if (!getSupabaseEnv()) redirect("/sign-in");

  const supabase = await createClient();
  const result = await supabase.auth.getClaims().catch(() => null);
  const claims = result?.data?.claims;
  if (!claims?.sub) redirect("/sign-in");

  return { supabase, userId: claims.sub, email: claims.email ?? null };
}

export type Session = Awaited<ReturnType<typeof requireSession>>;

export async function getProfile({ supabase, userId }: Pick<Session, "supabase" | "userId">) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, timezone, onboarding_done")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load profile");
  // Null if the account predates the schema or was just deleted. Callers still render.
  return data;
}
