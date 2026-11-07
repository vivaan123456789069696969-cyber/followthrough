import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv, supabaseFetch } from "./env";
import type { Database } from "./types";

/**
 * Bypasses row-level security. Server only, and only for what users can't do
 * themselves: reading and writing Google tokens and sync state, and scheduled jobs.
 * Every caller must check who the data belongs to first.
 */
export function createAdminClient() {
  const env = getSupabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!env || !secret) return null;
  return createClient<Database>(env.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseFetch },
  });
}

export type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
