import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routeDecision } from "@/lib/auth/routes";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { getSupabaseEnv, sessionCookieOptions, supabaseFetch } from "./env";
import type { Database } from "./types";

/**
 * Refreshes the session cookie, sends signed-out visitors to sign-in, and sets this
 * request's Content-Security-Policy. Next reads the policy from the request headers
 * and adds its nonce to the page's own scripts.
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);

  // Builds from the current request each time, so refreshed cookies are carried along.
  const pass = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    const next = NextResponse.next({ request: { headers } });
    next.headers.set("content-security-policy", csp);
    return next;
  };
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    redirect.headers.set("content-security-policy", csp);
    return redirect;
  };

  const env = getSupabaseEnv();
  // Without Supabase nobody can be signed in, so protected routes stay closed.
  if (!env) {
    const target = routeDecision({ pathname, search, isSignedIn: false });
    return target ? redirectTo(target) : pass();
  }

  let response = pass();

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookieOptions: sessionCookieOptions,
    global: { fetch: supabaseFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = pass();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims verifies the token. getSession would trust whatever the cookie says.
  // A malformed token can make this throw. That counts as signed out, not as an error page.
  const claims = await supabase.auth.getClaims().catch(() => null);
  const isSignedIn = Boolean(claims?.data?.claims?.sub);

  const target = routeDecision({ pathname, search, isSignedIn });
  if (!target) return response;

  // A refreshed session must survive the redirect, or the user gets signed out.
  const redirect = redirectTo(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
