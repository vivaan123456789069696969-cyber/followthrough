import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/routes";
import { getAppUrl, getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** Google and magic links both land here with a one-time code. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code && getSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${appUrl}${next}`);
    console.error(JSON.stringify({ event: "auth_callback_failed", code: error.code ?? "unknown" }));
  }

  return NextResponse.redirect(`${appUrl}/sign-in?error=link`);
}
