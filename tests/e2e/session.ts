import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54399";

/** A session cookie in Supabase's real format. tests/e2e/fake-supabase.mjs accepts only "good-*" signatures. */
export async function setSession(context: BrowserContext, baseURL: string | undefined, signature: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const userId = "00000000-0000-4000-8000-000000000001";
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: userId, role: "authenticated", email: "maya@example.com", exp: expires }),
    signature,
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user: { id: userId, aud: "authenticated", role: "authenticated" },
  };
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${encode(session)}`, url: baseURL! }]);
}

export const USER_ID = "00000000-0000-4000-8000-000000000001";

/** Signs in as a new person in UTC with an empty workspace, so tests don't share data. */
export async function signInFresh(context: BrowserContext, baseURL: string | undefined) {
  // A JWT signature is base64url, so its length can't be 1 more than a multiple of 4.
  // 8 + 32 = 40 characters keeps this one well-formed.
  const token = `good-utc${randomUUID().replace(/-/g, "")}`;
  await setSession(context, baseURL, token);
  return token;
}

export async function seed(token: string, table: string, rows: object[]) {
  const response = await fetch(`${FAKE_SUPABASE}/test/seed`, {
    method: "POST",
    body: JSON.stringify({ token, table, rows }),
  });
  return (await response.json()) as { id: string }[];
}

/** A calendar date in UTC, relative to today. */
export function dayFromToday(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
