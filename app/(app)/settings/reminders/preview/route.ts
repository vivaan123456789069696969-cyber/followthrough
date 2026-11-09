import { requireSession } from "@/lib/auth/session";
import { previewFor } from "@/lib/reminders/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeTimezone, todayInZone } from "@/lib/tasks/dates";

export const dynamic = "force-dynamic";

/** Today's reminder email for the signed-in person, as it would look. Sends nothing. */
export async function GET() {
  const { supabase, userId } = await requireSession();
  const admin = createAdminClient();
  const plain = (text: string, status = 200) =>
    new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!admin) return plain("Reminders aren't set up on this app yet.");

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const preview = await previewFor(admin, userId, todayInZone(safeTimezone(profile?.timezone)));
  if (!preview) return plain("We couldn't build a preview.", 500);
  if (!preview.items.length) return plain("Nothing would be in today's email: no open tasks of yours are due today, tomorrow or overdue.");
  return new Response(preview.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
