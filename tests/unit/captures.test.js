// Quick capture and the Inbox (captures.js) and its API, each with an empty database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, getNote, listNotes } from '../../notes.js';
import { getEntry, entriesOfDay, localDay } from '../../entries.js';
import {
  createCapture, waitingCaptures, waitingCount, sortCapture, letGo, undoCapture, updateCapture, noteFromCapture,
  listDeletedCaptures, getCapture, homeOf, snoozeCapture, snoozedCaptures, setWorld,
} from '../../captures.js';
import { firstUrl, titleOfHtml, isPrivateAddress, readLink } from '../../link-titles.js';
import { createLifeItem } from '../../life.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a capture keeps the thought and its time, and waits in the Inbox, oldest first', async () => {
  const db = emptyDb();
  const first = createCapture(db, { body: 'Ask Z about March' });
  await tick();
  createCapture(db, { body: 'Book idea' });
  assert.equal(first.state, 'waiting');
  assert.ok(first.captured_at);
  assert.deepEqual(waitingCaptures(db).map((c) => c.body), ['Ask Z about March', 'Book idea']);
  assert.equal(waitingCount(db), 2);
  assert.throws(() => createCapture(db, { body: '   ' }), (err) => err.status === 400);
});

test('J: into today\'s journal, remembering the capture', () => {
  const db = emptyDb();
  const capture = createCapture(db, { body: 'Walked by the harbour' });
  const { made } = sortCapture(db, capture.id, { to: 'journal' });
  assert.equal(made.kind, 'entry');
  const entry = getEntry(db, made.id);
  assert.deepEqual([entry.day, entry.body, entry.origin, entry.capture_id, entry.journal_name],
    [localDay(), 'Walked by the harbour', 'captured', capture.id, 'General']);
  assert.equal(waitingCount(db), 0);
  assert.deepEqual([getCapture(db, capture.id).sorted_into, getCapture(db, capture.id).sorted_id], ['journal', entry.id]);
  assert.throws(() => sortCapture(db, capture.id, { to: 'done' }), (err) => err.status === 409, 'sorted only once');
});

test('N: a new note, its first line the title', () => {
  const db = emptyDb();
  const capture = createCapture(db, { body: '**Pricing** idea\nOne price first.\nThen see.' });
  const { made } = sortCapture(db, capture.id, { to: 'note' });
  const note = getNote(db, made.id);
  assert.deepEqual([note.title, note.body, note.origin, note.capture_id], ['Pricing idea', 'One price first.\nThen see.', 'captured', capture.id]);
  assert.deepEqual(noteFromCapture('# Heading\n\nrest'), { title: 'Heading', body: 'rest' });
  assert.deepEqual(noteFromCapture('just one line'), { title: 'just one line', body: '' });
});

test('N with a note picked: added to the end of that note', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Workshop', body: 'Existing text.' });
  const capture = createCapture(db, { body: 'Ask about the room' });
  sortCapture(db, capture.id, { to: 'note', note_id: note.id });
  assert.equal(getNote(db, note.id).body, 'Existing text.\n\nAsk about the room');
  assert.equal(listNotes(db).length, 1);
});

test('D: done, nothing made; Backspace: let go, into Recently deleted', () => {
  const db = emptyDb();
  const done = createCapture(db, { body: 'Already did it' });
  const gone = createCapture(db, { body: 'Not needed' });
  sortCapture(db, done.id, { to: 'done' });
  letGo(db, gone.id);
  assert.equal(waitingCount(db), 0);
  assert.equal(getCapture(db, done.id).state, 'done');
  assert.deepEqual(listDeletedCaptures(db).map((c) => c.id), [gone.id]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 2, 'nothing removed');
});

test('every decision can be undone: the capture waits again, and what was made is taken back', () => {
  const db = emptyDb();
  const toJournal = createCapture(db, { body: 'one' });
  const toNote = createCapture(db, { body: 'two' });
  const note = createNote(db, { title: 'Existing', body: 'Before.' });
  const toExisting = createCapture(db, { body: 'three' });
  const done = createCapture(db, { body: 'four' });
  const gone = createCapture(db, { body: 'five' });

  const entry = sortCapture(db, toJournal.id, { to: 'journal' }).made;
  const newNote = sortCapture(db, toNote.id, { to: 'note' }).made;
  sortCapture(db, toExisting.id, { to: 'note', note_id: note.id });
  sortCapture(db, done.id, { to: 'done' });
  letGo(db, gone.id);
  assert.equal(waitingCount(db), 0);

  for (const capture of [toJournal, toNote, toExisting, done, gone]) undoCapture(db, capture.id);
  assert.deepEqual(waitingCaptures(db).map((c) => c.body), ['one', 'two', 'three', 'four', 'five']);
  assert.equal(getEntry(db, entry.id), null, 'the journal entry is taken back');
  assert.deepEqual(entriesOfDay(db, localDay()), []);
  assert.equal(getNote(db, newNote.id), null, 'the new note is taken back');
  assert.equal(getNote(db, note.id).body, 'Before.', 'the added text is taken out again');
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 2, 'taken back means deleted, not removed');
});

test('undo leaves a note alone if it was changed since', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Existing', body: 'Before.' });
  const capture = createCapture(db, { body: 'added' });
  sortCapture(db, capture.id, { to: 'note', note_id: note.id });
  db.prepare("UPDATE notes SET body = 'Rewritten by hand' WHERE id = ?").run(note.id);
  undoCapture(db, capture.id);
  assert.equal(getNote(db, note.id).body, 'Rewritten by hand');
  assert.equal(waitingCount(db), 1);
});

test('a waiting capture can be edited', () => {
  const db = emptyDb();
  const capture = createCapture(db, { body: 'tpyo' });
  assert.equal(updateCapture(db, capture.id, { body: 'typo' }).body, 'typo');
});

test('the captures API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = async (url) => (await fetch(app.url + url)).json();
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  const made = await (await send('POST', '/api/captures', { body: 'Ask Z' })).json();
  await send('POST', '/api/captures', { body: 'Second' });
  assert.equal((await get('/api/captures/count')).waiting, 2);
  assert.deepEqual((await get('/api/captures')).map((c) => c.body), ['Ask Z', 'Second']);
  assert.equal((await send('POST', '/api/captures', { body: '' })).status, 400);

  const sorted = await (await send('POST', `/api/captures/${made.id}/sort`, { to: 'journal' })).json();
  assert.equal(sorted.made.kind, 'entry');
  assert.equal((await get('/api/captures/count')).waiting, 1);
  assert.equal((await send('POST', `/api/captures/${made.id}/sort`, { to: 'note' })).status, 409);
  await send('POST', `/api/captures/${made.id}/undo`, {});
  assert.equal((await get('/api/captures/count')).waiting, 2);

  assert.equal((await send('DELETE', `/api/captures/${made.id}`)).status, 200);
  assert.deepEqual((await get('/api/captures?deleted=1')).map((c) => c.id), [made.id]);
  assert.equal((await send('POST', `/api/captures/${made.id}/sort`, { to: 'nowhere' })).status, 404, 'let go: not waiting');
  assert.equal((await send('POST', '/api/captures/00000000-0000-0000-0000-000000000000/sort', { to: 'done' })).status, 404);
});

// ---- A capture becomes a task (tasks/3) ----

import { listTasks } from '../../tasks.js';

test('a capture becomes a task with its day; it remembers the capture; Undo takes the task away', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const capture = createCapture(db, { body: 'Book the train to Hamburg\n\nthe early one' });
  const { made } = sortCapture(db, capture.id, { to: 'task', task: { text: 'Book the train to Hamburg', due: '2026-10-26', flag: 'must' } });
  assert.deepEqual([made.kind, made.text, made.due, made.flag, made.capture.body], ['task', 'Book the train to Hamburg', '2026-10-26', 'must', 'Book the train to Hamburg\n\nthe early one']);
  assert.equal(getCapture(db, capture.id).sorted_into, 'task');
  assert.equal(waitingCaptures(db).length, 0);
  assert.equal(listTasks(db, { done: false }).length, 1);
  undoCapture(db, capture.id);
  assert.equal(listTasks(db, { done: false }).length, 0);
  assert.equal(waitingCaptures(db).length, 1);
});

test('an older database keeps every capture and lets captures become tasks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-old-'));
  let db = openDatabase(dir);
  const kept = createCapture(db, { body: 'Kept thought' });
  sortCapture(db, createCapture(db, { body: 'To the journal' }).id, { to: 'journal' });
  // The shape before: sorted_into could only be journal or note.
  db.exec(`DROP INDEX captures_waiting; ALTER TABLE captures RENAME TO c_new;
    CREATE TABLE captures (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'typed', body TEXT NOT NULL DEFAULT '', captured_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'waiting', sorted_at TEXT, sorted_into TEXT CHECK (sorted_into IN ('journal', 'note')),
      sorted_id TEXT, sorted_note_body TEXT);
    INSERT INTO captures SELECT id, created_at, updated_at, deleted_at, origin, body, captured_at, state, sorted_at, sorted_into, sorted_id, sorted_note_body FROM c_new; DROP TABLE c_new; ALTER TABLE tasks DROP COLUMN capture_id;
    PRAGMA user_version = 10;`);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 2);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'captures_waiting'").get(), 'index kept');
  sortCapture(db, kept.id, { to: 'task', task: { text: 'Kept thought' } });
  assert.equal(getCapture(db, kept.id).sorted_into, 'task');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a capture can be given a home in My Life; a task or note made from it starts there', () => {
  const db = emptyDb();
  const goal = createLifeItem(db, { kind: 'goal', title: 'Save for the trip' });
  const one = createCapture(db, { body: 'pay the deposit' });
  assert.equal(one.home_id, null);
  assert.equal(homeOf(db, one), null);
  assert.equal(updateCapture(db, one.id, { home_id: goal.id }).home_id, goal.id);
  assert.deepEqual(homeOf(db, getCapture(db, one.id)), { id: goal.id, kind: 'goal', title: 'Save for the trip' });
  assert.throws(() => updateCapture(db, one.id, { home_id: 'nope' }), (err) => err.status === 400);
  // Changing only the home leaves the words alone.
  assert.equal(getCapture(db, one.id).body, 'pay the deposit');
  const task = sortCapture(db, one.id, { to: 'task', task: { text: 'Pay the deposit' } }).made;
  assert.equal(listTasks(db, { home: goal.id }).some((t) => t.id === task.id), true);

  const two = createCapture(db, { body: 'Trip ideas\nA list.' });
  updateCapture(db, two.id, { home_id: goal.id });
  const note = sortCapture(db, two.id, { to: 'note' }).made;
  assert.equal(getNote(db, note.id).home.id, goal.id);

  // "No home" sent with the task wins over the capture's home; null clears it.
  const three = createCapture(db, { body: 'no home please' });
  updateCapture(db, three.id, { home_id: goal.id });
  const bare = sortCapture(db, three.id, { to: 'task', task: { text: 'No home please', home_id: null } }).made;
  assert.equal(listTasks(db, { home: goal.id }).some((t) => t.id === bare.id), false);
  const four = createCapture(db, { body: 'clear it' });
  updateCapture(db, four.id, { home_id: goal.id });
  assert.equal(updateCapture(db, four.id, { home_id: null }).home_id, null);
  db.close();
});

test('a database from before capture homes gets home_id, every capture kept, and a read one starts at its suggested home', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-v27-'));
  let db = openDatabase(dir);
  const goal = createLifeItem(db, { kind: 'goal', title: 'Save for the trip' });
  const read = createCapture(db, { body: 'book the car' });
  const unread = createCapture(db, { body: 'something else' });
  db.prepare(`INSERT INTO capture_suggestions (id, created_at, updated_at, capture_id, state, kind, home_id, connects)
    VALUES ('s1', 'x', 'x', ?, 'ready', 'task', ?, '[]')`).run(read.id, goal.id);
  db.exec('ALTER TABLE captures DROP COLUMN home_id; PRAGMA user_version = 27;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(waitingCaptures(db).map((c) => [c.body, c.home_id]), [['book the car', goal.id], ['something else', null]]);
  assert.equal(getCapture(db, unread.id).body, 'something else');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a capture can become a journal entry on another day, with its words changed on the way; a bad day is refused', () => {
  const db = emptyDb();
  const past = createCapture(db, { body: 'Walked by the harbour' });
  const made = sortCapture(db, past.id, { to: 'journal', day: '2026-10-20' }).made;
  assert.equal(made.day, '2026-10-20');
  assert.deepEqual([made.body, made.origin, made.capture_id], ['Walked by the harbour', 'captured', past.id]);
  assert.equal(entriesOfDay(db, '2026-10-20').length, 1);
  assert.equal(entriesOfDay(db, localDay()).length, 0);
  // Undo takes the entry away again, and the capture waits.
  undoCapture(db, past.id);
  assert.equal(entriesOfDay(db, '2026-10-20').length, 0);
  assert.equal(waitingCaptures(db).length, 1);

  const future = sortCapture(db, past.id, { to: 'journal', day: '2027-01-02', body: 'Walked by the harbour, in the rain' }).made;
  assert.deepEqual([future.day, future.body], ['2027-01-02', 'Walked by the harbour, in the rain']);
  undoCapture(db, past.id);

  // No day: today, exactly as before.
  assert.equal(sortCapture(db, past.id, { to: 'journal' }).made.day, localDay());
  undoCapture(db, past.id);
  for (const day of ['tomorrow', '2026-02-31', '', 5]) {
    assert.throws(() => sortCapture(db, past.id, { to: 'journal', day }), (err) => err.status === 400, String(day));
  }
  assert.throws(() => sortCapture(db, past.id, { to: 'journal', body: '   ' }), (err) => err.status === 400);
  assert.equal(waitingCaptures(db).length, 1, 'nothing was made');
  db.close();
});

test('Snooze: a capture leaves the Inbox, comes back at its time, and Undo wakes it', () => {
  const db = emptyDb();
  const one = createCapture(db, { body: 'later' });
  createCapture(db, { body: 'now' });
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
  assert.equal(snoozeCapture(db, one.id, tomorrow).snoozed_until, tomorrow);
  assert.deepEqual(waitingCaptures(db).map((c) => c.body), ['now']);
  assert.equal(waitingCount(db), 1);
  assert.deepEqual(snoozedCaptures(db).map((c) => c.body), ['later']);
  // Its time comes: it is back by itself, nothing changed on it.
  snoozeCapture(db, one.id, new Date(Date.now() - 1000).toISOString());
  assert.equal(waitingCount(db), 2);
  assert.equal(snoozedCaptures(db).length, 0);
  // Undo wakes a sleeping one at once.
  snoozeCapture(db, one.id, tomorrow);
  assert.equal(undoCapture(db, one.id).snoozed_until, null);
  assert.equal(waitingCount(db), 2);
  assert.equal(snoozeCapture(db, 'nope', tomorrow), null);
});

test('an older database (before Snooze) keeps every capture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-snooze-'));
  let db = openDatabase(dir);
  createCapture(db, { body: 'Kept thought' });
  db.exec('ALTER TABLE captures DROP COLUMN snoozed_until; PRAGMA user_version = 28;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(waitingCaptures(db).map((c) => [c.body, c.snoozed_until]), [['Kept thought', null]]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('worlds: a capture is Inner (the default) or Outer, and can be moved', () => {
  const db = emptyDb();
  const mine = createCapture(db, { body: 'my thought' });
  const theirs = createCapture(db, { body: 'https://example.com/a', world: 'outer' });
  assert.deepEqual([mine.world, theirs.world], ['inner', 'outer']);
  assert.equal(setWorld(db, mine.id, 'outer').world, 'outer');
  assert.equal(setWorld(db, 'nope', 'inner'), null);
  assert.throws(() => db.prepare("UPDATE captures SET world = 'sideways' WHERE id = ?").run(mine.id));
});

test('a pasted link: its first web address and its page title are kept; a page that cannot be read leaves the capture alone', async () => {
  assert.equal(firstUrl('read https://example.com/a, then more'), 'https://example.com/a');
  assert.equal(firstUrl('no link here'), null);
  assert.equal(titleOfHtml('<head><TITLE>\n Tom &amp; Jerry &#8211; a  page </TITLE>'), 'Tom & Jerry – a page');
  assert.equal(titleOfHtml('<p>no title</p>'), '');
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.1.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivateAddress(address), false, address);
  const db = emptyDb();
  const linked = createCapture(db, { body: 'see https://example.com/a' });
  await readLink(db, linked.id, { fetcher: async () => 'Example' });
  assert.deepEqual([getCapture(db, linked.id).link_url, getCapture(db, linked.id).link_title], ['https://example.com/a', 'Example']);
  const broken = createCapture(db, { body: 'https://nowhere.invalid/' });
  await readLink(db, broken.id, { fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual([getCapture(db, broken.id).link_url, getCapture(db, broken.id).link_title], ['https://nowhere.invalid/', null]);
});

test('an older database (before worlds) keeps every capture as Inner World', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-world-'));
  let db = openDatabase(dir);
  createCapture(db, { body: 'Kept thought' });
  db.exec('ALTER TABLE captures DROP COLUMN world; ALTER TABLE captures DROP COLUMN link_url; ALTER TABLE captures DROP COLUMN link_title; PRAGMA user_version = 29;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(waitingCaptures(db).map((c) => [c.body, c.world, c.link_title]), [['Kept thought', 'inner', null]]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
