// Updating from inside the app (Settings › Updates): look for a newer version, bring it in with one press, and go back to
// the version before. The same steps as INSTALL.md "updating it", done by the app itself:
//   1. a whole copy of the database (data/backups/before-update-<time>.db, checked like the daily copy),
//   2. the owner's own changes to the app's files saved as a step of their own (CUSTOMISING.md),
//   3. a mark (git tag before-update-<day>) to come back to,
//   4. the new version, merged with git (a clash: everything is put back as it was, and Claude Code takes over),
//   5. what the new version needs (npm install), only when that changed,
//   6. a restart, after which the new version moves the database forward itself (db.js keeps its own copy too).
// Going back: the files return to the mark; when the update moved the database forward, the copy from step 1 comes back
// too and the database as it is now is kept beside it (data/backups/before-undo-<time>.db).
// What it knows is kept in data/update.json: the last look (checked_at, behind, news) and the last update.
// Nothing here ever touches data/ except data/backups/ and data/update.json.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { checkBackup, rowCounts, backupsDir } from './backup.js';

export const REMOTE = 'origin';
export const BRANCH = 'main';
export const UPDATE_LINE = 'Update Sovran Advisor by following https://github.com/Daniel-Piatek/sovran-advisor-app/blob/main/INSTALL.md';
export const UNDO_LINE = 'Undo the last Sovran Advisor update';
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000; // the daily look (the owner's choice, 2026-11-14): it only looks, never installs
const KEEP_COPIES = 3; // before-update and before-undo copies kept, newest first

export const STEPS = [
  ['backup', 'A whole copy of your notes and settings'],
  ['own', 'Your own changes to the app, kept'],
  ['mark', 'A mark to come back to'],
  ['bring', 'The new version'],
  ['install', 'What the new version needs'],
  ['restart', 'Starting it again'],
];

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

const stateFile = (dataDir) => path.join(dataDir, 'update.json');
export function readState(dataDir) {
  try { return JSON.parse(fs.readFileSync(stateFile(dataDir), 'utf8')); } catch { return {}; }
}
function writeState(dataDir, change) {
  const next = { ...readState(dataDir), ...change };
  for (const [key, value] of Object.entries(next)) if (value === null) delete next[key];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile(dataDir), JSON.stringify(next, null, 2));
  return next;
}

// Runs a program and answers { code, stdout, stderr }; never throws for a non-zero exit.
export function run(command, args, { cwd, env = process.env, timeout = 120_000, shell = false } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, env, timeout, shell, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && typeof err.code !== 'number' ? err.message : '') });
    });
  });
}

// git: on the PATH, else where a Mac keeps it (the Dock starts the app without a Terminal's PATH).
const GIT_PLACES = ['git', '/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git', 'C:\\Program Files\\Git\\cmd\\git.exe'];
let foundGit = null;
export async function findGit() {
  if (foundGit) return foundGit;
  for (const place of GIT_PLACES) {
    if ((await run(place, ['--version'], { timeout: 15_000 })).code === 0) return (foundGit = place);
  }
  return null;
}

// npm: next to the Node.js that runs the app (where its installer puts it), else on the PATH. On Windows npm is a .cmd,
// which Node starts only through the shell; the words given to it are fixed here, never typed by anyone.
export function npmCommand() {
  const win = process.platform === 'win32';
  const beside = path.join(path.dirname(process.execPath), win ? 'npm.cmd' : 'npm');
  const command = fs.existsSync(beside) ? beside : (win ? 'npm.cmd' : 'npm');
  return { command: win ? `"${command}"` : command, shell: win }; // through the shell, a folder with a space needs quotes
}

// The schema number a version of db.js says (export const SCHEMA_VERSION = N).
export const schemaOf = (text) => Number(String(text).match(/export const SCHEMA_VERSION = (\d+)/)?.[1] ?? 0);

// Makes a git runner for the app's folder. A name for its own commits only when the folder has none.
async function gitIn(appDir, gitPath) {
  const git = gitPath ?? await findGit();
  if (!git) throw fail('no_git', 'git is not on this computer, so the app cannot update itself.');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C' };
  const g = (args, opts = {}) => run(git, args, { cwd: appDir, env, ...opts });
  const named = (await g(['config', 'user.name'])).stdout.trim();
  g.commit = (args) => g([...(named ? [] : ['-c', 'user.name=Sovran Advisor', '-c', 'user.email=sovran@localhost']), ...args]);
  return g;
}

// Can this copy update itself? It must be a git copy of its own (installed with git clone), on main, with a remote.
export async function whereAmI({ appDir, gitPath }) {
  let g;
  try { g = await gitIn(appDir, gitPath); } catch (err) { return { can: false, why: err.kind, message: err.message }; }
  const top = await g(['rev-parse', '--show-toplevel']);
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b); // C: or c:
  if (top.code !== 0 || !same(fs.realpathSync(top.stdout.trim()), fs.realpathSync(appDir))) {
    return { can: false, why: 'no_git_copy', message: 'This copy was installed without git (from a zip), so it cannot update itself.' };
  }
  const branch = (await g(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (branch !== BRANCH) return { can: false, why: 'other_branch', message: `This copy is on its own branch (${branch}), so it does not update itself.` };
  const remote = await g(['remote', 'get-url', REMOTE]);
  if (remote.code !== 0) return { can: false, why: 'no_remote', message: 'This copy does not know where new versions come from.' };
  return { can: true, g };
}

// Looks for a newer version: { checked_at, behind, news: [what is new, newest first], db_upgrade }.
export async function checkForUpdate({ appDir, dataDir, gitPath }) {
  const where = await whereAmI({ appDir, gitPath });
  if (!where.can) throw fail(where.why, where.message);
  const { g } = where;
  const fetched = await g(['fetch', '--quiet', REMOTE, BRANCH], { timeout: 90_000 });
  if (fetched.code !== 0) throw fail('offline', 'The newest version could not be reached. Is this computer online?', { detail: fetched.stderr.trim() });
  const upstream = `${REMOTE}/${BRANCH}`;
  const behind = Number((await g(['rev-list', '--count', `HEAD..${upstream}`])).stdout.trim() || 0);
  const news = behind ? (await g(['log', '--no-merges', '--format=%s', '-n', '30', `HEAD..${upstream}`])).stdout.split('\n')
    .map((line) => line.replace(/\s*\(#\d+\)\s*$/, '').trim()).filter(Boolean) : [];
  const schemaNow = schemaOf((await g(['show', 'HEAD:db.js'])).stdout);
  const schemaNew = behind ? schemaOf((await g(['show', `${upstream}:db.js`])).stdout) : schemaNow;
  const check = { checked_at: new Date().toISOString(), behind, news, db_upgrade: schemaNew > schemaNow };
  writeState(dataDir, { check });
  return check;
}

// What Settings › Updates shows.
export async function updateStatus({ appDir, dataDir, gitPath, canRestart }) {
  const where = await whereAmI({ appDir, gitPath });
  const state = readState(dataDir);
  let last = state.last_update ?? null;
  let undo = null;
  if (where.can && last) {
    const head = (await where.g(['rev-parse', 'HEAD'])).stdout.trim();
    undo = head === last.after_commit ? { can: true, db: last.schema_after !== last.schema_before, since: last.at } : { can: false };
    last = { at: last.at, news: last.news ?? [] };
  }
  return {
    can: where.can && Boolean(canRestart),
    ...(!where.can ? { why: where.why, message: where.message } : !canRestart ? { why: 'no_restart', message: 'This copy was not started from its icon, so it cannot restart itself after an update.' } : {}),
    update_line: UPDATE_LINE, undo_line: UNDO_LINE,
    check: state.check ?? null, last, undo,
  };
}

function keepNewest(dataDir, prefix) {
  const dir = backupsDir(dataDir);
  const copies = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.db')).sort().reverse();
  for (const old of copies.slice(KEEP_COPIES)) {
    fs.rmSync(path.join(dir, old), { force: true });
    fs.rmSync(path.join(dir, old.replace(/\.db$/, '.check.json')), { force: true });
  }
}

// A whole copy of the database, checked against the app's own counts. Answers its file.
export function copyDatabase(db, dataDir, prefix) {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${prefix}${stamp()}.db`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const check = checkBackup(file, rowCounts(db));
  if (!check.ok) throw fail('backup', `The copy of your notes did not check out (${check.problem}). Nothing was changed.`);
  keepNewest(dataDir, prefix);
  return file;
}

// Did what the app needs (its packages) change between two versions?
async function needsInstall(g, from, to) {
  return (await g(['diff', '--quiet', from, to, '--', 'package.json', 'package-lock.json', 'scripts/vendor.js'])).code !== 0;
}

async function npmInstall(appDir, npm) {
  const { command, shell, before = [] } = npm ?? npmCommand(); // before: tests run a stand-in script
  const env = { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter) };
  const done = await run(command, [...before, 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: appDir, env, shell, timeout: 15 * 60_000 });
  if (done.code !== 0) throw fail('install', 'What the new version needs could not be installed.', { detail: (done.stderr || done.stdout).trim().split('\n').slice(-5).join('\n') });
}

// One update at a time. progress: { steps: [{ id, label, state: waiting|doing|done|skipped|failed }], result }.
export function makeUpdater({ appDir, dataDir, db, gitPath, npm, onRestart }) {
  let progress = null;
  const set = (id, state) => { const step = progress.steps.find((s) => s.id === id); if (step) step.state = state; };
  const begin = (steps) => { progress = { running: true, steps: steps.map(([id, label]) => ({ id, label, state: 'waiting' })), result: null }; };
  const finish = (result) => { progress.running = false; progress.result = result; };

  async function update() {
    let g;
    let tag = null;
    let before = null;
    let current = null;
    const doing = (id) => { current = id; set(id, 'doing'); };
    try {
      doing('backup');
      const where = await whereAmI({ appDir, gitPath });
      if (!where.can) throw fail(where.why, where.message);
      g = where.g;
      const backup = copyDatabase(db, dataDir, 'before-update-');
      set('backup', 'done');

      doing('own');
      const changed = (await g(['status', '--porcelain'])).stdout.trim();
      if (changed) {
        await g(['add', '-A', '--', '.', ':!MY-CHANGES.md']);
        const saved = await g.commit(['commit', '-q', '-m', `My own changes before the update of ${day()}`]);
        if (saved.code !== 0 && (await g(['status', '--porcelain'])).stdout.trim()) throw fail('own', 'Your own changes to the app could not be saved first. Nothing was changed.', { detail: saved.stderr.trim() });
        set('own', 'done');
      } else set('own', 'skipped');

      doing('mark');
      before = (await g(['rev-parse', 'HEAD'])).stdout.trim();
      const schemaBefore = schemaOf((await g(['show', 'HEAD:db.js'])).stdout);
      const tags = new Set((await g(['tag', '--list', `before-update-${day()}*`])).stdout.split('\n').map((t) => t.trim()));
      tag = `before-update-${day()}`;
      for (let n = 2; tags.has(tag); n++) tag = `before-update-${day()}-${n}`;
      if ((await g(['tag', tag])).code !== 0) { tag = null; throw fail('mark', 'A mark to come back to could not be made. Nothing was changed.'); }
      set('mark', 'done');

      doing('bring');
      const fetched = await g(['fetch', '--quiet', REMOTE, BRANCH], { timeout: 90_000 });
      if (fetched.code !== 0) throw fail('offline', 'The newest version could not be reached. Is this computer online? Nothing was changed.');
      const upstream = `${REMOTE}/${BRANCH}`;
      const news = (await g(['log', '--no-merges', '--format=%s', '-n', '30', `HEAD..${upstream}`])).stdout.split('\n')
        .map((line) => line.replace(/\s*\(#\d+\)\s*$/, '').trim()).filter(Boolean);
      if (!news.length && Number((await g(['rev-list', '--count', `HEAD..${upstream}`])).stdout.trim() || 0) === 0) {
        await g(['tag', '-d', tag]); tag = null;
        for (const s of progress.steps) if (s.state === 'waiting') s.state = 'skipped';
        set('bring', 'done');
        writeState(dataDir, { check: { checked_at: new Date().toISOString(), behind: 0, news: [], db_upgrade: false } });
        return finish({ ok: true, kind: 'up_to_date', message: 'You already have the newest version.' });
      }
      const merged = await g.commit(['merge', '--no-edit', upstream]);
      if (merged.code !== 0) {
        const files = (await g(['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').map((f) => f.trim()).filter(Boolean);
        await g(['merge', '--abort']);
        throw fail('clash', 'The new version changes the same lines as a change you made to the app yourself, so it stopped and put everything back as it was.', { files });
      }
      const after = (await g(['rev-parse', 'HEAD'])).stdout.trim();
      set('bring', 'done');

      doing('install');
      if (await needsInstall(g, before, after)) {
        try { await npmInstall(appDir, npm); } catch (err) {
          await g(['reset', '--hard', '-q', before]);
          try { await npmInstall(appDir, npm); } catch { /* the version before keeps what it had */ }
          throw err;
        }
        set('install', 'done');
      } else set('install', 'skipped');

      doing('restart');
      const schemaAfter = schemaOf((await g(['show', 'HEAD:db.js'])).stdout);
      writeState(dataDir, {
        check: { checked_at: new Date().toISOString(), behind: 0, news: [], db_upgrade: false },
        last_update: { at: new Date().toISOString(), before_tag: tag, before_commit: before, after_commit: after, backup: path.basename(backup), schema_before: schemaBefore, schema_after: schemaAfter, news },
      });
      set('restart', 'done');
      finish({ ok: true, kind: 'updated', restarting: true, message: 'Updated. The app is starting again.' });
      setTimeout(() => onRestart(), 300);
    } catch (err) {
      if (current) set(current, 'failed');
      if (tag && g) await g(['tag', '-d', tag]); // nothing changed (or it was all put back): no mark needed
      finish({ ok: false, kind: err.kind ?? 'problem', message: err.kind ? err.message : `Something went wrong: ${err.message}`, ...(err.files ? { files: err.files } : {}), ...(err.detail ? { detail: err.detail } : {}) });
    }
  }

  async function undo() {
    let current = null;
    const doing = (id) => { current = id; set(id, 'doing'); };
    try {
      doing('check');
      const where = await whereAmI({ appDir, gitPath });
      if (!where.can) throw fail(where.why, where.message);
      const { g } = where;
      const last = readState(dataDir).last_update;
      if (!last) throw fail('nothing', 'There is no update to go back from.');
      const head = (await g(['rev-parse', 'HEAD'])).stdout.trim();
      if (head !== last.after_commit || (await g(['status', '--porcelain', '--untracked-files=no'])).stdout.trim()) {
        throw fail('changed', 'The app was changed after the update, so it cannot go back by itself.');
      }
      const restoreDb = last.schema_after !== last.schema_before;
      const backup = path.join(backupsDir(dataDir), last.backup ?? '');
      if (restoreDb && !fs.existsSync(backup)) throw fail('no_copy', 'The copy of your notes from before the update is not there any more.');
      set('check', 'done');

      doing('keep');
      const kept = copyDatabase(db, dataDir, 'before-undo-');
      set('keep', 'done');

      doing('files');
      if ((await g(['reset', '--hard', '-q', last.before_commit])).code !== 0) throw fail('files', 'The app’s files could not be put back.');
      if (await needsInstall(g, last.after_commit, last.before_commit)) await npmInstall(appDir, npm);
      set('files', 'done');

      doing('restart');
      writeState(dataDir, { last_update: null, check: null, last_undo: { at: new Date().toISOString(), kept: path.basename(kept), restored_db: restoreDb } });
      set('restart', 'done');
      finish({ ok: true, kind: 'undone', restarting: true, restored_db: restoreDb, message: 'Going back to the version before. The app is starting again.' });
      // The database is swapped only once this app has let go of it, just before the version before starts.
      const swap = restoreDb ? () => {
        const file = path.join(dataDir, 'app.db');
        for (const extra of ['-wal', '-shm']) fs.rmSync(`${file}${extra}`, { force: true });
        fs.copyFileSync(backup, file);
      } : null;
      setTimeout(() => onRestart(swap), 300);
    } catch (err) {
      if (current) set(current, 'failed');
      finish({ ok: false, kind: err.kind ?? 'problem', message: err.kind ? err.message : `Something went wrong: ${err.message}`, ...(err.detail ? { detail: err.detail } : {}) });
    }
  }

  return {
    get progress() { return progress; },
    running: () => Boolean(progress?.running),
    start() {
      if (progress?.running) return false;
      begin(STEPS);
      update();
      return true;
    },
    startUndo() {
      if (progress?.running) return false;
      begin([['check', 'Checking it can go back'], ['keep', 'A whole copy of your notes as they are now'], ['files', 'The version before'], ['restart', 'Starting it again']]);
      undo();
      return true;
    },
  };
}
