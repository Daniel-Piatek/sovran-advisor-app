// The daily backup (Sovran Advisor): a whole copy of the database in data/backups, made when
// the app starts (if today has none yet) and then once a day while it runs. The newest 14 are
// kept; older ones are removed. A copy is made with VACUUM INTO, so it is complete and
// consistent even while the app is in use. To go back to one: stop the app, put the copy in
// place of data/app.db, start the app. Each new copy is checked as soon as it is made (checkBackup).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const KEEP = 14;
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NAME = /^app-(\d{4}-\d{2}-\d{2})\.db$/;

export const backupsDir = (dataDir) => path.join(dataDir, 'backups');

const checkFileOf = (file) => file.replace(/\.db$/, '.check.json');
const readCheck = (file) => { try { return JSON.parse(fs.readFileSync(checkFileOf(file), 'utf8')); } catch { return null; } };

export function listBackups(dataDir) {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse()
    .map((f) => ({ day: f.match(NAME)[1], file: path.join(dir, f), bytes: fs.statSync(path.join(dir, f)).size, check: readCheck(path.join(dir, f)) }));
}

// Rows in every table (SQLite's own tables left out): what a check compares.
export function rowCounts(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n]));
}

// A backup you can verify (myICOR advanced/everywhere/3): the copy is opened on its own, SQLite checks every page of
// it, and every table is read and counted. Given the counts the app had when the copy was made, each table must match.
// The result is kept beside the copy (app-<day>.check.json): { ok, checked_at, rows, tables, problem? }.
export function checkBackup(file, expected = null) {
  let result;
  try {
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      const pages = copy.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
      const counts = rowCounts(copy);
      const rows = Object.values(counts).reduce((a, b) => a + b, 0);
      const tables = Object.keys(counts).length;
      let problem = null;
      if (pages.length !== 1 || pages[0] !== 'ok') problem = 'SQLite found damage in the copy.';
      else if (!tables) problem = 'The copy is empty.';
      else if (expected) {
        const differ = Object.keys(expected).filter((t) => counts[t] !== expected[t]);
        if (differ.length) problem = `The copy does not match the app in ${differ.length === 1 ? `the table ${differ[0]}` : `${differ.length} tables`}.`;
      }
      result = { ok: !problem, checked_at: new Date().toISOString(), rows, tables, compared: Boolean(expected), ...(problem ? { problem } : {}) };
    } finally { copy.close(); }
  } catch (err) {
    result = { ok: false, checked_at: new Date().toISOString(), rows: 0, tables: 0, compared: false, problem: `The copy could not be opened (${err.message}).` };
  }
  fs.writeFileSync(checkFileOf(file), JSON.stringify(result));
  return result;
}

// Checks every kept copy again (Settings › Phone, backups and moving › Check them now).
export function checkAllBackups(dataDir) {
  return listBackups(dataDir).map((b) => ({ ...b, check: checkBackup(b.file) }));
}

// Makes today's copy unless there is one; then keeps the newest KEEP. Answers today's copy.
export function backUp(db, dataDir, { day = localDay(), keep = KEEP } = {}) {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `app-${day}.db`);
  if (!fs.existsSync(file)) {
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    // Counted in the same step as the copy (nothing else runs in between), then the copy is checked against it.
    checkBackup(file, rowCounts(db));
  }
  for (const old of listBackups(dataDir).slice(keep)) { fs.rmSync(old.file, { force: true }); fs.rmSync(checkFileOf(old.file), { force: true }); }
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
