import "server-only";

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose message is the failed
 * SQL plus its parameters, and puts the real SQLite error on `cause`. Matching on
 * the top-level message therefore misses constraint violations (and risks echoing
 * the query back to a caller), so walk the cause chain and read the error code.
 *
 * node:sqlite reports `errcode` 2067 (SQLITE_CONSTRAINT_UNIQUE) / 1555
 * (SQLITE_CONSTRAINT_PRIMARYKEY); bun:sqlite reports the same as `errno` with a
 * symbolic `code`. Both put the index name in the message:
 * "UNIQUE constraint failed: index 'users_username_key'".
 */

const UNIQUE_CODES = new Set([2067, 1555, "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"]);

function* causes(err: unknown): Generator<Record<string, unknown>> {
  let current = err;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

/** True for a duplicate-key error, optionally narrowed to one constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (const e of causes(err)) {
    const message = typeof e.message === "string" ? e.message : "";
    const unique =
      UNIQUE_CODES.has(e.errcode as number) ||
      UNIQUE_CODES.has(e.errno as number) ||
      UNIQUE_CODES.has(e.code as string) ||
      /UNIQUE constraint failed/.test(message);
    if (!unique) continue;
    if (!constraint || message.includes(constraint)) return true;
  }
  return false;
}
