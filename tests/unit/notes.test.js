// Notes in the database (notes.js), and the server's notes API, each with an empty database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { seed } from '../../scripts/seed.js';
import {
  createNote, getNote, listNotes, listDeletedNotes, searchNotes, searchQuery, updateNote, deleteNote, restoreNote,
  checkNoteInput, PREVIEW_LENGTH,
} from '../../notes.js';
import { startServer, hostsFile } from '../../server.js';

function emptyDb() {
  return prepareDatabase(new DatabaseSync(':memory:'));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a new note keeps its title, text, origin and times', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Pricing', body: 'One price first.' });
  assert.equal(note.title, 'Pricing');
  assert.equal(note.body, 'One price first.');
  assert.equal(note.origin, 'typed');
  assert.equal(note.created_at, note.updated_at);
  assert.deepEqual(getNote(db, note.id), note);
});

test('a note can start empty', () => {
  const note = createNote(emptyDb());
  assert.equal(note.title, '');
  assert.equal(note.body, '');
});

test('the list is last edited first, with the start of the text', async () => {
  const db = emptyDb();
  const first = createNote(db, { title: 'First' });
  await tick();
  createNote(db, { title: 'Second', body: 'x'.repeat(PREVIEW_LENGTH + 50) });
  await tick();
  assert.deepEqual(listNotes(db).map((n) => n.title), ['Second', 'First']);
  assert.equal(listNotes(db)[0].preview.length, PREVIEW_LENGTH);

  updateNote(db, first.id, { body: 'Edited later' });
  assert.deepEqual(listNotes(db).map((n) => n.title), ['First', 'Second']);
});

test('editing moves the edited time only when something changed', async () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Same' });
  await tick();
  assert.equal(updateNote(db, note.id, { title: 'Same' }).updated_at, note.updated_at);
  const edited = updateNote(db, note.id, { body: 'New text' });
  assert.ok(edited.updated_at > note.updated_at);
  assert.equal(edited.title, 'Same', 'a field that is not sent stays as it was');
  assert.equal(edited.created_at, note.created_at);
});

test('a deleted note is not listed or opened, but is still kept', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Gone' });
  db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), note.id);
  assert.deepEqual(listNotes(db), []);
  assert.equal(getNote(db, note.id), null);
  assert.equal(updateNote(db, note.id, { title: 'x' }), null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 1);
});

test('only text is accepted for a title and body', () => {
  assert.equal(checkNoteInput({ title: 'ok', body: 'ok' }), null);
  assert.equal(checkNoteInput({}), null);
  assert.match(checkNoteInput({ title: 3 }), /title must be text/);
  assert.match(checkNoteInput([]), /JSON object/);
  assert.match(checkNoteInput(null), /JSON object/);
  assert.match(checkNoteInput({ title: 'x'.repeat(1001) }), /longer than/);
});

test('the notes API: make, list, open and change a note', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const send = (method, url, body) => fetch(app.url + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  assert.deepEqual(await (await fetch(`${app.url}/api/notes`)).json(), [], 'starts empty');

  const made = await send('POST', '/api/notes', { title: 'Call with Z' });
  assert.equal(made.status, 201);
  const note = await made.json();

  const changed = await (await send('PATCH', `/api/notes/${note.id}`, { body: 'Budget is fixed.' })).json();
  assert.equal(changed.body, 'Budget is fixed.');
  assert.equal((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body, 'Budget is fixed.');

  const list = await (await fetch(`${app.url}/api/notes`)).json();
  assert.deepEqual(list.map((n) => [n.title, n.preview]), [['Call with Z', 'Budget is fixed.']]);

  assert.equal((await send('PATCH', `/api/notes/${note.id}`, { title: 7 })).status, 400);
  assert.equal((await fetch(`${app.url}/api/notes/${note.id}`, { method: 'PATCH', body: '{}' })).status, 415);
  assert.equal((await fetch(`${app.url}/api/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops',
  })).status, 400);
  assert.equal((await fetch(`${app.url}/api/notes/00000000-0000-0000-0000-000000000000`)).status, 404);
  assert.equal((await send('PUT', `/api/notes/${note.id}`)).status, 405);
});

test('the server answers only pages of this app', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const status = await new Promise((resolve, reject) => {
    const { port } = new URL(app.url);
    http.get({ host: '127.0.0.1', port, path: '/api/notes', headers: { Host: 'evil.example' } },
      (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`${app.url}/notes/anything`)).headers.get('content-type'), 'text/html; charset=utf-8',
    'a screen of the app gets the page');
});

test('every table has the same base columns, and a new database is at the newest version', () => {
  const db = emptyDb();
  const columns = db.prepare("SELECT name FROM pragma_table_info('notes')").all().map((c) => c.name);
  for (const base of ['id', 'created_at', 'updated_at', 'deleted_at', 'origin']) assert.ok(columns.includes(base), base);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.throws(() => db.prepare("INSERT INTO notes (id, created_at, updated_at, origin) VALUES ('x', 'a', 'a', 'guessed')").run(),
    /CHECK/, 'origin is one of typed, captured, imported, assistant');
});

test('an older database moves to the new shape, keeps every note, and is copied first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-old-'));
  const file = path.join(dir, 'app.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'typed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE INDEX notes_by_updated ON notes (updated_at);
    INSERT INTO notes VALUES ('11111111-1111-1111-1111-111111111111', 'Harbour walk', 'Coffee by the pier', 'typed', '2026-10-24T10:00:00.000Z', '2026-10-24T11:00:00.000Z', NULL);`);
  old.close();

  const db = openDatabase(dir);
  const note = getNote(db, '11111111-1111-1111-1111-111111111111');
  assert.deepEqual({ ...note }, {
    id: '11111111-1111-1111-1111-111111111111', title: 'Harbour walk', body: 'Coffee by the pier', origin: 'typed',
    created_at: '2026-10-24T10:00:00.000Z', updated_at: '2026-10-24T11:00:00.000Z', deleted_at: null,
    capture_id: null, home_id: null, home: null,
  });
  assert.equal(searchNotes(db, 'pier')[0].title, 'Harbour walk', 'old notes can be searched');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'notes_by_updated' AND tbl_name = 'notes'").get(), 'index kept');
  db.close();

  const backup = new DatabaseSync(`${file}.before-v${SCHEMA_VERSION}.bak`);
  assert.equal(backup.prepare('SELECT title FROM notes').get().title, 'Harbour walk');
  backup.close();
  openDatabase(dir).close(); // opening again changes nothing
  fs.rmSync(dir, { recursive: true, force: true });
});

test('search finds any word in the title or text, half-typed too', () => {
  const db = emptyDb();
  createNote(db, { title: 'Onboarding call with Lena', body: 'She lives by the harbour.' });
  createNote(db, { title: 'Café ideas', body: 'Pricing for the workshop' });
  createNote(db, { title: 'Groceries', body: 'eggs, milk' });
  assert.deepEqual(searchNotes(db, 'harbour').map((n) => n.title), ['Onboarding call with Lena']);
  assert.deepEqual(searchNotes(db, 'harb').map((n) => n.title), ['Onboarding call with Lena']);
  assert.deepEqual(searchNotes(db, 'LENA').map((n) => n.title), ['Onboarding call with Lena']);
  assert.deepEqual(searchNotes(db, 'cafe').map((n) => n.title), ['Café ideas'], 'accents do not matter');
  assert.deepEqual(searchNotes(db, 'pric work').map((n) => n.title), ['Café ideas'], 'every word must be there');
  assert.deepEqual(searchNotes(db, 'pricing lena'), []);
  assert.equal(searchNotes(db, '  ').length, 3, 'no words: every note');
  assert.equal(searchNotes(db, '"* ( ) -').length, 3, 'search signs alone are ignored');
  assert.deepEqual(searchNotes(db, 'milk OR eggs').map((n) => n.title), [], 'OR is a word, not a command');
  assert.equal(searchQuery('half-typed wor'), '"half"* "typed"* "wor"*');
});

test('search sees edits at once, and puts a title match first', () => {
  const db = emptyDb();
  const inBody = createNote(db, { title: 'Monday', body: 'about the budget' });
  createNote(db, { title: 'Budget', body: 'numbers' });
  assert.deepEqual(searchNotes(db, 'budget').map((n) => n.title), ['Budget', 'Monday']);
  updateNote(db, inBody.id, { body: 'about the harbour' });
  assert.deepEqual(searchNotes(db, 'budget').map((n) => n.title), ['Budget']);
  assert.deepEqual(searchNotes(db, 'harbour').map((n) => n.id), [inBody.id]);
});

test('deleting only marks a note: it leaves the list and search, and comes back whole', async () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Harbour walk', body: 'Coffee by the pier' });
  await tick();
  const deleted = deleteNote(db, note.id);
  assert.ok(deleted.deleted_at);
  assert.deepEqual(listNotes(db), []);
  assert.deepEqual(searchNotes(db, 'pier'), []);
  assert.equal(getNote(db, note.id), null);
  assert.deepEqual(listDeletedNotes(db).map((n) => n.id), [note.id]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 1, 'still kept');
  assert.equal(deleteNote(db, note.id).deleted_at, deleted.deleted_at, 'deleting twice changes nothing');

  const back = restoreNote(db, note.id);
  assert.deepEqual(back, { ...note, deleted_at: null }, 'everything in it, edited time unchanged');
  assert.deepEqual(searchNotes(db, 'pier').map((n) => n.id), [note.id]);
  assert.deepEqual(listDeletedNotes(db), []);
});

test('search stays fast with thousands of notes', () => {
  const db = emptyDb();
  seed(db, 5000);
  assert.equal(listNotes(db).length, 5000);
  for (const words of ['harbour', 'harb', 'budget timing', 'coffee lunch train', 'zzz']) {
    const start = performance.now();
    searchNotes(db, words);
    const ms = performance.now() - start;
    assert.ok(ms < 50, `"${words}" took ${ms.toFixed(1)} ms`);
  }
});

test('the notes API: search, delete and restore', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const json = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  const note = await (await json('POST', '/api/notes', { title: 'Harbour walk', body: 'pier' })).json();
  await json('POST', '/api/notes', { title: 'Other' });
  assert.deepEqual((await (await fetch(`${app.url}/api/notes?q=harb`)).json()).map((n) => n.title), ['Harbour walk']);

  assert.equal((await fetch(`${app.url}/api/notes/${note.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await fetch(`${app.url}/api/notes?q=harb`)).json()), []);
  assert.deepEqual((await (await fetch(`${app.url}/api/notes?deleted=1`)).json()).map((n) => n.id), [note.id]);
  assert.equal((await fetch(`${app.url}/api/notes/${note.id}/restore`, { method: 'POST' })).status, 415, 'must be sent as JSON');
  assert.equal((await json('POST', `/api/notes/${note.id}/restore`, {})).status, 200);
  assert.equal((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body, 'pier');
  assert.equal((await json('POST', '/api/notes/00000000-0000-0000-0000-000000000000/restore', {})).status, 404);
});

test('the app answers only its own names: this computer, and the names it is given', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-test-'));
  const app = await startServer({ port: 0, dataDir, hosts: ['my-mac.tail1234.ts.net'] });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const { port } = new URL(app.url);
  const ask = (host) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/api/notes', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(await ask(`127.0.0.1:${port}`), 200);
  assert.equal(await ask('my-mac.tail1234.ts.net'), 200);
  assert.equal(await ask('evil.example'), 403);
});

test('data/hosts.txt gives the names the phone opens the app by, one a line; # is a note', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-file-'));
  try {
    assert.deepEqual(hostsFile(dataDir), [], 'no file, no names');
    fs.writeFileSync(path.join(dataDir, 'hosts.txt'), '# my phone, through Tailscale\r\nmy-mac.tail1234.ts.net\n\n  other.tail1234.ts.net  \n');
    assert.deepEqual(hostsFile(dataDir), ['my-mac.tail1234.ts.net', 'other.tail1234.ts.net']);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
