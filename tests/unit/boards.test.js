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
import { createBoard, getBoard, renameBoard, addItem, changeItem, removeItem, boardText, listOwnBoards, listNoteBoards, deleteBoard, restoreBoard, cardToNote, boardSources, ENDLESS_SIZE } from '../../boards.js';
import { createEntry } from '../../entries.js';
import { createCapture } from '../../captures.js';
import { addStroke } from '../../ink.js';

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
  assert.throws(() => addItem(db, board.id, { kind: 'circle', text: 'x' }), /card, text, arrow or group/);
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

// ---- Boards of their own (schema 72 here, the Boards tab of Notes) ----

test('a board of its own is endless: a canvas of 20000 units each way, so cards and ink keep their place far out', () => {
  const db = emptyDb();
  const board = createBoard(db, { title: 'Pricing ideas', endless: true });
  assert.deepEqual([board.endless, board.width, board.height, board.note_id], [true, ENDLESS_SIZE, ENDLESS_SIZE, null]);
  const card = addItem(db, board.id, { kind: 'card', text: 'Far out', x: 15000, y: 12000 });
  assert.deepEqual([card.x, card.y], [15000, 12000]);
  assert.deepEqual([changeItem(db, card.id, { x: 99999 }).x], [ENDLESS_SIZE - 40]);
  assert.equal(addStroke(db, board.id, [[14000, 13000, 0.5, 0]]).points[0][0], 14000);
  const inNote = createBoard(db, { note_id: createNote(db, { title: 'N', body: '' }).id, endless: true });
  assert.deepEqual([inNote.endless, inNote.width], [false, 1200], 'a board in a note keeps its page size');
});

test('a card can point at a journal entry or an Inbox item, and shows it live', () => {
  const db = emptyDb();
  const board = createBoard(db, { endless: true });
  const entry = createEntry(db, { day: '2026-11-14', body: 'Long walk by the sea\nThought about the course' });
  const capture = createCapture(db, { body: 'Idea: a price for groups\nask Maria' });
  const a = addItem(db, board.id, { kind: 'card', ref_table: 'journal_entries', ref_id: entry.id });
  const b = addItem(db, board.id, { kind: 'card', ref_table: 'captures', ref_id: capture.id });
  assert.deepEqual([a.live.kind, a.live.title, a.live.sub, a.live.path], ['journal', 'Long walk by the sea', 'Thought about the course', `/journal/entries/${entry.id}`]);
  assert.deepEqual([b.live.kind, b.live.title, b.live.sub], ['inbox', 'Idea: a price for groups', 'ask Maria']);
  db.prepare("UPDATE journal_entries SET deleted_at = 'x' WHERE id = ?").run(entry.id);
  assert.equal(getBoard(db, board.id).items[0].live.missing, true);
});

test('what can be brought onto a board is found by its words across notes, journal entries and the Inbox', () => {
  const db = emptyDb();
  createNote(db, { title: 'Pricing the workshop', body: 'three tiers' });
  createNote(db, { title: 'Garden', body: 'tomatoes' });
  createEntry(db, { day: '2026-11-10', body: 'Talked pricing with Lena' });
  createCapture(db, { body: 'pricing for groups?' });
  const found = boardSources(db, 'pricing');
  assert.deepEqual([found.notes.map((n) => n.title), found.journal.length, found.inbox.map((i) => i.title)], [['Pricing the workshop'], 1, ['pricing for groups?']]);
  assert.equal(boardSources(db, '').notes.length, 2, 'with no words, the newest');
});

test('a quick card becomes a real note: the note is made from its words and the card points at it from then on', () => {
  const db = emptyDb();
  const board = createBoard(db, { endless: true });
  const card = addItem(db, board.id, { kind: 'card', text: 'Offer a group price\nfor 5 or more' });
  const { note_id: noteId, item } = cardToNote(db, card.id);
  assert.deepEqual([item.ref_table, item.ref_id, item.text, item.live.title, item.live.sub], ['notes', noteId, '', 'Offer a group price', 'for 5 or more']);
  assert.throws(() => cardToNote(db, card.id), /Only a card with its own words/);
});

test('a group is a coloured box with a name; moving it moves the cards inside it and nothing else', () => {
  const db = emptyDb();
  const board = createBoard(db, { endless: true });
  const group = addItem(db, board.id, { kind: 'group', text: 'Money', color: 'life', x: 10000, y: 10000, w: 600, h: 400 });
  const inside = addItem(db, board.id, { kind: 'card', text: 'In', x: 10100, y: 10100 });
  const outside = addItem(db, board.id, { kind: 'card', text: 'Out', x: 11000, y: 10100 });
  assert.deepEqual([group.kind, group.text, group.color, group.w, group.h], ['group', 'Money', 'life', 600, 400]);
  changeItem(db, group.id, { x: 10200, y: 10050 });
  const after = new Map(getBoard(db, board.id).items.map((i) => [i.id, i]));
  assert.deepEqual([after.get(inside.id).x, after.get(inside.id).y], [10300, 10150]);
  assert.deepEqual([after.get(outside.id).x, after.get(outside.id).y], [11000, 10100]);
  assert.equal(changeItem(db, group.id, { w: 20 }).w, 160, 'a group is never smaller than 160 by 100');
  assert.deepEqual([changeItem(db, group.id, { w: 700, h: 900, color: 'notes' }).w, changeItem(db, group.id, {}).h, changeItem(db, group.id, {}).color], [700, 900, 'notes']);
  assert.throws(() => addItem(db, board.id, { kind: 'group', color: 'accent' }), /colour is one of/);
  assert.throws(() => addItem(db, board.id, { kind: 'arrow', from_id: group.id, to_id: inside.id }), /two different cards/, 'arrows join cards, not groups');
  assert.match(boardText(db, board.id), /Group “Money” \(blue colour\) holds: In/);
  assert.match(boardText(db, board.id), /\(a board of its own\)/);
});

test('the Boards tab lists the boards of their own, newest change first; deleting marks and Undo brings one back', () => {
  const db = emptyDb();
  const older = createBoard(db, { title: 'Older', endless: true });
  const newer = createBoard(db, { title: 'Newer', endless: true });
  createBoard(db, { note_id: createNote(db, { title: 'Workshop', body: '' }).id, title: 'In a note' });
  db.prepare("UPDATE boards SET updated_at = CASE id WHEN ? THEN '2026-10-01T00:00:00Z' ELSE '2026-11-01T00:00:00Z' END").run(older.id);
  addItem(db, older.id, { kind: 'card', text: 'Fresh card' });
  assert.deepEqual(listOwnBoards(db).map((b) => [b.title, b.cards, b.names]), [['Older', 1, ['Fresh card']], ['Newer', 0, []]]);
  assert.deepEqual(listNoteBoards(db).map((b) => [b.title, b.note_title]), [['In a note', 'Workshop']]);
  deleteBoard(db, newer.id);
  assert.deepEqual(listOwnBoards(db).map((b) => b.title), ['Older']);
  restoreBoard(db, newer.id);
  assert.equal(listOwnBoards(db).length, 2);
});

test('schema 72 moves an older database: boards can be endless, board items take groups and journal and Inbox cards, every item is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boards-75-'));
  let db = openDatabase(dir);
  const note = createNote(db, { title: 'Keep', body: '' });
  const board = createBoard(db, { note_id: note.id, title: 'Old board' });
  const card = addItem(db, board.id, { kind: 'card', text: 'Old card' });
  db.exec('DROP INDEX board_items_by_board; ALTER TABLE board_items RENAME TO bi_new; ALTER TABLE boards DROP COLUMN endless;');
  db.exec(`CREATE TABLE board_items (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')), board_id TEXT NOT NULL REFERENCES boards (id),
    kind TEXT NOT NULL CHECK (kind IN ('card', 'text', 'arrow')), ref_table TEXT CHECK (ref_table IN ('notes', 'people', 'tasks')), ref_id TEXT,
    text TEXT NOT NULL DEFAULT '', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, w REAL NOT NULL DEFAULT 200, h REAL NOT NULL DEFAULT 80,
    from_id TEXT, to_id TEXT, label TEXT NOT NULL DEFAULT '', change_id TEXT);
    INSERT INTO board_items SELECT id, created_at, updated_at, deleted_at, origin, board_id, kind, ref_table, ref_id, text, x, y, w, h, from_id, to_id, label, change_id FROM bi_new;
    DROP TABLE bi_new; PRAGMA user_version = 71;`);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const read = getBoard(db, board.id);
  assert.deepEqual([read.endless, read.items.map((i) => [i.id, i.text, i.color])], [false, [[card.id, 'Old card', '']]]);
  assert.equal(addItem(db, board.id, { kind: 'group', text: 'New' }).kind, 'group');
  db.close();
});
