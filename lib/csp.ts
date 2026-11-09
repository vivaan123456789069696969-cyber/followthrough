import { sentryOrigin } from "@/lib/sentry/options";

/**
 * The Content-Security-Policy for every page. Scripts run only with this request's nonce,
 * so injected markup can't run code even if it got past React's escaping.
 */
export function contentSecurityPolicy(nonce: string, isDev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next's route announcer and some framework markup use inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Plus the error-reporting address, only when reporting is turned on.
    `connect-src 'self'${errorReportingOrigin()}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in forms hand over to Supabase and Google.
    `form-action 'self'${supabaseOrigin()} https://accounts.google.com`,
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function errorReportingOrigin(): string {
  const origin = sentryOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
  return origin ? ` ${origin}` : "";
}

/** This app's own Supabase project only, not every project on supabase.co. */
function supabaseOrigin(): string {
  try {
    return ` ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin}`;
  } catch {
    return "";
  }
}

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
