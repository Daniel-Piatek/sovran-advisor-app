// Tasks inside notes (tasks.js): task lines kept as rows, due dates, ticking from either
// side, and the API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, getNote, updateNote, deleteNote, restoreNote } from '../../notes.js';
import { createEntry } from '../../entries.js';
import { createPerson } from '../../people.js';
import { extractTasks, listTasks, changeTask, getTask } from '../../tasks.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const open = (db) => listTasks(db, { done: false });

test('task lines are found with their date and words', () => {
  assert.deepEqual(extractTasks('Next steps\n- [ ] Call the bank @2026-10-30\n  * [x] Book the room\n- not a task\n[ ] no list sign'), [
    { line: 1, done: false, due: '2026-10-30', estimate: null, text: 'Call the bank' },
    { line: 2, done: true, due: '', estimate: null, text: 'Book the room' },
  ]);
  assert.deepEqual(extractTasks('1. [ ] First\n2. [x] Second').map((t) => t.text), ['First', 'Second']);
  assert.equal(extractTasks('- [ ] Ask [Lena](/people/11111111-1111-1111-1111-111111111111) about **March**')[0].text, 'Ask Lena about March');
});

test('a note’s task lines are rows; an edit keeps a task’s id, a line taken away takes it off', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Call', body: '- [ ] Send the proposal @2026-10-30\n- [ ] Call the bank' });
  const [send, bank] = open(db);
  assert.deepEqual([send.text, send.due, send.source.title, bank.due], ['Send the proposal', '2026-10-30', 'Call', '']);
  updateNote(db, note.id, { body: 'Intro\n\n- [ ] Call the bank\n- [ ] Send the proposal @2026-10-30\n- [ ] New one' });
  assert.deepEqual(open(db).map((t) => t.id).slice(0, 2), [send.id, bank.id], 'moved lines keep their ids');
  updateNote(db, note.id, { body: '- [ ] Call the bank today\n- [x] Send the proposal @2026-10-30' });
  const now = listTasks(db);
  assert.equal(now.find((t) => t.id === send.id).done, true);
  assert.equal(now.find((t) => t.id === bank.id).text, 'Call the bank today', 'a task edited in place keeps its id');
  assert.equal(now.length, 2);
});

test('a task in a journal entry is due that day unless it says otherwise', () => {
  const db = emptyDb();
  createEntry(db, { day: '2026-10-20', body: '- [ ] Renew the insurance\n- [ ] Pay the invoice @2026-11-02' });
  assert.deepEqual(open(db).map((t) => [t.text, t.due, t.source.kind, t.source.day]),
    [['Renew the insurance', '2026-10-20', 'entry', '2026-10-20'], ['Pay the invoice', '2026-11-02', 'entry', '2026-10-20']]);
});

test('ticking from the Tasks page ticks the line in the note, and the date can change', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena', body: 'Notes\n- [ ] Ask about March\n- [ ] Send the deck' });
  const [ask] = open(db);
  assert.equal(changeTask(db, ask.id, { done: true }).done, true);
  assert.equal(db.prepare('SELECT body FROM people WHERE id = ?').get(lena.id).body, 'Notes\n- [x] Ask about March\n- [ ] Send the deck');
  changeTask(db, ask.id, { done: false, due: '2026-11-03' });
  assert.equal(db.prepare('SELECT body FROM people WHERE id = ?').get(lena.id).body, 'Notes\n- [ ] Ask about March @2026-11-03\n- [ ] Send the deck');
  changeTask(db, ask.id, { due: '' });
  assert.equal(open(db).find((t) => t.id === ask.id).due, '');
});

test('a task whose line changed meanwhile is not ticked blindly', () => {
  const db = emptyDb();
  const note = createNote(db, { body: '- [ ] One' });
  const [one] = open(db);
  db.prepare("UPDATE notes SET body = '- [ ] Something else' WHERE id = ?").run(note.id); // changed without a sync
  assert.throws(() => changeTask(db, one.id, { done: true }), (err) => err.status === 409);
  assert.equal(getNote(db, note.id).body, '- [ ] Something else');
});

test('a deleted note’s tasks leave the list, and come back with it', () => {
  const db = emptyDb();
  const note = createNote(db, { body: '- [ ] One' });
  deleteNote(db, note.id);
  assert.equal(open(db).length, 0);
  restoreNote(db, note.id);
  assert.equal(open(db).length, 1);
});

test('an older database gets tasks from the task lines already written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-old-'));
  let db = openDatabase(dir);
  createNote(db, { title: 'Old', body: '- [ ] Written before tasks' });
  db.exec('DROP TABLE tasks; PRAGMA user_version = 8;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(open(db).map((t) => t.text), ['Written before tasks']);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the tasks API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const note = await (await send('POST', '/api/notes', { title: 'Plan', body: '- [ ] Call the bank @2026-10-30' })).json();
  const [task] = await (await fetch(`${app.url}/api/tasks`)).json();
  assert.deepEqual([task.text, task.due, task.source.path], ['Call the bank', '2026-10-30', `/notes/${note.id}`]);
  assert.equal((await send('PATCH', `/api/tasks/${task.id}`, { done: 'yes' })).status, 400);
  assert.equal((await send('PATCH', `/api/tasks/${task.id}`, { due: 'friday' })).status, 400);
  assert.equal((await (await send('PATCH', `/api/tasks/${task.id}`, { done: true })).json()).done, true);
  assert.deepEqual(await (await fetch(`${app.url}/api/tasks`)).json(), []);
  assert.equal((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body, '- [x] Call the bank @2026-10-30');
});

// ---- The Tasks app (tasks/2) ----

import { createTask, deleteTask, restoreTask, dueReminders, changeReminder, listReminders, localMinute, localDay } from '../../tasks.js';
import { setModule } from '../../modules.js';
import { createLifeItem } from '../../life.js';

test('a task of its own, with a day, flag, estimate and home; edited and deleted with undo', () => {
  const db = emptyDb();
  const workshop = createLifeItem(db, { kind: 'project', title: 'Autumn workshop' });
  const task = createTask(db, { text: ' call the dentist ', due: '2026-10-26', flag: 'must', estimate: 10, home_id: workshop.id });
  assert.deepEqual([task.text, task.due, task.flag, task.estimate, task.home.title, task.source.kind],
    ['call the dentist', '2026-10-26', 'must', 10, 'Autumn workshop', 'own']);
  assert.equal(changeTask(db, task.id, { text: 'call the dentist back', flag: 'like', due: 'someday' }).due, 'someday');
  assert.equal(changeTask(db, task.id, { done: true }).done, true);
  assert.deepEqual(listTasks(db, { done: true }).map((t) => t.text), ['call the dentist back']);
  deleteTask(db, task.id);
  assert.equal(listTasks(db).length, 0);
  restoreTask(db, task.id);
  assert.equal(listTasks(db).length, 1);
  assert.throws(() => createTask(db, { text: 'x', home_id: '00000000-0000-0000-0000-000000000000' }), (err) => err.status === 400);
});

test('a task in a note: flag and home on the row, estimate and someday in its line, home from its note', () => {
  const db = emptyDb();
  const workshop = createLifeItem(db, { kind: 'project', title: 'Autumn workshop' });
  const pricing = createLifeItem(db, { kind: 'topic', title: 'Pricing' });
  const note = createNote(db, { body: '- [ ] Book the venue ~30m\n- [ ] Read about rates @someday' });
  updateNote(db, note.id, { home_id: workshop.id });
  const byText = (text) => open(db).find((t) => t.text === text);
  const [venue, rates] = [byText('Book the venue'), byText('Read about rates')];
  assert.deepEqual([venue.text, venue.estimate, venue.home.title, rates.due], ['Book the venue', 30, 'Autumn workshop', 'someday']);
  changeTask(db, venue.id, { flag: 'must', estimate: 45 });
  changeTask(db, rates.id, { home_id: pricing.id });
  assert.equal(getNote(db, note.id).body, '- [ ] Book the venue ~45m\n- [ ] Read about rates @someday');
  updateNote(db, note.id, { body: 'Plan\n\n- [ ] Book the venue ~45m\n- [ ] Read about rates @someday' });
  assert.deepEqual([byText('Book the venue').flag, byText('Read about rates').home.title], ['must', 'Pricing'], 'flag and home survive an edit');
  assert.deepEqual(listTasks(db, { home: workshop.id }).map((t) => t.text), ['Book the venue']);
  assert.throws(() => changeTask(db, venue.id, { text: 'other words' }), (err) => err.status === 400);
  assert.throws(() => deleteTask(db, venue.id), (err) => err.status === 400);
});

test('a task in a note or entry is put off to someday in its line, and moved back, the way a date is', () => {
  const db = emptyDb();
  const note = createNote(db, { body: '- [ ] Read about rates ~10m\n- [ ] Book the venue @2026-11-02' });
  const entry = createEntry(db, { day: '2026-10-20', body: '- [ ] Renew the pass' });
  const byText = (text) => open(db).find((t) => t.text === text);
  changeTask(db, byText('Read about rates').id, { due: 'someday' });
  changeTask(db, byText('Book the venue').id, { due: 'someday' });
  changeTask(db, byText('Renew the pass').id, { due: 'someday' });
  assert.equal(getNote(db, note.id).body, '- [ ] Read about rates ~10m @someday\n- [ ] Book the venue @someday');
  assert.equal(db.prepare('SELECT body FROM journal_entries WHERE id = ?').get(entry.id).body, '- [ ] Renew the pass @someday');
  assert.deepEqual(['Read about rates', 'Book the venue', 'Renew the pass'].map((t) => byText(t).due), ['someday', 'someday', 'someday']);
  // Back: a date replaces it; none takes the @ away (an entry's task is then of its entry's day).
  changeTask(db, byText('Book the venue').id, { due: '2026-11-02' });
  changeTask(db, byText('Read about rates').id, { due: '' });
  changeTask(db, byText('Renew the pass').id, { due: '' });
  assert.equal(getNote(db, note.id).body, '- [ ] Read about rates ~10m\n- [ ] Book the venue @2026-11-02');
  assert.equal(db.prepare('SELECT body FROM journal_entries WHERE id = ?').get(entry.id).body, '- [ ] Renew the pass');
  assert.equal(byText('Renew the pass').due, '2026-10-20');
});

test('a reminder comes due, snoozes, and is done when its task is', () => {
  const db = emptyDb();
  const task = createTask(db, { text: 'Call Lena', due: '2026-10-26', remind_time: '09:00' });
  assert.deepEqual(task.reminder.at, '2026-10-26T09:00');
  assert.equal(dueReminders(db, '2026-10-26T08:59').length, 0);
  const [due] = dueReminders(db, '2026-10-26T09:00');
  assert.equal(due.text, 'Call Lena');
  // Snoozed now, for ten minutes from now.
  const soon = createTask(db, { text: 'Stretch', due: '2020-01-01', remind_time: '08:00' });
  const [past] = dueReminders(db).filter((r) => r.task_id === soon.id);
  changeReminder(db, past.id, { snooze: 10 });
  assert.equal(dueReminders(db).filter((r) => r.task_id === soon.id).length, 0, 'snoozed');
  assert.equal(dueReminders(db, localMinute(new Date(Date.now() + 11 * 60_000))).filter((r) => r.task_id === soon.id).length, 1);
  changeTask(db, task.id, { done: true });
  assert.equal(dueReminders(db, '2030-01-01T00:00').filter((r) => r.task_id === task.id).length, 0, 'done with its task');
});

test('finishing a repeating task makes the next one, with its reminder', () => {
  const db = emptyDb();
  const plants = createTask(db, { text: 'water the plants', due: '2026-10-26', repeat: 'every monday', remind_time: '09:00', flag: 'like' });
  changeTask(db, plants.id, { done: true });
  const [next] = open(db);
  assert.deepEqual([next.text, next.due, next.repeat, next.flag, next.reminder.at], ['water the plants', '2026-11-02', 'every monday', 'like', '2026-11-02T09:00']);
  assert.notEqual(next.id, plants.id);
  changeTask(db, plants.id, { done: false });
  changeTask(db, plants.id, { done: true });
  assert.equal(open(db).length, 1, 'only the newest carries the repeat on');
});

test('the Tasks app API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-app-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const bad of [{}, { text: ' ' }, { text: 'x', due: 'friday' }, { text: 'x', flag: 'high' }, { text: 'x', estimate: -5 },
    { text: 'x', repeat: 'sometimes' }, { text: 'x', remind_time: '9am' }]) {
    assert.equal((await send('POST', '/api/tasks', bad)).status, 400, JSON.stringify(bad));
  }
  const task = await (await send('POST', '/api/tasks', { text: 'call the dentist', due: '2026-10-26', estimate: 10 })).json();
  assert.equal(task.estimate, 10);
  assert.equal((await (await send('PATCH', `/api/tasks/${task.id}`, { flag: 'must' })).json()).flag, 'must');
  assert.equal((await send('DELETE', `/api/tasks/${task.id}`)).status, 200);
  assert.deepEqual((await (await fetch(`${app.url}/api/tasks?deleted=1`)).json()).map((d) => d.text), ['call the dentist']);
  assert.equal((await send('POST', `/api/tasks/${task.id}/restore`, {})).status, 200);
  assert.equal((await (await fetch(`${app.url}/api/reminders/due`)).json()).length, 0);
});

test('Done ends the alarm and leaves the task open; tomorrow brings it back at the same time; ended alarms are listed', () => {
  const db = emptyDb();
  const a = createTask(db, { text: 'Send invoice 2026-118', due: '2020-01-01', remind_time: '14:00' });
  const b = createTask(db, { text: 'Call Lena', due: '2020-01-01', remind_time: '16:00' });
  assert.deepEqual(listReminders(db, { state: 'waiting' }).map((r) => [r.text, r.at.slice(11)]), [['Send invoice 2026-118', '14:00'], ['Call Lena', '16:00']]);
  assert.deepEqual(listReminders(db, { state: 'done' }), []);

  const [first] = dueReminders(db).filter((r) => r.task_id === a.id);
  changeReminder(db, first.id, { done: true });
  assert.equal(listTasks(db).some((t) => t.id === a.id), true, 'the task is still open');
  assert.equal(dueReminders(db).some((r) => r.task_id === a.id), false, 'the alarm is over');
  assert.deepEqual(listReminders(db, { state: 'done' }).map((r) => [r.text, r.state, r.task_done]), [['Send invoice 2026-118', 'done', false]]);

  const [second] = dueReminders(db).filter((r) => r.task_id === b.id);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const changed = changeReminder(db, second.id, { snooze: 'tomorrow' });
  assert.equal(changed.snoozed_until, `${localDay(tomorrow)}T16:00`);
  assert.equal(dueReminders(db).some((r) => r.task_id === b.id), false);
  assert.equal(dueReminders(db, `${localDay(tomorrow)}T16:00`).some((r) => r.task_id === b.id), true);
  const hour = changeReminder(db, second.id, { snooze: 60 });
  assert.equal(hour.snoozed_until, localMinute(new Date(Date.now() + 60 * 60_000)));
  assert.equal(changeReminder(db, '00000000-0000-0000-0000-000000000000', { done: true }), null);
});

test('finishing a repeating task writes only the next one; unticking it takes the next away again while it is open', () => {
  const db = emptyDb();
  const first = createTask(db, { text: 'Water the plants', due: '2026-11-02', repeat: 'every monday', estimate: 10, remind_time: '09:00' });
  const done = changeTask(db, first.id, { done: true });
  assert.deepEqual([done.done, done.repeat], [true, ''], 'the finished one stays done, and the rule moves on');
  const [next, ...others] = open(db).filter((t) => t.repeat_from === first.id);
  assert.equal(others.length, 0);
  assert.deepEqual([next.text, next.due, next.estimate, next.repeat, next.reminder.at], ['Water the plants', '2026-11-09', 10, 'every monday', '2026-11-09T09:00']);
  assert.equal(open(db).length, 1, 'never a pile of copies');

  // Unticked by mistake: the next one goes (marked deleted, never removed) and the rule comes back.
  const back = changeTask(db, first.id, { done: false });
  assert.equal(back.repeat, 'every monday');
  assert.equal(open(db).length, 1);
  assert.equal(open(db)[0].id, first.id);
  assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM tasks WHERE id = ?').get(next.id).gone, 1);

  // Ticked again, the next one is made again; once that one is done itself, unticking the first leaves it alone.
  changeTask(db, first.id, { done: true });
  const [again] = open(db);
  assert.notEqual(again.id, next.id);
  changeTask(db, again.id, { done: true });
  const afterThat = open(db).find((t) => t.repeat_from === again.id);
  changeTask(db, first.id, { done: false });
  assert.equal(getTask(db, again.id).done, true, 'a finished next one stays finished');
  assert.ok(afterThat && getTask(db, afterThat.id));
});

test('with Tasks in depth switched off a finished repeating task simply stays finished', () => {
  const db = emptyDb();
  setModule(db, 'tasks-plus', false);
  const task = createTask(db, { text: 'Weekly review', due: '2026-11-06', repeat: 'every friday' });
  const done = changeTask(db, task.id, { done: true });
  assert.deepEqual([done.done, done.repeat], [true, 'every friday'], 'the rule stays on it');
  assert.equal(open(db).length, 0);
  changeTask(db, task.id, { done: false });
  assert.equal(open(db).length, 1);
});

test('a database from before repeat_from gets the column, every task kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeat-old-'));
  let db = openDatabase(dir);
  createTask(db, { text: 'Keep me', due: '2026-11-06', repeat: 'every friday' });
  db.exec('ALTER TABLE tasks DROP COLUMN repeat_from; PRAGMA user_version = 39;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const [task] = listTasks(db);
  assert.deepEqual([task.text, task.repeat, task.repeat_from], ['Keep me', 'every friday', null]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
