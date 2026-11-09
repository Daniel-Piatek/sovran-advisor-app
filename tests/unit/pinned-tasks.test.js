// A task pinned to a time and a length of its own (tasks.pin_at, tasks.pin_minutes; Calendar in depth, lesson 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { insertTask, changeTask, getTask, checkTaskInput } from '../../tasks.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a task is not pinned until it is; pinning keeps it a task and gives it its own length', () => {
  const db = emptyDb();
  const made = insertTask(db, { text: 'Draft the workshop agenda', due: '2026-11-10', estimate: 60 });
  assert.deepEqual([made.pin_at, made.pin_minutes], ['', null]);
  const pinned = changeTask(db, made.id, { due: '2026-11-10', plan_part: 'morning', plan_at: '10:45', pin_at: '10:45', pin_minutes: 90 });
  assert.deepEqual([pinned.pin_at, pinned.pin_minutes, pinned.estimate, pinned.done], ['10:45', 90, 60, false]);
  // Its estimate is not touched; it can still be finished.
  assert.equal(changeTask(db, made.id, { done: true }).done, true);
  // Unpin: it keeps its place, loses the pin.
  const free = changeTask(db, made.id, { pin_at: '' });
  assert.deepEqual([free.pin_at, free.pin_minutes, free.plan_at, free.plan_part], ['', null, '10:45', 'morning']);
});

test('pinned without a length takes the estimate; a task moved to another day leaves its pin; what is refused', () => {
  const db = emptyDb();
  const task = insertTask(db, { text: 'Write', due: '2026-11-10', estimate: 45 });
  assert.equal(changeTask(db, task.id, { pin_at: '09:00' }).pin_minutes, 45);
  assert.equal(changeTask(db, task.id, { due: '2026-11-11' }).pin_at, '');
  assert.equal(checkTaskInput({ pin_at: '25:00' }), 'pin_at is a time (HH:MM), or empty.');
  assert.match(checkTaskInput({ pin_at: '09:00', pin_minutes: 2 }), /5 to 1440/);
  assert.equal(checkTaskInput({ pin_at: '' }), null);
});

test('schema 59 moves an older database: a task takes the two columns and every task is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-old-'));
  let db = openDatabase(dir);
  const task = insertTask(db, { text: 'Keep me', due: '2026-11-10' });
  db.exec('ALTER TABLE tasks DROP COLUMN pin_at; ALTER TABLE tasks DROP COLUMN pin_minutes; PRAGMA user_version = 58;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual([getTask(db, task.id).text, getTask(db, task.id).pin_at, getTask(db, task.id).pin_minutes], ['Keep me', '', null]);
  db.close();
});
