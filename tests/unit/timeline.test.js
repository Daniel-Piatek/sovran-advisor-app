// The Timeline (timeline.js, advanced/people/2): one stream read from the tables that keep
// notes, journal entries, finished tasks, events and captures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { createNote, deleteNote } from '../../notes.js';
import { createPerson, createCompany, updatePerson } from '../../people.js';
import { createEntry } from '../../entries.js';
import { createTask, changeTask, deleteTask } from '../../tasks.js';
import { createEvent } from '../../events.js';
import { createCapture } from '../../captures.js';
import { timeline, localSecond, compareRows } from '../../timeline.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
// A fixed "now": noon on 8 Nov 2026 (the owner's local time).
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const stamp = (db, table, column, id, hour, minute = 0) => {
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(new Date(2026, 10, 8, hour, minute, 0).toISOString(), id);
};
const keys = (answer) => answer.items.map((i) => `${i.kind}:${i.text}`);

test('every kind is in one stream, newest first, read from the tables that keep it', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Onboarding call with Lena', body: 'Lena starts Monday.' });
  const entry = createEntry(db, { body: 'Morning pages about the proposal.' });
  const done = createTask(db, { text: 'Send the proposal' });
  changeTask(db, done.id, { done: true });
  createTask(db, { text: 'Still open' });
  const capture = createCapture(db, { body: 'Ask Jonas about the venue\nand the dates' });
  stamp(db, 'notes', 'updated_at', note.id, 9, 12);
  stamp(db, 'journal_entries', 'written_at', entry.id, 8, 30);
  stamp(db, 'tasks', 'done_at', done.id, 10, 5);
  stamp(db, 'captures', 'captured_at', capture.id, 11, 40);
  createEvent(db, { title: 'Proposal review', starts_at: '2026-11-08T08:00', ends_at: '2026-11-08T09:00' });
  createEvent(db, { title: 'Lunch with Marta', starts_at: '2026-11-08T12:30', ends_at: '2026-11-08T13:30' }); // still ahead today
  createEvent(db, { title: 'Tomorrow’s workshop', starts_at: '2026-11-09T10:00', ends_at: '2026-11-09T11:00' }); // not today: not on the line
  const answer = timeline(db, { now: NOW });
  assert.deepEqual(keys(answer), [
    'event:Lunch with Marta', 'capture:Ask Jonas about the venue', 'task:Send the proposal',
    'note:Onboarding call with Lena', 'entry:Morning pages about the proposal.', 'event:Proposal review',
  ]);
  assert.equal(answer.more, false);
  const [lunch, cap, task, noteRow, entryRow] = answer.items;
  assert.equal(lunch.at, '2026-11-08T12:30:00.000');
  assert.equal(cap.at, '2026-11-08T11:40:00.000');
  assert.deepEqual([task.href, noteRow.href, entryRow.href, cap.href], ['/tasks', `/notes/${note.id}`, `/journal/entries/${entry.id}`, '/inbox']);
  assert.deepEqual([lunch.where, cap.where, task.where, noteRow.where, entryRow.where], ['Event', 'Capture', 'Task done', 'Note', 'Journal']);
});

test('a task done in a note opens that note; deleted things and open tasks are not on the line', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Plan', body: '- [ ] Call the bank' });
  const gone = createNote(db, { title: 'Thrown away' });
  deleteNote(db, gone.id);
  const own = createTask(db, { text: 'Own task' });
  deleteTask(db, own.id);
  assert.deepEqual(keys(timeline(db, { now: new Date() })), ['note:Plan']);
  const [task] = db.prepare('SELECT id FROM tasks WHERE source_kind = ?').all('note');
  changeTask(db, task.id, { done: true });
  db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(new Date().toISOString(), task.id);
  assert.equal(timeline(db, { now: new Date() }).items.find((i) => i.kind === 'task').href, `/notes/${note.id}`);
});

test('kinds switch rows on and off, and a search keeps the rows that hold every word', () => {
  const db = emptyDb();
  createNote(db, { title: 'Onboarding call', body: 'with Lena Fischer' });
  createNote(db, { title: 'Groceries', body: 'milk' });
  createCapture(db, { body: 'Lena asked about 100% of the budget' });
  createEntry(db, { body: 'Walked home.' });
  const all = (opts) => keys(timeline(db, { now: new Date(), ...opts })).sort();
  assert.deepEqual(all({ kinds: ['capture'] }), ['capture:Lena asked about 100% of the budget']);
  assert.deepEqual(all({ kinds: ['note', 'entry'] }), ['entry:Walked home.', 'note:Groceries', 'note:Onboarding call']);
  assert.deepEqual(all({ kinds: [] }), []);
  assert.deepEqual(all({ q: 'lena' }), ['capture:Lena asked about 100% of the budget', 'note:Onboarding call']);
  assert.deepEqual(all({ q: 'lena fischer' }), ['note:Onboarding call'], 'every word, anywhere in the row');
  assert.deepEqual(all({ q: 'LENA', kinds: ['capture'] }), ['capture:Lena asked about 100% of the budget'], 'case is ignored; kinds and search together');
  assert.deepEqual(all({ q: '100%' }), ['capture:Lena asked about 100% of the budget'], '% is a letter');
  assert.deepEqual(all({ q: '%' }), ['capture:Lena asked about 100% of the budget']);
  assert.deepEqual(all({ q: 'nothing like this' }), []);
});

test('going further back with before leaves no row out, and none twice', () => {
  const db = emptyDb();
  const made = [];
  for (let i = 0; i < 7; i++) {
    const note = createNote(db, { title: `Note ${i}` });
    // Two of them in the very same second, a few milliseconds apart.
    const when = new Date(2026, 10, 8, 9, 0, Math.floor(i / 2), (i % 2) * 400);
    db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(when.toISOString(), note.id);
    made.push(note.title);
  }
  const seen = [];
  let before = '';
  for (let guard = 0; guard < 10; guard++) {
    const page = timeline(db, { now: NOW, limit: 3, before });
    for (const item of page.items) if (!seen.includes(item.text)) seen.push(item.text);
    if (!page.more) break;
    before = page.items.at(-1).at;
  }
  assert.deepEqual([...seen].sort(), [...made].sort());
});

test('the time is the owner’s own', () => {
  assert.equal(localSecond(new Date(2026, 10, 8, 7, 5, 9, 42).toISOString()), '2026-11-08T07:05:09.042');
});

test('the Timeline API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = (query = '') => fetch(`${app.url}/api/timeline${query}`);
  await fetch(`${app.url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'A note' }) });
  const answer = await (await get()).json();
  assert.deepEqual(answer.items.map((i) => [i.kind, i.text]), [['note', 'A note']]);
  assert.deepEqual((await (await get('?kinds=capture')).json()).items, []);
  assert.equal((await (await get('?q=zzz')).json()).items.length, 0);
  for (const bad of ['?kinds=mail', '?before=yesterday', '?limit=0', '?limit=5000', '?limit=x']) assert.equal((await get(bad)).status, 400, bad);
  assert.equal((await fetch(`${app.url}/api/timeline`, { method: 'POST' })).status, 405);
});

test('one person’s Timeline: what links to them, their tasks, and a company also gets its people’s rows, marked', () => {
  const db = emptyDb();
  const nord = createCompany(db, { name: 'Nordlicht Studio' });
  const lena = createPerson(db, { name: 'Lena Fischer', company_id: nord.id });
  const jonas = createPerson(db, { name: 'Jonas Berg' });
  const link = (p) => `[${p.name}](/people/${p.id})`;
  const done = (task) => { changeTask(db, task.id, { done: true }); db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(new Date().toISOString(), task.id); };

  createNote(db, { title: 'Onboarding', body: `Call with ${link(lena)}.` });
  createEntry(db, { body: `Met ${link(lena)} for coffee.` });
  createNote(db, { title: 'Jonas only', body: `Ask ${link(jonas)}.` });
  createNote(db, { title: 'Unrelated', body: 'Nothing here.' });
  createNote(db, { title: 'About the studio', body: `Notes on [${nord.name}](/companies/${nord.id}).` });
  done(createTask(db, { text: 'Send Lena Fischer the intake form', mentions: [{ kind: 'person', id: lena.id }] }));
  done(createTask(db, { text: 'Ring Jonas Berg', mentions: [{ kind: 'person', id: jonas.id }] }));
  createNote(db, { title: 'Plan', body: `Meeting with ${link(lena)}\n- [ ] Prepare the offer for Lena Fischer\n- [ ] Book the room` });
  for (const t of db.prepare("SELECT id FROM tasks WHERE source_kind = 'note'").all()) done(t);
  updatePerson(db, lena.id, { body: '- [ ] Ask about her holiday' }); // a task written in her own notes
  for (const t of db.prepare("SELECT id FROM tasks WHERE source_kind = 'person'").all()) done(t);

  const about = (kind, id, opts = {}) => timeline(db, { now: new Date(), about: { kind, id }, ...opts });
  const texts = (answer) => answer.items.map((i) => i.text).sort();
  assert.deepEqual(texts(about('person', lena.id)), [
    'Ask about her holiday', 'Met Lena Fischer for coffee.', 'Onboarding', 'Plan', 'Prepare the offer for Lena Fischer', 'Send Lena Fischer the intake form',
  ]);
  assert.deepEqual(texts(about('person', jonas.id)), ['Jonas only', 'Ring Jonas Berg']);
  // Events and captures have nothing to follow, so they are not in a person's Timeline.
  createCapture(db, { body: 'Lena Fischer called' });
  assert.equal(about('person', lena.id).items.some((i) => i.kind === 'capture'), false);
  assert.deepEqual(about('person', lena.id, { kinds: ['capture', 'event'] }).items, []);
  // Narrowing and searching still work inside it.
  assert.deepEqual(texts(about('person', lena.id, { kinds: ['task'] })), ['Ask about her holiday', 'Prepare the offer for Lena Fischer', 'Send Lena Fischer the intake form']);
  assert.deepEqual(texts(about('person', lena.id, { q: 'coffee' })), ['Met Lena Fischer for coffee.']);
  // The company: its own rows unmarked, its people's marked with the person, others' left out.
  const company = about('company', nord.id).items;
  assert.equal(company.find((i) => i.text === 'About the studio').via, undefined);
  assert.deepEqual(company.find((i) => i.text === 'Onboarding').via, { id: lena.id, name: 'Lena Fischer' });
  assert.equal(company.some((i) => i.text === 'Jonas only' || i.text === 'Ring Jonas Berg' || i.text === 'Unrelated'), false);
  assert.equal(company.length, 7, 'the studio’s note and Lena’s six');
  // Every row of a person's Timeline is a row of the big one.
  const big = new Set(timeline(db, { now: new Date(), limit: 200 }).items.map((i) => `${i.kind}:${i.id}`));
  for (const i of about('person', lena.id).items) assert.ok(big.has(`${i.kind}:${i.id}`), i.text);
  // Someone who is not there has nothing; a deleted person too.
  assert.deepEqual(about('person', '11111111-1111-1111-1111-111111111111').items, []);
});

test('the Timeline API takes about=person:<id>', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-about-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = (url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const lena = await post('/api/people', { name: 'Lena Fischer' });
  await post('/api/notes', { title: 'Call', body: `Rang [Lena Fischer](/people/${lena.id}).` });
  await post('/api/notes', { title: 'Other' });
  const answer = await (await fetch(`${app.url}/api/timeline?about=person:${lena.id}`)).json();
  assert.deepEqual(answer.items.map((i) => i.text), ['Call']);
  for (const bad of ['about=note:x', 'about=person:nope', 'about=person']) assert.equal((await fetch(`${app.url}/api/timeline?${bad}`)).status, 400, bad);
});

test('rows of the same second always come in the same order: newer first, then by kind, then by id', () => {
  const rows = [
    { at: '2026-11-09T10:00:00', kind: 'task', id: 'b' }, { at: '2026-11-09T10:00:00', kind: 'note', id: 'z' },
    { at: '2026-11-09T10:00:01', kind: 'task', id: 'a' }, { at: '2026-11-09T10:00:00', kind: 'note', id: 'a' },
  ];
  const expected = ['2026-11-09T10:00:01 task a', '2026-11-09T10:00:00 note a', '2026-11-09T10:00:00 note z', '2026-11-09T10:00:00 task b'];
  const order = (list) => [...list].sort(compareRows).map((r) => `${r.at} ${r.kind} ${r.id}`);
  assert.deepEqual(order(rows), expected);
  assert.deepEqual(order([...rows].reverse()), expected);
  for (const a of rows) for (const b of rows) assert.equal(compareRows(a, b), 0 - compareRows(b, a), 'the same answer both ways round');
});
