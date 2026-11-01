/**
 * A better-sqlite3-shaped client over the SQLite that ships with the runtime:
 * `node:sqlite` under Node / Electron, `bun:sqlite` under Bun (the data scripts).
 *
 * Drizzle's better-sqlite3 session only needs `prepare()` (with `run`/`all`/`get`
 * and `raw()` for array rows) and `transaction()`, so this thin layer is all it
 * takes to reuse it — and the app ends up with no native module at all, which is
 * what lets one machine package both the Windows and the macOS build.
 *
 * Both modules are loaded with `process.getBuiltinModule`, which bundlers leave
 * alone: Turbopack never has to resolve `bun:sqlite`.
 */

type Param = string | number | bigint | null | Uint8Array;
export type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

interface NativeStatement {
  run(...params: Param[]): RunResult;
  all(...params: Param[]): unknown[];
  get(...params: Param[]): unknown;
}

interface Driver {
  prepare(sql: string): {
    run(params: Param[]): RunResult;
    all(params: Param[]): unknown[];
    get(params: Param[]): unknown;
    values(params: Param[]): unknown[][];
  };
  exec(sql: string): void;
  close(): void;
  /** True while a transaction is open on the connection. */
  inTransaction(): boolean;
}

// ───────────────────────── drivers ─────────────────────────

type NodeStatement = NativeStatement & { setReturnArrays(enabled: boolean): void };
type NodeSqlite = {
  DatabaseSync: new (path: string, options?: { timeout?: number }) => {
    prepare(sql: string): NodeStatement;
    exec(sql: string): void;
    close(): void;
    readonly isTransaction: boolean;
  };
};

function nodeDriver(file: string): Driver {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as NodeSqlite;
  const db = new DatabaseSync(file, { timeout: 10_000 });
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const asArrays = <T>(fn: () => T) => {
        stmt.setReturnArrays(true);
        try {
          return fn();
        } finally {
          stmt.setReturnArrays(false);
        }
      };
      return {
        run: (p) => stmt.run(...p),
        all: (p) => stmt.all(...p),
        get: (p) => stmt.get(...p),
        values: (p) => asArrays(() => stmt.all(...p) as unknown[][]),
      };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    inTransaction: () => db.isTransaction,
  };
}

type BunStatement = NativeStatement & { values(...params: Param[]): unknown[][] };
type BunSqlite = {
  Database: new (path: string, options?: { create?: boolean }) => {
    prepare(sql: string): BunStatement;
    exec(sql: string): void;
    close(): void;
    readonly inTransaction: boolean;
  };
};

function bunDriver(file: string): Driver {
  const { Database } = process.getBuiltinModule("bun:sqlite") as BunSqlite;
  const db = new Database(file, { create: true });
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (p) => stmt.run(...p),
        all: (p) => stmt.all(...p),
        // bun returns null for "no row", better-sqlite3 (and Drizzle) expect undefined.
        get: (p) => stmt.get(...p) ?? undefined,
        values: (p) => stmt.values(...p),
      };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    inTransaction: () => db.inTransaction,
  };
}

// ───────────────────────── better-sqlite3 surface ─────────────────────────

/** Values Drizzle may hand over that SQLite can't bind directly. */
function bindable(value: unknown): Param {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  return JSON.stringify(value);
}

const bind = (params: unknown[]) => params.map(bindable);

export class SqliteClient {
  private driver: Driver;
  private depth = 0;

  constructor(readonly file: string) {
    this.driver = process.versions.bun ? bunDriver(file) : nodeDriver(file);
  }

  prepare(sql: string) {
    const stmt = this.driver.prepare(sql);
    return {
      run: (...p: unknown[]) => stmt.run(bind(p)),
      all: (...p: unknown[]) => stmt.all(bind(p)),
      get: (...p: unknown[]) => stmt.get(bind(p)),
      raw: () => ({
        all: (...p: unknown[]) => stmt.values(bind(p)),
        get: (...p: unknown[]) => stmt.values(bind(p))[0],
      }),
    };
  }

  exec(sql: string) {
    this.driver.exec(sql);
  }

  pragma(statement: string) {
    return this.prepare(`PRAGMA ${statement}`).all();
  }

  /**
   * better-sqlite3's `db.transaction(fn)`: returns a function with `deferred`,
   * `immediate` and `exclusive` variants. The callback must be synchronous — a
   * promise would let other requests' statements interleave into the open
   * transaction on this single connection — so returning one is an error.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const run = (mode: "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE") => (...args: A): R => {
      if (this.depth > 0) return fn(...args);
      this.exec(`BEGIN ${mode}`);
      this.depth++;
      try {
        const result = fn(...args);
        if (result && typeof (result as { then?: unknown }).then === "function")
          throw new TypeError("Transaction function cannot return a promise");
        this.depth--;
        this.exec("COMMIT");
        return result;
      } catch (err) {
        this.depth--;
        this.exec("ROLLBACK");
        throw err;
      }
    };
    return Object.assign(run("DEFERRED"), {
      deferred: run("DEFERRED"),
      immediate: run("IMMEDIATE"),
      exclusive: run("EXCLUSIVE"),
    });
  }

  get inTransaction() {
    return this.driver.inTransaction();
  }

  close() {
    this.driver.close();
  }
}
