// People in depth, lesson 1 (modules.js, and tasks.js mentions): the module switch, a task of
// its own that mentions a person or a company, and a database from before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, createCompany } from '../../people.js';
import { createNote } from '../../notes.js';
import { createTask, changeTask, deleteTask, restoreTask, listTasks, checkTaskInput } from '../../tasks.js';
import { linkedFrom } from '../../links.js';
import { listModules, setModule, moduleOn } from '../../modules.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('People in depth is on until it is switched off, and the switch is kept', () => {
  const db = emptyDb();
  assert.deepEqual(listModules(db).map((m) => [m.id, m.label, m.on]), [['tasks', 'Tasks', false], ['planner', 'Planner', false], ['calendar', 'Calendar', false], ['life', 'My Life', false], ['course', 'Course', false], ['people-plus', 'People in depth', true], ['voice', 'Dictation', false], ['tasks-plus', 'Tasks in depth', true], ['calendar-links', 'Calendar links', true], ['calendar-plus', 'Calendar in depth', true], ['mylife-plus', 'My Life in depth', false], ['calendar-google', 'Google Calendar', false], ['writing', 'Writing and thinking', true], ['everywhere', 'Phone, backups and moving', false], ['help', 'Help pages', false], ['mail', 'Mail', false]]);
  setModule(db, 'people-plus', false);
  assert.equal(moduleOn(db, 'people-plus'), false);
  setModule(db, 'people-plus', true);
  assert.equal(moduleOn(db, 'people-plus'), true);
  assert.throws(() => setModule(db, 'nothing', true), /no such module/);
});

test('a task of its own keeps who it mentions, and the person’s page lists it', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const nord = createCompany(db, { name: 'Nordlicht Studio' });
  const task = createTask(db, {
    text: 'Send Lena Fischer the offer from Nordlicht Studio',
    mentions: [{ kind: 'person', id: lena.id }, { kind: 'company', id: nord.id }],
  });
  assert.deepEqual(task.mentions, [{ kind: 'person', id: lena.id, name: 'Lena Fischer' }, { kind: 'company', id: nord.id, name: 'Nordlicht Studio' }]);
  assert.equal(task.text, 'Send Lena Fischer the offer from Nordlicht Studio', 'the words stay plain');
  const [from] = linkedFrom(db, 'person', lena.id);
  assert.deepEqual([from.from_kind, from.from_id, from.label, from.link_text], ['task', task.id, task.text, 'Lena Fischer']);
  assert.equal(linkedFrom(db, 'company', nord.id).length, 1);

  // Words changed: a name still in the words stays mentioned, a name taken out goes.
  const edited = changeTask(db, task.id, { text: 'Send Lena Fischer the offer' });
  assert.deepEqual(edited.mentions.map((m) => m.name), ['Lena Fischer']);
  assert.equal(linkedFrom(db, 'company', nord.id).length, 0);
  // A new list replaces it.
  assert.deepEqual(changeTask(db, task.id, { text: 'Ask Nordlicht Studio', mentions: [{ kind: 'company', id: nord.id }] }).mentions.map((m) => m.name), ['Nordlicht Studio']);
  assert.equal(linkedFrom(db, 'person', lena.id).length, 0);

  // A renamed person shows by the current name; a deleted task leaves the list and comes back.
  db.prepare('UPDATE companies SET name = ? WHERE id = ?').run('Nordlicht GmbH', nord.id);
  assert.equal(listTasks(db, { id: task.id })[0].mentions[0].name, 'Nordlicht GmbH');
  deleteTask(db, task.id);
  assert.equal(linkedFrom(db, 'company', nord.id).length, 0);
  restoreTask(db, task.id);
  assert.equal(linkedFrom(db, 'company', nord.id).length, 1);
});

test('a repeating task carries its mentions to the next one', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const task = createTask(db, { text: 'Call Lena Fischer', repeat: 'every monday', mentions: [{ kind: 'person', id: lena.id }] });
  changeTask(db, task.id, { done: true });
  const next = listTasks(db, { done: false }).find((t) => t.id !== task.id);
  assert.deepEqual(next.mentions.map((m) => m.name), ['Lena Fischer']);
});

test('a mention must be someone in the app, and a task in a page is changed in its page', () => {
  const db = emptyDb();
  assert.throws(() => createTask(db, { text: 'Call Nobody', mentions: [{ kind: 'person', id: '11111111-1111-1111-1111-111111111111' }] }), /not in the app/);
  assert.equal(listTasks(db).length, 0, 'nothing half-made');
  assert.equal(checkTaskInput({ text: 'x', mentions: 'Lena' }, { creating: true }), 'mentions is a list of people and companies: { kind, id }.');
  assert.equal(checkTaskInput({ text: 'x', mentions: [{ kind: 'note', id: 'a' }] }, { creating: true }) !== null, true);
  createNote(db, { title: 'Plan', body: '- [ ] Call the bank' });
  const [inNote] = listTasks(db);
  assert.throws(() => changeTask(db, inNote.id, { mentions: [] }), /changed in its page/);
});

test('a database from before People in depth keeps every link and takes a task’s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-plus-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer' });
  createNote(db, { title: 'Call', body: `Rang [Lena Fischer](/people/${lena.id}) today.` });
  // Back to the shape of version 30: links could not come from a task.
  const old = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'links'").get().sql.replace(", 'task', 'interaction'", '');
  db.exec(`ALTER TABLE links RENAME TO links_now; DROP INDEX links_to; DROP INDEX links_from; ${old}; INSERT INTO links SELECT * FROM links_now; DROP TABLE links_now; PRAGMA user_version = 30;`);
  assert.throws(() => db.prepare("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id) VALUES ('x', 'a', 'a', 'task', 'y', 'person', 'z')").run(), /CHECK/);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  assert.equal(linkedFrom(db, 'person', lena.id).length, 1, 'the note’s link is kept');
  const task = createTask(db, { text: 'Call Lena Fischer', mentions: [{ kind: 'person', id: lena.id }] });
  assert.equal(linkedFrom(db, 'person', lena.id).length, 2);
  assert.equal(task.mentions.length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the modules API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.deepEqual((await (await fetch(`${app.url}/api/modules`)).json()).map((m) => [m.id, m.on]), [['tasks', false], ['planner', false], ['calendar', false], ['life', false], ['course', false], ['people-plus', true], ['voice', false], ['tasks-plus', true], ['calendar-links', true], ['calendar-plus', true], ['mylife-plus', false], ['calendar-google', false], ['writing', true], ['everywhere', false], ['help', false], ['mail', false]]);
  for (const bad of [{}, { id: 'people-plus' }, { id: 'people-plus', on: 'no' }, { id: 'no-such-module', on: true }]) {
    assert.equal((await send('PATCH', '/api/modules', bad)).status, 400, JSON.stringify(bad));
  }
  const peoplePlus = (list) => list.find((m) => m.id === 'people-plus');
  assert.equal(peoplePlus(await (await send('PATCH', '/api/modules', { id: 'people-plus', on: false })).json()).on, false);
  assert.equal(peoplePlus(await (await fetch(`${app.url}/api/modules`)).json()).on, false);
  assert.equal((await send('DELETE', '/api/modules')).status, 405);
  // Tasks over the API: mentions in, mentions out.
  const lena = await (await send('POST', '/api/people', { name: 'Lena Fischer' })).json();
  const made = await (await send('POST', '/api/tasks', { text: 'Ring Lena Fischer', mentions: [{ kind: 'person', id: lena.id }] })).json();
  assert.deepEqual(made.mentions, [{ kind: 'person', id: lena.id, name: 'Lena Fischer' }]);
  assert.equal((await send('POST', '/api/tasks', { text: 'Ring Nobody', mentions: [{ kind: 'person', id: '11111111-1111-1111-1111-111111111111' }] })).status, 400);
});
