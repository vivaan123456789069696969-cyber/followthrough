import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribe } from "@/lib/reminders/unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns reminders off for the person a signed link names. No sign-in: the signature is the
 * proof. Mail apps post here for one-click unsubscribe; the confirm page's form does too.
 * Only POST changes anything, so link scanners that open URLs can't unsubscribe people.
 */
export async function POST(request: NextRequest) {
  const fromForm = (request.headers.get("content-type") ?? "").includes("form");
  const form = fromForm ? await request.formData() : null;
  const userId = String(form?.get("u") ?? request.nextUrl.searchParams.get("u") ?? "");
  const signature = String(form?.get("s") ?? request.nextUrl.searchParams.get("s") ?? "");
  // The confirm page's own form says so; a mail app's one-click post doesn't.
  const viaPage = form?.get("source") === "page";

  const done = (ok: boolean) =>
    viaPage ? NextResponse.redirect(new URL(`/unsubscribe?${ok ? "done=1" : "invalid=1"}`, request.url), 303) : new Response(null, { status: ok ? 200 : 400 });

  const admin = createAdminClient();
  if (!admin || !UUID.test(userId) || !signature) return done(false);

  const { data: prefs } = await admin.from("reminder_prefs").select("id, unsubscribe_token").eq("user_id", userId).maybeSingle();
  if (!prefs || !verifyUnsubscribe(userId, prefs.unsubscribe_token, signature)) return done(false);

  const { error } = await admin.from("reminder_prefs").update({ enabled: false }).eq("id", prefs.id);
  if (error) {
    console.error(JSON.stringify({ event: "unsubscribe_failed", code: error.code }));
    return done(false);
  }
  return done(true);
}
