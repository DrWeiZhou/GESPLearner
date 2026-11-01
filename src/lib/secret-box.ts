import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dbPath } from "@/db";

/**
 * AES-256-GCM for secrets kept in the database (the LLM API key set from /admin).
 *
 * The key never lives in the database, so a copied `gesp.db` alone doesn't reveal
 * the stored secrets. It comes from the `SETTINGS_SECRET` env var when set;
 * otherwise each installation generates one on first use and keeps it in
 * `secret.key` next to the database. Losing or changing it makes previously saved
 * secrets unreadable (the admin just enters the API key again).
 */

export type SealedSecret = { v: 1; iv: string; tag: string; data: string };

const MIN_SECRET_LENGTH = 16;

let cached: string | null = null;

function settingsSecret(): string {
  const env = process.env.SETTINGS_SECRET;
  if (env) return env;
  if (cached) return cached;
  const file = path.join(path.dirname(dbPath()), "secret.key");
  try {
    cached = readFileSync(file, "utf8").trim();
  } catch {
    cached = randomBytes(32).toString("base64");
    writeFileSync(file, cached + "\n", { mode: 0o600 });
  }
  return cached;
}

export const isSecretBoxConfigured = () => settingsSecret().length >= MIN_SECRET_LENGTH;

function key() {
  const secret = settingsSecret();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SETTINGS_SECRET 少于 ${MIN_SECRET_LENGTH} 位`);
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
