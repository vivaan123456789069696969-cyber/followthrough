import { NextResponse, type NextRequest } from "next/server";
import { createCalendar } from "@/lib/google/api";
import { googleConfig, hasFeature } from "@/lib/google/config";
import { loadIntegration, saveGrant } from "@/lib/google/integration";
import { exchangeCode, parseState, revokeToken, STATE_COOKIE, stateMatches } from "@/lib/google/oauth";
import { syncAllOpenAfterResponse } from "@/lib/google/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeTimezone } from "@/lib/tasks/dates";

export const dynamic = "force-dynamic";

const log = (event: string, reason?: string) => console.error(JSON.stringify({ event, reason: reason ?? "unknown" }));

/** Google sends the user back here. Tokens are stored encrypted; none reach the browser. */
export async function GET(request: NextRequest) {
  const result = (status: string) => {
    const response = NextResponse.redirect(new URL(`/settings?google=${status}#google-heading`, request.url));
    response.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
    return response;
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/sign-in", request.url));

  const params = request.nextUrl.searchParams;
  const saved = parseState(request.cookies.get(STATE_COOKIE)?.value);
  if (!stateMatches(saved, params.get("state"), userId)) return result("expired");
  if (params.get("error")) return result("cancelled");
  const code = params.get("code");
  const config = googleConfig();
  const admin = createAdminClient();
  if (!code || !config || !admin) return result("error");

  // The same workspace the rest of the app uses: the oldest membership, the personal one.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return result("error");

  let reply: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    reply = await exchangeCode(config, code, saved.verifier);
  } catch (error) {
    log("google_exchange_failed", error instanceof Error ? error.message : undefined);
    return result("error");
  }

  let stored = false;
  try {
    // People can untick a permission on Google's screen. Then the feature isn't on.
    if (!hasFeature((reply.scope ?? "").split(" "), saved.feature)) return result("not-granted");

    const owner = { workspaceId: membership.workspace_id, userId };
    const existing = await loadIntegration(admin, owner.workspaceId, userId);
    const integration = await saveGrant(admin, owner, reply, existing);
    stored = true;

    // The due-date calendar is made when that permission is given, if there isn't one.
    if (saved.feature === "deadlines" && !integration.calendar_id) {
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
      const calendarId = await createCalendar(reply.access_token, safeTimezone(profile?.timezone));
      const { error } = await admin.from("integrations").update({ calendar_id: calendarId }).eq("id", integration.id);
      if (error) throw new Error(`calendar_save_failed:${error.code}`);
    }
    // Open tasks from before this connection are sent too.
    syncAllOpenAfterResponse(owner.workspaceId, userId);
    return result(`connected-${saved.feature}`);
  } catch (error) {
    log("google_connect_failed", error instanceof Error ? error.message : undefined);
    return result("error");
  } finally {
    // A grant that wasn't kept is given back, so Google doesn't list an access nobody holds.
    if (!stored && reply.refresh_token) await revokeToken(reply.refresh_token).catch(() => undefined);
  }
}
