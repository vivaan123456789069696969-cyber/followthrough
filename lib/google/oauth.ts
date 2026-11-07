import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { googleUrls, isFeature, SCOPES, type GoogleFeature } from "./config";
import { googleFetch, googleJson, GoogleError, ReconnectNeeded } from "./http";

/** A one-time value for the round trip to Google, kept in an httpOnly cookie. */
export type OAuthState = { state: string; verifier: string; feature: GoogleFeature; userId: string; createdAt: number };

export const STATE_COOKIE = "ft_google_oauth";
export const STATE_MAX_AGE_SECONDS = 600;

export function newOAuthState(feature: GoogleFeature, userId: string): OAuthState {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    feature,
    userId,
    createdAt: Date.now(),
  };
}

export function authorizeUrl(config: { clientId: string; redirectUri: string }, oauth: OAuthState): string {
  const challenge = createHash("sha256").update(oauth.verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES[oauth.feature],
    // Keeps what was granted before, so each feature adds to the connection.
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent",
    state: oauth.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${googleUrls().authorize}?${params.toString()}`;
}

/** Checks the cookie and the reply belong together, to this user, and aren't stale. */
export function stateMatches(saved: OAuthState | null, returnedState: string | null, userId: string): saved is OAuthState {
  if (!saved || !returnedState || saved.userId !== userId) return false;
  if (Date.now() - saved.createdAt > STATE_MAX_AGE_SECONDS * 1000) return false;
  // Same length first, then a constant-time comparison.
  const a = Buffer.from(saved.state);
  const b = Buffer.from(returnedState);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseState(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as OAuthState;
    const ok =
      typeof value.state === "string" &&
      typeof value.verifier === "string" &&
      typeof value.userId === "string" &&
      isFeature(value.feature) &&
      Number.isFinite(value.createdAt);
    return ok ? value : null;
  } catch {
    return null;
  }
}

export const serializeState = (state: OAuthState) => Buffer.from(JSON.stringify(state)).toString("base64url");

export type TokenReply = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

type Client = { clientId: string; clientSecret: string; redirectUri: string };

export async function exchangeCode(config: Client, code: string, verifier: string, fetchImpl?: typeof fetch): Promise<TokenReply> {
  const response = await googleFetch(googleUrls().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    fetchImpl,
  });
  return googleJson<TokenReply>(response);
}

export async function refreshAccessToken(config: Client, refreshToken: string, fetchImpl?: typeof fetch): Promise<TokenReply> {
  const response = await googleFetch(googleUrls().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  });
  try {
    return await googleJson<TokenReply>(response);
  } catch (error) {
    // invalid_grant: access was removed in Google, or the token expired (7 days in testing mode).
    if (error instanceof GoogleError && error.reason === "invalid_grant") throw new ReconnectNeeded();
    throw error;
  }
}

/** Tells Google to drop the app's access. A token that's already invalid counts as done. */
export async function revokeToken(token: string, fetchImpl?: typeof fetch): Promise<void> {
  const response = await googleFetch(googleUrls().revoke, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    fetchImpl,
  });
  if (response.ok || response.status === 400) return;
  await googleJson(response);
}
