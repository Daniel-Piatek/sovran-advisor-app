// The journal in the database (entries.js) and its API, each with an empty database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { getNote } from '../../notes.js';
import {
  localDay, isDay, generalJournal, listJournals, createJournal, deleteJournal, createEntry, getEntry,
  entriesOfDay, entriesBefore, entryDays, updateEntry, deleteEntry, restoreEntry, listDeletedEntries, searchEntries,
  checkEntryInput,
} from '../../entries.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('General is always there, once', () => {
  const db = emptyDb();
  assert.deepEqual(listJournals(db).map((j) => [j.name, j.is_general]), [['General', 1]]);
  prepareDatabase(db);
  assert.equal(listJournals(db).length, 1, 'opening again does not add a second General');
  assert.throws(() => deleteJournal(db, generalJournal(db).id), /can’t be deleted/);
});

test('own journals: added with a name, no two with the same name', () => {
  const db = emptyDb();
  createJournal(db, ' Health ');
  createJournal(db, 'Dreams');
  assert.deepEqual(listJournals(db).map((j) => j.name), ['General', 'Health', 'Dreams']);
  assert.throws(() => createJournal(db, 'health'), (err) => err.status === 409);
  assert.throws(() => createJournal(db, '  '), (err) => err.status === 400);
  assert.throws(() => createJournal(db, 'x'.repeat(61)), (err) => err.status === 400);
});

test('an entry goes into the chosen journal, or General, on the chosen day, or today', () => {
  const db = emptyDb();
  const health = createJournal(db, 'Health');
  const inGeneral = createEntry(db, { body: 'Call went well' });
  assert.equal(inGeneral.journal_name, 'General');
  assert.equal(inGeneral.day, localDay());
  assert.equal(inGeneral.origin, 'typed');
  const inHealth = createEntry(db, { journal_id: health.id, day: '2026-10-24', title: 'Walk', body: 'By the harbour' });
  assert.deepEqual([inHealth.journal_name, inHealth.day, inHealth.title], ['Health', '2026-10-24', 'Walk']);
  assert.throws(() => createEntry(db, { journal_id: '00000000-0000-0000-0000-000000000000' }), (err) => err.status === 400);
});

test('a day lists its entries in the order written; Earlier is newest first', async () => {
  const db = emptyDb();
  const health = createJournal(db, 'Health');
  createEntry(db, { day: '2026-10-25', body: 'morning' });
  await tick();
  createEntry(db, { day: '2026-10-25', journal_id: health.id, body: 'walk' });
  createEntry(db, { day: '2026-10-23', body: 'older' });
  await tick();
  createEntry(db, { day: '2026-10-24', body: 'yesterday' });
  assert.deepEqual(entriesOfDay(db, '2026-10-25').map((e) => e.preview), ['morning', 'walk']);
  assert.deepEqual(entriesOfDay(db, '2026-10-25', { journalId: health.id }).map((e) => e.preview), ['walk']);
  assert.deepEqual(entriesBefore(db, '2026-10-25').map((e) => e.preview), ['yesterday', 'older']);
  assert.deepEqual(entriesBefore(db, '2026-10-25', { limit: 1 }).map((e) => e.preview), ['yesterday']);
  assert.deepEqual(entryDays(db, '2026-10-01', '2026-10-31'),
    [{ day: '2026-10-23', count: 1 }, { day: '2026-10-24', count: 1 }, { day: '2026-10-25', count: 2 }]);
  assert.deepEqual(entryDays(db, '2026-10-01', '2026-10-31', { journalId: health.id }), [{ day: '2026-10-25', count: 1 }]);
});

test('editing an entry, and moving it to another journal', async () => {
  const db = emptyDb();
  const health = createJournal(db, 'Health');
  const entry = createEntry(db, { body: 'first' });
  await tick();
  assert.equal(updateEntry(db, entry.id, { body: 'first' }).updated_at, entry.updated_at, 'no change, no new time');
  const moved = updateEntry(db, entry.id, { journal_id: health.id, title: 'Now titled' });
  assert.deepEqual([moved.journal_name, moved.title, moved.body], ['Health', 'Now titled', 'first']);
  assert.ok(moved.updated_at > entry.updated_at);
  assert.equal(moved.written_at, entry.written_at, 'when it was written stays');
});

test('deleting a journal moves its entries to General and never deletes them', () => {
  const db = emptyDb();
  const health = createJournal(db, 'Health');
  const kept = createEntry(db, { journal_id: health.id, body: 'kept' });
  const alreadyDeleted = createEntry(db, { journal_id: health.id, body: 'in Recently deleted' });
  deleteEntry(db, alreadyDeleted.id);
  const result = deleteJournal(db, health.id);
  assert.equal(result.moved, 2);
  assert.deepEqual(listJournals(db).map((j) => j.name), ['General']);
  assert.equal(getEntry(db, kept.id).journal_name, 'General');
  assert.equal(restoreEntry(db, alreadyDeleted.id).journal_name, 'General', 'a restored entry lands in General');
  assert.throws(() => createEntry(db, { journal_id: health.id }), (err) => err.status === 400);
  createJournal(db, 'Health'); // the name is free again
});

test('deleting an entry only marks it; it comes back whole', () => {
  const db = emptyDb();
  const entry = createEntry(db, { day: '2026-10-25', title: 'Walk', body: 'harbour' });
  deleteEntry(db, entry.id);
  assert.deepEqual(entriesOfDay(db, '2026-10-25'), []);
  assert.deepEqual(searchEntries(db, 'harbour'), []);
  assert.deepEqual(listDeletedEntries(db).map((e) => e.id), [entry.id]);
  assert.equal(getEntry(db, entry.id), null);
  assert.deepEqual(restoreEntry(db, entry.id), { ...entry, deleted_at: null });
  assert.deepEqual(searchEntries(db, 'harb').map((e) => e.id), [entry.id]);
});

test('search finds entries by any word, half-typed, with their journal', () => {
  const db = emptyDb();
  createEntry(db, { title: 'Morning', body: 'walked by the harbour' });
  createEntry(db, { body: 'groceries' });
  assert.deepEqual(searchEntries(db, 'walk').map((e) => [e.title, e.journal_name]), [['Morning', 'General']]);
  assert.deepEqual(searchEntries(db, ''), []);
});

test('only real days and text are accepted', () => {
  assert.ok(isDay('2026-10-25'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('25.10.2026'));
  assert.equal(checkEntryInput({ day: '2026-10-25', body: 'x', journal_id: 'a' }), null);
  assert.match(checkEntryInput({ day: 'today' }), /day must be/);
  assert.match(checkEntryInput({ body: 3 }), /body must be text/);
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('a database from before the journal gets it, keeps every note, and is copied first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-v1-'));
  const file = path.join(dir, 'app.db');
  const v1 = new DatabaseSync(file);
  v1.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'typed', title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '');
    INSERT INTO notes VALUES ('22222222-2222-2222-2222-222222222222', '2026-10-24T10:00:00.000Z', '2026-10-24T10:00:00.000Z', NULL, 'typed', 'Kept', 'text');
    PRAGMA user_version = 1;`);
  v1.close();

  const db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(getNote(db, '22222222-2222-2222-2222-222222222222').title, 'Kept');
  assert.deepEqual(listJournals(db).map((j) => j.name), ['General']);
  assert.equal(createEntry(db, { body: 'first entry' }).journal_name, 'General');
  db.close();
  assert.ok(fs.existsSync(`${file}.before-v${SCHEMA_VERSION}.bak`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the journal API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = async (url) => (await fetch(app.url + url)).json();
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  const [general] = await get('/api/journals');
  const health = await (await send('POST', '/api/journals', { name: 'Health' })).json();
  assert.equal((await send('POST', '/api/journals', { name: 'health' })).status, 409);

  const entry = await (await send('POST', '/api/entries', { journal_id: health.id, day: '2026-10-25', body: 'walk' })).json();
  await send('POST', '/api/entries', { day: '2026-10-25', body: 'call' });
  await send('POST', '/api/entries', { day: '2026-10-24', body: 'yesterday' });
  assert.equal((await send('POST', '/api/entries', { day: 'nope' })).status, 400);

  assert.deepEqual((await get('/api/entries?day=2026-10-25')).map((e) => e.preview), ['walk', 'call']);
  assert.deepEqual((await get(`/api/entries?day=2026-10-25&journal=${health.id}`)).map((e) => e.preview), ['walk']);
  assert.deepEqual((await get('/api/entries?before=2026-10-25')).map((e) => e.preview), ['yesterday']);
  assert.deepEqual(await get('/api/entries/days?from=2026-10-01&to=2026-10-31'),
    [{ day: '2026-10-24', count: 1 }, { day: '2026-10-25', count: 2 }]);
  assert.equal((await fetch(`${app.url}/api/entries/days?from=2026-10-01`)).status, 400);
  assert.equal((await fetch(`${app.url}/api/entries?day=yesterday`)).status, 400);
  assert.deepEqual((await get('/api/entries?q=walk')).map((e) => e.id), [entry.id]);

  const changed = await (await send('PATCH', `/api/entries/${entry.id}`, { title: 'Walk', journal_id: general.id })).json();
  assert.deepEqual([changed.title, changed.journal_name], ['Walk', 'General']);
  assert.equal((await send('DELETE', `/api/entries/${entry.id}`)).status, 200);
  assert.deepEqual((await get('/api/entries?deleted=1')).map((e) => e.id), [entry.id]);
  assert.equal((await send('POST', `/api/entries/${entry.id}/restore`, {})).status, 200);
  assert.equal((await get(`/api/entries/${entry.id}`)).body, 'walk');

  assert.equal((await send('DELETE', `/api/journals/${general.id}`)).status, 400);
  assert.equal((await send('DELETE', `/api/journals/${health.id}`)).status, 200);
  assert.deepEqual((await get('/api/journals')).map((j) => j.name), ['General']);
});
