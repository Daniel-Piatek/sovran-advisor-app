import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../db.js';
import { backUp, listBackups, checkBackup, checkAllBackups } from '../../backup.js';
import { writeMoveFile, receiveMoveFile, moveStatus, confirmMove, cancelMove, applyPendingMove } from '../../move.js';
import { setModule } from '../../modules.js';
import { startServer } from '../../server.js';

const temp = (t, name) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), name)); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const note = (db, id, title) => db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES (?, 'a', 'a', ?, '')").run(id, title);
const quiet = { port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0 };

test('a new backup is checked at once: whole, and the same as the app', (t) => {
  const dataDir = temp(t, 'check-');
  const db = openDatabase(dataDir);
  note(db, 'n1', 'One');
  backUp(db, dataDir, { day: '2026-11-01' });
  const [b] = listBackups(dataDir);
  assert.equal(b.check.ok, true);
  assert.equal(b.check.compared, true);
  assert.ok(b.check.rows > 0 && b.check.tables > 10);
  db.close();
});

test('a damaged copy is found, and a copy that differs from the app is named', (t) => {
  const dataDir = temp(t, 'check-bad-');
  const db = openDatabase(dataDir);
  note(db, 'n1', 'One');
  const file = backUp(db, dataDir, { day: '2026-11-01' });
  assert.match(checkBackup(file, { notes: 2 }).problem, /the table notes/);
  fs.writeFileSync(file, Buffer.alloc(8192, 7)); // not a database any more
  const [again] = checkAllBackups(dataDir);
  assert.equal(again.check.ok, false);
  assert.match(again.check.problem, /could not be opened|damage/);
  db.close();
});

test('a moving file takes everything to a new computer, only after a yes, and keeps what was there', async (t) => {
  const oldDir = temp(t, 'move-old-');
  const old = openDatabase(oldDir);
  note(old, 'n1', 'From the old computer');
  fs.mkdirSync(path.join(oldDir, 'files'), { recursive: true });
  const sha = 'a'.repeat(64);
  fs.writeFileSync(path.join(oldDir, 'files', sha), 'a picture');
  const moving = path.join(oldDir, 'move.tar.gz');
  const about = await writeMoveFile(old, oldDir, fs.createWriteStream(moving));
  assert.equal(about.counts.notes, 1);
  old.close();

  const newDir = temp(t, 'move-new-');
  const fresh = openDatabase(newDir);
  note(fresh, 'n2', 'Made on the new one');
  fresh.close();
  const summary = await receiveMoveFile(newDir, fs.createReadStream(moving));
  assert.equal(summary.counts.notes, 1);
  assert.equal(summary.files, 1);
  assert.equal(applyPendingMove(newDir), null); // no yes yet: nothing happens
  assert.equal(moveStatus(newDir).waiting, true);
  confirmMove(newDir);
  const last = applyPendingMove(newDir);
  assert.match(last.kept_at, /^before-move-/);
  const now = new DatabaseSync(path.join(newDir, 'app.db'));
  assert.deepEqual(now.prepare('SELECT title FROM notes').all().map((r) => r.title), ['From the old computer']);
  now.close();
  assert.equal(fs.readFileSync(path.join(newDir, 'files', sha), 'utf8'), 'a picture');
  const kept = new DatabaseSync(path.join(newDir, last.kept_at, 'app.db'));
  assert.deepEqual(kept.prepare('SELECT title FROM notes').all().map((r) => r.title), ['Made on the new one']);
  kept.close();
  assert.equal(moveStatus(newDir).waiting, false);
  assert.equal(moveStatus(newDir).last.kept_at, last.kept_at);
});

test('a file that is not a moving file, or reaches outside its folder, changes nothing', async (t) => {
  const dataDir = temp(t, 'move-bad-');
  await assert.rejects(receiveMoveFile(dataDir, Readable.from([Buffer.from('hello')])), /not a moving file/);
  // A tar with ../evil inside.
  const h = Buffer.alloc(512);
  h.write('../evil', 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write('00000000004\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const tar = Buffer.concat([h, Buffer.from('evil'), Buffer.alloc(508), Buffer.alloc(1024)]);
  await assert.rejects(receiveMoveFile(dataDir, Readable.from([zlib.gzipSync(tar)])), /should not/);
  assert.equal(fs.existsSync(path.join(dataDir, '..', 'evil')), false);
  assert.equal(moveStatus(dataDir).waiting, false);
  assert.equal(cancelMove(dataDir).waiting, false);
});

test('the module is off in a new install: its addresses say so, and /quick points to Settings', async (t) => {
  const dataDir = temp(t, 'everywhere-app-');
  let app = await startServer({ ...quiet, dataDir });
  t.after(() => app.close());
  assert.equal((await fetch(`${app.url}/api/backups`)).status, 409);
  assert.match(await (await fetch(`${app.url}/quick`)).text(), /switched off/);
  const db = openDatabase(dataDir);
  setModule(db, 'everywhere', true);
  db.close();
  assert.match(await (await fetch(`${app.url}/quick`)).text(), /Keep in Inbox/);
  const backups = await (await fetch(`${app.url}/api/backups`)).json();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].check.ok, true);
  assert.deepEqual(await (await fetch(`${app.url}/api/phone`)).json(), { addresses: [] });
  // Another website can't send a moving file (its type needs asking first).
  assert.equal((await fetch(`${app.url}/api/move`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
  const file = await fetch(`${app.url}/api/move/file`);
  assert.equal(file.status, 200);
  const upload = await fetch(`${app.url}/api/move`, { method: 'POST', headers: { 'Content-Type': 'application/x-sovran-move' }, body: Buffer.from(await file.arrayBuffer()) });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).waiting, true);
  assert.equal((await (await fetch(`${app.url}/api/move/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).restarting, false);
  // The next start brings it in.
  await app.close();
  app = await startServer({ ...quiet, dataDir });
  const status = await (await fetch(`${app.url}/api/move`)).json();
  assert.equal(status.waiting, false);
  assert.match(status.last.kept_at, /^before-move-/);
  assert.ok(fs.existsSync(path.join(dataDir, status.last.kept_at, 'app.db')));
});
