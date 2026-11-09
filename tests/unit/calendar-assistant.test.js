// Your assistant and your calendar (calendar-assistant.js, Calendar in depth 10): calendar_list reads; calendar_propose only ever makes a card,
// and only Approve makes or moves the event. Made-up calendars; no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createConversation } from '../../assistant.js';
import { runTool, applyAction, dismissAction, undoAction, getAction, offeredTools } from '../../assistant-tools.js';
import { setPermission } from '../../permissions.js';
import { setModule } from '../../modules.js';
import { createEvent, getEvent, eventsBetween } from '../../events.js';
import { createTask, changeTask } from '../../tasks.js';
import { updateSettings } from '../../planner.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function setUp() {
  const db = emptyDb();
  updateSettings(db, { day_start: '09:00', split: '14:00', day_end: '17:00' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-asst-'));
  const cards = [];
  const run = { conversationId: createConversation(db, dir).id, messageId: null, card: (c) => cards.push(c) };
  return { db, run, cards };
}
const call = (db, name, args, run) => JSON.parse(runTool(db, name, args, run));

test('calendar_list reads the days: events with ids and where they are from, and the free time left once the plan is in them; it changes nothing', () => {
  const { db, run } = setUp();
  const lunch = createEvent(db, { title: 'Lunch', starts_at: `${day(1)}T12:00`, ends_at: `${day(1)}T13:00` });
  createEvent(db, { title: 'Call', starts_at: `${day(1)}T10:00`, ends_at: `${day(1)}T10:30` });
  const task = createTask(db, { text: 'Draft the agenda', due: day(1), estimate: 60 });
  changeTask(db, task.id, { plan_part: 'afternoon', plan_at: '13:00' });
  const [today, tomorrow] = call(db, 'calendar_list', { from: day(0), to: day(1) }, run);
  assert.deepEqual([today.day, today.events.length, today.free.map((g) => [g.from, g.to, g.free_minutes])], [day(0), 0, [['09:00', '17:00', 480]]]);
  assert.deepEqual(tomorrow.events.map((e) => [e.title, e.source, e.changeable]), [['Call', 'yours', true], ['Lunch', 'yours', true]]);
  assert.equal(tomorrow.events[1].id, lunch.id);
  // The afternoon gap (13:00 to 17:00) has the hour of the planned task in it: three hours are free.
  assert.deepEqual(tomorrow.free.find((g) => g.from === '13:00'), { from: '13:00', to: '17:00', free_minutes: 180, after: 'Lunch' });
  assert.equal(tomorrow.planned_tasks, 1);
  assert.throws(() => runTool(db, 'calendar_list', { from: 'soon' }, run), /from is a day/);
  assert.throws(() => runTool(db, 'calendar_list', { from: day(0), to: day(40) }, run), /At most 21 days/);
  assert.equal(eventsBetween(db, day(0), day(5)).length, 2, 'nothing changed');
});

test('calendar_propose makes only a card, even with “Does it alone”; Approve makes the event in your own calendar; Not now makes nothing; Undo takes it back', () => {
  const { db, run, cards } = setUp();
  setPermission(db, 'change', 'alone'); // the switch that lets other changes through: never a meeting
  const out = call(db, 'calendar_propose', { title: 'Workshop dry run', starts_at: `${day(3)}T14:00`, minutes: 60, reason: 'Thursday is free in your calendar and your plan' }, run);
  assert.ok(out.waiting);
  assert.match(out.note, /Nothing was added/);
  const card = getAction(db, out.waiting);
  assert.deepEqual([card.kind, card.state, card.title, card.after.ends_at], ['calendar_propose', 'proposed', 'Workshop dry run', `${day(3)}T15:00`]);
  assert.equal(eventsBetween(db, day(0), day(10)).length, 0, 'nothing exists before Approve');

  const approved = applyAction(db, card.id);
  assert.equal(approved.state, 'applied');
  const [made] = eventsBetween(db, day(0), day(10));
  assert.deepEqual([made.title, made.starts_at, made.ends_at], ['Workshop dry run', `${day(3)}T14:00`, `${day(3)}T15:00`]);
  assert.equal(getAction(db, card.id).target_id, made.id);
  undoAction(db, card.id);
  assert.equal(eventsBetween(db, day(0), day(10)).length, 0, 'Undo took it back');

  const second = call(db, 'calendar_propose', { title: 'Another', starts_at: `${day(4)}T09:00`, minutes: 30 }, run);
  dismissAction(db, second.waiting);
  assert.equal(eventsBetween(db, day(0), day(10)).length, 0, 'Not now makes nothing');
  assert.equal(cards.length, 2);
});

test('the card says when it overlaps; a move is a card that moves one of your events and Undo puts it back; a bad proposal is refused before it reaches a card', () => {
  const { db, run } = setUp();
  const call1 = createEvent(db, { title: 'Call with Lena', starts_at: `${day(3)}T14:30`, ends_at: `${day(3)}T15:30` });
  const out = call(db, 'calendar_propose', { title: 'Workshop dry run', starts_at: `${day(3)}T14:00`, minutes: 60 }, run);
  assert.deepEqual(out.overlaps, ['Call with Lena']);
  assert.match(out.note, /It overlaps “Call with Lena”/);
  assert.equal(getAction(db, out.waiting).after.overlaps[0].starts_at, `${day(3)}T14:30`);

  const moved = call(db, 'calendar_propose', { move_event_id: call1.id, starts_at: `${day(3)}T16:00`, ends_at: `${day(3)}T17:00`, reason: 'It clashes' }, run);
  applyAction(db, moved.waiting);
  assert.deepEqual([getEvent(db, call1.id).starts_at, getEvent(db, call1.id).title], [`${day(3)}T16:00`, 'Call with Lena']);
  undoAction(db, moved.waiting);
  assert.equal(getEvent(db, call1.id).starts_at, `${day(3)}T14:30`);

  assert.throws(() => runTool(db, 'calendar_propose', { starts_at: 'tomorrow', title: 'x' }, run), /starts_at is a moment/);
  assert.throws(() => runTool(db, 'calendar_propose', { starts_at: `${day(3)}T14:00`, ends_at: `${day(3)}T13:00`, title: 'x' }, run), /after starts_at/);
  assert.throws(() => runTool(db, 'calendar_propose', { starts_at: `${day(3)}T14:00`, minutes: 30 }, run), /needs a name/);
  assert.throws(() => runTool(db, 'calendar_propose', { move_event_id: '00000000-0000-4000-8000-000000000000', starts_at: `${day(3)}T14:00`, minutes: 30 }, run), (e) => e.status === 404);
  assert.throws(() => runTool(db, 'calendar_propose', { title: 'x', starts_at: `${day(3)}T14:00`, minutes: 30, where: 'google' }, run), /No Google calendar can be written to/);
});

test('the two tools are the module’s: switch Calendar in depth off and your assistant cannot see or propose calendar events', () => {
  const { db, run } = setUp();
  assert.ok(offeredTools(db).some((t) => t.name === 'calendar_list') && offeredTools(db).some((t) => t.name === 'calendar_propose'));
  setModule(db, 'calendar-plus', false);
  assert.ok(!offeredTools(db).some((t) => t.name.startsWith('calendar_')));
  setModule(db, 'calendar-plus', true);
  assert.ok(offeredTools(db).some((t) => t.name === 'calendar_propose'));
});

test('schema 65 moves an older database: a calendar proposal is a kind of card, every card is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-asst-old-'));
  let db = openDatabase(dir);
  const convo = createConversation(db, dir);
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, title, target_id) VALUES ('a1', 'x', 'x', ?, 'add_task', 'done', 'Keep me', '')").run(convo.id);
  db.close();
  // An older table: the kinds before calendar_propose.
  const raw = new DatabaseSync(path.join(dir, 'app.db'));
  const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'assistant_actions'").get().sql.replace(", 'calendar_propose'", '');
  raw.exec('PRAGMA foreign_keys = OFF; ALTER TABLE assistant_actions RENAME TO assistant_actions_now; DROP INDEX IF EXISTS assistant_actions_by_message;');
  raw.exec(sql);
  raw.exec('INSERT INTO assistant_actions SELECT * FROM assistant_actions_now; DROP TABLE assistant_actions_now; PRAGMA user_version = 64;');
  assert.throws(() => raw.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, title, target_id) VALUES ('a2', 'x', 'x', ?, 'calendar_propose', 'proposed', 'x', '')").run(convo.id));
  raw.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT title FROM assistant_actions WHERE id = 'a1'").get().title, 'Keep me');
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, title, target_id) VALUES ('a3', 'x', 'x', ?, 'calendar_propose', 'proposed', 'New', '')").run(convo.id);
  db.close();
});
