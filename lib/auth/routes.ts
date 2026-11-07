export const HOME_AFTER_SIGN_IN = "/my-day";
const SIGN_IN = "/sign-in";

/** Everything else needs a session, so a new page is private unless it's added here. */
// Scheduled jobs have no session; each checks its own secret instead.
const PUBLIC_PATHS = new Set(["/", SIGN_IN, "/auth/callback", "/auth/confirm", "/api/cron/google-sync"]);

/**
 * Only same-site paths are allowed after sign-in. Anything else could send someone
 * to another site from a link that looks like ours.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return HOME_AFTER_SIGN_IN;
  // "//evil.com" and "/\evil.com" are read by browsers as other sites.
  if (next.startsWith("//") || next.includes("\\")) return HOME_AFTER_SIGN_IN;
  if (/[\u0000-\u001f\u007f]/.test(next)) return HOME_AFTER_SIGN_IN;

  try {
    const base = "http://internal.invalid";
    const resolved = new URL(next, base);
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // Dot segments can collapse into "//evil.com" here, after the check above.
    if (resolved.origin !== base || path.startsWith("//")) return HOME_AFTER_SIGN_IN;
    return path;
  } catch {
    return HOME_AFTER_SIGN_IN;
  }
}

/** Where to send this request instead, or null to let it through. */
export function routeDecision(input: { pathname: string; search: string; isSignedIn: boolean }): string | null {
  const { pathname, search, isSignedIn } = input;

  if (isSignedIn) return pathname === SIGN_IN ? HOME_AFTER_SIGN_IN : null;
  if (PUBLIC_PATHS.has(pathname)) return null;

  return `${SIGN_IN}?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
