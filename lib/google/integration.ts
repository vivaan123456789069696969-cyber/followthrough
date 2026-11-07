import "server-only";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { googleConfig } from "./config";
import { GoogleError, ReconnectNeeded } from "./http";
import { refreshAccessToken, revokeToken, type TokenReply } from "./oauth";

export type Integration = Database["public"]["Tables"]["integrations"]["Row"];

const contextFor = (userId: string, kind: "access" | "refresh") => `google:${userId}:${kind}`;

/** Always looked up by workspace and user together, so one person's row can't serve another. */
export async function loadIntegration(admin: AdminClient, workspaceId: string, userId: string): Promise<Integration | null> {
  const { data, error } = await admin
    .from("integrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(`integration_load_failed:${error.code}`);
  return data;
}

/** Stores what Google granted. Keeps the old refresh token if Google didn't send a new one. */
export async function saveGrant(admin: AdminClient, owner: { workspaceId: string; userId: string }, reply: TokenReply, existing: Integration | null) {
  const granted = (reply.scope ?? "").split(" ").filter(Boolean);
  const scopes = [...new Set([...(existing?.status === "active" ? existing.scopes : []), ...granted])];
  const values = {
    scopes,
    access_token_enc: encryptToken(reply.access_token, contextFor(owner.userId, "access")),
    expires_at: new Date(Date.now() + reply.expires_in * 1000).toISOString(),
    status: "active" as const,
    ...(reply.refresh_token ? { refresh_token_enc: encryptToken(reply.refresh_token, contextFor(owner.userId, "refresh")) } : {}),
  };

  if (existing) {
    const { data, error } = await admin.from("integrations").update(values).eq("id", existing.id).select("*").single();
    if (error) throw new Error(`integration_save_failed:${error.code}`);
    return data;
  }
  if (!values.refresh_token_enc) throw new Error("integration_no_refresh_token");
  const { data, error } = await admin
    .from("integrations")
    .insert({ workspace_id: owner.workspaceId, user_id: owner.userId, provider: "google", ...values })
    .select("*")
    .single();
  if (error) throw new Error(`integration_save_failed:${error.code}`);
  return data;
}

/** A working access token, refreshed when it's about to expire. */
export async function accessToken(
  admin: AdminClient,
  integration: Integration,
  options: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const { force = false, fetchImpl } = options;
  if (integration.status !== "active" || !integration.refresh_token_enc) throw new ReconnectNeeded();

  const fresh = !force && integration.expires_at && Date.parse(integration.expires_at) - Date.now() > 60_000;
  if (fresh && integration.access_token_enc) {
    try {
      return decryptToken(integration.access_token_enc, contextFor(integration.user_id, "access"));
    } catch {
      // Unreadable (changed key or damaged value): fall through and refresh instead.
    }
  }

  const config = googleConfig();
  if (!config) throw new Error("google_not_configured");
  try {
    let refreshToken: string;
    try {
      refreshToken = decryptToken(integration.refresh_token_enc, contextFor(integration.user_id, "refresh"));
    } catch {
      // Can't be read any more, so the only fix is connecting again.
      throw new ReconnectNeeded();
    }
    const reply = await refreshAccessToken(config, refreshToken, fetchImpl);
    const { error } = await admin
      .from("integrations")
      .update({
        access_token_enc: encryptToken(reply.access_token, contextFor(integration.user_id, "access")),
        expires_at: new Date(Date.now() + reply.expires_in * 1000).toISOString(),
      })
      .eq("id", integration.id);
    if (error) console.error(JSON.stringify({ event: "google_token_save_failed", code: error.code }));
    return reply.access_token;
  } catch (error) {
    if (error instanceof ReconnectNeeded) {
      // The user removed access in Google, or testing mode's 7 days ran out. Show a banner; stop syncing.
      await admin.from("integrations").update({ status: "needs_reconnect", access_token_enc: null }).eq("id", integration.id);
    }
    throw error;
  }
}

/**
 * Runs a Google call with a working token. If Google turns the token away, refreshes once
 * and tries again; if that fails too, the connection is marked as needing to reconnect.
 */
export async function withToken<T>(admin: AdminClient, integration: Integration, call: (token: string) => Promise<T>): Promise<T> {
  try {
    return await call(await accessToken(admin, integration));
  } catch (error) {
    if (!(error instanceof GoogleError && error.status === 401)) throw error;
    return call(await accessToken(admin, integration, { force: true }));
  }
}

/**
 * Removes the app's access at Google, then forgets the tokens. Tasks and meetings stay.
 * Returns whether Google confirmed, so people can be told to remove access themselves if not.
 */
export async function disconnect(admin: AdminClient, integration: Integration): Promise<{ revoked: boolean }> {
  let revoked = false;
  const sealed = integration.refresh_token_enc ?? integration.access_token_enc;
  if (sealed) {
    try {
      const kind = integration.refresh_token_enc ? "refresh" : "access";
      await revokeToken(decryptToken(sealed, contextFor(integration.user_id, kind)));
      revoked = true;
    } catch (error) {
      // Still forget the tokens: the user asked to disconnect, and Google expires them anyway.
      console.error(JSON.stringify({ event: "google_revoke_failed", name: error instanceof Error ? error.message : "unknown" }));
    }
  }
  const { error } = await admin.from("integrations").delete().eq("id", integration.id);
  if (error) throw new Error(`integration_delete_failed:${error.code}`);
  return { revoked: revoked || !sealed };
}

/** Where people can remove FollowThrough's access themselves. */
export const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";
