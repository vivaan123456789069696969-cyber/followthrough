import { timingSafeEqual } from "node:crypto";
import { googleConfig } from "@/lib/google/config";
import { syncDue } from "@/lib/google/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron sends CRON_SECRET as a bearer token. Anything else is turned away. */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  // A short secret is too easy to guess, so the job stays off until a proper one is set.
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Retries syncs to Google that failed or haven't run yet. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  if (!admin || !googleConfig()) return Response.json({ synced: 0, skipped: "google_not_configured" });

  try {
    const synced = await syncDue(admin);
    return Response.json({ synced });
  } catch (error) {
    console.error(JSON.stringify({ event: "google_cron_failed", reason: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
