// Bullets (blocks.js, advanced/writing/1): a note's list items as rows with a parent and a position, made again from the text on every save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote, getNote } from '../../notes.js';
import { setModule, listModules } from '../../modules.js';
import { parseOutline, listBlocks, setFolded } from '../../blocks.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const BODY = 'Intro line\n\n* Format\n  * One exercise\n  * Two exercises\n* Agenda\n  * [ ] Book the room\n* Venue\n';

test('the list items of a text are read as a tree: depth by two spaces, never deeper than one below the bullet above; code and other lines are not bullets', () => {
  const items = parseOutline(BODY);
  assert.deepEqual(items.map((i) => [i.text, i.depth, i.parent, i.position]), [['Format', 0, null, 0], ['One exercise', 1, 0, 0], ['Two exercises', 1, 0, 1], ['Agenda', 0, null, 1], ['Book the room', 1, 3, 0], ['Venue', 0, null, 2]]);
  assert.deepEqual(parseOutline('- a\n      - way too deep\n').map((i) => i.depth), [0, 1]);
  assert.deepEqual(parseOutline('```\n- not a bullet\n```\n- a bullet\n').map((i) => i.text), ['a bullet']);
  assert.deepEqual(parseOutline('1. one\n2. two\n   - nested\n').map((i) => [i.text, i.depth]), [['one', 0], ['two', 0], ['nested', 1]]);
  assert.deepEqual(parseOutline('- a\n\nA paragraph\n- b\n').map((i) => [i.text, i.position]), [['a', 0], ['b', 0]], 'a paragraph ends a list: b starts a new one');
  assert.deepEqual(parseOutline(''), []);
});

test('saving a note makes its bullet rows (while the module is on); the tree is there with parents and positions', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Ideas for the autumn workshop', body: BODY });
  const blocks = listBlocks(db, note.id);
  assert.deepEqual(blocks.map((b) => [b.text, b.depth, b.position, b.children, b.folded]), [['Format', 0, 0, 2, false], ['One exercise', 1, 0, 0, false], ['Two exercises', 1, 1, 0, false], ['Agenda', 0, 1, 1, false], ['Book the room', 1, 0, 0, false], ['Venue', 0, 2, 0, false]]);
  assert.equal(blocks[1].parent_id, blocks[0].id);
  assert.equal(blocks[0].parent_id, null);
});

test('an edited, nested or moved bullet keeps its id and whether it is folded; a removed one is marked deleted, never removed', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'N', body: BODY });
  const before = Object.fromEntries(listBlocks(db, note.id).map((b) => [b.text, b.id]));
  setFolded(db, before.Format, true);

  updateNote(db, note.id, { body: BODY.replace('Two exercises', 'Two short exercises') }); // an edit
  let after = listBlocks(db, note.id);
  assert.equal(after.find((b) => b.text === 'Two short exercises').id, before['Two exercises']);

  updateNote(db, note.id, { body: '* Agenda\n  * [ ] Book the room\n* Format\n  * One exercise\n  * Two short exercises\n* Venue\n' }); // Format moved below Agenda
  after = listBlocks(db, note.id);
  assert.deepEqual(after.map((b) => b.text), ['Agenda', 'Book the room', 'Format', 'One exercise', 'Two short exercises', 'Venue']);
  assert.equal(after.find((b) => b.text === 'Format').id, before.Format);
  assert.equal(after.find((b) => b.text === 'Format').folded, true, 'folded went with it');

  updateNote(db, note.id, { body: '* Agenda\n* Format\n  * One exercise\n  * Two short exercises\n' }); // two bullets removed
  assert.equal(listBlocks(db, note.id).length, 4);
  const gone = db.prepare('SELECT text, deleted_at FROM bullets WHERE note_id = ? AND deleted_at IS NOT NULL ORDER BY text').all(note.id);
  assert.deepEqual(gone.map((g) => g.text), ['Book the room', 'Venue']);
  assert.ok(gone.every((g) => g.deleted_at));
});

test('folding is not an edit: the note’s text and edited time stay', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'N', body: BODY });
  const [format] = listBlocks(db, note.id);
  const before = getNote(db, note.id);
  assert.equal(setFolded(db, format.id, true).folded, true);
  const after = getNote(db, note.id);
  assert.deepEqual([after.body, after.updated_at], [before.body, before.updated_at]);
  assert.equal(setFolded(db, format.id, false).folded, false);
  assert.equal(setFolded(db, '00000000-0000-0000-0000-000000000000', true), null);
});

test('with the module off no rows are made on a save, the ones there are kept, and switching it on makes them from the text', () => {
  const db = emptyDb();
  assert.deepEqual(listModules(db).find((m) => m.id === 'writing'), { ...listModules(db).find((m) => m.id === 'writing') });
  assert.equal(listModules(db).find((m) => m.id === 'writing').on, true, 'on until switched off');
  const note = createNote(db, { title: 'N', body: BODY });
  assert.equal(db.prepare('SELECT count(*) AS n FROM bullets').get().n, 6);
  setModule(db, 'writing', false);
  updateNote(db, note.id, { body: '* only one\n' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM bullets WHERE deleted_at IS NULL').get().n, 6, 'untouched while off');
  setModule(db, 'writing', true);
  assert.deepEqual(listBlocks(db, note.id).map((b) => b.text), ['only one'], 'made from the text when asked');
  assert.equal(listBlocks(db, 'nope'), null);
  updateNote(db, note.id, { body: '' });
  assert.deepEqual(listBlocks(db, note.id), []);
});

test('schema 50 moves an older database: the bullets table is new, every note is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', '* a')");
  db.exec('DROP TABLE bullets; PRAGMA user_version = 49;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bullets').get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
});
