/** Null until Supabase is configured, so the app still builds and fails closed without it. */
export function getSupabaseEnv(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

/** Session cookies stay out of reach of page scripts. All Supabase calls run on the server. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

/** A stalled Supabase fails quickly and counts as signed out, instead of hanging every page. */
export const supabaseFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(8000) });

/**
 * The app's own address. Links in emails and redirects are built from this,
 * never from request headers, which a caller can forge.
 */
export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (url) return url.replace(/\/+$/, "");
  // Preview builds get a new address each time. Production must set its address on purpose.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL is not set");
  }
  return "http://localhost:3000";
}
