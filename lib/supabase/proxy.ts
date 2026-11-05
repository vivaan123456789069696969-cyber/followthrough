import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routeDecision } from "@/lib/auth/routes";
import { getSupabaseEnv } from "./env";
import type { Database } from "./types";

/** Refreshes the session cookie and sends signed-out visitors to sign-in. */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const env = getSupabaseEnv();

  // Without Supabase nobody can be signed in, so protected routes stay closed.
  if (!env) {
    const redirectTo = routeDecision({ pathname, search, isSignedIn: false });
    return redirectTo ? NextResponse.redirect(new URL(redirectTo, request.url)) : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims verifies the token. getSession would trust whatever the cookie says.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const redirectTo = routeDecision({ pathname, search, isSignedIn });
  if (!redirectTo) return response;

  // A refreshed session must survive the redirect, or the user gets signed out.
  const redirect = NextResponse.redirect(new URL(redirectTo, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
