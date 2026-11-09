// Links between pages (links.js), kept in step with the text, and their API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote, deleteNote } from '../../notes.js';
import { createEntry, localDay } from '../../entries.js';
import { createCapture, sortCapture, undoCapture } from '../../captures.js';
import { extractLinks, linkedFrom, linkTarget, suggestLinks } from '../../links.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('links are found in a text, with the sentence around them', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const links = extractLinks(`First line.\n\nCall went well. Next: [Workshop plan](/notes/${id}) and a call [Oct 27](/journal/2026-10-27). Done.`);
  assert.deepEqual(links, [
    { to_kind: 'note', to_id: id, link_text: 'Workshop plan', context: 'Next: Workshop plan and a call Oct 27.' },
    { to_kind: 'day', to_id: '2026-10-27', link_text: 'Oct 27', context: 'Next: Workshop plan and a call Oct 27.' },
  ]);
  assert.deepEqual(extractLinks('[a file](/files/' + 'a'.repeat(64) + ') and [web](https://example.com)'), []);
  assert.equal(extractLinks(`**Bold** [E](/journal/entries/${id})`)[0].context, 'Bold E');
});

test('a link from today\'s journal shows on the note, and keeps working after a rename', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Workshop plan' });
  const entry = createEntry(db, { body: `Call went well. Next: [Workshop plan](/notes/${note.id}).` });
  assert.deepEqual(linkedFrom(db, 'note', note.id).map((l) => [l.from_kind, l.from_id, l.context]),
    [['entry', entry.id, 'Next: Workshop plan.']]);
  updateNote(db, note.id, { title: 'Autumn workshop' });
  assert.deepEqual(linkTarget(db, 'note', note.id), { exists: true, title: 'Autumn workshop' });
  assert.equal(linkedFrom(db, 'note', note.id).length, 1, 'still linked: the row points at the id');
});

test('links follow the text: removed from the text, gone from Linked from', () => {
  const db = emptyDb();
  const target = createNote(db, { title: 'Target' });
  const source = createNote(db, { title: 'Source', body: `See [Target](/notes/${target.id}).` });
  assert.equal(linkedFrom(db, 'note', target.id).length, 1);
  updateNote(db, source.id, { body: 'No link any more.' });
  assert.deepEqual(linkedFrom(db, 'note', target.id), []);
});

test('a deleted page is left out of Linked from, and a link to it says it is gone', () => {
  const db = emptyDb();
  const target = createNote(db, { title: 'Target' });
  const source = createNote(db, { title: 'Source', body: `See [Target](/notes/${target.id}).` });
  deleteNote(db, source.id);
  assert.deepEqual(linkedFrom(db, 'note', target.id), []);
  deleteNote(db, target.id);
  assert.deepEqual(linkTarget(db, 'note', target.id), { exists: false });
});

test('a note linking to itself is not listed', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Me' });
  updateNote(db, note.id, { body: `I am [Me](/notes/${note.id}).` });
  assert.deepEqual(linkedFrom(db, 'note', note.id), []);
});

test('links to days and entries, and links in a sorted capture', async () => {
  const db = emptyDb();
  const entry = createEntry(db, { title: 'Morning', body: 'Walked' });
  const note = createNote(db, { title: 'Week', body: `[Morning](/journal/entries/${entry.id}) and [Today](/journal/${localDay()}).` });
  assert.deepEqual(linkedFrom(db, 'entry', entry.id).map((l) => l.label), ['Week']);
  assert.deepEqual(linkedFrom(db, 'day', localDay()).map((l) => l.from_id), [note.id]);

  const capture = createCapture(db, { body: `Ask about [Week](/notes/${note.id})` });
  const { made } = sortCapture(db, capture.id, { to: 'journal' });
  assert.deepEqual(linkedFrom(db, 'note', note.id).map((l) => l.from_id), [made.id]);
  undoCapture(db, capture.id);
  assert.deepEqual(linkedFrom(db, 'note', note.id), [], 'undone: the entry is deleted, so its link is left out');
});

test('suggestions: notes by title first, entries, and days for today, yesterday and dates', async () => {
  const db = emptyDb();
  createNote(db, { title: 'Questions for the accountant' });
  await tick();
  createNote(db, { title: 'Pricing', body: 'questions later' });
  createEntry(db, { title: 'Accountant call', body: 'went fine', day: '2026-10-20' });
  const found = suggestLinks(db, 'que', { today: '2026-10-25' });
  assert.deepEqual(found.filter((f) => f.kind === 'note').map((f) => f.label), ['Questions for the accountant', 'Pricing']);
  assert.deepEqual(suggestLinks(db, 'account', { today: '2026-10-25' }).map((f) => [f.kind, f.label]),
    [['note', 'Questions for the accountant'], ['entry', 'Accountant call']]);
  assert.deepEqual(suggestLinks(db, 'yes', { today: '2026-10-25' })[0], { kind: 'day', id: '2026-10-24', label: 'Yesterday' });
  assert.deepEqual(suggestLinks(db, '2026-01-02', { today: '2026-10-25' })[0], { kind: 'day', id: '2026-01-02', label: '2026-01-02' });
  assert.equal(suggestLinks(db, '', { today: '2026-10-25' }).filter((f) => f.kind === 'note').length, 2, 'nothing typed: recent notes');
});

test('an older database gets its links from the texts already written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-old-'));
  let db = openDatabase(dir);
  const target = createNote(db, { title: 'Target' });
  createNote(db, { title: 'Source', body: `See [Target](/notes/${target.id}).` });
  db.exec('DROP TABLE links; PRAGMA user_version = 4;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(linkedFrom(db, 'note', target.id).length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the links API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = async (url, body) => (await fetch(app.url + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  const get = async (url) => (await fetch(app.url + url)).json();
  const note = await post('/api/notes', { title: 'Workshop plan' });
  await post('/api/entries', { body: `Next: [Workshop plan](/notes/${note.id}).` });
  assert.deepEqual((await get(`/api/links/to?kind=note&id=${note.id}`)).map((l) => l.context), ['Next: Workshop plan.']);
  assert.deepEqual(await get(`/api/links/target?kind=note&id=${note.id}`), { exists: true, title: 'Workshop plan' });
  assert.equal((await get('/api/links/suggest?q=work'))[0].label, 'Workshop plan');
  assert.equal((await fetch(`${app.url}/api/links/to?kind=page&id=x`)).status, 400);
});
