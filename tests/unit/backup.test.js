import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../db.js';
import { backUp, listBackups } from '../../backup.js';
import { startServer } from '../../server.js';

test('a backup is a whole copy, one a day, and only the newest 14 are kept', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const db = openDatabase(dataDir);
  db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Kept', 'In the copy')").run();
  const file = backUp(db, dataDir, { day: '2026-11-01' });
  const copy = new DatabaseSync(file);
  assert.equal(copy.prepare('SELECT title FROM notes').get().title, 'Kept');
  copy.close();
  const size = fs.statSync(file).size;
  db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n2', 'a', 'a', 'Later', '')").run();
  backUp(db, dataDir, { day: '2026-11-01' }); // the same day: the copy stays as it was
  assert.equal(fs.statSync(file).size, size);
  for (let d = 2; d <= 20; d++) backUp(db, dataDir, { day: `2026-11-${String(d).padStart(2, '0')}` });
  const kept = listBackups(dataDir).map((b) => b.day);
  assert.equal(kept.length, 14);
  assert.equal(kept[0], '2026-11-20');
  assert.equal(kept.at(-1), '2026-11-07');
  db.close();
});

test('the app makes today’s backup when it starts', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-app-'));
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.equal(listBackups(dataDir).length, 1);
});
