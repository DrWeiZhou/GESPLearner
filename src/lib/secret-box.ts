import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets kept in the database (the LLM API key set from /admin).
 *
 * The key comes from the `SETTINGS_SECRET` env var, never from the database, so a
 * leaked dump alone doesn't reveal the stored secrets. Generate one with
 * `openssl rand -base64 32`; changing it makes previously saved secrets unreadable.
 */

export type SealedSecret = { v: 1; iv: string; tag: string; data: string };

const MIN_SECRET_LENGTH = 16;

export const isSecretBoxConfigured = () => (process.env.SETTINGS_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH;

function key() {
  const secret = process.env.SETTINGS_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SETTINGS_SECRET 未配置或少于 ${MIN_SECRET_LENGTH} 位`);
  }
  return createHash("sha256").update(`gesp-settings:${secret}`).digest();
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/** Throws when the secret changed since sealing (GCM auth fails) or the blob is malformed. */
export function open(sealed: SealedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}
