// Settings › Updates (app-update.js): a real git copy of a made-up app, its own "GitHub" (a bare repository in a
// temporary folder), and a real database. Nothing goes out to the web.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase } from '../../db.js';
import { checkForUpdate, makeUpdater, updateStatus, whereAmI, readState, schemaOf } from '../../app-update.js';
import { startServer } from '../../server.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 'Mentor', GIT_AUTHOR_EMAIL: 'm@x', GIT_COMMITTER_NAME: 'Mentor', GIT_COMMITTER_EMAIL: 'm@x' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const wait = async (updater) => { for (let i = 0; i < 400 && updater.running(); i++) await new Promise((r) => setTimeout(r, 25)); return updater.progress; };

// The mentor's copy (where new versions are made), its "GitHub", and the student's copy, cloned from it.
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mentor = path.join(root, 'mentor');
  fs.mkdirSync(mentor);
  git(mentor, 'init', '-q', '-b', 'main');
  write(mentor, 'db.js', 'export const SCHEMA_VERSION = 70;\n');
  write(mentor, 'package.json', '{"name":"x"}\n');
  write(mentor, 'page.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  write(mentor, '.gitignore', 'data/\nMY-CHANGES.md\n');
  git(mentor, 'add', '-A'); git(mentor, 'commit', '-q', '-m', 'First version (#1)');
  const hub = path.join(root, 'hub.git');
  git(root, 'clone', '-q', '--bare', mentor, hub);
  git(mentor, 'remote', 'add', 'origin', hub);
  const app = path.join(root, 'student');
  git(root, 'clone', '-q', hub, app);
  const dataDir = path.join(app, 'data');
  const db = openDatabase(dataDir);
  t.after(() => { try { db.close(); } catch { /* closed by the test */ } });
  db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'x', 'x', 'Mine', 'kept')").run();
  const publish = (file, text, message) => { write(mentor, file, text); git(mentor, 'add', '-A'); git(mentor, 'commit', '-q', '-m', message); git(mentor, 'push', '-q', 'origin', 'main'); };
  return { root, mentor, app, dataDir, db, publish };
}

test('schemaOf reads the number from db.js', () => {
  assert.equal(schemaOf('export const SCHEMA_VERSION = 70;'), 70);
  assert.equal(schemaOf('nothing'), 0);
});

test('a copy without git, or on its own branch, says it cannot update itself', async (t) => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-zip-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.equal((await whereAmI({ appDir: plain })).why, 'no_git_copy');
  const w = world(t);
  git(w.app, 'checkout', '-q', '-b', 'mine');
  const where = await whereAmI({ appDir: w.app });
  assert.equal(where.can, false);
  assert.equal(where.why, 'other_branch');
});

test('looking: up to date, then what is new in plain words, and whether the database moves forward', async (t) => {
  const w = world(t);
  assert.deepEqual((await checkForUpdate({ appDir: w.app, dataDir: w.dataDir })).behind, 0);
  w.publish('page.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n', 'Calendar: a new week view (#30)');
  w.publish('db.js', 'export const SCHEMA_VERSION = 71;\n', 'Habits: a streak for each habit (#31)');
  const check = await checkForUpdate({ appDir: w.app, dataDir: w.dataDir });
  assert.equal(check.behind, 2);
  assert.deepEqual(check.news, ['Habits: a streak for each habit', 'Calendar: a new week view']);
  assert.equal(check.db_upgrade, true);
  assert.equal(readState(w.dataDir).check.behind, 2, 'kept for Settings and the daily look');
  const status = await updateStatus({ appDir: w.app, dataDir: w.dataDir, canRestart: true });
  assert.equal(status.can, true);
  assert.equal(status.check.behind, 2);
  assert.equal((await updateStatus({ appDir: w.app, dataDir: w.dataDir, canRestart: false })).can, false, 'no restart, no update');
});

test('updating: a checked copy of the notes, the student\'s own change kept, a mark, the new version, a restart; then going back', async (t) => {
  const w = world(t);
  write(w.app, 'page.txt', 'one\ntwo MINE\nthree\nfour\nfive\nsix\nseven\n'); // the student's own change
  write(w.app, 'my-module.js', '// mine\n');
  write(w.app, 'MY-CHANGES.md', 'my list\n');
  w.publish('page.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven NEW\n', 'Notes: pin a note (#32)');
  let restarted = [];
  const updater = makeUpdater({ appDir: w.app, dataDir: w.dataDir, db: w.db, onRestart: (swap) => restarted.push(swap) });
  assert.equal(updater.start(), true);
  assert.equal(updater.start(), false, 'one at a time');
  const progress = await wait(updater);
  assert.equal(progress.result.kind, 'updated', JSON.stringify(progress));
  assert.deepEqual(progress.steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'skipped', 'done']);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0], undefined, 'a plain restart');
  assert.equal(read(w.app, 'page.txt'), 'one\ntwo MINE\nthree\nfour\nfive\nsix\nseven NEW\n', 'both changes');
  assert.equal(read(w.app, 'my-module.js'), '// mine\n');
  assert.equal(read(w.app, 'MY-CHANGES.md'), 'my list\n');
  assert.match(git(w.app, 'log', '--format=%s'), /My own changes before the update of/);
  assert.equal(git(w.app, 'status', '--porcelain'), '');
  const last = readState(w.dataDir).last_update;
  assert.match(last.before_tag, /^before-update-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(last.news, ['Notes: pin a note']);
  assert.ok(fs.existsSync(path.join(w.dataDir, 'backups', last.backup)), 'the copy of the notes is there');
  assert.equal(JSON.parse(read(path.join(w.dataDir, 'backups'), last.backup.replace(/\.db$/, '.check.json'))).ok, true, 'and checked');

  const status = await updateStatus({ appDir: w.app, dataDir: w.dataDir, canRestart: true });
  assert.deepEqual(status.undo, { can: true, db: false, since: last.at });
  restarted = [];
  assert.equal(updater.startUndo(), true);
  const back = await wait(updater);
  assert.equal(back.result.kind, 'undone', JSON.stringify(back));
  assert.equal(back.result.restored_db, false, 'the database did not move, so it stays as it is');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0], null);
  assert.equal(read(w.app, 'page.txt'), 'one\ntwo MINE\nthree\nfour\nfive\nsix\nseven\n', 'the version before, with the student\'s change');
  assert.equal(readState(w.dataDir).last_update, undefined);
});

test('nothing new: it says so and changes nothing', async (t) => {
  const w = world(t);
  const head = git(w.app, 'rev-parse', 'HEAD');
  let restarted = 0;
  const updater = makeUpdater({ appDir: w.app, dataDir: w.dataDir, db: w.db, onRestart: () => restarted++ });
  updater.start();
  const progress = await wait(updater);
  assert.equal(progress.result.kind, 'up_to_date');
  assert.equal(git(w.app, 'rev-parse', 'HEAD'), head);
  assert.equal(git(w.app, 'tag'), '', 'no mark left behind');
  assert.equal(restarted, 0);
});

test('a clash with the student\'s own change: it stops and puts everything back as it was', async (t) => {
  const w = world(t);
  write(w.app, 'page.txt', 'one\ntwo\nthree MINE\nfour\nfive\nsix\nseven\n');
  w.publish('page.txt', 'one\ntwo\nthree THEIRS\nfour\nfive\nsix\nseven\n', 'Page: a better line three (#33)');
  let restarted = 0;
  const updater = makeUpdater({ appDir: w.app, dataDir: w.dataDir, db: w.db, onRestart: () => restarted++ });
  updater.start();
  const progress = await wait(updater);
  assert.equal(progress.result.kind, 'clash');
  assert.deepEqual(progress.result.files, ['page.txt']);
  assert.equal(progress.steps.find((s) => s.id === 'bring').state, 'failed');
  assert.equal(read(w.app, 'page.txt'), 'one\ntwo\nthree MINE\nfour\nfive\nsix\nseven\n', 'their change is as it was');
  assert.equal(git(w.app, 'status', '--porcelain'), '', 'no half-done merge');
  assert.equal(git(w.app, 'tag'), '');
  assert.equal(restarted, 0);
});

test('when what the app needs changed, it installs it; going back after a database move brings the copy back', async (t) => {
  const w = world(t);
  const marker = path.join(w.root, 'npm-ran');
  const fakeNpm = path.join(w.root, 'fake-npm.js');
  fs.writeFileSync(fakeNpm, `require('fs').appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');`);
  const npm = { command: process.execPath, shell: false, before: [fakeNpm] };
  w.publish('package.json', '{"name":"x","dependencies":{"y":"1"}}\n', 'Needs a new piece (#34)');
  w.publish('db.js', 'export const SCHEMA_VERSION = 71;\n', 'Database: a new table (#35)');
  let restarted = [];
  const updater = makeUpdater({ appDir: w.app, dataDir: w.dataDir, db: w.db, npm, onRestart: (swap) => restarted.push(swap) });
  updater.start();
  const progress = await wait(updater);
  assert.equal(progress.result.kind, 'updated', JSON.stringify(progress));
  assert.equal(progress.steps.find((s) => s.id === 'install').state, 'done');
  assert.match(read(w.root, 'npm-ran'), /^install --omit=dev/);
  await new Promise((r) => setTimeout(r, 400));

  // After the update the student writes something new; going back keeps that in a copy and brings back the one from before.
  w.db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n2', 'x', 'x', 'After', 'new')").run();
  assert.equal((await updateStatus({ appDir: w.app, dataDir: w.dataDir, canRestart: true })).undo.db, true, 'the page warns first');
  restarted = [];
  updater.startUndo();
  const back = await wait(updater);
  assert.equal(back.result.kind, 'undone', JSON.stringify(back));
  assert.equal(back.result.restored_db, true);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(typeof restarted[0], 'function');
  w.db.close();
  restarted[0]();
  const db = openDatabase(w.dataDir);
  t.after(() => db.close());
  assert.deepEqual(db.prepare('SELECT id FROM notes ORDER BY id').all().map((r) => r.id), ['n1'], 'the database from before the update');
  const kept = readState(w.dataDir).last_undo.kept;
  const { DatabaseSync } = await import('node:sqlite');
  const copy = new DatabaseSync(path.join(w.dataDir, 'backups', kept), { readOnly: true });
  assert.deepEqual(copy.prepare('SELECT id FROM notes ORDER BY id').all().map((r) => r.id), ['n1', 'n2'], 'what was written since is kept');
  copy.close();
  assert.equal(read(w.app, 'db.js'), 'export const SCHEMA_VERSION = 70;\n');
});

test('the routes: GET /api/update, a look, an update that restarts, and the jobs list', async (t) => {
  const w = world(t);
  w.db.close();
  w.publish('page.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n', 'Planner: a quieter day (#36)');
  let restarted = 0;
  const quiet = { port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0 };
  const app = await startServer({ ...quiet, dataDir: w.dataDir, updateAppDir: w.app, updateCheckEvery: 24 * 60 * 60 * 1000, onRestart: () => { restarted++; } });
  t.after(() => app.close());
  const post = (p) => fetch(`${app.url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const first = await (await fetch(`${app.url}/api/update`)).json();
  assert.equal(first.can, true);
  assert.equal(first.check, null);
  const looked = await (await post('/api/update/check')).json();
  assert.deepEqual(looked.check.news, ['Planner: a quieter day']);
  const jobs = await (await fetch(`${app.url}/api/jobs`)).json();
  assert.equal(jobs.find((j) => j.id === 'update-check').every_minutes, 1440);
  const started = await post('/api/update');
  assert.equal(started.status, 202);
  let status;
  for (let i = 0; i < 400; i++) { status = await (await fetch(`${app.url}/api/update`)).json(); if (!status.progress.running) break; await new Promise((r) => setTimeout(r, 25)); }
  assert.equal(status.progress.result.kind, 'updated');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(restarted, 1);
  assert.equal((await fetch(`${app.url}/api/update`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
});
