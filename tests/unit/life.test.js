// My Life (life.js): Key Elements, Goals, Projects and Topics, their homes and chains,
// links to them, and their API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote } from '../../notes.js';
import {
  createLifeItem, getLifeItem, listLifeItems, updateLifeItem, deleteLifeItem, restoreLifeItem, listDeletedLifeItems,
} from '../../life.js';
import { linkedFrom, suggestLinks, linkTarget } from '../../links.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a Key Element with a Goal, a Project serving it, and a Topic', () => {
  const db = emptyDb();
  const health = createLifeItem(db, { kind: 'key_element', title: ' Health ', not_this: 'Not a diet.' });
  const goal = createLifeItem(db, { kind: 'goal', title: 'Run a half marathon', home_id: health.id, horizon: 'year' });
  const project = createLifeItem(db, {
    kind: 'project', title: 'Spring training plan', home_id: health.id, serves: [goal.id], starts_on: '2026-11-01',
  });
  createLifeItem(db, { kind: 'topic', title: 'Sleep', home_id: health.id, depth: 'deep' });

  assert.equal(getLifeItem(db, health.id).title, 'Health');
  assert.deepEqual(getLifeItem(db, health.id).under.map((i) => [i.kind, i.title]),
    [['goal', 'Run a half marathon'], ['topic', 'Sleep'], ['project', 'Spring training plan']]);
  const page = getLifeItem(db, project.id);
  assert.deepEqual([page.home.title, page.serves.map((g) => g.title), page.state, page.starts_on],
    ['Health', ['Run a half marathon'], 'active', '2026-11-01']);
  assert.deepEqual(getLifeItem(db, goal.id).under.map((i) => i.title), ['Spring training plan']);
  assert.deepEqual(listLifeItems(db).find((i) => i.id === project.id).serves, [goal.id]);
});

test('only a Key Element can be a home, and only a Project or a Habit serves Goals', () => {
  const db = emptyDb();
  const work = createLifeItem(db, { kind: 'key_element', title: 'Work' });
  const goal = createLifeItem(db, { kind: 'goal', title: 'Three clients', home_id: work.id });
  const no = (err) => err.status === 400;
  assert.throws(() => createLifeItem(db, { kind: 'project', title: 'X', home_id: goal.id }), no);
  assert.throws(() => createLifeItem(db, { kind: 'key_element', title: 'X', home_id: work.id }), no);
  assert.throws(() => createLifeItem(db, { kind: 'topic', title: 'X', serves: [goal.id] }), no);
  assert.throws(() => createLifeItem(db, { kind: 'project', title: 'X', serves: [work.id] }), no);
  assert.throws(() => createLifeItem(db, { kind: 'habit', title: 'X', home_id: goal.id }), no);
  assert.throws(() => createLifeItem(db, { kind: 'jelly', title: 'X' }), no);
  assert.throws(() => createLifeItem(db, { kind: 'goal', title: ' ' }), no);
  assert.throws(() => updateLifeItem(db, goal.id, { kind: 'topic' }), no);
});

test('taking a Goal off a Project and adding it back keeps one row', () => {
  const db = emptyDb();
  const goal = createLifeItem(db, { kind: 'goal', title: 'G' });
  const project = createLifeItem(db, { kind: 'project', title: 'P', serves: [goal.id] });
  assert.deepEqual(updateLifeItem(db, project.id, { serves: [] }).serves, []);
  assert.equal(updateLifeItem(db, project.id, { serves: [goal.id] }).serves[0].title, 'G');
  assert.equal(db.prepare('SELECT count(*) AS n FROM life_serves').get().n, 1);
});

test('archiving keeps an item; deleting can be undone, and a deleted home drops out', () => {
  const db = emptyDb();
  const family = createLifeItem(db, { kind: 'key_element', title: 'Family' });
  const topic = createLifeItem(db, { kind: 'topic', title: 'Holidays', home_id: family.id });
  assert.equal(updateLifeItem(db, topic.id, { state: 'archived' }).state, 'archived');
  assert.equal(listLifeItems(db).length, 2);
  deleteLifeItem(db, family.id);
  assert.equal(getLifeItem(db, family.id), null);
  assert.equal(getLifeItem(db, topic.id).home, null);
  assert.equal(listLifeItems(db).find((i) => i.id === topic.id).home_id, null);
  assert.deepEqual(listDeletedLifeItems(db).map((i) => i.title), ['Family']);
  restoreLifeItem(db, family.id);
  assert.equal(getLifeItem(db, topic.id).home.title, 'Family');
});

test('a note links to a My Life item, and an item’s thinking space links out', () => {
  const db = emptyDb();
  const project = createLifeItem(db, { kind: 'project', title: 'Autumn workshop' });
  const note = createNote(db, { title: 'Ideas', body: `For [Autumn workshop](/life/${project.id}).` });
  assert.deepEqual(linkedFrom(db, 'life', project.id).map((l) => l.label), ['Ideas']);
  assert.deepEqual(linkTarget(db, 'life', project.id), { exists: true, title: 'Autumn workshop', life_kind: 'project' });
  updateLifeItem(db, project.id, { body: `See [Ideas](/notes/${note.id}).` });
  assert.deepEqual(linkedFrom(db, 'note', note.id).map((l) => [l.from_kind, l.label, l.life_kind]),
    [['life', 'Autumn workshop', 'project']]);
  const found = suggestLinks(db, 'autumn', { today: '2026-10-25' });
  assert.deepEqual(found.filter((f) => f.kind === 'life').map((f) => [f.label, f.life_kind]), [['Autumn workshop', 'project']]);
  assert.equal(suggestLinks(db, 'autumn', { today: '2026-10-25', only: 'person' }).length, 0);
});

test('an older database gets My Life, and links that can point at it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-old-'));
  let db = openDatabase(dir);
  const target = createNote(db, { title: 'Target' });
  createNote(db, { title: 'Source', body: `See [Target](/notes/${target.id}).` });
  db.exec(`DROP TABLE life_serves; DROP TABLE life_items; DROP TABLE links;
    CREATE TABLE links (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'typed', from_kind TEXT NOT NULL CHECK (from_kind IN ('note', 'entry', 'person', 'company')),
      from_id TEXT NOT NULL, to_kind TEXT NOT NULL CHECK (to_kind IN ('note', 'entry', 'day', 'person', 'company')),
      to_id TEXT NOT NULL, link_text TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '');
    PRAGMA user_version = 6;`);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  assert.equal(linkedFrom(db, 'note', target.id).length, 1, 'links made again');
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health' });
  createNote(db, { title: 'Run', body: `[Health](/life/${health.id})` });
  assert.equal(linkedFrom(db, 'life', health.id).length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a database from before descriptions gets description, every item and what was written in it kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-v26-'));
  let db = openDatabase(dir);
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health', not_this: 'Not a diet', body: 'My thinking' });
  createLifeItem(db, { kind: 'goal', title: 'Run', home_id: health.id, statement: 'Ten kilometres' });
  db.exec('ALTER TABLE life_items DROP COLUMN description; PRAGMA user_version = 26;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listLifeItems(db).map((i) => [i.title, i.description, i.notes_count]), [['Health', '', 0], ['Run', '', 0]]);
  const kept = getLifeItem(db, health.id);
  assert.deepEqual([kept.not_this, kept.body], ['Not a diet', 'My thinking']);
  assert.equal(getLifeItem(db, db.prepare("SELECT id FROM life_items WHERE title = 'Run'").get().id).statement, 'Ten kilometres');
  assert.equal(updateLifeItem(db, health.id, { description: 'Body, energy, sleep' }).description, 'Body, energy, sleep');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the My Life API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const health = await (await send('POST', '/api/life', { kind: 'key_element', title: 'Health' })).json();
  assert.equal((await send('POST', '/api/life', { kind: 'goal' })).status, 400);
  assert.equal((await send('POST', '/api/life', { kind: 'goal', title: 'G', horizon: 'soon' })).status, 400);
  assert.equal((await send('POST', '/api/life', { kind: 'project', title: 'P', ends_on: 'May' })).status, 400);
  const goal = await (await send('POST', '/api/life', { kind: 'goal', title: 'Run', home_id: health.id })).json();
  const project = await (await send('POST', '/api/life', { kind: 'project', title: 'Plan', home_id: health.id })).json();
  const changed = await (await send('PATCH', `/api/life/${project.id}`, { serves: [goal.id], outcome: 'A plan' })).json();
  assert.deepEqual([changed.outcome, changed.serves.map((g) => g.title)], ['A plan', ['Run']]);
  assert.deepEqual((await (await fetch(`${app.url}/api/life`)).json()).map((i) => i.title), ['Health', 'Plan', 'Run']);
  assert.equal((await send('DELETE', `/api/life/${goal.id}`)).status, 200);
  assert.deepEqual((await (await fetch(`${app.url}/api/life?deleted=1`)).json()).map((i) => i.title), ['Run']);
  assert.equal((await send('POST', `/api/life/${goal.id}/restore`, {})).status, 200);
  assert.equal((await fetch(`${app.url}/api/links/to?kind=life&id=${goal.id}`)).status, 200);
  assert.equal((await fetch(`${app.url}/api/life/${goal.id}`)).status, 200);
});
