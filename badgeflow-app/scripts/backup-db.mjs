#!/usr/bin/env node
// Nightly SQLite backup for the BadgeFlow server (run from cron, see README).
// VACUUM INTO writes a consistent snapshot even while the app is writing, the
// copy is integrity-checked and gzipped, and snapshots older than KEEP_DAYS
// are removed. Usage: node scripts/backup-db.mjs [backupDir]
import { DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP_DAYS = 14;
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(appDir, "prisma", "dev.sqlite");
const backupDir = process.argv[2] || join(process.env.HOME || appDir, "backups", "badgeflow");
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const snapshot = join(backupDir, `badgeflow-${stamp}.sqlite`);

const db = new DatabaseSync(source, { readOnly: true });
db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
db.close();

const copy = new DatabaseSync(snapshot, { readOnly: true });
const check = copy.prepare("PRAGMA integrity_check").get();
const counts = ["Session", "ShopSettings", "Campaign"]
  .map((t) => `${t}=${copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n}`)
  .join(" ");
copy.close();
if (Object.values(check)[0] !== "ok") throw new Error(`Backup failed integrity check: ${JSON.stringify(check)}`);

await pipeline(createReadStream(snapshot), createGzip(), createWriteStream(`${snapshot}.gz`));
unlinkSync(snapshot);

const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
for (const name of readdirSync(backupDir)) {
  const path = join(backupDir, name);
  if (name.startsWith("badgeflow-") && name.endsWith(".sqlite.gz") && statSync(path).mtimeMs < cutoff) unlinkSync(path);
}

console.log(`${new Date().toISOString()} backup ok ${snapshot}.gz ${counts}`);
