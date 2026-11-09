// The assistant plans with you and closes the day with you (time/3 and time/4, their
// assistant steps): it reads the week, proposes moves as cards, and never moves a task,
// nor saves the day's line, without your yes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createTask, getTask, changeTask } from '../../tasks.js';
import { setHighlight, highlightOf, addDays, weekOf } from '../../planner.js';
import { dayClose } from '../../reviews.js';
import { runTool, applyAction, undoAction, planCards } from '../../assistant-tools.js';
import { createConversation } from '../../assistant.js';
import { localDay } from '../../entries.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
function chat(db) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const conversation = createConversation(db, dir);
  const cards = [];
  return { cards, run: { conversationId: conversation.id, card: (c) => cards.push(c) } };
}

test('it reads the week as the Planner counts it, and says which day holds too much', () => {
  const db = emptyDb();
  const monday = weekOf(localDay());
  createTask(db, { text: 'Write the offer', due: addDays(monday, 2), estimate: 400 });
  createTask(db, { text: 'Sort the attic', due: addDays(monday, 2), estimate: 120 });
  const week = JSON.parse(runTool(db, 'read_week', { day: monday }, {}));
  assert.equal(week.days.length, 7);
  const wednesday = week.days[2];
  assert.deepEqual([wednesday.planned_minutes, wednesday.budget_minutes, wednesday.over_by_minutes], [520, 480, 40]);
  assert.deepEqual(wednesday.tasks.map((t) => t.text), ['Write the offer', 'Sort the attic']);
});

test('a move, a Highlight and a block wait on cards; Apply does it, Undo takes it back', () => {
  const db = emptyDb();
  const { run, cards } = chat(db);
  const day = '2026-10-28';
  const attic = createTask(db, { text: 'Sort the attic', due: day, estimate: 120 });
  changeTask(db, attic.id, { plan_part: 'morning' });
  runTool(db, 'propose_plan', { move: 'move', task_id: attic.id, day: '2026-10-30', reason: 'Wednesday is full' }, run);
  assert.equal(getTask(db, attic.id).due, day, 'nothing moves until you apply it');
  assert.deepEqual([cards[0].kind, cards[0].state, cards[0].title], ['plan', 'proposed', 'Move “Sort the attic” to Fri 30 Oct']);
  assert.equal(planCards(db).length, 1);
  applyAction(db, cards[0].id);
  assert.equal(getTask(db, attic.id).due, '2026-10-30');
  undoAction(db, cards[0].id);
  assert.deepEqual([getTask(db, attic.id).due, getTask(db, attic.id).plan_part], [day, 'morning']);

  const first = createTask(db, { text: 'Draft the talk', due: day });
  const second = createTask(db, { text: 'Call the bank', due: day });
  setHighlight(db, day, first.id);
  runTool(db, 'propose_plan', { move: 'highlight', task_id: second.id, day, reason: 'It is the Weekly Goal' }, run);
  applyAction(db, cards[1].id);
  assert.equal(highlightOf(db, day), second.id);
  undoAction(db, cards[1].id);
  assert.equal(highlightOf(db, day), first.id);

  runTool(db, 'propose_plan', { move: 'block', day, starts_at: '09:00', ends_at: '10:30', block_kind: 'deep', reason: 'Room for the talk' }, run);
  assert.equal(cards[2].title, 'A Deep Work block on Wed 28 Oct, 09:00–10:30');
  applyAction(db, cards[2].id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM blocks WHERE deleted_at IS NULL').get().n, 1);
  undoAction(db, cards[2].id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM blocks WHERE deleted_at IS NULL').get().n, 0);
  assert.throws(() => runTool(db, 'propose_plan', { move: 'block', day, starts_at: '10:00', ends_at: '09:00', reason: 'x' }, run), (err) => err.status === 400);
});

test('closing the day: the suggested line is saved only when you approve it, and Undo reopens the day', () => {
  const db = emptyDb();
  const { run, cards } = chat(db);
  const today = localDay();
  const task = createTask(db, { text: 'Write the offer', due: today });
  changeTask(db, task.id, { done: true });
  setHighlight(db, today, task.id);
  const read = JSON.parse(runTool(db, 'read_day', {}, run));
  assert.equal(read.highlight, 'Write the offer');
  runTool(db, 'propose_close_day', { line: 'The offer went out.', highlight: 'done' }, run);
  assert.equal(dayClose(db, today), null, 'not saved yet');
  applyAction(db, cards[0].id);
  assert.deepEqual([dayClose(db, today).closed, dayClose(db, today).line], [true, 'The offer went out.']);
  assert.equal(JSON.parse(runTool(db, 'read_day', {}, run)).closed.line, 'The offer went out.');
  undoAction(db, cards[0].id);
  assert.equal(dayClose(db, today).closed, false);
  assert.throws(() => runTool(db, 'propose_close_day', { day: '2999-01-01', line: 'x' }, run), (err) => err.status === 400);
});

test('a database from before plan cards keeps every card, and takes the new kinds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-v23-'));
  let db = openDatabase(dir);
  const conversation = createConversation(db, dir);
  db.exec(`DROP TABLE assistant_actions;
    CREATE TABLE assistant_actions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'assistant', conversation_id TEXT NOT NULL REFERENCES conversations (id), message_id TEXT REFERENCES chat_messages (id),
      kind TEXT NOT NULL CHECK (kind IN ('add_task', 'add_note', 'append_to_journal', 'edit_note', 'change_task', 'step')),
      state TEXT NOT NULL CHECK (state IN ('done', 'proposed', 'applied', 'dismissed', 'undone', 'refused')),
      target_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', before TEXT NOT NULL DEFAULT '{}', after TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '');
    PRAGMA user_version = 23;`);
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title) VALUES ('a1', 'x', 'x', ?, 'step', 'refused', '', 'Kept')").run(conversation.id);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT title FROM assistant_actions WHERE id = 'a1'").get().title, 'Kept');
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id) VALUES ('a2', 'x', 'x', ?, 'close_day', 'proposed', '2026-10-26')").run(conversation.id);
  db.close();
});

test('“plan my week with me”, end to end with the stand-in claude: a card with a reason, on the board’s list', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-api-'));
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = (url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const monday = weekOf(localDay());
  await post('/api/tasks', { text: 'Write the offer', due: addDays(monday, 1), estimate: 400 });
  await post('/api/tasks', { text: 'Sort the attic', due: addDays(monday, 1), estimate: 120 });
  const conversation = await post('/api/conversations', {});
  const lines = (await (await fetch(`${app.url}/api/conversations/${conversation.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Plan my week with me' }),
  })).text()).trim().split('\n').map((l) => JSON.parse(l));
  const message = lines.at(-1).message;
  assert.match(message.text, /holds too much, over by 40 minutes/);
  assert.equal(message.cards[0].kind, 'plan');
  assert.match(message.cards[0].reason, /over budget by 40 min/);
  const board = await (await fetch(`${app.url}/api/assistant-actions/plans`)).json();
  assert.deepEqual(board.map((c) => c.id), [message.cards[0].id]);
});
