// A note's one home in My Life (notes.home_id, pkm/4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, getNote, updateNote, notesAtHome, deleteNote } from '../../notes.js';
import { createLifeItem, deleteLifeItem, restoreLifeItem, getLifeItem } from '../../life.js';
import { insertTask, listTasks, syncAllTasks } from '../../tasks.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a note has one home; moving it leaves the first home and joins the second', () => {
  const db = emptyDb();
  const workshop = createLifeItem(db, { kind: 'project', title: 'Autumn workshop' });
  const onboarding = createLifeItem(db, { kind: 'project', title: 'Nordlicht onboarding' });
  const ideas = createNote(db, { title: 'Ideas' });
  assert.equal(getNote(db, ideas.id).home, null);
  assert.deepEqual(updateNote(db, ideas.id, { home_id: workshop.id }).home,
    { id: workshop.id, title: 'Autumn workshop', kind: 'project', state: 'active' });
  assert.deepEqual(notesAtHome(db, workshop.id).notes.map((n) => n.title), ['Ideas']);
  updateNote(db, ideas.id, { home_id: onboarding.id });
  assert.equal(notesAtHome(db, workshop.id).total, 0);
  assert.deepEqual(notesAtHome(db, onboarding.id).notes.map((n) => n.title), ['Ideas']);
  assert.equal(updateNote(db, ideas.id, { home_id: null }).home, null);
  assert.throws(() => updateNote(db, ideas.id, { home_id: '00000000-0000-0000-0000-000000000000' }), (err) => err.status === 400);
});

test('a home lists its notes newest first, twenty at a time, without deleted notes', () => {
  const db = emptyDb();
  const topic = createLifeItem(db, { kind: 'topic', title: 'Pricing' });
  for (let i = 1; i <= 23; i++) updateNote(db, createNote(db, { title: `Note ${i}` }).id, { home_id: topic.id });
  deleteNote(db, notesAtHome(db, topic.id).notes[0].id);
  const first = notesAtHome(db, topic.id);
  assert.equal(first.total, 22);
  assert.equal(first.notes.length, 20);
  assert.equal(first.notes[0].title, 'Note 22');
  assert.deepEqual(notesAtHome(db, topic.id, { offset: 20 }).notes.map((n) => n.title), ['Note 2', 'Note 1']);
});

test('a deleted home leaves its notes without a home until it comes back', () => {
  const db = emptyDb();
  const work = createLifeItem(db, { kind: 'key_element', title: 'Work' });
  const note = createNote(db, { title: 'Plan' });
  updateNote(db, note.id, { home_id: work.id });
  deleteLifeItem(db, work.id);
  assert.equal(getNote(db, note.id).home, null);
  restoreLifeItem(db, work.id);
  assert.equal(getNote(db, note.id).home.title, 'Work');
});

test('an older database keeps every note and gives notes a home', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homes-old-'));
  let db = openDatabase(dir);
  createNote(db, { title: 'Kept', body: 'Text' });
  db.exec('ALTER TABLE notes DROP COLUMN home_id; PRAGMA user_version = 7;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const [kept] = db.prepare('SELECT id, title, body FROM notes').all();
  assert.deepEqual([kept.title, kept.body], ['Kept', 'Text']);
  const home = createLifeItem(db, { kind: 'goal', title: 'G' });
  assert.equal(updateNote(db, kept.id, { home_id: home.id }).home.title, 'G');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the home API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homes-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const project = await (await send('POST', '/api/life', { kind: 'project', title: 'Workshop' })).json();
  const note = await (await send('POST', '/api/notes', { title: 'Ideas' })).json();
  assert.equal((await send('PATCH', `/api/notes/${note.id}`, { home_id: 5 })).status, 400);
  assert.equal((await send('PATCH', `/api/notes/${note.id}`, { home_id: '00000000-0000-0000-0000-000000000000' })).status, 400);
  assert.equal((await (await send('PATCH', `/api/notes/${note.id}`, { home_id: project.id })).json()).home.title, 'Workshop');
  const home = await (await fetch(`${app.url}/api/life/${project.id}/notes`)).json();
  assert.deepEqual([home.total, home.notes.map((n) => n.title)], [1, ['Ideas']]);
});

test('a Key Element\'s notes and tasks at home also hold those at home in what is under it, each note saying which home', () => {
  const db = emptyDb();
  const work = createLifeItem(db, { kind: 'key_element', title: 'Work' });
  const family = createLifeItem(db, { kind: 'key_element', title: 'Family' });
  const project = createLifeItem(db, { kind: 'project', title: 'Nordlicht onboarding', home_id: work.id });
  const archived = createLifeItem(db, { kind: 'topic', title: 'Old pricing', home_id: work.id, state: 'archived' });
  const kitchen = createLifeItem(db, { kind: 'project', title: 'Kitchen', home_id: family.id });
  const loose = createLifeItem(db, { kind: 'topic', title: 'Loose' });
  const at = (title, home, body = '') => updateNote(db, createNote(db, { title, body }).id, { home_id: home.id });
  at('On the Key Element', work);
  at('In the project', project, '- [ ] book the room');
  at('In the archived topic', archived);
  const gone = at('Deleted', project);
  deleteNote(db, gone.id);
  at('In the kitchen', kitchen, '- [ ] choose tiles');
  at('Loose note', loose);
  syncAllTasks(db);

  const list = notesAtHome(db, work.id);
  assert.equal(list.total, 3);
  assert.deepEqual(list.notes.map((n) => [n.title, n.home.title, n.home.kind]), [
    ['In the archived topic', 'Old pricing', 'topic'], ['In the project', 'Nordlicht onboarding', 'project'], ['On the Key Element', 'Work', 'key_element']]);
  assert.ok(list.notes.every((n) => n.updated_at && 'preview' in n));
  assert.equal(notesAtHome(db, work.id, { limit: 2, offset: 2 }).notes.length, 1);
  assert.equal(notesAtHome(db, family.id).total, 1);
  // An item that is not a Key Element holds only its own.
  assert.deepEqual(notesAtHome(db, project.id).notes.map((n) => n.title), ['In the project']);

  insertTask(db, { text: 'send the welcome pack', home_id: project.id });
  insertTask(db, { text: 'review the year', home_id: work.id });
  insertTask(db, { text: 'order the cupboards', home_id: kitchen.id });
  insertTask(db, { text: 'no home at all' });
  assert.deepEqual(listTasks(db, { home: work.id }).map((t) => [t.text, t.home.title]).sort(),
    [['book the room', 'Nordlicht onboarding'], ['review the year', 'Work'], ['send the welcome pack', 'Nordlicht onboarding']]);
  assert.deepEqual(listTasks(db, { home: project.id }).map((t) => t.text).sort(), ['book the room', 'send the welcome pack']);
  assert.deepEqual(listTasks(db, { home: family.id }).map((t) => t.text).sort(), ['choose tiles', 'order the cupboards']);

  // The page of a Key Element also needs what it holds, with each one's description.
  const under = getLifeItem(db, work.id).under;
  assert.deepEqual(under.map((i) => i.title), ['Nordlicht onboarding', 'Old pricing']);
  assert.ok(under.every((i) => i.description === ''));
});
