import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

const FAKE_SUPABASE = "http://127.0.0.1:54399";

/** A session cookie in Supabase's real format. tests/e2e/fake-supabase.mjs accepts only "good-*" signatures. */
export async function setSession(
  context: BrowserContext,
  baseURL: string | undefined,
  signature: string,
  userId = "00000000-0000-4000-8000-000000000001",
) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 3600;
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

/**
 * A new person with their own user id, as the Google tests need: their Google data is
 * found by user id. Must match userIdFor() in fake-supabase.mjs.
 */
export async function signInOwnUser(context: BrowserContext, baseURL: string | undefined) {
  const hex = randomUUID().replace(/-/g, "");
  // 7 + 32 = 39 characters: a valid base64url length.
  const token = `good-gg${hex}`;
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  await setSession(context, baseURL, token, userId);
  return { token, userId };
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
