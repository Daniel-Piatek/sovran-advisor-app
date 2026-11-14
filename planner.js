// The Planner (time/2): where your fixed events and the tasks you choose meet your time.
// A day shows its events (locked: their time is fixed in the calendar), the tasks planned
// for it (a task is planned for a day by giving it that day, so it shows there in Tasks
// too, and never on the Calendar), and its time blocks, containers of time with a kind
// that hold tasks. Its Tray holds what waits for a day. The budget (planned work plus a
// buffer) is counted on the page. Settings live in the settings table.
// Weekly and Daily Planning (time/3): a Weekly Goal is a task marked for its week
// (tasks.goal_week, that week's Monday); each day has one Highlight (highlights); and a
// planning flow remembers its steps (planning), so it resumes where it was left.

import { randomUUID } from 'node:crypto';
import { listTasks, changeTask, getTask, localDay } from './tasks.js';
import { isSpeedy } from './public/due.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const BLOCK_KINDS = ['deep', 'shallow', 'routine', 'batch', 'buffer'];

// ---- Settings ----

export const DEFAULTS = {
  work_minutes: 300,         // five hours of planned work a day
  buffer_minutes: 180,       // and three of buffer
  day_start: '08:00',        // the Planner's day: morning from here
  split: '14:00',            // afternoon from here
  day_end: '18:00',          // to here
  no_estimate_minutes: 30,   // what a task without an estimate counts for
  missed: 'keep',            // a task planned for an earlier day, not done: keep (in Missed), carry (to today), ask
};
const RULES = {
  work_minutes: (v) => Number.isInteger(v) && v >= 0 && v <= 24 * 60,
  buffer_minutes: (v) => Number.isInteger(v) && v >= 0 && v <= 24 * 60,
  day_start: (v) => TIME.test(v),
  split: (v) => TIME.test(v),
  day_end: (v) => TIME.test(v),
  no_estimate_minutes: (v) => Number.isInteger(v) && v >= 0 && v <= 8 * 60,
  missed: (v) => ['keep', 'carry', 'ask'].includes(v),
};

export function getSettings(db) {
  // Only the Planner's own keys, and a row that isn't JSON is skipped (its default is used), never the whole screen.
  const stored = {};
  for (const row of db.prepare('SELECT key, value FROM settings WHERE deleted_at IS NULL').all()) {
    if (!(row.key in DEFAULTS)) continue;
    try { stored[row.key] = JSON.parse(row.value); } catch { /* the default */ }
  }
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, key in stored && RULES[key](stored[key]) ? stored[key] : value]));
}

export function checkSettingsInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  for (const [key, value] of Object.entries(input)) {
    if (!RULES[key]) return `There is no setting called ${key}.`;
    if (!RULES[key](value)) return `${key} can't be ${JSON.stringify(value)}.`;
  }
  return null;
}

export function updateSettings(db, changes) {
  const merged = { ...getSettings(db), ...changes };
  if (!(merged.day_start < merged.split && merged.split < merged.day_end)) throw fail(400, 'The day starts, splits and ends in that order.');
  const time = now();
  for (const [key, value] of Object.entries(changes)) {
    db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
      .run(randomUUID(), time, time, key, JSON.stringify(value));
  }
  return getSettings(db);
}

// ---- Time blocks ----

const BLOCK_COLUMNS = 'id, day, starts_at, ends_at, kind, title, created_at, updated_at, deleted_at';

export function checkBlockInput(input, { creating = false } = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ((creating || 'day' in input) && !/^\d{4}-\d{2}-\d{2}$/.test(input.day ?? '')) return 'day is YYYY-MM-DD.';
  for (const field of ['starts_at', 'ends_at']) {
    if ((creating || field in input) && !TIME.test(input[field] ?? '')) return `${field} is HH:MM.`;
  }
  if ((creating || 'kind' in input) && !BLOCK_KINDS.includes(input.kind)) return `kind is ${BLOCK_KINDS.join(', ')}.`;
  if ('title' in input && (typeof input.title !== 'string' || input.title.length > 200)) return 'title must be text.';
  return null;
}

const blockRow = (db, id) => db.prepare(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE id = ?`).get(id);

export function getBlock(db, id, { deleted = false } = {}) {
  const block = blockRow(db, id);
  return block && (deleted || !block.deleted_at) ? { ...block } : null;
}

export function createBlock(db, { day, starts_at, ends_at, kind, title = '' }) {
  if (ends_at <= starts_at) throw fail(400, 'A block ends after it starts.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO blocks (id, created_at, updated_at, day, starts_at, ends_at, kind, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, day, starts_at, ends_at, kind, title.trim());
  return getBlock(db, id);
}

export function updateBlock(db, id, changes) {
  const block = getBlock(db, id);
  if (!block) return null;
  const next = { ...block, ...Object.fromEntries(['starts_at', 'ends_at', 'kind', 'title'].filter((f) => f in changes).map((f) => [f, changes[f]])) };
  if (next.ends_at <= next.starts_at) throw fail(400, 'A block ends after it starts.');
  db.prepare('UPDATE blocks SET starts_at = ?, ends_at = ?, kind = ?, title = ?, updated_at = ? WHERE id = ?')
    .run(next.starts_at, next.ends_at, next.kind, next.title.trim(), now(), id);
  return getBlock(db, id);
}

// Deleting a block leaves its tasks on the day, out of the block; bringing it back puts
// them back in (they still name it).
export function deleteBlock(db, id) {
  if (!getBlock(db, id)) return null;
  db.prepare('UPDATE blocks SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getBlock(db, id, { deleted: true });
}

export function restoreBlock(db, id) {
  if (!blockRow(db, id)) return null;
  db.prepare('UPDATE blocks SET deleted_at = NULL WHERE id = ?').run(id);
  return getBlock(db, id);
}

export const blocksOf = (db, day) => plain(db.prepare(`SELECT ${BLOCK_COLUMNS} FROM blocks WHERE day = ? AND deleted_at IS NULL
  ORDER BY starts_at`).all(day));

// ---- Weeks, Weekly Goals and the Highlight ----

const dateOf = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (day, n) => { const date = dateOf(day); date.setDate(date.getDate() + n); return dayOf(date); };
// The Monday of the week a day is in.
export const weekOf = (day) => addDays(day, -((dateOf(day).getDay() + 6) % 7));
export const WEEKLY_GOALS = 5; // a warning from the sixth, never a stop

export const weekGoals = (db, monday) => listTasks(db).filter((t) => t.goal_week === monday);

// The day's Highlight: its task, while that task is still planned for the day.
export function highlightOf(db, day) {
  const row = db.prepare('SELECT task_id FROM highlights WHERE day = ? AND deleted_at IS NULL').get(day);
  const task = row?.task_id ? getTask(db, row.task_id) : null;
  return task && task.due === day ? task.id : null;
}

// Makes a task the day's Highlight (null: none). A task planned for another day (or none)
// is planned for this one. Returns the one it replaced, so it can be undone.
export function setHighlight(db, day, taskId) {
  const previous = highlightOf(db, day);
  if (taskId) {
    const task = getTask(db, taskId);
    if (!task) throw fail(400, 'There is no such task.');
    if (task.due !== day) changeTask(db, taskId, { due: day, plan_part: task.due === day ? task.plan_part : '', block_id: null });
  }
  const time = now();
  db.prepare(`INSERT INTO highlights (id, created_at, updated_at, day, task_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (day) DO UPDATE SET task_id = excluded.task_id, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, day, taskId ?? null);
  return { day, task_id: highlightOf(db, day), previous };
}

// ---- Planning flows ----

export const FLOWS = {
  weekly: ['brain_zen', 'goal_alignment', 'schedule', 'balance', 'rebalance'],
  daily: ['review', 'assess', 'highlight', 'order', 'execute'],
};

export function getFlow(db, kind, period) {
  const row = db.prepare('SELECT steps FROM planning WHERE kind = ? AND period = ? AND deleted_at IS NULL').get(kind, period);
  const steps = row ? JSON.parse(row.steps) : {};
  const next = FLOWS[kind].find((step) => !steps[step]) ?? null;
  return { kind, period, steps, next };
}

// Marks a step done or skipped (or neither, with null).
export function setFlowStep(db, kind, period, step, state) {
  if (!FLOWS[kind]?.includes(step)) throw fail(400, 'There is no such step.');
  if (![null, 'done', 'skipped'].includes(state)) throw fail(400, 'A step is done, skipped, or neither.');
  const { steps } = getFlow(db, kind, period);
  if (state) steps[step] = state; else delete steps[step];
  const time = now();
  db.prepare(`INSERT INTO planning (id, created_at, updated_at, kind, period, steps) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, period) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at`)
    .run(randomUUID(), time, time, kind, period, JSON.stringify(steps));
  return getFlow(db, kind, period);
}

// ---- One day ----

const isDay = (due) => /^\d{4}-\d{2}-\d{2}$/.test(due);

// The tasks planned for a day (open and done), and Tasks to place: what waits for a day.
//   missed     planned for a day before today and not done (with that day): Due
//   upcoming   planned for a later day, to pull into this one early (the next 30)
//   no_day     no day yet, and longer (or not estimated)
//   speedies   no day yet, and fifteen minutes or less
// With "carry" in the settings, missed tasks move to today when today's Planner opens.
export function plannerDay(db, day, { today = localDay(), events = [] } = {}) {
  const settings = getSettings(db);
  let carried = 0;
  if (day === today && settings.missed === 'carry') {
    for (const task of listTasks(db, { done: false }).filter((t) => isDay(t.due) && t.due < today)) {
      try { changeTask(db, task.id, { due: today, plan_part: '', block_id: null }); carried++; } catch { /* stays in Missed */ }
    }
  }
  const all = listTasks(db);
  const blocks = blocksOf(db, day);
  const tasks = all.filter((t) => t.due === day).map((t) => (blocks.some((b) => b.id === t.block_id) ? t : { ...t, block_id: null }));
  const open = all.filter((t) => !t.done);
  return {
    day,
    today,
    settings,
    carried,
    events,
    blocks,
    tasks,
    highlight_id: highlightOf(db, day),
    week: weekOf(day),
    week_goals: weekGoals(db, weekOf(day)),
    weekly_goals_max: WEEKLY_GOALS,
    tray: {
      missed: open.filter((t) => isDay(t.due) && t.due < today).sort((a, b) => a.due.localeCompare(b.due)),
      upcoming: open.filter((t) => isDay(t.due) && t.due > day && t.due >= today).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 30),
      no_day: open.filter((t) => t.due === '' && !isSpeedy(t.estimate)),
      speedies: open.filter((t) => t.due === '' && isSpeedy(t.estimate)),
    },
  };
}

// The week a day is in: each day with its events, blocks, planned tasks and Highlight;
// the week's goals and the Tray. eventsOf(day) gives a day's events.
export function plannerWeek(db, day, { today = localDay(), eventsOf = () => [] } = {}) {
  const monday = weekOf(day);
  const all = listTasks(db);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => ({
    day: d,
    events: eventsOf(d),
    blocks: blocksOf(db, d),
    tasks: all.filter((t) => t.due === d),
    highlight_id: highlightOf(db, d),
  }));
  const open = all.filter((t) => !t.done);
  return {
    week: monday,
    today,
    settings: getSettings(db),
    days,
    week_goals: weekGoals(db, monday),
    weekly_goals_max: WEEKLY_GOALS,
    tray: {
      missed: open.filter((t) => isDay(t.due) && t.due < today).sort((a, b) => a.due.localeCompare(b.due)),
      no_day: open.filter((t) => t.due === '' && !isSpeedy(t.estimate)),
      speedies: open.filter((t) => t.due === '' && isSpeedy(t.estimate)),
    },
  };
}
