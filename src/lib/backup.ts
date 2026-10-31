import "server-only";
import { existsSync, renameSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, dbPath, getClient } from "@/db";
import { BACKUP_NAME_RE, backupDirFor, listBackupFiles, writeBackup, type BackupFile } from "@/db/backups";
import { SqliteClient } from "@/db/sqlite";
import { HttpError } from "@/lib/auth";

/**
 * Backups of the single SQLite file. Accounts, answers, coins and chats exist
 * nowhere else, so the app keeps its own copies:
 *
 * - automatically, once a day on the first start (`GESP_AUTO_BACKUP=1`, set by the
 *   desktop shell — see db/backups), keeping the newest 30;
 * - on demand from /admin, which can also download a copy or restore one.
 */

export type { BackupFile };

export const backupDir = () => backupDirFor(dbPath());

export const listBackups = (): BackupFile[] => listBackupFiles(backupDir());

/** Writes a copy of the live database into the backup folder. */
export const createBackup = (tag?: "restore") => writeBackup(getClient(), backupDir(), tag);

export function backupPath(name: string) {
  if (!BACKUP_NAME_RE.test(name)) throw new HttpError(400, "备份文件名不正确");
  const file = path.join(backupDir(), name);
  if (!existsSync(file)) throw new HttpError(404, "备份不存在");
  return file;
}

/** Refuses anything that isn't a GESP database before it replaces the live one. */
function validate(file: string) {
  let client: SqliteClient | null = null;
  try {
    client = new SqliteClient(file);
    const tables = new Set(
      (client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    for (const t of ["users", "papers", "questions", "__drizzle_migrations"])
      if (!tables.has(t)) throw new HttpError(400, "这不是 GESP 备考助手的备份文件");
    const check = client.prepare("pragma quick_check").all() as { quick_check: string }[];
    if (check[0]?.quick_check !== "ok") throw new HttpError(400, "备份文件已损坏");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "无法读取备份文件：它不是有效的数据库");
  } finally {
    client?.close();
  }
}

/**
 * Replaces the live database with `data` (an uploaded file or a listed backup).
 * The current state is backed up first, so a restore can itself be undone.
 * Migrations run when the connection reopens, so an older backup is upgraded.
 */
export async function restoreBackup(data: Uint8Array) {
  const header = Buffer.from(data.subarray(0, 16)).toString("latin1");
  if (header !== "SQLite format 3\0") throw new HttpError(400, "这不是 GESP 备考助手的备份文件");

  const live = dbPath();
  const incoming = `${live}.incoming`;
  await writeFile(incoming, data);
  try {
    validate(incoming);
  } catch (err) {
    rmSync(incoming, { force: true });
    throw err;
  }

  createBackup("restore");
  closeDb();
  for (const suffix of ["-wal", "-shm"]) rmSync(live + suffix, { force: true });
  renameSync(incoming, live);
}

export async function restoreFromList(name: string) {
  await restoreBackup(new Uint8Array(await readFile(backupPath(name))));
}
