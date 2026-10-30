import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// promisify() drops the options overload, so wrap it by hand.
const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

/**
 * Password hashing with scrypt from node:crypto — no native dependency, so it runs
 * unchanged on Vercel's Node runtime.
 *
 * Stored format: `scrypt$N$r$p$<salt-b64>$<hash-b64>`. The parameters travel with
 * the hash, so they can be raised later without invalidating existing passwords.
 */

const N = 1 << 15; // 32768
const R = 8;
const P = 1;
const KEY_LEN = 32;
// scrypt needs roughly 128 * N * r bytes; give it headroom over the 32 MB default.
const MAX_MEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  try {
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
