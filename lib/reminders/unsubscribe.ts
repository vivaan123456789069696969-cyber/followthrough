import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// One-click unsubscribe without signing in. The link carries the user id and a signature
// over the id and that person's unsubscribe token. Changing the token (or the secret)
// makes old links stop working. Links don't expire: an unsubscribe link must keep working.

function secret(): string | null {
  const value = process.env.UNSUBSCRIBE_SECRET;
  return value && value.length >= 32 ? value : null;
}

export function unsubscribeConfigured(): boolean {
  return secret() !== null;
}

export function signUnsubscribe(userId: string, token: string): string {
  const key = secret();
  if (!key) throw new Error("UNSUBSCRIBE_SECRET must be set, at least 32 characters");
  return createHmac("sha256", key).update(`unsubscribe:${userId}:${token}`).digest("base64url");
}

export function verifyUnsubscribe(userId: string, token: string, signature: string): boolean {
  if (!secret()) return false;
  const expected = Buffer.from(signUnsubscribe(userId, token));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(appUrl: string, userId: string, token: string): string {
  return `${appUrl}/unsubscribe?u=${encodeURIComponent(userId)}&s=${signUnsubscribe(userId, token)}`;
}

/** The address mail apps post to for one-click unsubscribe (RFC 8058). */
export function oneClickUrl(appUrl: string, userId: string, token: string): string {
  return `${appUrl}/api/unsubscribe?u=${encodeURIComponent(userId)}&s=${signUnsubscribe(userId, token)}`;
}
