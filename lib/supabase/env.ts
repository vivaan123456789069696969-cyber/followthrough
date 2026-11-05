/** Null until Supabase is configured, so the app still builds and fails closed without it. */
export function getSupabaseEnv(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

/**
 * The app's own address. Links in emails and redirects are built from this,
 * never from request headers, which a caller can forge.
 */
export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (url) return url.replace(/\/+$/, "");
  // Set by Vercel itself on every deployment, so it can't be forged by a request.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_APP_URL is not set");
  }
  return "http://localhost:3000";
}
