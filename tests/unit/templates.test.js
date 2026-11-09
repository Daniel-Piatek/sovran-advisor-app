// Routines (templates.js, Calendar in depth lesson 6): a title and a length, dragged into a day they make a task, never an event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { checkTemplateInput, createTemplate, listTemplates, removeTemplate, restoreTemplate, placeTemplate } from '../../templates.js';
import { eventsBetween } from '../../events.js';
import { getTask } from '../../tasks.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a routine is a name and a length; removing keeps it, and it comes back', () => {
  const db = emptyDb();
  const run = createTemplate(db, { title: ' Run ', minutes: 45 });
  assert.deepEqual([run.title, run.minutes], ['Run', 45]);
  createTemplate(db, { title: 'Deep work', minutes: 180 });
  assert.deepEqual(listTemplates(db).map((t) => t.title), ['Run', 'Deep work']);
  removeTemplate(db, run.id);
  assert.deepEqual(listTemplates(db).map((t) => t.title), ['Deep work']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM event_templates').get().n, 2, 'never really removed');
  restoreTemplate(db, run.id);
  assert.equal(listTemplates(db).length, 2);
  assert.equal(checkTemplateInput({ title: '', minutes: 30 }), 'A routine needs a name.');
  assert.equal(checkTemplateInput({ title: 'x', minutes: 2 }), 'minutes is 5 to 1440.');
  assert.equal(checkTemplateInput({ title: 'x', minutes: 30 }), null);
});

test('dropped into a day a routine makes a task of its words and length, placed in the day, marked with its routine, and never an event', () => {
  const db = emptyDb();
  const run = createTemplate(db, { title: 'Run', minutes: 45 });
  const task = placeTemplate(db, run.id, { due: '2026-11-11', plan_part: 'morning', plan_at: '08:00' });
  assert.deepEqual([task.text, task.estimate, task.due, task.plan_part, task.plan_at, task.template_id, task.done], ['Run', 45, '2026-11-11', 'morning', '08:00', run.id, false]);
  assert.deepEqual(getTask(db, task.id).template_id, run.id);
  assert.equal(eventsBetween(db, '2026-11-01', '2026-11-30').length, 0);
  // Each drop is a task of its own.
  assert.notEqual(placeTemplate(db, run.id, { due: '2026-11-12', plan_part: 'afternoon' }).id, task.id);
  assert.throws(() => placeTemplate(db, run.id, { due: 'someday', plan_part: 'morning' }), /due is a day/);
  assert.throws(() => placeTemplate(db, run.id, { due: '2026-11-11', plan_part: 'night' }), /morning or afternoon/);
  assert.throws(() => placeTemplate(db, '00000000-0000-4000-8000-000000000000', { due: '2026-11-11', plan_part: 'morning' }), (e) => e.status === 404);
});

test('schema 61 moves an older database: routines are new, a task can say which routine it came from, every task is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-old-'));
  let db = openDatabase(dir);
  const run = createTemplate(db, { title: 'Run', minutes: 45 });
  const task = placeTemplate(db, run.id, { due: '2026-11-11', plan_part: 'morning' });
  db.exec('DROP TABLE event_templates; ALTER TABLE tasks DROP COLUMN template_id; PRAGMA user_version = 60;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual([getTask(db, task.id).text, getTask(db, task.id).template_id], ['Run', null]);
  assert.equal(listTemplates(db).length, 0);
  db.close();
});
