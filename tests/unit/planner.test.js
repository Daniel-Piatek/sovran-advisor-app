// The Planner (planner.js): settings, time blocks, a day, the Tray and Missed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createTask, changeTask, listTasks } from '../../tasks.js';
import { createNote, getNote, updateNote } from '../../notes.js';
import { getSettings, updateSettings, checkSettingsInput, createBlock, deleteBlock, restoreBlock, plannerDay, DEFAULTS } from '../../planner.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const TODAY = '2026-10-26';

test('settings have defaults, keep what you change, and refuse what makes no sense', () => {
  const db = emptyDb();
  assert.deepEqual(getSettings(db), DEFAULTS);
  assert.equal(updateSettings(db, { work_minutes: 360, missed: 'ask' }).work_minutes, 360);
  assert.equal(getSettings(db).missed, 'ask');
  assert.notEqual(checkSettingsInput({ missed: 'never' }), null);
  assert.notEqual(checkSettingsInput({ colour: 'red' }), null);
  assert.throws(() => updateSettings(db, { split: '07:00' }), (err) => err.status === 400);
});

test('planning a task gives it the day and a part; a task in a page gets its @date', () => {
  const db = emptyDb();
  const own = createTask(db, { text: 'Sort the attic', estimate: 60 });
  const note = createNote(db, { title: 'Bank', body: '- [ ] Call the bank ~30m' });
  const [bank] = listTasks(db).filter((t) => t.text === 'Call the bank');
  changeTask(db, own.id, { due: TODAY, plan_part: 'afternoon' });
  changeTask(db, bank.id, { due: TODAY, plan_part: 'morning' });
  const day = plannerDay(db, TODAY, { today: TODAY });
  assert.deepEqual(day.tasks.map((t) => [t.text, t.plan_part]).sort(), [['Call the bank', 'morning'], ['Sort the attic', 'afternoon']]);
  assert.equal(getNote(db, note.id).body, `- [ ] Call the bank ~30m @${TODAY}`);
  // Out again: back in the Tray.
  changeTask(db, own.id, { due: '', plan_part: '' });
  assert.deepEqual(plannerDay(db, TODAY, { today: TODAY }).tray.no_day.map((t) => t.text), ['Sort the attic']);
});

test('a block holds tasks of its day; deleting it leaves them on the day, Undo puts them back', () => {
  const db = emptyDb();
  const deep = createBlock(db, { day: TODAY, starts_at: '09:00', ends_at: '10:30', kind: 'deep' });
  const outline = createTask(db, { text: 'Write the outline', estimate: 60 });
  changeTask(db, outline.id, { due: TODAY, block_id: deep.id, plan_part: 'morning' });
  assert.equal(plannerDay(db, TODAY, { today: TODAY }).tasks[0].block_id, deep.id);
  assert.throws(() => changeTask(db, outline.id, { due: '2026-10-27', block_id: deep.id }), (err) => err.status === 400);
  deleteBlock(db, deep.id);
  assert.equal(plannerDay(db, TODAY, { today: TODAY }).tasks[0].block_id, null);
  restoreBlock(db, deep.id);
  assert.equal(plannerDay(db, TODAY, { today: TODAY }).tasks[0].block_id, deep.id);
  changeTask(db, outline.id, { due: '2026-10-27' });
  assert.equal(listTasks(db)[0].block_id, null, 'moved to another day, it leaves the block');
  assert.throws(() => createBlock(db, { day: TODAY, starts_at: '11:00', ends_at: '10:00', kind: 'deep' }), (err) => err.status === 400);
});

test('the Tray: Missed with its day, then no day, then the Speedies; carry moves Missed to today', () => {
  const db = emptyDb();
  createTask(db, { text: 'Renew the pass', due: '2026-10-22' });
  createTask(db, { text: 'Sort the attic', estimate: 60 });
  createTask(db, { text: 'Reply to Jonas', estimate: 5 });
  createTask(db, { text: 'Book the room', estimate: 15 }); // fifteen minutes is still a Speedy
  createTask(db, { text: 'Read about rates', due: 'someday' });
  const { tray } = plannerDay(db, TODAY, { today: TODAY });
  assert.deepEqual([tray.missed.map((t) => [t.text, t.due]), tray.no_day.map((t) => t.text), tray.speedies.map((t) => t.text)],
    [[['Renew the pass', '2026-10-22']], ['Sort the attic'], ['Reply to Jonas', 'Book the room']]);
  updateSettings(db, { missed: 'carry' });
  const carried = plannerDay(db, TODAY, { today: TODAY });
  assert.equal(carried.carried, 1);
  assert.deepEqual([carried.tray.missed.length, carried.tasks.map((t) => t.text)], [0, ['Renew the pass']]);
});

test('the Planner API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-test-'));
  const app = await startServer({ port: 0, dataDir, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  await send('POST', '/api/events', { title: 'Standup', starts_at: `${TODAY}T09:15`, ends_at: `${TODAY}T09:30` });
  const block = await (await send('POST', '/api/blocks', { day: TODAY, starts_at: '10:00', ends_at: '11:30', kind: 'deep' })).json();
  assert.equal((await send('POST', '/api/blocks', { day: TODAY, starts_at: '10:00', ends_at: '11:30', kind: 'nap' })).status, 400);
  const task = await (await send('POST', '/api/tasks', { text: 'Write', estimate: 60 })).json();
  assert.equal((await send('PATCH', `/api/tasks/${task.id}`, { plan_part: 'evening' })).status, 400);
  await send('PATCH', `/api/tasks/${task.id}`, { due: TODAY, block_id: block.id, plan_part: 'morning' });
  const day = await (await fetch(`${app.url}/api/planner?day=${TODAY}`)).json();
  assert.deepEqual([day.events.map((e) => e.title), day.blocks.length, day.tasks[0].block_id], [['Standup'], 1, block.id]);
  assert.equal((await (await send('PATCH', '/api/settings', { buffer_minutes: 120 })).json()).buffer_minutes, 120);
  assert.equal((await send('PATCH', '/api/settings', { buffer_minutes: -1 })).status, 400);
  assert.equal((await send('DELETE', `/api/blocks/${block.id}`)).status, 200);
  assert.equal((await send('POST', `/api/blocks/${block.id}/restore`, {})).status, 200);
});

// ---- Weekly Goals, the Highlight, the week and planning flows (time/3) ----

import { setHighlight, plannerWeek, weekOf, getFlow, setFlowStep, highlightOf } from '../../planner.js';

test('a Weekly Goal is marked for its week; the week lists them', () => {
  const db = emptyDb();
  assert.equal(weekOf('2026-10-29'), '2026-10-26');
  const offer = createTask(db, { text: 'Write the offer', goal_week: '2026-10-26' });
  createTask(db, { text: 'Just a task' });
  assert.deepEqual(plannerWeek(db, '2026-10-28', { today: TODAY }).week_goals.map((t) => t.text), ['Write the offer']);
  changeTask(db, offer.id, { goal_week: '' });
  assert.equal(plannerWeek(db, '2026-10-28', { today: TODAY }).week_goals.length, 0);
});

test('one Highlight a day: choosing another replaces it and says which; a task off the day is planned for it', () => {
  const db = emptyDb();
  const a = createTask(db, { text: 'Outline', due: TODAY });
  const b = createTask(db, { text: 'Offer' }); // no day yet
  assert.deepEqual(setHighlight(db, TODAY, a.id), { day: TODAY, task_id: a.id, previous: null });
  const replaced = setHighlight(db, TODAY, b.id);
  assert.deepEqual([replaced.task_id, replaced.previous], [b.id, a.id]);
  assert.equal(listTasks(db).find((t) => t.id === b.id).due, TODAY, 'planned for the day');
  setHighlight(db, TODAY, replaced.previous); // undo
  assert.equal(highlightOf(db, TODAY), a.id);
  changeTask(db, a.id, { due: '2026-10-27' });
  assert.equal(highlightOf(db, TODAY), null, 'moved away, it is no longer the day’s Highlight');
});

test('the week: seven days from Monday, each with its tasks and Highlight', () => {
  const db = emptyDb();
  const t = createTask(db, { text: 'Call', due: '2026-10-28' });
  setHighlight(db, '2026-10-28', t.id);
  const week = plannerWeek(db, '2026-10-28', { today: TODAY });
  assert.deepEqual(week.days.map((d) => d.day), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual([week.days[2].tasks.map((x) => x.text), week.days[2].highlight_id], [['Call'], t.id]);
});

test('a planning flow remembers done and skipped steps, and where to go on', () => {
  const db = emptyDb();
  assert.equal(getFlow(db, 'weekly', '2026-10-26').next, 'brain_zen');
  setFlowStep(db, 'weekly', '2026-10-26', 'brain_zen', 'done');
  const flow = setFlowStep(db, 'weekly', '2026-10-26', 'goal_alignment', 'skipped');
  assert.deepEqual([flow.steps, flow.next], [{ brain_zen: 'done', goal_alignment: 'skipped' }, 'schedule']);
  assert.equal(getFlow(db, 'daily', TODAY).next, 'review', 'each flow is its own');
  assert.throws(() => setFlowStep(db, 'weekly', '2026-10-26', 'nap', 'done'), (err) => err.status === 400);
});

test('a placed task keeps its time in its day; another day (in the app or typed in its page) leaves the time behind', () => {
  const db = emptyDb();
  const own = createTask(db, { text: 'Sort the attic', due: TODAY, estimate: 60 });
  assert.equal(changeTask(db, own.id, { plan_part: 'morning', plan_at: '10:45' }).plan_at, '10:45');
  assert.equal(changeTask(db, own.id, { due: '2026-10-27' }).plan_at, '');
  const note = createNote(db, { title: 'Plan', body: `- [ ] Call the bank @${TODAY}` });
  const line = listTasks(db).find((t) => t.text === 'Call the bank');
  assert.equal(changeTask(db, line.id, { plan_at: '14:15' }).plan_at, '14:15');
  updateNote(db, note.id, { body: '- [ ] Call the bank @2026-10-29' });
  assert.equal(listTasks(db).find((t) => t.text === 'Call the bank').plan_at, '');
});

test('a database from before the day in hours gets plan_at, every task kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-v24-'));
  let db = openDatabase(dir);
  createTask(db, { text: 'Kept', due: TODAY });
  db.exec('ALTER TABLE tasks DROP COLUMN plan_at; PRAGMA user_version = 24;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listTasks(db).map((t) => [t.text, t.plan_at]), [['Kept', '']]);
  db.close();
});
