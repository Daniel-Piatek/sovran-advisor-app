// The daily backup (Sovran Advisor): a whole copy of the database in data/backups, made when
// the app starts (if today has none yet) and then once a day while it runs. The newest 14 are
// kept; older ones are removed. A copy is made with VACUUM INTO, so it is complete and
// consistent even while the app is in use. To go back to one: stop the app, put the copy in
// place of data/app.db, start the app.

import fs from 'node:fs';
import path from 'node:path';

const KEEP = 14;
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NAME = /^app-(\d{4}-\d{2}-\d{2})\.db$/;

export const backupsDir = (dataDir) => path.join(dataDir, 'backups');

export function listBackups(dataDir) {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse()
    .map((f) => ({ day: f.match(NAME)[1], file: path.join(dir, f), bytes: fs.statSync(path.join(dir, f)).size }));
}

// Makes today's copy unless there is one; then keeps the newest KEEP. Answers today's copy.
export function backUp(db, dataDir, { day = localDay(), keep = KEEP } = {}) {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `app-${day}.db`);
  if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of listBackups(dataDir).slice(keep)) fs.rmSync(old.file, { force: true });
  return file;
}

// The job: once now, then every `every` ms (0: never). stop() ends it.
export function startBackups(db, dataDir, { every = 60 * 60 * 1000 } = {}) {
  if (!every) return { stop: () => {} };
  const run = () => { try { backUp(db, dataDir); } catch (err) { console.error(`The daily backup could not be made: ${err.message}`); } };
  run();
  const timer = setInterval(run, every); // hourly: a new day's copy is made within the hour
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
