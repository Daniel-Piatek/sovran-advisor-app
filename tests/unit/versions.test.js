// Versions of a note (versions.js, advanced/writing/4): every save kept with its author, compared word by word, restored as one more save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote, getNote, setNoteBody } from '../../notes.js';
import { setModule } from '../../modules.js';
import { listVersions, compareVersions, diffWords, getVersion } from '../../versions.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const text = (parts) => parts.map((p) => (p.t === 'same' ? p.text : p.t === 'add' ? `[+${p.text}]` : `[-${p.text}]`)).join('');

test('every save is a version, with its author and what changed; a save that changes nothing is not one', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Workshop', body: 'Three tiers felt like too many.' });
  updateNote(db, note.id, { body: 'Three tiers felt like too many. Two is enough.' });
  updateNote(db, note.id, { body: 'Three tiers felt like too many. Two is enough.' }); // nothing changed
  updateNote(db, note.id, { body: 'Two tiers.', author: 'assistant' });
  updateNote(db, note.id, { title: 'Workshop pricing' });
  const versions = listVersions(db, note.id);
  assert.deepEqual(versions.map((v) => [v.seq, v.author, v.summary]), [[4, 'me', 'title changed'], [3, 'assistant', '1 word added, 8 words removed'], [2, 'me', '3 words added'], [1, 'me', 'First version']]);
});

test('an assistant’s note is its first version; quick capture appending to a note is a version too', () => {
  const db = emptyDb();
  const made = createNote(db, { title: 'From the assistant', body: 'x', origin: 'assistant' });
  assert.equal(listVersions(db, made.id)[0].author, 'assistant');
  const note = createNote(db, { title: 'N', body: 'a' });
  setNoteBody(db, note.id, 'a\n\nb');
  assert.deepEqual(listVersions(db, note.id).map((v) => v.seq), [2, 1]);
});

test('the note row stays the current text; a version holds its whole text', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'N', body: 'one' });
  updateNote(db, note.id, { body: 'two' });
  const [latest, first] = listVersions(db, note.id);
  assert.equal(getVersion(db, latest.id).body, getNote(db, note.id).body);
  assert.equal(getVersion(db, first.id).body, 'one');
});

test('two versions are compared word by word: added and removed words; the older to the newer, whichever order they are given', () => {
  assert.equal(text(diffWords('Three tiers felt like too many.', 'Three tiers felt like one too many.')), 'Three tiers felt like [+one ]too many.');
  assert.equal(text(diffWords('a b c d', 'a c d e')), 'a [-b ]c d[+ e]');
  assert.equal(text(diffWords('', 'new')), '[+new]');
  assert.equal(text(diffWords('gone', '')), '[-gone]');
  assert.equal(text(diffWords('same', 'same')), 'same');
  const db = emptyDb();
  const note = createNote(db, { title: 'N', body: 'alpha beta' });
  updateNote(db, note.id, { body: 'alpha gamma' });
  const [v2, v1] = listVersions(db, note.id);
  const forward = compareVersions(db, v1.id, v2.id);
  assert.deepEqual([forward.from.seq, forward.to.seq, text(forward.parts)], [1, 2, 'alpha [-beta][+gamma]']);
  assert.deepEqual(compareVersions(db, v2.id, v1.id).parts, forward.parts);
  assert.throws(() => compareVersions(db, v1.id, '00000000-0000-4000-8000-000000000000'), (e) => e.status === 404);
});

test('restore writes the old text as the next version and never over one', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'N', body: 'first words' });
  updateNote(db, note.id, { body: 'second words' });
  updateNote(db, note.id, { body: 'third words' });
  const old = listVersions(db, note.id).find((v) => v.seq === 2);
  const stored = getVersion(db, old.id);
  updateNote(db, note.id, { title: stored.title, body: stored.body, label: `Restored from version ${stored.seq}` });
  const after = listVersions(db, note.id);
  assert.deepEqual(after.map((v) => v.seq), [4, 3, 2, 1]);
  assert.equal(getNote(db, note.id).body, 'second words');
  assert.equal(after[0].label, 'Restored from version 2');
  assert.equal(getVersion(db, after.find((v) => v.seq === 3).id).body, 'third words', 'the text restored over is still there');
});

test('with the module off no versions are written; switched on, the note as it is becomes the first', () => {
  const db = emptyDb();
  setModule(db, 'writing', false);
  const note = createNote(db, { title: 'N', body: 'a' });
  updateNote(db, note.id, { body: 'b' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_versions').get().n, 0);
  setModule(db, 'writing', true);
  assert.deepEqual(listVersions(db, note.id).map((v) => [v.seq, v.words]), [[1, 1]]);
  assert.equal(listVersions(db, '00000000-0000-4000-8000-000000000000'), null);
});

test('schema 53 moves an older database: the versions table is new, every note is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'versions-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', 'x')");
  db.exec('DROP TABLE note_versions; PRAGMA user_version = 52;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_versions').get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
});
