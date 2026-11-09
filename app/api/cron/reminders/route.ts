import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/lib/reminders/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { testSwitch } from "@/lib/test-switches";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Called every 15 minutes by Supabase's scheduler. Tests may pass ?now= to simulate the
 * time, but only when REMINDERS_TEST_CLOCK is "true".
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  if (!admin) return Response.json({ skipped: "supabase_admin_not_configured" });

  const requested = new URL(request.url).searchParams.get("now");
  const asked = requested ? Date.parse(requested) : NaN;
  // A simulated time only in tests, and never more than 30 days from the real one.
  const usable = testSwitch("REMINDERS_TEST_CLOCK") && Number.isFinite(asked) && Math.abs(asked - Date.now()) < 30 * 24 * 60 * 60 * 1000;
  const now = usable ? new Date(asked) : new Date();
  try {
    return Response.json(await runReminders(admin, now));
  } catch (error) {
    console.error(JSON.stringify({ event: "reminders_cron_failed", reason: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
