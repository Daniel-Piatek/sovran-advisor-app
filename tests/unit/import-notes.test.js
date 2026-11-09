// Bring your notes in (import-notes.js, advanced/writing/9): read only, safe to run twice, your edits win. Everything is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { updateNote, getNote, deleteNote, searchNotes } from '../../notes.js';
import { linkedFrom } from '../../links.js';
import { importObsidian, importDayOne, listRuns } from '../../import-notes.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const VAULT = [
  { path: 'Autumn/Pricing thoughts.md', text: '---\ntags: [pricing]\n---\n* Package: 3 days for 4800 EUR\n' },
  { path: 'Autumn/Pricing history.md', text: 'See [[Pricing thoughts]] and [[Pricing thoughts|the package]]. Also [[Unknown page]].\n' },
  { path: 'Autumn/Workshop venues in Hamburg.md', text: 'Nordlicht Studio, the harbour loft.\n' },
  { path: 'Autumn/.obsidian/workspace.md', text: 'settings, not a note' },
  { path: 'Autumn/picture.png', text: 'not markdown' },
];

test('a vault comes in as notes: title from the file name, body without front matter, origin imported, with its source key', () => {
  const db = emptyDb();
  const report = importObsidian(db, VAULT, { source: 'Autumn' });
  assert.deepEqual([report.imported, report.already, report.kept, report.doubled, report.files], [3, 0, 0, 0, 3]);
  const note = db.prepare("SELECT * FROM notes WHERE source_key = 'obsidian:Autumn/Pricing thoughts.md'").get();
  assert.deepEqual([note.title, note.body, note.origin, note.imported_at === note.updated_at], ['Pricing thoughts', '* Package: 3 days for 4800 EUR', 'imported', true]);
  assert.equal(getNote(db, note.id).source_key, 'obsidian:Autumn/Pricing thoughts.md');
  assert.equal(searchNotes(db, 'harbour').length, 1, 'search finds the imported words at once');
});

test('[[links]] between the notes of the vault become links of the app; ones to nothing stay as they were', () => {
  const db = emptyDb();
  const report = importObsidian(db, VAULT);
  assert.equal(report.linked, 1);
  const history = db.prepare("SELECT id, body FROM notes WHERE title = 'Pricing history'").get();
  const pricing = db.prepare("SELECT id FROM notes WHERE title = 'Pricing thoughts'").get();
  assert.equal(history.body, `See [Pricing thoughts](/notes/${pricing.id}) and [the package](/notes/${pricing.id}). Also [[Unknown page]].`);
  assert.deepEqual(linkedFrom(db, 'note', pricing.id).map((l) => l.label), ['Pricing history', 'Pricing history'], 'one row for each of the two links');
});

test('run twice: nothing imported, everything already here, none doubled; a note you edited is kept and left as you wrote it; a deleted one does not come back', () => {
  const db = emptyDb();
  importObsidian(db, VAULT);
  const venues = db.prepare("SELECT id FROM notes WHERE title = 'Workshop venues in Hamburg'").get();
  const pricing = db.prepare("SELECT id FROM notes WHERE title = 'Pricing thoughts'").get();
  db.prepare("UPDATE notes SET imported_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(venues.id); // as if it was imported long ago, and edited since
  updateNote(db, venues.id, { body: 'Nordlicht Studio, the harbour loft. Book by Friday.' });
  deleteNote(db, pricing.id);
  const second = importObsidian(db, VAULT);
  assert.deepEqual([second.imported, second.already, second.kept, second.doubled], [0, 2, 1, 0]);
  assert.deepEqual(second.kept_titles, ['Workshop venues in Hamburg']);
  assert.equal(getNote(db, venues.id).body, 'Nordlicht Studio, the harbour loft. Book by Friday.');
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes WHERE title = 'Pricing thoughts'").get().n, 1, 'the deleted note stays deleted');
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 3);
  assert.deepEqual(listRuns(db).map((r) => [r.kind, r.imported, r.already, r.kept]), [['obsidian', 0, 2, 1], ['obsidian', 3, 0, 0]]);
});

test('a dry run says what it would do and changes nothing; refusals are plain', () => {
  const db = emptyDb();
  const dry = importObsidian(db, VAULT, { dryRun: true });
  assert.deepEqual([dry.imported, dry.would], [3, true]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 0);
  assert.equal(listRuns(db).length, 0);
  assert.throws(() => importObsidian(db, 'nope'), /list of/);
  assert.throws(() => importObsidian(db, Array.from({ length: 5001 }, (_, i) => ({ path: `n${i}.md`, text: '' }))), (e) => e.status === 413);
});

const EXPORT = { entries: [
  { uuid: 'AAA111', creationDate: '2026-09-03T08:15:00Z', timeZone: 'Europe/Athens', text: 'First morning\\. Slept well\\!' },
  { uuid: 'BBB222', creationDate: '2026-09-03T21:30:00Z', timeZone: 'Europe/Athens', text: 'Evening walk.' },
  { uuid: 'CCC333', creationDate: '2026-09-04T07:00:00Z', timeZone: 'Europe/Athens', text: 'The next day.' },
  { creationDate: '2026-09-05T07:00:00Z', text: 'no id: skipped' },
] };

test('a Day One export becomes journal entries on their days, once: a second run adds nothing', () => {
  const db = emptyDb();
  const first = importDayOne(db, EXPORT, { source: 'Journal.json' });
  assert.deepEqual([first.added, first.already, first.doubled, first.days, first.skipped, first.first, first.last], [3, 0, 0, 2, 1, '2026-09-03', '2026-09-04']);
  const night = db.prepare("SELECT * FROM journal_entries WHERE source_key = 'dayone:BBB222'").get();
  assert.deepEqual([night.day, night.origin, night.written_at, night.body], ['2026-09-04', 'imported', '2026-09-03T21:30:00.000Z', 'Evening walk.'], 'the day is the day where it was written (Athens is ahead of UTC)');
  assert.equal(db.prepare("SELECT body FROM journal_entries WHERE source_key = 'dayone:AAA111'").get().body, 'First morning. Slept well!');
  const second = importDayOne(db, JSON.stringify(EXPORT));
  assert.deepEqual([second.added, second.already, second.doubled], [0, 3, 0]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM journal_entries').get().n, 3);
  assert.throws(() => importDayOne(db, 'not json'), /not JSON/);
  assert.throws(() => importDayOne(db, { notes: [] }), /no entries/);
});

test('schema 57 moves an older database: notes and entries gain their source, every row is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', 'x')");
  db.exec('DROP INDEX notes_by_source; DROP INDEX journal_entries_by_source; ALTER TABLE notes DROP COLUMN source_key; ALTER TABLE notes DROP COLUMN imported_at; ALTER TABLE journal_entries DROP COLUMN source_key; DROP TABLE import_runs; PRAGMA user_version = 56;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare("SELECT title, source_key, imported_at FROM notes WHERE id = 'n1'").get() }, { title: 'Keep me', source_key: null, imported_at: null });
  assert.equal(db.prepare('SELECT count(*) AS n FROM import_runs').get().n, 0);
  db.close();
});
