import "server-only";

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose message is the failed
 * SQL plus its parameters, and puts the real postgres error on `cause`. Matching on
 * the message therefore misses constraint violations (and risks echoing the query
 * back to a caller), so walk the cause chain and read the SQLSTATE instead.
 */

const UNIQUE_VIOLATION = "23505";

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
    if (e.code !== UNIQUE_VIOLATION) continue;
    if (!constraint) return true;
    const name = [e.constraint_name, e.constraint, e.detail, e.message]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (name.includes(constraint)) return true;
  }
  return false;
}
