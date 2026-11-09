// Closing the day, the week and the quarter (reviews.js, time/4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createTask, changeTask, listTasks, getTask } from '../../tasks.js';
import { entriesOfDay, getEntry } from '../../entries.js';
import { setHighlight, updateSettings } from '../../planner.js';
import { closeDay, reopenDay, dayClose, nextDayFor, countsLine, weekReview, closeWeek, reopenWeek } from '../../reviews.js';
import { createNote, updateNote } from '../../notes.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const DAY = '2026-10-26';
const byText = (db, text) => listTasks(db).find((t) => t.text === text);

test('closing a day: the Highlight, what is left, the counts and the line in the journal', () => {
  const db = emptyDb();
  for (const text of ['Write the offer', 'Pay the invoice', 'Call the bank', 'Sort the attic', 'Tidy the studio']) createTask(db, { text, due: DAY });
  changeTask(db, byText(db, 'Pay the invoice').id, { done: true });
  setHighlight(db, DAY, byText(db, 'Write the offer').id);
  const { close, entry } = closeDay(db, DAY, {
    line: '  Slow start, good afternoon.  ',
    highlight: 'done',
    leave: { [byText(db, 'Call the bank').id]: 'tomorrow', [byText(db, 'Sort the attic').id]: 'no_day' },
  }, { today: DAY });
  assert.equal(getTask(db, byText(db, 'Write the offer').id).done, true);
  assert.equal(byText(db, 'Call the bank').due, '2026-10-27');
  assert.equal(byText(db, 'Sort the attic').due, '');
  assert.equal(byText(db, 'Tidy the studio').due, DAY); // left in Missed, as the setting says
  assert.deepEqual([close.closed, close.line, close.highlight, close.planned, close.done, close.moved, close.missed],
    [true, 'Slow start, good afternoon.', 'done', 5, 2, 2, 1]);
  assert.equal(close.highlight_text, 'Write the offer');
  assert.equal(entry.journal_name, 'General');
  assert.equal(entry.day, DAY);
  assert.equal(entry.body, 'Slow start, good afternoon.\n\n2 of 5 planned tasks done · Highlight: Write the offer, done');
});

test('reopen a day closed too early, change the line: the same journal entry changes', () => {
  const db = emptyDb();
  createTask(db, { text: 'Call the bank', due: DAY });
  createTask(db, { text: 'Sort the attic', due: DAY });
  closeDay(db, DAY, { line: 'Too early', leave: { [byText(db, 'Sort the attic').id]: 'tomorrow' } }, { today: DAY });
  const reopened = reopenDay(db, DAY);
  assert.deepEqual([reopened.closed, reopened.line], [false, 'Too early']);
  changeTask(db, byText(db, 'Call the bank').id, { done: true });
  const { close } = closeDay(db, DAY, { line: 'Better than it looked' }, { today: DAY });
  assert.deepEqual([close.closed, close.planned, close.done, close.moved, close.missed], [true, 2, 1, 1, 0]);
  const entries = entriesOfDay(db, DAY);
  assert.equal(entries.length, 1);
  assert.equal(getEntry(db, entries[0].id).body, 'Better than it looked\n\n1 of 2 planned tasks done');
  assert.equal(reopenDay(db, '2026-10-01'), null);
});

test('a day to come cannot be closed; carry sends what is left to tomorrow; after midnight, tomorrow is today', () => {
  const db = emptyDb();
  assert.throws(() => closeDay(db, '2026-10-27', {}, { today: DAY }), (err) => err.status === 400);
  updateSettings(db, { missed: 'carry' });
  createTask(db, { text: 'Call the bank', due: '2026-10-25' });
  closeDay(db, '2026-10-25', {}, { today: DAY });
  assert.equal(byText(db, 'Call the bank').due, DAY);
  assert.equal(nextDayFor(DAY, DAY), '2026-10-27');
  assert.equal(dayClose(db, '2026-10-25').missed, 0);
  assert.equal(countsLine({ planned: 0, done: 0, highlight: '' }), 'Nothing was planned');
});

test('the Highlight moved goes to tomorrow; not done stays in Missed', () => {
  const db = emptyDb();
  const first = createTask(db, { text: 'Draft the talk', due: DAY });
  setHighlight(db, DAY, first.id);
  assert.equal(closeDay(db, DAY, { highlight: 'moved' }, { today: DAY }).close.highlight, 'moved');
  assert.equal(getTask(db, first.id).due, '2026-10-27');
  const db2 = emptyDb();
  const second = createTask(db2, { text: 'Draft the talk', due: DAY });
  setHighlight(db2, DAY, second.id);
  const { close } = closeDay(db2, DAY, { highlight: 'not_done' }, { today: DAY });
  assert.deepEqual([close.highlight, close.missed], ['not_done', 1]);
  assert.equal(getTask(db2, second.id).due, DAY);
});

test('a database from before closing days gets the table, every row kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-old-'));
  let db = openDatabase(dir);
  createTask(db, { text: 'Kept', due: DAY });
  db.exec('DROP TABLE day_closes; PRAGMA user_version = 16;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listTasks(db).map((t) => t.text), ['Kept']);
  assert.equal(closeDay(db, DAY, { line: 'Fine' }, { today: DAY }).close.line, 'Fine');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the shutdown API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const day = '2026-10-01';
  assert.equal(await (await fetch(`${app.url}/api/shutdown/${day}`)).json(), null);
  assert.equal((await send('PUT', `/api/shutdown/${day}`, { line: 5 })).status, 400);
  assert.equal((await send('PUT', `/api/shutdown/${day}`, { leave: { x: 'later' } })).status, 400);
  assert.equal((await send('DELETE', `/api/shutdown/${day}`)).status, 404);
  const closed = await (await send('PUT', `/api/shutdown/${day}`, { line: 'Quiet day' })).json();
  assert.deepEqual([closed.close.closed, closed.entry.body], [true, 'Quiet day\n\nNothing was planned']);
  assert.equal((await (await fetch(`${app.url}/api/planner?day=${day}`)).json()).closed.line, 'Quiet day');
  assert.equal((await (await send('DELETE', `/api/shutdown/${day}`)).json()).closed, false);
  assert.equal((await send('PUT', '/api/shutdown/2999-01-01', {})).status, 400);
});

const MONDAY = '2026-10-26';
const at = (n) => { const d = new Date(`${MONDAY}T12:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('a day pushed later counts as a move, for tasks of their own and in a page; earlier or none does not', () => {
  const db = emptyDb();
  const own = createTask(db, { text: 'Draft the talk', due: at(0) });
  changeTask(db, own.id, { due: at(1) });
  changeTask(db, own.id, { due: at(3) });
  changeTask(db, own.id, { due: at(2) }); // earlier
  changeTask(db, own.id, { due: '' });
  assert.equal(getTask(db, own.id).due_moves, 2);
  const note = createNote(db, { title: 'Plan', body: `- [ ] Call the bank @${at(0)}` });
  const line = byText(db, 'Call the bank');
  changeTask(db, line.id, { due: at(1) });
  updateNote(db, note.id, { body: `- [ ] Call the bank @${at(4)}` }); // typed in the page
  assert.equal(getTask(db, line.id).due_moves, 2);
});

test('the Weekly Review: planned against done, Highlights hit, goals that kept moving, the lines; closing keeps it as it was', () => {
  const db = emptyDb();
  const options = { today: at(4) };
  const offer = createTask(db, { text: 'Write the offer', due: at(0), goal_week: MONDAY });
  createTask(db, { text: 'Pay the invoice', due: at(0) });
  const talk = createTask(db, { text: 'Draft the talk', due: at(1), goal_week: MONDAY });
  createTask(db, { text: 'Weekend thing', due: at(5) });
  setHighlight(db, at(0), offer.id);
  changeTask(db, offer.id, { done: true });
  closeDay(db, at(0), { line: 'Offer sent.' }, { today: at(0) });
  setHighlight(db, at(1), talk.id);
  changeTask(db, talk.id, { due: at(2) });
  changeTask(db, talk.id, { due: at(3) });
  const review = weekReview(db, at(2), options);
  assert.equal(review.week, MONDAY);
  assert.equal(review.closed, false);
  const back = review.look_back;
  assert.deepEqual(back.days.map((d) => [d.planned, d.done]), [[2, 1], [0, 0], [0, 0], [1, 0], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual([back.days[0].closed, back.days[0].line, back.days[5].to_come], [true, 'Offer sent.', true]);
  assert.deepEqual(back.days[0].highlight, { text: 'Write the offer', outcome: 'done' });
  assert.deepEqual(back.days[1].highlight, { text: 'Draft the talk', outcome: 'moved' });
  assert.deepEqual([back.planned, back.done, back.highlights, back.highlights_hit], [3, 1, 2, 1]);
  assert.deepEqual(back.kept_moving, [{ text: 'Draft the talk', done: false, moves: 2 }]);

  const closed = closeWeek(db, at(2), { wins: '  The offer is out.  ' }, options);
  assert.deepEqual([closed.closed, closed.wins], [true, 'The offer is out.']);
  changeTask(db, talk.id, { done: true }); // afterwards: the kept look back does not change
  assert.equal(weekReview(db, MONDAY, options).look_back.done, 1);
  const reopened = reopenWeek(db, MONDAY, options);
  assert.deepEqual([reopened.closed, reopened.wins, reopened.look_back.done], [false, 'The offer is out.', 2]);
  assert.equal(reopenWeek(db, MONDAY, options), null);
});

test('a database from before the Weekly Review gets due_moves and reviews, every row kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-v17-'));
  let db = openDatabase(dir);
  createTask(db, { text: 'Kept', due: DAY });
  db.exec('DROP TABLE reviews; ALTER TABLE tasks DROP COLUMN due_moves; PRAGMA user_version = 17;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listTasks(db).map((t) => [t.text, t.due_moves]), [['Kept', 0]]);
  assert.equal(closeWeek(db, DAY, { wins: 'Fine' }).wins, 'Fine');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Weekly Review API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-week-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const open = await (await fetch(`${app.url}/api/reviews/week/2026-10-01`)).json();
  assert.deepEqual([open.week, open.closed, open.look_back.days.length], ['2026-09-28', false, 7]);
  assert.equal((await send('PUT', '/api/reviews/week/2026-10-01', { wins: 3 })).status, 400);
  assert.equal((await send('DELETE', '/api/reviews/week/2026-10-01')).status, 404);
  assert.equal((await (await send('PUT', '/api/reviews/week/2026-10-01', { wins: 'Calm week' })).json()).wins, 'Calm week');
  assert.equal((await (await send('DELETE', '/api/reviews/week/2026-09-30')).json()).closed, false);
});

import { quarterOf, quarterEnd, quarterName, quarterWeeks, quarterReview, markGoal, addNextGoal, closeQuarter, reopenQuarter } from '../../reviews.js';
import { createLifeItem, getLifeItem } from '../../life.js';

test('a quarter: its first and last day, its name, and its weeks by their Thursday', () => {
  assert.equal(quarterOf('2026-11-15'), '2026-10-01');
  assert.equal(quarterOf('2026-11-15', 1), '2027-01-01');
  assert.equal(quarterOf('2026-02-01', -1), '2025-10-01');
  assert.equal(quarterEnd('2026-10-01'), '2026-12-31');
  assert.equal(quarterName('2026-10-01'), 'Q4 2026');
  const weeks = quarterWeeks('2026-10-01');
  // 1 October 2026 is a Thursday: its week (from 28 September) is in Q4; the week of 28 December too.
  assert.deepEqual([weeks[0], weeks.at(-1), weeks.length], ['2026-09-28', '2026-12-28', 14]);
});

test('the quarterly review: weeks summed up, Goals marked (and archived), loose ends as items, next quarter’s Goals', () => {
  const db = emptyDb();
  const today = '2026-12-29'; // the quarter's last week
  const options = { today };
  const offer = createTask(db, { text: 'Write the offer', due: '2026-10-26', goal_week: '2026-10-26' });
  changeTask(db, offer.id, { done: true });
  setHighlight(db, '2026-10-26', offer.id);
  closeWeek(db, '2026-10-26', { wins: 'The offer is out.' }, options);
  const course = createLifeItem(db, { kind: 'goal', title: 'Launch the course', horizon: 'quarter' });
  const book = createLifeItem(db, { kind: 'goal', title: 'Write the book', horizon: 'quarter' });
  createLifeItem(db, { kind: 'goal', title: 'Someday goal', horizon: 'someday' });

  let review = quarterReview(db, '2026-11-02', options);
  const back = review.look_back;
  assert.equal(back.name, 'Q4 2026');
  const week = back.weeks.find((w) => w.week === '2026-10-26');
  assert.deepEqual([week.closed, week.wins, week.goals_done, week.goals, week.highlights_hit], [true, 'The offer is out.', 1, 1, 1]);
  assert.deepEqual([back.goals_done, back.highlights_hit], [1, 1]);
  assert.deepEqual(back.quarter_goals.map((g) => g.title), ['Launch the course', 'Write the book']);
  assert.ok(review.loose_ends.some((l) => l.kind === 'week' && l.week === '2026-10-05'));
  assert.ok(!review.loose_ends.some((l) => l.week === '2026-10-26'));
  assert.deepEqual(review.loose_ends.filter((l) => l.kind === 'goal').map((l) => l.title), ['Launch the course', 'Write the book']);

  review = markGoal(db, today, course.id, 'reached', options);
  assert.equal(getLifeItem(db, course.id).state, 'archived');
  review = markGoal(db, today, book.id, 'in_play', options);
  assert.deepEqual(review.look_back.quarter_goals.map((g) => [g.title, g.mark]), [['Launch the course', 'reached'], ['Write the book', 'in_play']]);
  assert.equal(review.loose_ends.filter((l) => l.kind === 'goal').length, 0);
  assert.throws(() => markGoal(db, today, course.id, 'maybe', options), (err) => err.status === 400);

  review = addNextGoal(db, today, 'Grow the list', options);
  assert.deepEqual(review.next.goals.map((g) => g.title), ['Grow the list']);
  assert.equal(review.next.name, 'Q1 2027');
  // Next quarter: what is still in play and the new Goal; not what was reached.
  assert.deepEqual(quarterReview(db, '2027-01-10', { today: '2027-01-10' }).look_back.quarter_goals.map((g) => g.title), ['Write the book', 'Grow the list']);
  assert.ok(!review.look_back.quarter_goals.some((g) => g.title === 'Grow the list'));

  const closed = closeQuarter(db, today, { wins: 'A good quarter.' }, options);
  assert.deepEqual([closed.closed, closed.wins, closed.loose_ends.length], [true, 'A good quarter.', 0]);
  assert.throws(() => markGoal(db, today, book.id, 'let_go', options), (err) => err.status === 400);
  assert.equal(reopenQuarter(db, today, options).closed, false);
});

test('a database from before quarter marks gets them, every review kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-v18-'));
  let db = openDatabase(dir);
  closeWeek(db, DAY, { wins: 'Kept' });
  db.exec('ALTER TABLE reviews DROP COLUMN marks; PRAGMA user_version = 18;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(weekReview(db, DAY).wins, 'Kept');
  assert.equal(quarterReview(db, DAY).quarter, '2026-10-01');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the quarterly review API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-quarter-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const goal = await (await send('POST', '/api/life', { kind: 'goal', title: 'Launch the course', horizon: 'quarter' })).json();
  const review = await (await fetch(`${app.url}/api/reviews/quarter/2026-11-02`)).json();
  assert.deepEqual([review.quarter, review.look_back.quarter_goals.map((g) => g.title)], ['2026-10-01', ['Launch the course']]);
  assert.equal((await send('PUT', `/api/reviews/quarter/2026-11-02/goals/${goal.id}`, { mark: 'nope' })).status, 400);
  assert.equal((await (await send('PUT', `/api/reviews/quarter/2026-11-02/goals/${goal.id}`, { mark: 'let_go' })).json()).look_back.quarter_goals[0].mark, 'let_go');
  assert.equal((await send('POST', '/api/reviews/quarter/2026-11-02/next', { title: '' })).status, 400);
  assert.equal((await (await send('POST', '/api/reviews/quarter/2026-11-02/next', { title: 'Grow the list' })).json()).next.goals.length, 1);
  assert.equal((await (await send('PUT', '/api/reviews/quarter/2026-11-02', { wins: 'Done' })).json()).closed, true);
  assert.equal((await (await send('DELETE', '/api/reviews/quarter/2026-12-01')).json()).closed, false);
});
