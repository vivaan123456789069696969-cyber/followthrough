import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with a random 12-byte IV per value. The context string (who and what the
// token is for) is bound in as associated data, so a ciphertext copied onto another
// row or another user fails to decrypt instead of quietly working.

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  const bytes = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (bytes.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 random bytes, base64 encoded");
  return bytes;
}

export function tokenEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Throws if the value was changed, belongs to another context, or the key is wrong. */
export function decryptToken(sealed: string, context: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unknown token format");
  const authTag = Buffer.from(tag, "base64url");
  // A shortened tag is easier to forge, and Node would accept one unless told the length.
  if (authTag.length !== 16) throw new Error("Unknown token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
