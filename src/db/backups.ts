import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { SqliteClient } from "./sqlite";

/**
 * Backup files of the SQLite database: `<data dir>/backups/gesp-YYYYMMDD-HHMMSS[-tag].db`.
 * Low-level on purpose — db/index runs the daily automatic backup from here, so
 * this module can't depend on anything above the database layer (see lib/backup).
 */

export type BackupFile = { name: string; size: number; createdAt: string };

const KEEP = 30;
export const BACKUP_NAME_RE = /^gesp-\d{8}-\d{6}(-[a-z]+)?\.db$/;

export const backupDirFor = (dbFile: string) => path.join(path.dirname(dbFile), "backups");

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function listBackupFiles(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKUP_NAME_RE.test(f))
    .map((name) => {
      const s = statSync(path.join(dir, name));
      return { name, size: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** `VACUUM INTO` writes a consistent, compacted copy while the app keeps running. */
export function writeBackup(client: SqliteClient, dir: string, tag?: "auto" | "restore"): BackupFile {
  mkdirSync(dir, { recursive: true });
  const name = `gesp-${stamp()}${tag ? `-${tag}` : ""}.db`;
  const file = path.join(dir, name);
  rmSync(file, { force: true });
  // Single quotes are the only thing that needs escaping inside the SQL literal.
  client.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of listBackupFiles(dir).slice(KEEP)) rmSync(path.join(dir, old.name), { force: true });
  const s = statSync(file);
  return { name, size: s.size, createdAt: s.mtime.toISOString() };
}

/** Once a day: skipped when today's backup already exists. */
export function dailyBackup(client: SqliteClient, dir: string) {
  const today = stamp().slice(0, 8);
  if (listBackupFiles(dir).some((b) => b.name.startsWith(`gesp-${today}`))) return null;
  return writeBackup(client, dir, "auto");
}
