// Your assistant on a board (advanced/writing/7): board_read is free; board_draw waits for a card and is one change you can undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote } from '../../notes.js';
import { createConversation } from '../../assistant.js';
import { runTool, applyAction, dismissAction, undoAction, getAction, offeredTools } from '../../assistant-tools.js';
import { setPermission } from '../../permissions.js';
import { setModule } from '../../modules.js';
import { createBoard, addItem, getBoard, planDrawing } from '../../boards.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
function setUp() {
  const db = emptyDb();
  const note = createNote(db, { title: 'Ideas for the autumn workshop', body: '* x' });
  const board = createBoard(db, { note_id: note.id, title: 'Workshop flow' });
  const pricing = addItem(db, board.id, { kind: 'card', text: 'Pricing case', x: 400, y: 100 });
  const qa = addItem(db, board.id, { kind: 'card', text: 'Q&A', x: 800, y: 100 });
  addItem(db, board.id, { kind: 'arrow', from_id: pricing.id, to_id: qa.id });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-asst-'));
  const cards = [];
  const run = { conversationId: createConversation(db, dir).id, messageId: null, card: (c) => cards.push(c) };
  return { db, board, pricing, qa, run, cards };
}

test('board_read lists the boards, then reads one as text: cards, what they point to, arrows; it is free and changes nothing', () => {
  const { db, board, run, pricing } = setUp();
  const list = JSON.parse(runTool(db, 'board_read', {}, run));
  assert.deepEqual(list.map((b) => [b.board_id, b.title, b.note]), [[board.id, 'Workshop flow', 'Ideas for the autumn workshop']]);
  const text = runTool(db, 'board_read', { board_id: board.id }, run);
  assert.match(text, new RegExp(`Card \\[${pricing.id}\\]: Pricing case`));
  assert.match(text, /- Pricing case → Q&A/);
  assert.throws(() => runTool(db, 'board_read', { board_id: '00000000-0000-4000-8000-000000000000' }, run), (e) => e.status === 404);
  assert.equal(getBoard(db, board.id).items.length, 3);
});

test('board_draw waits on a card and draws nothing; Approve draws it, marked as the assistant’s, as one change; Undo takes all of it back', () => {
  const { db, board, pricing, qa, run, cards } = setUp();
  const out = JSON.parse(runTool(db, 'board_draw', { board_id: board.id, reason: 'A pause', items: [
    { kind: 'card', key: 'break', text: 'Break', x: 600, y: 300 },
    { kind: 'arrow', from: pricing.id, to: 'break' },
    { kind: 'arrow', from: 'break', to: qa.id },
  ] }, run));
  assert.ok(out.waiting);
  assert.equal(getBoard(db, board.id).items.length, 3, 'nothing is drawn yet');
  const card = getAction(db, out.waiting);
  assert.deepEqual([card.kind, card.state, card.title], ['board_draw', 'proposed', 'Workshop flow: 1 card and 2 arrows']);

  assert.equal(applyAction(db, card.id).state, 'applied');
  const drawn = getBoard(db, board.id).items.filter((i) => i.origin === 'assistant');
  assert.deepEqual(drawn.map((i) => [i.kind, i.text]), [['card', 'Break'], ['arrow', ''], ['arrow', '']]);
  assert.ok(drawn.every((i) => i.change_id === card.id), 'one change');
  const breakCard = drawn[0];
  assert.deepEqual([drawn[1].from_id, drawn[1].to_id, drawn[2].from_id, drawn[2].to_id], [pricing.id, breakCard.id, breakCard.id, qa.id]);
  assert.equal(getBoard(db, board.id).items.length, 6);

  assert.equal(undoAction(db, card.id).state, 'undone');
  assert.deepEqual(getBoard(db, board.id).items.map((i) => i.kind), ['card', 'card', 'arrow'], 'the board is as it was');
  assert.match(runTool(db, 'board_read', { board_id: board.id }, run), /Pricing case → Q&A/);
  void cards;
});

test('Not now draws nothing; Does it alone (the change switch) draws at once with a card to undo it; a bad drawing is refused before it reaches a card', () => {
  const { db, board, pricing, run } = setUp();
  const waiting = JSON.parse(runTool(db, 'board_draw', { board_id: board.id, items: [{ kind: 'card', text: 'One' }] }, run)).waiting;
  assert.equal(dismissAction(db, waiting).state, 'dismissed');
  assert.equal(getBoard(db, board.id).items.length, 3);

  assert.throws(() => runTool(db, 'board_draw', { board_id: board.id, items: [] }, run), /list of cards/);
  assert.throws(() => runTool(db, 'board_draw', { board_id: board.id, items: [{ kind: 'arrow', from: pricing.id, to: 'nowhere' }] }, run), /neither a card of the board nor a new one/);
  assert.throws(() => runTool(db, 'board_draw', { board_id: board.id, items: [{ kind: 'card', text: ' ' }] }, run), /needs its words/);
  assert.throws(() => runTool(db, 'board_draw', { board_id: board.id, items: Array.from({ length: 21 }, () => ({ kind: 'card', text: 'x' })) }, run), /at most 20/);
  assert.throws(() => planDrawing(db, 'nope', [{ kind: 'card', text: 'x' }]), (e) => e.status === 404);

  setPermission(db, 'change', 'alone');
  const alone = JSON.parse(runTool(db, 'board_draw', { board_id: board.id, items: [{ kind: 'card', text: 'At once' }] }, run));
  assert.equal(alone.drawn, true);
  assert.equal(getBoard(db, board.id).items.filter((i) => i.origin === 'assistant').length, 1);
  undoAction(db, alone.card);
  assert.equal(getBoard(db, board.id).items.filter((i) => i.origin === 'assistant').length, 0);
});

test('the two tools are offered only while the module is on', () => {
  const { db } = setUp();
  const names = () => offeredTools(db).map((t) => t.name).filter((n) => n.startsWith('board_'));
  assert.deepEqual(names(), ['board_read', 'board_draw']);
  setModule(db, 'writing', false);
  assert.deepEqual(names(), []);
});

test('schema 56 moves an older database: the assistant’s cards can be board drawings, every row is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-old-'));
  let db = openDatabase(dir);
  const conv = createConversation(db, dir);
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'assistant_actions'").get().sql;
  db.exec('DROP INDEX IF EXISTS assistant_actions_by_message; DROP TABLE assistant_actions');
  db.exec(table.replace(", 'board_draw'", '')); // the table as it was before this lesson
  db.exec(`INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title, before, after, reason) VALUES ('a1', 'a', 'a', '${conv.id}', 'add_task', 'done', '', 'Keep me', '{}', '{}', '')`);
  assert.throws(() => db.exec(`INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title, before, after, reason) VALUES ('a2', 'a', 'a', '${conv.id}', 'board_draw', 'done', '', 'x', '{}', '{}', '')`));
  db.exec('PRAGMA user_version = 55;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT title FROM assistant_actions WHERE id = 'a1'").get().title, 'Keep me');
  db.exec(`INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title, before, after, reason) VALUES ('a2', 'a', 'a', '${conv.id}', 'board_draw', 'done', '', 'Allowed now', '{}', '{}', '')`);
  db.close();
});
