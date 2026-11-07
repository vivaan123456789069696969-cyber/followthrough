import { NextResponse, type NextRequest } from "next/server";
import { googleConfig, isFeature } from "@/lib/google/config";
import { authorizeUrl, newOAuthState, serializeState, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/google/oauth";
import { googleReady } from "@/lib/google/schedule";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Starts connecting one Google feature. The callback checks the cookie set here. */
export async function GET(request: NextRequest) {
  const settings = (status: string) => NextResponse.redirect(new URL(`/settings?google=${status}#google-heading`, request.url));

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/sign-in", request.url));

  const feature = request.nextUrl.searchParams.get("feature");
  const config = googleConfig();
  if (!isFeature(feature)) return settings("error");
  if (!config || !googleReady()) return settings("unavailable");

  const state = newOAuthState(feature, userId);
  const response = NextResponse.redirect(authorizeUrl(config, state));
  response.cookies.set(STATE_COOKIE, serializeState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, so the cookie comes back on Google's top-level redirect to the callback.
    sameSite: "lax",
    path: "/api/google",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}
