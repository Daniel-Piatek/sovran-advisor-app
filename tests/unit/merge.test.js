// You and your assistant at once (merge.js, advanced/writing/5): a three-way merge, clashes kept, the choice a version, the assistant told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote, getNote } from '../../notes.js';
import { setModule } from '../../modules.js';
import { listVersions, getVersion } from '../../versions.js';
import { merge3, saveWithMerge, listClashes, resolveClash, takeClashNotes } from '../../merge.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a line only one side changed takes that change; the same change on both sides is one change', () => {
  assert.deepEqual(merge3('a\nb\nc', 'A\nb\nc', 'a\nb\nc\nd'), { text: 'A\nb\nc\nd', clashes: [] });
  assert.deepEqual(merge3('a\nb\nc', 'a\nb\nc', 'a\nB\nc'), { text: 'a\nB\nc', clashes: [] });
  assert.deepEqual(merge3('a\nb\nc', 'a\nX\nc', 'a\nX\nc'), { text: 'a\nX\nc', clashes: [] });
  assert.deepEqual(merge3('a\nb\nc\nd', 'a\nc\nd', 'a\nb\nc\nD'), { text: 'a\nc\nD', clashes: [] }, 'a deleted line and a changed line further down');
  assert.equal(merge3('a\nb\nc', 'a\nc', 'a\nb\nC').clashes.length, 1, 'changes right next to each other are a clash, as in git');
  assert.deepEqual(merge3('', 'first', ''), { text: 'first', clashes: [] });
});

test('a line both changed differently is a clash: mine stays, both sides are kept, with the line', () => {
  const r = merge3('one\ntwo quiet mornings\nthree', 'one\ntwo quiet mornings, no calls\nthree', 'one\nmeetings only after lunch\nthree\nfour');
  assert.equal(r.text, 'one\ntwo quiet mornings, no calls\nthree\nfour', 'the other side’s other change still merges');
  assert.deepEqual(r.clashes, [{ line: 1, mine: 'two quiet mornings, no calls', theirs: 'meetings only after lunch' }]);
  const both = merge3('a', 'x', 'y');
  assert.deepEqual([both.text, both.clashes.length], ['x', 1]);
});

function setUp() {
  const db = emptyDb();
  const note = createNote(db, { title: 'Proposal', body: 'Three parts\ntwo quiet mornings\nFollow up' });
  return { db, note, base: 1 };
}

test('you change the first line while your assistant adds a bullet at the end: both are in the note, as one merged version', () => {
  const { db, note, base } = setUp();
  updateNote(db, note.id, { body: `${note.body}\n* Send the contract`, author: 'assistant' }); // version 2: the assistant
  const result = saveWithMerge(db, note.id, { body: 'Three parts, in detail\ntwo quiet mornings\nFollow up', base });
  assert.equal(result.merged, true);
  assert.equal(getNote(db, note.id).body, 'Three parts, in detail\ntwo quiet mornings\nFollow up\n* Send the contract');
  assert.deepEqual(result.clashes, []);
  assert.deepEqual(listVersions(db, note.id).map((v) => [v.seq, v.author, v.label]), [[3, 'me', 'Merged'], [2, 'assistant', ''], [1, 'me', '']]);
});

test('a save that starts from the latest version is plain; so is one without a version, or with the module off', () => {
  const { db, note } = setUp();
  assert.equal(saveWithMerge(db, note.id, { body: 'changed', base: 1 }).merged, false);
  assert.equal(saveWithMerge(db, note.id, { body: 'changed again' }).merged, false);
  updateNote(db, note.id, { body: 'x\ny' });
  setModule(db, 'writing', false);
  assert.equal(saveWithMerge(db, note.id, { body: 'z', base: 1 }).merged, false);
});

test('both changed the same line: your words stay, a clash is recorded, the assistant’s whole text is kept; Keep yours, Take the assistant’s and Keep both are each a new version', () => {
  for (const [choice, expected, label] of [['mine', 'Three parts\ntwo quiet mornings, no calls\nFollow up', 'Kept yours'], ['theirs', 'Three parts\nmeetings only after lunch\nFollow up', 'Took the assistant’s side'], ['both', 'Three parts\ntwo quiet mornings, no calls\nmeetings only after lunch\nFollow up', 'Kept both']]) {
    const { db, note, base } = setUp();
    updateNote(db, note.id, { body: 'Three parts\nmeetings only after lunch\nFollow up', author: 'assistant' });
    const result = saveWithMerge(db, note.id, { body: 'Three parts\ntwo quiet mornings, no calls\nFollow up', base });
    assert.equal(result.clashes.length, 1);
    assert.equal(getNote(db, note.id).body, 'Three parts\ntwo quiet mornings, no calls\nFollow up');
    const [clash] = listClashes(db, note.id);
    assert.deepEqual([clash.mine, clash.theirs, clash.state], ['two quiet mornings, no calls', 'meetings only after lunch', 'open']);
    assert.equal(db.prepare('SELECT theirs_text FROM note_clashes').get().theirs_text, 'Three parts\nmeetings only after lunch\nFollow up', 'the assistant’s whole text');
    assert.equal(getVersion(db, listVersions(db, note.id)[1].id).author, 'assistant', 'and it is a version of its own');

    const closed = resolveClash(db, clash.id, choice);
    assert.equal(closed.state, choice);
    assert.equal(getNote(db, note.id).body, expected);
    assert.equal(listVersions(db, note.id)[0].label, label, 'the choice is a new version, even when no word changed');
    assert.deepEqual(listClashes(db, note.id), []);
    assert.throws(() => resolveClash(db, clash.id, 'mine'), (e) => e.status === 409);
  }
});

test('your assistant is told which side won, once, in its next turn', () => {
  const { db, note, base } = setUp();
  updateNote(db, note.id, { body: 'Three parts\nmeetings only after lunch\nFollow up', author: 'assistant' });
  saveWithMerge(db, note.id, { body: 'Three parts\ntwo quiet mornings, no calls\nFollow up', base });
  assert.deepEqual(takeClashNotes(db), [], 'nothing until you choose');
  resolveClash(db, listClashes(db, note.id)[0].id, 'mine');
  const [told] = takeClashNotes(db);
  assert.match(told, /“Proposal”.*the owner's words won: “two quiet mornings, no calls”.*“meetings only after lunch” was not kept.*Never build on a line that is gone/);
  assert.deepEqual(takeClashNotes(db), []);
});

test('a line that was changed since cannot be replaced by a choice; the assistant’s change meeting yours keeps your words', () => {
  const { db, note, base } = setUp();
  updateNote(db, note.id, { body: 'Three parts\nmeetings only after lunch\nFollow up', author: 'assistant' });
  saveWithMerge(db, note.id, { body: 'Three parts\ntwo quiet mornings, no calls\nFollow up', base });
  const [clash] = listClashes(db, note.id);
  updateNote(db, note.id, { body: 'Three parts\nsomething else entirely\nFollow up' });
  assert.throws(() => resolveClash(db, clash.id, 'theirs'), (e) => e.code === 'moved');
  assert.throws(() => resolveClash(db, clash.id, 'maybe'), /Choose yours/);

  const other = setUp();
  updateNote(other.db, other.note.id, { body: 'Three parts\ntwo quiet mornings, no calls\nFollow up' }); // you changed it while the card waited
  const merged = saveWithMerge(other.db, other.note.id, { body: 'Three parts\nmeetings only after lunch\nFollow up', author: 'assistant', winner: 'current', baseText: other.note.body });
  assert.equal(merged.merged, true);
  assert.equal(getNote(other.db, other.note.id).body, 'Three parts\ntwo quiet mornings, no calls\nFollow up');
  assert.equal(listClashes(other.db, other.note.id)[0].theirs, 'meetings only after lunch');
});

test('schema 54 moves an older database: the clashes table is new, every note is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', 'x')");
  db.exec('DROP TABLE note_clashes; PRAGMA user_version = 53;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_clashes').get().n, 0);
  db.close();
});
