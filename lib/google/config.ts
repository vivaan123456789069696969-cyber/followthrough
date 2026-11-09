import "server-only";
import { testSwitch } from "@/lib/test-switches";

// Which Google permission each feature asks for. Checked against Google's scope pages on
// 2026-11-08: developers.google.com/workspace/calendar/api/auth and .../tasks/auth.
// Each is asked for only when its feature is turned on (incremental authorization).

export const SCOPES = {
  // "See the events on Google calendars you own." Read only, and only the person's own
  // calendars (the app reads the primary one). Accepted by events.list per Google's reference.
  calendar: "https://www.googleapis.com/auth/calendar.events.owned.readonly",
  // "Make secondary Google calendars, and see, create, change, and delete events on them."
  // Only calendars this app created, so the user's own calendars stay untouched.
  deadlines: "https://www.googleapis.com/auth/calendar.app.created",
  // "Create, edit, organize, and delete all your tasks." Google has nothing narrower that can write.
  tasks: "https://www.googleapis.com/auth/tasks",
} as const;

export type GoogleFeature = keyof typeof SCOPES;

export const FEATURES = Object.keys(SCOPES) as GoogleFeature[];

export function isFeature(value: unknown): value is GoogleFeature {
  return typeof value === "string" && (FEATURES as string[]).includes(value);
}

export function hasFeature(scopes: string[] | null | undefined, feature: GoogleFeature): boolean {
  return Boolean(scopes?.includes(SCOPES[feature]));
}

/**
 * Google's addresses. Tests point these at a stand-in server, but only when
 * GOOGLE_TEST_ENDPOINTS is "true": a stray setting must never send secrets elsewhere.
 */
export function googleUrls() {
  const test = testSwitch("GOOGLE_TEST_ENDPOINTS");
  const pick = (override: string | undefined, real: string) => (test && override ? override : real);
  return {
    authorize: pick(process.env.GOOGLE_AUTH_URL, "https://accounts.google.com/o/oauth2/v2/auth"),
    token: pick(process.env.GOOGLE_TOKEN_URL, "https://oauth2.googleapis.com/token"),
    revoke: pick(process.env.GOOGLE_REVOKE_URL, "https://oauth2.googleapis.com/revoke"),
    api: pick(process.env.GOOGLE_API_URL, "https://www.googleapis.com").replace(/\/+$/, ""),
  };
}

export function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}
