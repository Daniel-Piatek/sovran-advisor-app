// Closing the day, the week and the quarter (time/4). Planning opens a day; the shutdown
// closes it: what got done, what moves, and the day in one line. The line is kept with
// the day and written in the General journal too, with the counts under it. A day closed
// too early can be reopened (its line is kept, and closing it again changes the same
// journal entry). Short and kind: no score, no streak.
// The Weekly Review looks back on a week: planned against done each day, the Highlights
// hit, the Weekly Goals that kept moving, and the lines of its closed days, with one line
// for its wins. Closing the week keeps that look back as it was.
// The quarterly review sums up the quarter's weeks (a week is in the quarter its Thursday
// is in) and lists its Goals (My Life Goals with the Quarter horizon), each marked
// reached, let go or still in play; reached and let go also archive the Goal in My Life.
// It ends with two or three Goals for the next quarter (they start on its first day).
// Loose ends are items in it: weeks never closed, Goals not marked once the last week has
// begun. Never badges.

import { randomUUID } from 'node:crypto';
import { addDays, getSettings, highlightOf, weekOf, weekGoals } from './planner.js';
import { listTasks, changeTask, getTask } from './tasks.js';
import { createEntry, updateEntry, getEntry, localDay } from './entries.js';
import { createLifeItem, updateLifeItem } from './life.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text);

export const MAX_LINE_LENGTH = 300;
export const LEAVE = ['missed', 'tomorrow', 'no_day'];
const OUTCOMES = ['done', 'not_done', 'moved'];
const CLOSE_COLUMNS = 'day, closed_at, line, highlight, highlight_task_id, planned, done, moved, missed, entry_id, updated_at';

export function checkCloseInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('line' in input && (typeof input.line !== 'string' || input.line.length > MAX_LINE_LENGTH)) return `line is text of at most ${MAX_LINE_LENGTH} characters.`;
  if ('highlight' in input && !['', ...OUTCOMES].includes(input.highlight)) return 'highlight is done, not_done or moved.';
  if ('leave' in input && (typeof input.leave !== 'object' || input.leave === null || Array.isArray(input.leave)
    || !Object.values(input.leave).every((choice) => LEAVE.includes(choice)))) return 'leave gives each task missed, tomorrow or no_day.';
  return null;
}

// How a day was closed (null: never). closed is false once it is reopened.
export function dayClose(db, day) {
  const row = db.prepare(`SELECT ${CLOSE_COLUMNS} FROM day_closes WHERE day = ? AND deleted_at IS NULL`).get(day);
  if (!row) return null;
  const task = row.highlight_task_id ? getTask(db, row.highlight_task_id) : null;
  const close = { ...row, closed: Boolean(row.closed_at), highlight_text: task?.text ?? '' };
  return { ...close, counts_line: countsLine(close) };
}

// Where "tomorrow" is for a day being closed: the day after it, but never before today
// (a day closed after midnight sends its tasks to the day that has begun).
export const nextDayFor = (day, today = localDay()) => (addDays(day, 1) < today ? today : addDays(day, 1));

// The counts in plain words, for the closed day and its journal entry.
export function countsLine({ planned, done, highlight, highlight_text: text }) {
  const tasks = planned ? `${done} of ${planned} planned ${planned === 1 ? 'task' : 'tasks'} done` : 'Nothing was planned';
  const outcome = { done: 'done', not_done: 'not done', moved: 'moved' }[highlight];
  return outcome && text ? `${tasks} · Highlight: ${text}, ${outcome}` : tasks;
}

// Closes a day: the Highlight done, not done or moved; every task left open stays in
// Missed, moves to tomorrow or loses its day, as `leave` says (by default as the Missed
// setting says); the line and the counts are kept, and written in the journal.
export function closeDay(db, day, { line = '', highlight = '', leave = {} } = {}, { today = localDay() } = {}) {
  if (!isDay(day)) throw fail(400, 'day is YYYY-MM-DD.');
  if (day > today) throw fail(400, 'A day is closed once it has come.');
  const previous = db.prepare('SELECT * FROM day_closes WHERE day = ? AND deleted_at IS NULL').get(day);
  const fallback = getSettings(db).missed === 'carry' ? 'tomorrow' : 'missed';
  const target = nextDayFor(day, today);
  const off = { due: target, plan_part: '', block_id: null };
  let moved = 0;

  const highlightId = highlightOf(db, day) ?? previous?.highlight_task_id ?? null;
  let outcome = previous?.highlight ?? '';
  const chosen = highlightId ? getTask(db, highlightId) : null;
  if (chosen && chosen.due === day) {
    if (chosen.done) outcome = 'done';
    else if (highlight === 'done') { changeTask(db, chosen.id, { done: true }); outcome = 'done'; }
    else if (highlight === 'moved') { changeTask(db, chosen.id, off); moved++; outcome = 'moved'; }
    else outcome = 'not_done';
  }
  for (const task of listTasks(db, { done: false }).filter((t) => t.due === day)) {
    if (chosen && task.id === chosen.id && outcome !== 'not_done') continue;
    const choice = leave[task.id] ?? fallback;
    if (choice === 'tomorrow') { changeTask(db, task.id, off); moved++; }
    if (choice === 'no_day') { changeTask(db, task.id, { due: '', plan_part: '', block_id: null }); moved++; }
  }

  const onDay = listTasks(db).filter((t) => t.due === day);
  const counts = {
    planned: onDay.length + moved + (previous?.moved ?? 0),
    done: onDay.filter((t) => t.done).length,
    moved: moved + (previous?.moved ?? 0),
    missed: onDay.filter((t) => !t.done).length,
  };
  const text = line.trim();
  const close = { ...counts, highlight: outcome, highlight_text: chosen?.text ?? '' };
  const body = [text, countsLine(close)].filter(Boolean).join('\n\n');
  const entry = previous?.entry_id && getEntry(db, previous.entry_id)
    ? updateEntry(db, previous.entry_id, { title: 'Day closed', body })
    : createEntry(db, { day, title: 'Day closed', body });

  const time = now();
  db.prepare(`INSERT INTO day_closes (id, created_at, updated_at, day, closed_at, line, highlight, highlight_task_id, planned, done, moved, missed, entry_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (day) DO UPDATE SET updated_at = excluded.updated_at, closed_at = excluded.closed_at, line = excluded.line,
      highlight = excluded.highlight, highlight_task_id = excluded.highlight_task_id, planned = excluded.planned,
      done = excluded.done, moved = excluded.moved, missed = excluded.missed, entry_id = excluded.entry_id, deleted_at = NULL`)
    .run(randomUUID(), time, time, day, time, text, outcome, chosen?.id ?? null, counts.planned, counts.done, counts.moved, counts.missed, entry.id);
  return { close: dayClose(db, day), entry };
}

// Opens a closed day again. Its line, counts and journal entry stay; tasks already moved
// stay where they went.
export function reopenDay(db, day) {
  const close = dayClose(db, day);
  if (!close) return null;
  db.prepare('UPDATE day_closes SET closed_at = NULL, updated_at = ? WHERE day = ?').run(now(), day);
  return dayClose(db, day);
}

// ---- The Weekly Review ----

export const MAX_WINS_LENGTH = 300;
const KEPT_MOVING = 2; // a Weekly Goal whose day was pushed later this often

function reviewRow(db, kind, period) {
  return db.prepare('SELECT period, closed_at, wins, snapshot, marks FROM reviews WHERE kind = ? AND period = ? AND deleted_at IS NULL').get(kind, period) ?? null;
}

// The week as it is now. Each day: planned and done (as counted when it was closed, else
// as its tasks are now; nothing for a day to come), its Highlight and what became of it,
// and its line.
export function weekLookBack(db, monday, { today = localDay() } = {}) {
  const all = listTasks(db);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((day) => {
    const close = dayClose(db, day);
    const tasks = all.filter((t) => t.due === day);
    const counted = close?.closed ? { planned: close.planned, done: close.done } : { planned: tasks.length, done: tasks.filter((t) => t.done).length };
    const row = db.prepare('SELECT task_id FROM highlights WHERE day = ? AND deleted_at IS NULL').get(day);
    const task = (close?.closed && close.highlight_task_id ? getTask(db, close.highlight_task_id) : null) ?? (row?.task_id ? getTask(db, row.task_id) : null);
    const outcome = task ? (task.done ? 'done' : close?.closed && close.highlight ? close.highlight : task.due === day ? 'not_done' : 'moved') : '';
    return {
      day,
      to_come: day > today,
      closed: Boolean(close?.closed),
      ...(day > today ? { planned: 0, done: 0 } : counted),
      highlight: task ? { text: task.text, outcome } : null,
      line: close?.line ?? '',
    };
  });
  const goals = weekGoals(db, monday);
  return {
    week: monday,
    days,
    planned: days.reduce((n, d) => n + d.planned, 0),
    done: days.reduce((n, d) => n + d.done, 0),
    highlights: days.filter((d) => d.highlight).length,
    highlights_hit: days.filter((d) => d.highlight?.outcome === 'done').length,
    goals: goals.map((t) => ({ text: t.text, done: t.done, moves: t.due_moves })),
    kept_moving: goals.filter((t) => t.due_moves >= KEPT_MOVING).map((t) => ({ text: t.text, done: t.done, moves: t.due_moves })),
  };
}

// The week's review: closed, its look back as it was kept; open, as it is now.
export function weekReview(db, day, options) {
  const monday = weekOf(day);
  const row = reviewRow(db, 'week', monday);
  const closed = Boolean(row?.closed_at);
  return {
    week: monday,
    closed,
    closed_at: row?.closed_at ?? null,
    wins: row?.wins ?? '',
    look_back: closed && row.snapshot ? JSON.parse(row.snapshot) : weekLookBack(db, monday, options),
  };
}

export function checkReviewInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('wins' in input && (typeof input.wins !== 'string' || input.wins.length > MAX_WINS_LENGTH)) return `wins is text of at most ${MAX_WINS_LENGTH} characters.`;
  return null;
}

function keepReview(db, kind, period, { wins, snapshot, closed }) {
  const time = now();
  db.prepare(`INSERT INTO reviews (id, created_at, updated_at, kind, period, closed_at, wins, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, period) DO UPDATE SET updated_at = excluded.updated_at, closed_at = excluded.closed_at,
      wins = excluded.wins, snapshot = coalesce(excluded.snapshot, snapshot), deleted_at = NULL`)
    .run(randomUUID(), time, time, kind, period, closed ? time : null, wins, snapshot ?? null);
}

// Closes the week: its look back is kept as it is now, with the wins line.
export function closeWeek(db, day, { wins = '' } = {}, options) {
  const monday = weekOf(day);
  keepReview(db, 'week', monday, { wins: wins.trim(), snapshot: JSON.stringify(weekLookBack(db, monday, options)), closed: true });
  return weekReview(db, monday, options);
}

// Opens it again: the wins line stays; the look back is live until it is closed again.
export function reopenWeek(db, day, options) {
  const monday = weekOf(day);
  const row = reviewRow(db, 'week', monday);
  if (!row?.closed_at) return null;
  keepReview(db, 'week', monday, { wins: row.wins, closed: false });
  return weekReview(db, monday, options);
}

// ---- The quarter ----

export const MARKS = ['reached', 'let_go', 'in_play'];
export const NEXT_GOALS = 3; // two or three keep a quarter clear: a word from the fourth, never a stop
const pad = (n) => String(n).padStart(2, '0');

// The first day of the quarter a day is in, and of the one n quarters on.
export function quarterOf(day, n = 0) {
  const [year, month] = day.split('-').map(Number);
  const index = Math.floor((month - 1) / 3) + n;
  const y = year + Math.floor(index / 4);
  return `${y}-${pad(((index % 4) + 4) % 4 * 3 + 1)}-01`;
}
export const quarterEnd = (start) => addDays(quarterOf(start, 1), -1);
export const quarterName = (start) => `Q${(Number(start.slice(5, 7)) - 1) / 3 + 1} ${start.slice(0, 4)}`;

// Its weeks: the Mondays whose Thursday falls in it.
export function quarterWeeks(start) {
  const end = quarterEnd(start);
  const weeks = [];
  for (let monday = weekOf(start); monday <= end; monday = addDays(monday, 7)) {
    const thursday = addDays(monday, 3);
    if (thursday >= start && thursday <= end) weeks.push(monday);
  }
  return weeks;
}

const goalRows = (db) => db.prepare(`SELECT id, title, state, starts_on FROM life_items
  WHERE kind = 'goal' AND horizon = 'quarter' AND deleted_at IS NULL ORDER BY created_at`).all().map((row) => ({ ...row }));

// The quarter's Goals: active ones that have started by its end, and any marked in it.
function quarterGoals(db, start, marks) {
  const end = quarterEnd(start);
  return goalRows(db)
    .filter((g) => marks[g.id] || (g.state === 'active' && (!g.starts_on || g.starts_on <= end)))
    .map((g) => ({ id: g.id, title: g.title, state: g.state, mark: marks[g.id] ?? '' }));
}

function quarterLookBack(db, start, marks, { today = localDay() } = {}) {
  const weeks = quarterWeeks(start).map((monday) => {
    const { closed, wins, look_back: back } = weekReview(db, monday, { today });
    return {
      week: monday, to_come: monday > today, closed, wins,
      goals: back.goals.length, goals_done: back.goals.filter((g) => g.done).length,
      highlights: back.highlights, highlights_hit: back.highlights_hit, planned: back.planned, done: back.done,
    };
  });
  const sum = (key) => weeks.reduce((n, w) => n + w[key], 0);
  return {
    quarter: start,
    name: quarterName(start),
    ends: quarterEnd(start),
    weeks,
    goals_done: sum('goals_done'), goals: sum('goals'),
    highlights_hit: sum('highlights_hit'), highlights: sum('highlights'),
    planned: sum('planned'), done: sum('done'),
    quarter_goals: quarterGoals(db, start, marks),
  };
}

// The quarterly review: closed, as it was kept; open, as it is now, with its loose ends.
export function quarterReview(db, day, { today = localDay() } = {}) {
  const start = quarterOf(day);
  const row = reviewRow(db, 'quarter', start);
  const closed = Boolean(row?.closed_at);
  const marks = JSON.parse(row?.marks ?? '{}');
  const back = closed && row.snapshot ? JSON.parse(row.snapshot) : quarterLookBack(db, start, marks, { today });
  const lastWeek = weekOf(quarterEnd(start));
  const next = quarterOf(start, 1);
  const loose = closed ? [] : [
    ...back.weeks.filter((w) => addDays(w.week, 6) < today && !w.closed).map((w) => ({ kind: 'week', week: w.week })),
    ...(today >= lastWeek ? back.quarter_goals.filter((g) => !g.mark).map((g) => ({ kind: 'goal', id: g.id, title: g.title })) : []),
  ];
  return {
    quarter: start,
    closed,
    closed_at: row?.closed_at ?? null,
    wins: row?.wins ?? '',
    look_back: back,
    loose_ends: loose,
    next: { quarter: next, name: quarterName(next), goals: goalRows(db).filter((g) => g.starts_on === next).map((g) => ({ id: g.id, title: g.title })) },
    next_goals_max: NEXT_GOALS,
  };
}

function keepMarks(db, start, marks) {
  const time = now();
  db.prepare(`INSERT INTO reviews (id, created_at, updated_at, kind, period, marks) VALUES (?, ?, ?, 'quarter', ?, ?)
    ON CONFLICT (kind, period) DO UPDATE SET marks = excluded.marks, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, start, JSON.stringify(marks));
}

// Marks one of the quarter's Goals. Reached and let go archive it in My Life; still in
// play keeps it (or brings it back) as active.
export function markGoal(db, day, goalId, mark, options) {
  if (!MARKS.includes(mark)) throw fail(400, 'mark is reached, let_go or in_play.');
  const start = quarterOf(day);
  const row = reviewRow(db, 'quarter', start);
  if (row?.closed_at) throw fail(400, 'That quarter is closed: reopen it first.');
  const marks = JSON.parse(row?.marks ?? '{}');
  if (!quarterGoals(db, start, marks).some((g) => g.id === goalId)) throw fail(404, 'That Goal is not in this quarter.');
  marks[goalId] = mark;
  keepMarks(db, start, marks);
  updateLifeItem(db, goalId, { state: mark === 'in_play' ? 'active' : 'archived' });
  return quarterReview(db, day, options);
}

// A Goal for the next quarter: a My Life Goal with the Quarter horizon, starting then.
export function addNextGoal(db, day, title, options) {
  if (typeof title !== 'string' || !title.trim()) throw fail(400, 'A Goal needs a name.');
  createLifeItem(db, { kind: 'goal', title, horizon: 'quarter', starts_on: quarterOf(day, 1) });
  return quarterReview(db, day, options);
}

export function closeQuarter(db, day, { wins = '' } = {}, options = {}) {
  const start = quarterOf(day);
  const marks = JSON.parse(reviewRow(db, 'quarter', start)?.marks ?? '{}');
  keepReview(db, 'quarter', start, { wins: wins.trim(), snapshot: JSON.stringify(quarterLookBack(db, start, marks, options)), closed: true });
  return quarterReview(db, day, options);
}

export function reopenQuarter(db, day, options) {
  const start = quarterOf(day);
  const row = reviewRow(db, 'quarter', start);
  if (!row?.closed_at) return null;
  keepReview(db, 'quarter', start, { wins: row.wins, closed: false });
  return quarterReview(db, day, options);
}
