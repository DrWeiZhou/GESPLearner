/**
 * Backs up the SQLite database into the backup folder next to it (`VACUUM INTO`,
 * a consistent copy even while the app runs). Same as /admin →「数据备份」.
 *
 *   bun --conditions react-server scripts/backup.ts
 *
 * The database is `GESP_DB_PATH`, or data/gesp.db in development. Restore by
 * copying a backup over the database file while the app is closed, or from /admin.
 */
import { createBackup, backupDir } from "../src/lib/backup";

const b = createBackup();
console.log(`✓ ${backupDir()}/${b.name}（${Math.ceil(b.size / 1024)} KB），保留最近 30 份`);
process.exit(0);
