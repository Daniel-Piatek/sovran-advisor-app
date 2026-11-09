// Boards (boards.js, advanced/writing/6): rows for the board, cards, words and arrows; a card that points at a page shows it live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote } from '../../notes.js';
import { createPerson } from '../../people.js';
import { createTask } from '../../tasks.js';
import { createBoard, getBoard, renameBoard, addItem, changeItem, removeItem, boardText } from '../../boards.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a board is a row in a note; cards, words and arrows are rows of the board', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Ideas for the autumn workshop', body: 'x' });
  const board = createBoard(db, { note_id: note.id, title: 'Workshop flow' });
  assert.deepEqual([board.title, board.note_id, board.note_title, board.items], ['Workshop flow', note.id, 'Ideas for the autumn workshop', []]);
  const welcome = addItem(db, board.id, { kind: 'card', text: 'Welcome', x: 40, y: 40 });
  const close = addItem(db, board.id, { kind: 'card', text: 'Close', x: 600, y: 300 });
  const words = addItem(db, board.id, { kind: 'text', text: 'Ask about the venue', x: 40, y: 400 });
  const arrow = addItem(db, board.id, { kind: 'arrow', from_id: welcome.id, to_id: close.id, label: 'then' });
  const read = getBoard(db, board.id);
  assert.deepEqual(read.items.map((i) => [i.kind, i.text]), [['card', 'Welcome'], ['card', 'Close'], ['text', 'Ask about the venue'], ['arrow', '']]);
  assert.deepEqual([arrow.from_id, arrow.to_id, arrow.label], [welcome.id, close.id, 'then']);
  assert.equal(words.origin, 'typed');
  assert.throws(() => createBoard(db, { note_id: '00000000-0000-4000-8000-000000000000' }), (e) => e.status === 404);
  assert.equal(renameBoard(db, board.id, 'Flow').title, 'Flow');
});

test('what is refused: an empty card, an arrow to nowhere or to itself, a card that points at nothing, a bad kind', () => {
  const db = emptyDb();
  const board = createBoard(db, {});
  const a = addItem(db, board.id, { kind: 'card', text: 'A' });
  assert.throws(() => addItem(db, board.id, { kind: 'card', text: '  ' }), /Write something/);
  assert.throws(() => addItem(db, board.id, { kind: 'arrow', from_id: a.id, to_id: a.id }), /two different cards/);
  assert.throws(() => addItem(db, board.id, { kind: 'arrow', from_id: a.id, to_id: 'nope' }), /two different cards/);
  assert.throws(() => addItem(db, board.id, { kind: 'card', ref_table: 'notes', ref_id: '00000000-0000-4000-8000-000000000000' }), (e) => e.status === 404);
  assert.throws(() => addItem(db, board.id, { kind: 'text', ref_table: 'notes', ref_id: 'x' }), /point at a note/);
  assert.throws(() => addItem(db, board.id, { kind: 'circle', text: 'x' }), /card, text or arrow/);
  assert.throws(() => addItem(db, '00000000-0000-4000-8000-000000000000', { kind: 'card', text: 'x' }), (e) => e.status === 404);
});

test('a card that points at a note, a person or a task shows it live: change the note’s first line and the card follows', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Book notes: Deep Work', body: '* Focus is a skill' });
  const person = createPerson(db, { name: 'Lena Fischer' });
  const task = createTask(db, { text: 'Send the agenda', due: '2026-11-12' });
  const board = createBoard(db, {});
  addItem(db, board.id, { kind: 'card', ref_table: 'notes', ref_id: note.id });
  addItem(db, board.id, { kind: 'card', ref_table: 'people', ref_id: person.id });
  addItem(db, board.id, { kind: 'card', ref_table: 'tasks', ref_id: task.id, text: 'for Friday' });
  const lives = getBoard(db, board.id).items.map((i) => i.live);
  assert.deepEqual(lives.map((l) => [l.kind, l.title, l.sub]), [['note', 'Book notes: Deep Work', 'Focus is a skill'], ['person', 'Lena Fischer', ''], ['task', 'Send the agenda', 'due 2026-11-12']]);
  updateNote(db, note.id, { body: '* Depth beats hours' });
  assert.equal(getBoard(db, board.id).items[0].live.sub, 'Depth beats hours');
  db.prepare("UPDATE notes SET deleted_at = 'x' WHERE id = ?").run(note.id);
  assert.equal(getBoard(db, board.id).items[0].live.missing, true, 'a page that is gone says so');
});

test('moving a card saves its place (kept on the canvas); removing a card takes the arrows that joined it', () => {
  const db = emptyDb();
  const board = createBoard(db, {});
  const a = addItem(db, board.id, { kind: 'card', text: 'A' });
  const b = addItem(db, board.id, { kind: 'card', text: 'B' });
  addItem(db, board.id, { kind: 'arrow', from_id: a.id, to_id: b.id });
  assert.deepEqual([changeItem(db, a.id, { x: 5000, y: -4 }).x, changeItem(db, a.id, { x: 5000, y: -4 }).y], [1160, 0]);
  assert.equal(changeItem(db, a.id, { text: 'Welcome' }).text, 'Welcome');
  removeItem(db, a.id);
  assert.deepEqual(getBoard(db, board.id).items.map((i) => i.id), [b.id]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM board_items').get().n, 3, 'marked deleted, not removed');
  assert.throws(() => removeItem(db, a.id), (e) => e.status === 404);
});

test('the board as short text for your assistant: each card, what it points to, and each arrow', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Pricing thoughts', body: '* Package' });
  const board = createBoard(db, { note_id: note.id, title: 'Workshop flow' });
  const a = addItem(db, board.id, { kind: 'card', text: 'Welcome' });
  const b = addItem(db, board.id, { kind: 'card', ref_table: 'notes', ref_id: note.id });
  addItem(db, board.id, { kind: 'arrow', from_id: a.id, to_id: b.id });
  const text = boardText(db, board.id);
  assert.match(text, /Board “Workshop flow” in the note “Pricing thoughts”/);
  assert.match(text, new RegExp(`- Card \\[${a.id}\\]: Welcome`));
  assert.match(text, /Card \[.+\]: Pricing thoughts — points to a note, Package/);
  assert.match(text, /- Welcome → Pricing thoughts/);
  assert.equal(boardText(db, '00000000-0000-4000-8000-000000000000'), null);
});

test('schema 55 moves an older database: boards and their items are new, every note is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boards-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', 'x')");
  db.exec('DROP TABLE board_items; DROP TABLE boards; PRAGMA user_version = 54;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM boards').get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
});
