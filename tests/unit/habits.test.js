// Habits, the fifth kind in My Life (advanced/mylife/1): the rows, the rules, the move from schema 66, and the module's gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote } from '../../notes.js';
import { createLifeItem, getLifeItem, listLifeItems, updateLifeItem, checkLifeInput } from '../../life.js';
import { startServer } from '../../server.js';

const emptyDb = () => { const db = new DatabaseSync(':memory:'); prepareDatabase(db); return db; };

test('a Habit has a cadence and what counts as done, and stands on a Key Element', () => {
  const db = emptyDb();
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health' });
  const run = createLifeItem(db, { kind: 'habit', title: 'Run 3× a week', home_id: health.id, cadence_times: 3, cadence_per: 'week', done_when: 'Twenty minutes, outside' });
  const read = getLifeItem(db, run.id);
  assert.deepEqual([read.kind, read.cadence_times, read.cadence_per, read.done_when, read.home.title], ['habit', 3, 'week', 'Twenty minutes, outside', 'Health']);
  assert.deepEqual(getLifeItem(db, health.id).under.map((i) => i.title), ['Run 3× a week']);
  // The default is once a week.
  const plain = createLifeItem(db, { kind: 'habit', title: 'Stretch' });
  assert.deepEqual([plain.cadence_times, plain.cadence_per], [1, 'week']);
});

test('a Habit carries Goals like a Project, and shows under the Key Element of its Goal', () => {
  const db = emptyDb();
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health' });
  const family = createLifeItem(db, { kind: 'key_element', title: 'Family' });
  const goal = createLifeItem(db, { kind: 'goal', title: 'Run ten kilometres', home_id: health.id });
  const habit = createLifeItem(db, { kind: 'habit', title: 'Run 3× a week', home_id: family.id, serves: [goal.id] });
  assert.deepEqual(getLifeItem(db, goal.id).under.map((i) => i.title), ['Run 3× a week']);
  assert.deepEqual(getLifeItem(db, health.id).under.map((i) => i.title).sort(), ['Run 3× a week', 'Run ten kilometres']);
  assert.deepEqual(getLifeItem(db, family.id).under.map((i) => i.title), ['Run 3× a week']);
  assert.deepEqual(listLifeItems(db).find((i) => i.id === habit.id).serves, [goal.id]);
  assert.throws(() => createLifeItem(db, { kind: 'topic', title: 'T', serves: [goal.id] }), (e) => e.status === 400);
});

test('a rhythm is a whole number, and a week has seven days', () => {
  const db = emptyDb();
  const no = (e) => e.status === 400;
  for (const bad of [0, 2.5, '3', 32]) assert.ok(checkLifeInput({ cadence_times: bad }), `${bad}`);
  assert.equal(checkLifeInput({ cadence_times: 31, cadence_per: 'month' }), null);
  assert.ok(checkLifeInput({ cadence_per: 'year' }));
  assert.throws(() => createLifeItem(db, { kind: 'habit', title: 'Daily x2', cadence_times: 8 }), no);
  const habit = createLifeItem(db, { kind: 'habit', title: 'Swim', cadence_times: 12, cadence_per: 'month' });
  assert.throws(() => updateLifeItem(db, habit.id, { cadence_per: 'week' }), no); // 12 a week is not possible
  assert.equal(updateLifeItem(db, habit.id, { cadence_per: 'week', cadence_times: 5 }).cadence_times, 5);
  assert.equal(updateLifeItem(db, habit.id, { cadence_times: 7 }).cadence_times, 7);
});

test('a database from schema 67 gets Habits and keeps every row and every reference', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habits-move-'));
  const file = path.join(dir, 'app.db');
  const db = openDatabase(dir);
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health', body: 'My thinking' });
  const goal = createLifeItem(db, { kind: 'goal', title: 'Run', home_id: health.id, statement: 'Ten kilometres' });
  const project = createLifeItem(db, { kind: 'project', title: 'Plan', home_id: health.id, serves: [goal.id] });
  const note = createNote(db, { title: 'Run log', body: 'x' });
  db.prepare('UPDATE notes SET home_id = ? WHERE id = ?').run(project.id, note.id);
  // Put the database back as schema 67 (the AI choice, before Habits) had it: no habit kind, no cadence columns.
  const old = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'life_items'").get().sql
    .replace(", 'habit'", '').replace(/,\s*cadence_times[\s\S]*?done_when TEXT NOT NULL DEFAULT ''/, '')
    .replace('CREATE TABLE life_items', 'CREATE TABLE life_items_old');
  const columns = 'id, created_at, updated_at, deleted_at, origin, kind, title, description, state, home_id, not_this, statement, horizon, shipped_means, why, outcome, done_means, starts_on, ends_on, pulse, depth, body';
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(old);
  db.exec(`INSERT INTO life_items_old (${columns}) SELECT ${columns} FROM life_items`);
  db.exec('DROP TABLE life_items; ALTER TABLE life_items_old RENAME TO life_items; PRAGMA foreign_keys = ON; PRAGMA user_version = 67');
  assert.ok(!db.prepare("SELECT sql FROM sqlite_master WHERE name = 'life_items'").get().sql.includes('habit'));
  db.close();

  const moved = openDatabase(dir);
  assert.equal(moved.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(`${file}.before-v${SCHEMA_VERSION}.bak`));
  assert.deepEqual(listLifeItems(moved).map((i) => i.title).sort(), ['Health', 'Plan', 'Run']);
  assert.equal(getLifeItem(moved, goal.id).statement, 'Ten kilometres');
  assert.equal(getLifeItem(moved, health.id).body, 'My thinking');
  assert.deepEqual(getLifeItem(moved, goal.id).under.map((i) => i.title), ['Plan']);
  assert.equal(moved.prepare('SELECT home_id FROM notes WHERE id = ?').get(note.id).home_id, project.id);
  assert.deepEqual(moved.prepare('PRAGMA foreign_key_check').all(), []);
  // The references still point at life_items, not at the table that was renamed away.
  assert.ok(moved.prepare("SELECT sql FROM sqlite_master WHERE name = 'life_serves'").get().sql.includes('life_items'));
  assert.ok(!moved.prepare("SELECT group_concat(sql) AS s FROM sqlite_master").get().s.includes('life_items_before'));
  const habit = createLifeItem(moved, { kind: 'habit', title: 'Run 3× a week', home_id: health.id, serves: [goal.id], cadence_times: 3 });
  assert.equal(getLifeItem(moved, habit.id).serves[0].id, goal.id);
  moved.close();
});

test('My Life in depth is off in a new install; switching it off hides Habits and refuses new ones; the rows wait', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'habits-module-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = async (method, p, body) => {
    const res = await fetch(`${app.url}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const titles = async () => (await send('GET', '/api/life')).body.map((i) => i.title).sort();
  const health = (await send('POST', '/api/life', { kind: 'key_element', title: 'Health' })).body;
  // Off in a new install (Sovran Advisor): no Habit until it is switched on.
  assert.equal((await send('GET', '/api/modules')).body.find((m) => m.id === 'mylife-plus').on, false);
  assert.equal((await send('POST', '/api/life', { kind: 'habit', title: 'Too early', home_id: health.id })).status, 409);
  await send('PATCH', '/api/modules', { id: 'mylife-plus', on: true });
  assert.equal((await send('POST', '/api/life', { kind: 'habit', title: 'Run 3× a week', home_id: health.id, cadence_times: 3 })).status, 201);
  await send('PATCH', '/api/modules', { id: 'mylife-plus', on: false });
  assert.deepEqual(await titles(), ['Health']);
  assert.equal((await send('POST', '/api/life', { kind: 'habit', title: 'Another' })).status, 409);
  assert.equal((await send('POST', '/api/life', { kind: 'goal', title: 'Still fine' })).status, 201);
  await send('PATCH', '/api/modules', { id: 'mylife-plus', on: true });
  assert.deepEqual(await titles(), ['Health', 'Run 3× a week', 'Still fine']);
});
