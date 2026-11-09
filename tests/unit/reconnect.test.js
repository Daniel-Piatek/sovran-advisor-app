// A reconnect rhythm (reconnect.js, advanced/people/5): a cadence per person, the Reconnect
// list worked out from logged lines, "Remind me" as a task, the assistant's reconnect_list,
// and a database from before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, updatePerson, getPerson, checkPersonInput } from '../../people.js';
import { logInteraction } from '../../interactions.js';
import { reconnectList, remindToReconnect, daysLeft, lastInTouch, addDays } from '../../reconnect.js';
import { createTask, changeTask, listTasks } from '../../tasks.js';
import { runTool, offeredTools } from '../../assistant-tools.js';
import { setModule } from '../../modules.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const TODAY = '2026-11-08';
const NOW = new Date(2026, 10, 8, 14, 30);
const ago = (n) => addDays(TODAY, -n);
const log = (db, person, daysAgo, kind = 'call') => logInteraction(db, { about: { kind: 'person', id: person.id }, kind, note: 'Spoke', when: ago(daysAgo) }, { at: NOW });

test('days left count from the last logged line, and with nothing logged a person is due today', () => {
  assert.equal(daysLeft(7, ago(9), TODAY), -2);
  assert.equal(daysLeft(7, ago(7), TODAY), 0);
  assert.equal(daysLeft(21, ago(12), TODAY), 9);
  assert.equal(daysLeft(30, null, TODAY), 0);
  assert.equal(daysLeft(null, ago(3), TODAY), null, 'no rhythm, nothing to count');
  assert.equal(daysLeft(7, '2026-10-24', '2026-10-31'), 0, 'whole days, whatever the clocks did');
});

test('the Reconnect list: everyone with a rhythm, the most overdue first; logging a line moves them off', () => {
  const db = emptyDb();
  const jonas = createPerson(db, { name: 'Jonas Weber' });
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const marta = createPerson(db, { name: 'Marta Kowalska' });
  createPerson(db, { name: 'No rhythm' });
  assert.equal(getPerson(db, jonas.id).cadence_days, null);
  updatePerson(db, jonas.id, { cadence_days: 7 });
  updatePerson(db, lena.id, { cadence_days: 21 });
  updatePerson(db, marta.id, { cadence_days: 30 });
  log(db, jonas, 9);
  log(db, lena, 12);
  log(db, lena, 40); // an older one does not count
  const list = reconnectList(db, { today: TODAY });
  assert.deepEqual(list.map((p) => [p.name, p.cadence_label, p.days_left, p.last_in_touch]), [
    ['Jonas Weber', 'Weekly', -2, ago(9)], ['Marta Kowalska', 'Monthly', 0, null], ['Lena Fischer', 'Every 3 weeks', 9, ago(12)],
  ]);
  // The person's page numbers are the same ones.
  const page = getPerson(db, jonas.id);
  assert.equal(page.last_in_touch, lastInTouch(db, jonas.id));
  assert.equal(page.last_in_touch, ago(9));
  // A call today: Jonas leaves the overdue part and is a week from due.
  log(db, jonas, 0);
  assert.deepEqual(reconnectList(db, { today: TODAY }).map((p) => [p.name, p.days_left]), [['Marta Kowalska', 0], ['Jonas Weber', 7], ['Lena Fischer', 9]].sort((a, b) => a[1] - b[1]));
  // A deleted person is not on it; Off takes them off.
  updatePerson(db, lena.id, { cadence_days: null });
  assert.equal(reconnectList(db, { today: TODAY }).some((p) => p.name === 'Lena Fischer'), false);
  db.prepare('UPDATE people SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), marta.id);
  assert.deepEqual(reconnectList(db, { today: TODAY }).map((p) => p.name), ['Jonas Weber']);
});

test('only the offered rhythms are accepted', () => {
  assert.equal(checkPersonInput({ cadence_days: 14 }), null);
  assert.equal(checkPersonInput({ cadence_days: null }), null);
  for (const bad of [5, '7', 0, 365]) assert.match(checkPersonInput({ cadence_days: bad }), /cadence_days is 7, 14, 21, 30, 90 or null/);
  const db = emptyDb();
  const p = createPerson(db, { name: 'A' });
  assert.throws(() => db.prepare('UPDATE people SET cadence_days = 5 WHERE id = ?').run(p.id), /CHECK/);
});

test('Remind me makes "Reconnect with Jonas" for tomorrow, once; finished, it can be made again', () => {
  const db = emptyDb();
  const jonas = createPerson(db, { name: 'Jonas Weber' });
  const made = remindToReconnect(db, jonas.id, { today: TODAY });
  assert.deepEqual([made.existing, made.task.text, made.task.due, made.task.source.kind, made.task.mentions.map((m) => m.name)], [false, 'Reconnect with Jonas', '2026-11-09', 'own', ['Jonas Weber']]);
  const again = remindToReconnect(db, jonas.id, { today: TODAY });
  assert.deepEqual([again.existing, again.task_id], [true, made.task_id]);
  assert.equal(listTasks(db, { done: false }).length, 1);
  createTask(db, { text: 'Reconnect with the bank' }); // not about him: not in the way
  changeTask(db, made.task_id, { done: true });
  assert.equal(remindToReconnect(db, jonas.id, { today: TODAY }).existing, false);
  assert.equal(remindToReconnect(db, '11111111-1111-1111-1111-111111111111'), null);
});

test('the assistant’s reconnect_list answers from the same list, and is not there with the module off', () => {
  const db = emptyDb();
  const jonas = createPerson(db, { name: 'Jonas Weber' });
  updatePerson(db, jonas.id, { cadence_days: 7 });
  logInteraction(db, { about: { kind: 'person', id: jonas.id }, kind: 'call', note: 'x', when: ago(9) });
  const answer = JSON.parse(runTool(db, 'reconnect_list', {}, { readOnly: true }));
  assert.equal(answer.length, 1);
  assert.equal(answer[0].name, 'Jonas Weber');
  assert.match(answer[0].status, /overdue/);
  assert.equal(answer[0].path, `/people/${jonas.id}`);
  assert.equal(runTool(emptyDb(), 'reconnect_list', {}, {}), 'Nobody has a rhythm yet. The owner sets one on a person’s page.');
  setModule(db, 'people-plus', false);
  assert.equal(offeredTools(db).some((t) => t.name === 'reconnect_list'), false);
  assert.throws(() => runTool(db, 'reconnect_list', {}, {}), /switched off/);
});

test('a database from before the rhythm keeps every person and takes the column', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconnect-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer', role: 'Producer' });
  db.exec('ALTER TABLE people DROP COLUMN cadence_days; PRAGMA user_version = 32;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  assert.deepEqual([getPerson(db, lena.id).name, getPerson(db, lena.id).role, getPerson(db, lena.id).cadence_days], ['Lena Fischer', 'Producer', null]);
  assert.equal(updatePerson(db, lena.id, { cadence_days: 14 }).cadence_days, 14);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Reconnect API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconnect-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const jonas = await (await send('POST', '/api/people', { name: 'Jonas Weber' })).json();
  assert.deepEqual(await (await send('GET', '/api/reconnect')).json(), []);
  assert.equal((await send('PATCH', `/api/people/${jonas.id}`, { cadence_days: 10 })).status, 400);
  const set = await (await send('PATCH', `/api/people/${jonas.id}`, { cadence_days: 7 })).json();
  assert.deepEqual([set.cadence_days, set.last_in_touch, set.days_left], [7, null, 0]);
  const [row] = await (await send('GET', '/api/reconnect')).json();
  assert.deepEqual([row.name, row.cadence_label, row.days_left], ['Jonas Weber', 'Weekly', 0]);
  const made = await send('POST', `/api/people/${jonas.id}/remind`, {});
  assert.equal(made.status, 201);
  assert.equal((await send('POST', `/api/people/${jonas.id}/remind`, {})).status, 200, 'a second press makes nothing new');
  assert.equal((await send('POST', '/api/people/11111111-1111-1111-1111-111111111111/remind', {})).status, 404);
  const tasks = await (await send('GET', '/api/tasks')).json();
  assert.deepEqual(tasks.map((x) => x.text), ['Reconnect with Jonas']);
  assert.equal((await send('PATCH', `/api/people/${jonas.id}`, { cadence_days: null })).status, 200);
  assert.deepEqual(await (await send('GET', '/api/reconnect')).json(), []);
  assert.equal((await send('POST', '/api/reconnect', {})).status, 405);
});
