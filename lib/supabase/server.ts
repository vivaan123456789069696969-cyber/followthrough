import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";
import type { Database } from "./types";

/** For Server Components, Server Actions and Route Handlers. Acts as the signed-in user, so RLS applies. */
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured");

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't write cookies. The proxy refreshes the session instead.
        }
      },
    },
  });
}
