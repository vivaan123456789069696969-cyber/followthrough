import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/routes";
import { getAppUrl, getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** This response can set a session cookie, so it must never be cached. */
function redirectNoStore(url: string) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Google and magic links both land here with a one-time code. */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  // Cancelled at Google, or sign-up failed on Supabase's side.
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    const errorCode = request.nextUrl.searchParams.get("error_code") ?? "unknown";
    console.error(JSON.stringify({ event: "auth_provider_error", error: providerError.slice(0, 100), code: errorCode.slice(0, 100) }));
    return redirectNoStore(`${appUrl}/sign-in?error=provider`);
  }

  if (code && getSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectNoStore(`${appUrl}${next}`);
    console.error(JSON.stringify({ event: "auth_callback_failed", code: error.code ?? "unknown" }));
  }

  return redirectNoStore(`${appUrl}/sign-in?error=link`);
}
