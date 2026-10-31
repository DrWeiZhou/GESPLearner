import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { backupDirFor, dailyBackup } from "./backups";
import { bootstrapContent } from "./bootstrap";
import { SqliteClient, type RunResult } from "./sqlite";
import * as schema from "./schema";

/**
 * One SQLite file holds everything. The desktop shell passes its location in
 * `GESP_DB_PATH` (the user's data directory); in development it defaults to
 * `data/gesp.db`, next to the bundled question bank.
 *
 * The database is always there — it is created, migrated and filled with the
 * bundled papers on first use — so the old demo mode never kicks in.
 */
export const isDatabaseConfigured = true;

export type DB = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

/** Transaction handle, for helpers that have to join a caller's transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

// The turbopackIgnore hints keep the build's file tracer from copying data/ (PDFs,
// local databases, backups) into the standalone output; the desktop build copies
// exactly the bundled content itself (scripts/desktop/build.ts).

/** Bundled content (papers, syllabus, migrations) lives here. */
export const contentDir = () => process.env.GESP_CONTENT_DIR ?? process.cwd();
export const dataDir = () => path.join(/*turbopackIgnore: true*/ contentDir(), "data");
export const dbPath = () =>
  process.env.GESP_DB_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "gesp.db");

const globalForDb = globalThis as unknown as { __gespDb?: DB; __gespClient?: SqliteClient };

function open(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const client = new SqliteClient(file);
  // WAL lets the build's prerender workers read while nothing writes, and keeps
  // readers from blocking the writer at runtime. Foreign keys are off by default
  // in SQLite, and the schema relies on cascades.
  client.pragma("journal_mode = WAL");
  client.pragma("synchronous = NORMAL");
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 10000");
  const dialect = new SQLiteSyncDialect({ casing: "snake_case" });
  // BetterSQLiteSession is typed against better-sqlite3's Database; SqliteClient
  // implements the part of it the session uses.
  const session = new BetterSQLiteSession(client as never, dialect, undefined);
  const db = new BaseSQLiteDatabase("sync", dialect, session as never, undefined) as unknown as DB;
  return { client, db };
}

/**
 * Lazily opened, migrated and seeded on first use. Everything here is synchronous,
 * so two requests can't race each other through the setup.
 */
export function getDb(): DB {
  if (!globalForDb.__gespDb) {
    const { client, db } = open(dbPath());
    migrate(db as never, { migrationsFolder: path.join(/*turbopackIgnore: true*/ contentDir(), "drizzle") });
    globalForDb.__gespClient = client;
    globalForDb.__gespDb = db;
    // Closing checkpoints the WAL into gesp.db, so a quit leaves one self-contained
    // file behind (an unclean exit is still safe: SQLite replays the WAL on open).
    process.once("exit", () => {
      if (globalForDb.__gespClient === client) closeDb();
    });
    // Imports the bundled question bank when it changed since the last start.
    // Failures are logged, not thrown: whatever is already imported keeps working.
    try {
      bootstrapContent(db);
    } catch (err) {
      console.error("导入内置题库失败：", err);
    }
    // The desktop shell asks for one backup a day (see lib/backup).
    if (process.env.GESP_AUTO_BACKUP === "1") {
      try {
        dailyBackup(client, backupDirFor(dbPath()));
      } catch (err) {
        console.error("自动备份失败：", err);
      }
    }
  }
  return globalForDb.__gespDb;
}

/** The raw connection, for backups (VACUUM INTO) and restores. */
export function getClient(): SqliteClient {
  getDb();
  return globalForDb.__gespClient!;
}

/** Closes the connection; the next `getDb()` reopens (and re-migrates) the file. */
export function closeDb() {
  globalForDb.__gespClient?.close();
  globalForDb.__gespClient = undefined;
  globalForDb.__gespDb = undefined;
}

export { schema };
