import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { HOME_AFTER_SIGN_IN } from "@/lib/auth/routes";
import { getAppUrl, getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const EMAIL_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup"]);

/** This response sets a session cookie, so it must never be cached. */
function redirectNoStore(url: string) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Sign-in links from email land here with a one-time token. Unlike the code flow in
 * /auth/callback, this works in any browser, so opening the email on another app or
 * device still signs the person in there.
 */
export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && EMAIL_TYPES.has(type) && getSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return redirectNoStore(`${appUrl}${HOME_AFTER_SIGN_IN}`);
    console.error(JSON.stringify({ event: "auth_confirm_failed", code: error.code ?? "unknown" }));
  }

  return redirectNoStore(`${appUrl}/sign-in?error=link`);
}
