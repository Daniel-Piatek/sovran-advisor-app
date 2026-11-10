// Tasks (schema.sql, tables tasks and reminders; tasks/1 and tasks/2).
// A task lives in one of two places:
//   in a page's text   a line in a note, a journal entry, or a person's or company's
//                      notes:  - [ ] Call the bank @2026-10-30 ~10m   (done: - [x] …)
//                      Each task line is also a row, made again from the text on every
//                      save, like links. A row keeps its id while its words stay the same
//                      (or while it stays in the same place). Done, the date (@day or
//                      @someday) and the estimate (~10m) live in the line; changing them
//                      from the Tasks app changes the line, so the two never disagree.
//   on its own         added in the Tasks app (source_kind 'own'): the row is all of it.
// What the row alone keeps, for every task: its Must or Like flag, its home in My Life
// (a task in a note is at home where its note is, unless it has its own), its repeat (a
// task of its own: finishing it makes the next one), and its reminders.
//   due   a day, 'someday', or '' (none); in a journal entry without one, the entry's day

import { randomUUID } from 'node:crypto';
import { syncLinks, plainWords } from './links.js';
import { parseEstimate, parseRepeat, nextRepeat } from './public/due.js';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const pad = (n) => String(n).padStart(2, '0');
export const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localMinute = (date = new Date()) => `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s+|$)(.*)$/;
const DUE = /(?:^|\s)@(\d{4}-\d{2}-\d{2}|someday)(?=\s|$)/;
const ESTIMATE = /(?:^|\s)(~[0-9.]+(?:h\d{0,2}m?|m|min|h)?)(?=\s|$)/i;
const SOURCES = {
  note: { table: 'notes', path: (id) => `/notes/${id}` },
  entry: { table: 'journal_entries', path: (id) => `/journal/entries/${id}` },
  person: { table: 'people', path: (id) => `/people/${id}` },
  company: { table: 'companies', path: (id) => `/companies/${id}` },
};
const FLAGS = ['', 'must', 'like'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TASK_LENGTH = 1_000;
export const MAX_DETAILS_LENGTH = 20_000;

// Every task line in a text, in order: its line number, done, due, estimate and words.
export function extractTasks(markdown) {
  const found = [];
  markdown.split('\n').forEach((line, index) => {
    const match = TASK_LINE.exec(line);
    if (!match) return;
    const rest = match[4];
    const due = DUE.exec(rest)?.[1] ?? '';
    const estimateWord = ESTIMATE.exec(rest)?.[1];
    const estimate = estimateWord ? parseEstimate(estimateWord) : null;
    let words = rest.replace(DUE, ' ');
    if (estimate) words = words.replace(ESTIMATE, ' ');
    const text = plainWords(words).replace(/\s+/g, ' ').trim();
    found.push({ line: index, done: match[2] !== ' ', due, estimate, text });
  });
  return found;
}

// A task's day pushed later (one date to a later one) counts once in due_moves, so the
// Weekly Review can name the Weekly Goals that kept moving. Takes the new day twice.
const DATE = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
const LATER = `due_moves = due_moves + (due GLOB ${DATE} AND ? GLOB ${DATE} AND ? > due)`;

// Makes a page's task rows again from its text. Rows are matched to lines by their words
// first, then by their place, so ids (and flags, homes, reminders) stay; a line that is
// gone marks its row deleted.
export function syncTasks(db, kind, id, markdown) {
  if (!SOURCES[kind]) return;
  const day = kind === 'entry' ? db.prepare('SELECT day FROM journal_entries WHERE id = ?').get(id)?.day ?? '' : '';
  const lines = extractTasks(markdown);
  const rows = db.prepare(`SELECT id, text, position, done FROM tasks WHERE source_kind = ? AND source_id = ? AND deleted_at IS NULL
    ORDER BY position`).all(kind, id);
  const taken = new Set();
  const match = lines.map((task) => {
    const row = rows.find((r) => !taken.has(r.id) && r.text === task.text);
    if (row) taken.add(row.id);
    return row ?? null;
  });
  lines.forEach((task, i) => {
    if (match[i]) return;
    const row = rows.find((r) => !taken.has(r.id) && r.position === i);
    if (row) { taken.add(row.id); match[i] = row; }
  });
  const time = now();
  lines.forEach((task, i) => {
    const due = task.due || day;
    const row = match[i];
    if (row) {
      db.prepare(`UPDATE tasks SET position = ?, line = ?, text = ?, done = ?, due = ?, estimate = ?,
          done_at = CASE WHEN ? = 1 THEN coalesce(done_at, ?) END, updated_at = ?, ${LATER},
          plan_at = CASE WHEN due = ? THEN plan_at ELSE '' END,
          short_text = CASE WHEN text = ? THEN short_text ELSE '' END WHERE id = ?`)
        .run(i, task.line, task.text, task.done ? 1 : 0, due, task.estimate, task.done ? 1 : 0, time, time, due, due, due, task.text, row.id);
      if (task.done && !row.done) closeReminders(db, row.id);
    } else {
      db.prepare(`INSERT INTO tasks (id, created_at, updated_at, source_kind, source_id, position, line, text, done, due, estimate, done_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), time, time, kind, id, i, task.line, task.text, task.done ? 1 : 0, due, task.estimate, task.done ? time : null);
    }
  });
  for (const row of rows.filter((r) => !taken.has(r.id))) {
    db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, row.id);
  }
}

// Rebuilds every page's tasks (for a database from before tasks existed).
export function syncAllTasks(db) {
  for (const [kind, { table }] of Object.entries(SOURCES)) {
    for (const row of db.prepare(`SELECT id, body FROM ${table}`).all()) syncTasks(db, kind, row.id, row.body);
  }
}

// Every task that is not deleted (nor is its page), with where it lives, its home and its
// next reminder. done: false (open only), true (done, most recently done first), or
// undefined for both. home: only the tasks at home in that My Life item (for a Key Element,
// also those at home in the Goals, Projects and Topics under it).
export function listTasks(db, { done, home, id } = {}) {
  const where = [
    't.deleted_at IS NULL',
    "(t.source_kind = 'own' OR coalesce(n.id, e.id, p.id, c.id) IS NOT NULL)",
    ...(done === undefined ? [] : [`t.done = ${done ? 1 : 0}`]),
    ...(home ? ['(h.id = $home OR h.home_id = $home)'] : []),
    ...(id ? ['t.id = $id'] : []),
  ];
  const rows = db.prepare(`SELECT t.id, t.text, t.done, t.due, t.done_at, t.source_kind, t.source_id, t.position, t.line,
      t.flag, t.estimate, t.repeat, t.repeat_from, t.mail_thread_id, t.home_id AS own_home_id, t.plan_part, t.plan_at, t.pin_at, t.pin_minutes, t.template_id, t.short_text, t.details, t.block_id, t.goal_week, t.due_moves, t.created_at, t.updated_at,
      n.title AS note_title, e.title AS entry_title, e.day AS entry_day, p.name AS person_name, c.name AS company_name,
      h.id AS home_id, h.title AS home_title, h.kind AS home_kind,
      cap.id AS capture_id, cap.body AS capture_body, cap.captured_at AS captured_at,
      (SELECT r.id || ' ' || r.at FROM reminders r WHERE r.task_id = t.id AND r.state = 'waiting' AND r.deleted_at IS NULL
        ORDER BY r.at LIMIT 1) AS reminder
    FROM tasks t
    LEFT JOIN notes n ON t.source_kind = 'note' AND n.id = t.source_id AND n.deleted_at IS NULL
    LEFT JOIN journal_entries e ON t.source_kind = 'entry' AND e.id = t.source_id AND e.deleted_at IS NULL
    LEFT JOIN people p ON t.source_kind = 'person' AND p.id = t.source_id AND p.deleted_at IS NULL
    LEFT JOIN companies c ON t.source_kind = 'company' AND c.id = t.source_id AND c.deleted_at IS NULL
    LEFT JOIN life_items h ON h.id = coalesce(t.home_id, n.home_id) AND h.deleted_at IS NULL
    LEFT JOIN captures cap ON cap.id = t.capture_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${done ? 't.done_at DESC,' : ''} t.due = '', t.due = 'someday', t.due, t.created_at, t.position`)
    .all({ ...(home ? { home } : {}), ...(id ? { id } : {}) });
  const mentions = mentionsOf(db);
  return rows.map((row) => {
    const [reminderId, at] = row.reminder?.split(' ') ?? [];
    return {
      id: row.id, text: row.text, done: row.done === 1, due: row.due, done_at: row.done_at, position: row.position,
      line: row.line, flag: row.flag, estimate: row.estimate, repeat: row.repeat, repeat_from: row.repeat_from, mail_thread_id: row.mail_thread_id, own_home_id: row.own_home_id,
      plan_part: row.plan_part, plan_at: row.plan_at, pin_at: row.pin_at, pin_minutes: row.pin_minutes, template_id: row.template_id, short_text: row.short_text, details: row.details, block_id: row.block_id, goal_week: row.goal_week, due_moves: row.due_moves,
      created_at: row.created_at, updated_at: row.updated_at,
      home: row.home_id ? { id: row.home_id, title: row.home_title, kind: row.home_kind } : null,
      reminder: reminderId ? { id: reminderId, at } : null,
      mentions: mentions.get(row.id) ?? [],
      capture: row.capture_id ? { id: row.capture_id, body: row.capture_body, captured_at: row.captured_at } : null,
      source: row.source_kind === 'own' ? { kind: 'own' } : {
        kind: row.source_kind, id: row.source_id, path: SOURCES[row.source_kind].path(row.source_id),
        title: (row.note_title ?? row.entry_title ?? row.person_name ?? row.company_name ?? '').trim(),
        ...(row.entry_day ? { day: row.entry_day } : {}),
      },
    };
  });
}

export const getTask = (db, id) => listTasks(db, { id })[0] ?? null;

// Who a task of its own mentions (People in depth): its link rows (from_kind 'task'), with
// the person's or company's current name, in the order they were written.
function mentionsOf(db) {
  const found = new Map();
  const rows = db.prepare(`SELECT l.from_id, l.to_kind, l.to_id, coalesce(p.name, c.name) AS name
    FROM links l
    LEFT JOIN people p ON l.to_kind = 'person' AND p.id = l.to_id AND p.deleted_at IS NULL
    LEFT JOIN companies c ON l.to_kind = 'company' AND c.id = l.to_id AND c.deleted_at IS NULL
    WHERE l.from_kind = 'task' AND l.deleted_at IS NULL AND coalesce(p.id, c.id) IS NOT NULL
    ORDER BY l.rowid`).all();
  for (const row of rows) found.set(row.from_id, [...found.get(row.from_id) ?? [], { kind: row.to_kind, id: row.to_id, name: row.name }]);
  return found;
}

const MENTION_KINDS = ['person', 'company'];
const MAX_MENTIONS = 20;

// Makes a task of its own's mention rows again: one link row for each, with the sentence
// (its words) around it. Only people and companies that are in the app are kept.
function setMentions(db, taskId, text, mentions) {
  db.prepare("DELETE FROM links WHERE from_kind = 'task' AND from_id = ?").run(taskId);
  const time = now();
  const insert = db.prepare(`INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id, link_text, context)
    VALUES (?, ?, ?, 'task', ?, ?, ?, ?, ?)`);
  const seen = new Set();
  for (const { kind, id } of mentions) {
    if (seen.has(`${kind}/${id}`)) continue;
    seen.add(`${kind}/${id}`);
    const row = db.prepare(`SELECT name FROM ${kind === 'person' ? 'people' : 'companies'} WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!row) throw fail(400, `That ${kind} is not in the app.`);
    insert.run(randomUUID(), time, time, taskId, kind, id, row.name, text.length > 240 ? `${text.slice(0, 239)}…` : text);
  }
}

// Checks what the page sent for a task. Returns what is wrong, or null.
export function checkTaskInput(input, { creating = false } = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (creating || 'text' in input) {
    if (typeof input.text !== 'string' || !input.text.trim()) return 'A task needs words.';
    if (input.text.length > MAX_TASK_LENGTH) return `text is longer than ${MAX_TASK_LENGTH} characters.`;
  }
  if ('details' in input && (typeof input.details !== 'string' || input.details.length > MAX_DETAILS_LENGTH)) return `details is words, at most ${MAX_DETAILS_LENGTH} characters.`;
  if ('done' in input && typeof input.done !== 'boolean') return 'done is true or false.';
  if ('due' in input && !(input.due === '' || input.due === 'someday' || (typeof input.due === 'string' && DAY.test(input.due)))) {
    return 'due is a date (YYYY-MM-DD), someday, or empty.';
  }
  if ('flag' in input && !FLAGS.includes(input.flag)) return 'flag is must, like, or empty.';
  if ('estimate' in input && input.estimate !== null && !(Number.isInteger(input.estimate) && input.estimate > 0 && input.estimate < 100_000)) {
    return 'estimate is minutes, or null.';
  }
  if ('repeat' in input && input.repeat !== '' && (typeof input.repeat !== 'string' || !parseRepeat(input.repeat))) return 'That repeat is not understood.';
  if ('home_id' in input && input.home_id !== null && typeof input.home_id !== 'string') return 'home_id must be an id.';
  if ('remind_time' in input && (typeof input.remind_time !== 'string' || !/^\d{2}:\d{2}$/.test(input.remind_time))) return 'remind_time is HH:MM.';
  if ('plan_part' in input && !['', 'morning', 'afternoon'].includes(input.plan_part)) return 'plan_part is morning, afternoon, or empty.';
  if ('plan_at' in input && !(input.plan_at === '' || (typeof input.plan_at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.plan_at)))) return 'plan_at is a time (HH:MM), or empty.';
  if ('pin_at' in input && !(input.pin_at === '' || (typeof input.pin_at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.pin_at)))) return 'pin_at is a time (HH:MM), or empty.';
  if ('pin_minutes' in input && input.pin_minutes !== null && !(Number.isInteger(input.pin_minutes) && input.pin_minutes >= 5 && input.pin_minutes <= 1440)) return 'pin_minutes is 5 to 1440 minutes, or null.';
  if ('mail_thread_id' in input && input.mail_thread_id !== null && !(typeof input.mail_thread_id === 'string' && /^[0-9a-f-]{36}$/.test(input.mail_thread_id))) return 'mail_thread_id must be an id.';
  if ('goal_week' in input && !(input.goal_week === '' || (typeof input.goal_week === 'string' && DAY.test(input.goal_week)))) return 'goal_week is a Monday (YYYY-MM-DD), or empty.';
  if ('block_id' in input && input.block_id !== null && typeof input.block_id !== 'string') return 'block_id must be an id.';
  if ('mentions' in input && !(Array.isArray(input.mentions) && input.mentions.length <= MAX_MENTIONS
    && input.mentions.every((m) => m && typeof m === 'object' && MENTION_KINDS.includes(m.kind) && typeof m.id === 'string'))) {
    return 'mentions is a list of people and companies: { kind, id }.';
  }
  return null;
}

function checkHome(db, homeId) {
  if (homeId && !db.prepare('SELECT 1 FROM life_items WHERE id = ? AND deleted_at IS NULL').get(homeId)) {
    throw fail(400, 'That home is not in My Life.');
  }
}

function addReminder(db, taskId, at) {
  const time = now();
  db.prepare('INSERT INTO reminders (id, created_at, updated_at, task_id, at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), time, time, taskId, at);
}
function closeReminders(db, taskId) {
  const time = now();
  db.prepare("UPDATE reminders SET state = 'done', updated_at = ? WHERE task_id = ? AND state = 'waiting'").run(time, taskId);
}

const inTransaction = (db, work) => {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

// A task of its own. A repeat without a day starts on its first day; a time adds a
// reminder on the task's day (today when it has none).
export const createTask = (db, task) => inTransaction(db, () => insertTask(db, task));

// The same, inside a change already under way (sorting a capture).
export function insertTask(db, { text, details = '', due = '', flag = '', estimate = null, repeat = '', home_id = null, remind_time, origin = 'typed', capture_id = null, goal_week = '', mentions = [], repeat_from = null, mail_thread_id = null }) {
  {
    checkHome(db, home_id);
    const rule = repeat ? parseRepeat(repeat) : '';
    const day = due || (rule ? nextRepeat(rule, localDay(), { included: true }) : '');
    const id = randomUUID();
    const time = now();
    db.prepare(`INSERT INTO tasks (id, created_at, updated_at, origin, source_kind, source_id, position, line, text, due, flag, estimate, repeat, home_id, capture_id, repeat_from)
      VALUES (?, ?, ?, ?, 'own', '', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, time, time, origin, text.trim(), day, flag, estimate, rule, home_id || null, capture_id, repeat_from);
    if (details) db.prepare('UPDATE tasks SET details = ? WHERE id = ?').run(details, id);
    if (remind_time) addReminder(db, id, `${DAY.test(day) ? day : localDay()}T${remind_time}`);
    if (goal_week) db.prepare('UPDATE tasks SET goal_week = ? WHERE id = ?').run(goal_week, id);
    if (mail_thread_id) db.prepare('UPDATE tasks SET mail_thread_id = ? WHERE id = ?').run(String(mail_thread_id), id);
    if (mentions.length) setMentions(db, id, text.trim(), mentions);
    return getTask(db, id);
  }
}

// Changes a task. Done, due and estimate of a task in a page change its line there (and
// fail with 409 if the line no longer holds this task); its words are changed in its page,
// not here. Flag and home are kept on the row for every task. Finishing a repeating task
// makes the next one, with its reminder.
export function changeTask(db, id, changes) {
  return inTransaction(db, () => {
    const task = getTask(db, id);
    if (!task) return null;
    const { done, due, estimate } = changes;
    if ('details' in changes) db.prepare('UPDATE tasks SET details = ?, updated_at = ? WHERE id = ?').run(changes.details, now(), id);
    if ('home_id' in changes) checkHome(db, changes.home_id);
    // Where it sits in its day (the Planner). A block belongs to one day: a task put in a
    // block takes that day, and a task moved to another day leaves its block.
    if (changes.block_id) {
      const block = db.prepare('SELECT day FROM blocks WHERE id = ? AND deleted_at IS NULL').get(changes.block_id);
      if (!block) throw fail(400, 'That block is not in the Planner.');
      if (due !== undefined && due !== block.day) throw fail(400, 'A block holds tasks of its own day.');
    }
    const place = {};
    if ('plan_part' in changes) place.plan_part = changes.plan_part;
    if ('plan_at' in changes) place.plan_at = changes.plan_at;
    // A time block (Calendar in depth): pinned to a time and a length of its own, unpinned by an empty time. It is a task still.
    if ('pin_at' in changes) { place.pin_at = changes.pin_at; place.pin_minutes = changes.pin_at ? (changes.pin_minutes ?? task.pin_minutes ?? task.estimate ?? 30) : null; }
    else if ('pin_minutes' in changes && task.pin_at) place.pin_minutes = changes.pin_minutes;
    else if (due !== undefined && due !== task.due && task.pin_at) { place.pin_at = ''; place.pin_minutes = null; } // another day: it leaves its pin, as it leaves its time
    if ('block_id' in changes) place.block_id = changes.block_id || null;
    if ('goal_week' in changes) place.goal_week = changes.goal_week;
    else if (due !== undefined && task.block_id && due !== task.due) place.block_id = null;
    // A task moved to another day leaves its time behind, as it leaves its block.
    if (!('plan_at' in changes) && due !== undefined && due !== task.due && task.plan_at) place.plan_at = '';
    if (task.source.kind === 'own') {
      const fields = ['text', 'done', 'due', 'flag', 'estimate', 'home_id'].filter((f) => f in changes);
      if (due !== undefined) db.prepare(`UPDATE tasks SET ${LATER} WHERE id = ?`).run(due, due, id);
      if ('text' in changes && changes.text.trim() !== task.text) db.prepare("UPDATE tasks SET short_text = '' WHERE id = ?").run(id);
      if (fields.length) {
        db.prepare(`UPDATE tasks SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...fields.map((f) => (f === 'done' ? (changes.done ? 1 : 0) : f === 'text' ? changes.text.trim() : f === 'home_id' ? changes.home_id || null : changes[f])), now(), id);
      }
      if (done !== undefined) db.prepare(`UPDATE tasks SET done_at = ${done ? '?' : 'NULL'} WHERE id = ?`).run(...(done ? [now(), id] : [id]));
      // Who the words mention: the list sent, or else those whose names are still in the words.
      if ('mentions' in changes) setMentions(db, id, changes.text?.trim() ?? task.text, changes.mentions);
      else if ('text' in changes && changes.text.trim() !== task.text) {
        const typed = changes.text.trim().toLowerCase();
        setMentions(db, id, changes.text.trim(), task.mentions.filter((m) => typed.includes(m.name.toLowerCase())));
      }
    } else {
      if ('text' in changes || 'mentions' in changes) throw fail(400, 'A task in a page is changed in its page.');
      const lineChanges = done !== undefined || due !== undefined || estimate !== undefined;
      if (lineChanges) changeLine(db, task, { done, due, estimate });
      const fields = ['flag', 'home_id'].filter((f) => f in changes);
      if (fields.length) {
        db.prepare(`UPDATE tasks SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...fields.map((f) => (f === 'home_id' ? changes.home_id || null : changes[f])), now(), id);
      }
    }
    if (Object.keys(place).length) {
      db.prepare(`UPDATE tasks SET ${Object.keys(place).map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(place), now(), id);
    }
    if (done === true && !task.done) {
      closeReminders(db, id);
      if (task.repeat && moduleOn(db, 'tasks-plus')) repeatTask(db, task); // with Tasks in depth off a finished task just stays finished
    }
    if (done === false && task.done) unrepeatTask(db, task);
    return getTask(db, id);
  });
}

// The next one of a repeating task: the same words, flag, estimate, home and repeat, on
// the repeat's next day after this one's, with a reminder at the same time.
function repeatTask(db, task) {
  const next = nextRepeat(task.repeat, DAY.test(task.due) ? task.due : localDay());
  const made = insertTask(db, {
    text: task.text, due: next, flag: task.flag, estimate: task.estimate, repeat: task.repeat, home_id: task.own_home_id,
    remind_time: task.reminder?.at.slice(11), mentions: task.mentions, repeat_from: task.id,
  });
  db.prepare('UPDATE tasks SET repeat = ? WHERE id = ?').run('', task.id); // the next one carries it on
  return made;
}

// Unticking a finished repeat by mistake must not leave two open copies: the next one it made goes
// again (marked deleted, never removed), as long as it is still open, and the rule is back on this one.
function unrepeatTask(db, task) {
  const next = db.prepare('SELECT id, repeat FROM tasks WHERE repeat_from = ? AND done = 0 AND deleted_at IS NULL').get(task.id);
  if (!next) return;
  const time = now();
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, next.id);
  db.prepare('UPDATE tasks SET repeat = ? WHERE id = ?').run(next.repeat, task.id);
}

// Changes a task's line in its page's text: its box, its @date and its ~estimate.
function changeLine(db, task, { done, due, estimate }) {
  const { table } = SOURCES[task.source.kind];
  const source = db.prepare(`SELECT body FROM ${table} WHERE id = ?`).get(task.source.id);
  const lines = source.body.split('\n');
  const found = extractTasks(source.body)[task.position];
  if (!found || found.text !== task.text) throw fail(409, 'This task changed in its page. Reload to see it.');
  const match = TASK_LINE.exec(lines[found.line]);
  let rest = match[4];
  if (due !== undefined) {
    rest = rest.replace(DUE, '').trimEnd();
    if (due) rest = `${rest} @${due}`;
  }
  if (estimate !== undefined) {
    if (found.estimate) rest = rest.replace(ESTIMATE, '').trimEnd();
    if (estimate) rest = `${rest} ~${estimate}m`;
  }
  const box = done === undefined ? match[2] : done ? 'x' : ' ';
  lines[found.line] = `${match[1]}[${box}]${match[3] || ' '}${rest}`;
  const body = lines.join('\n');
  db.prepare(`UPDATE ${table} SET body = ?, updated_at = ? WHERE id = ?`).run(body, now(), task.source.id);
  syncLinks(db, task.source.kind, task.source.id, body);
  syncTasks(db, task.source.kind, task.source.id, body);
}

// Deleting is for a task of its own (a task in a page goes when its line goes); it only
// sets deleted_at, and comes back with restoreTask.
export function deleteTask(db, id) {
  const task = getTask(db, id);
  if (!task) return null;
  if (task.source.kind !== 'own') throw fail(400, 'A task in a page is deleted in its page.');
  db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(now(), id);
  return { ...task, deleted_at: now() };
}

export function restoreTask(db, id) {
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ? AND source_kind = 'own'").get(id)) return null;
  db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ?').run(id);
  return getTask(db, id);
}

export function listDeletedTasks(db) {
  return db.prepare(`SELECT id, text, deleted_at FROM tasks WHERE source_kind = 'own' AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC`).all().map((row) => ({ ...row }));
}

// ---- Reminders: an alarm at a time on a task, never a task of its own ----

// Reminders whose time has come (or whose snooze is over), on open tasks.
export function dueReminders(db, at = localMinute()) {
  return db.prepare(`SELECT r.id, r.at, r.snoozed_until, t.id AS task_id, t.text
    FROM reminders r JOIN tasks t ON t.id = r.task_id
    WHERE r.state = 'waiting' AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND t.done = 0
      AND coalesce(r.snoozed_until, r.at) <= ? ORDER BY r.at`).all(at).map((row) => ({ ...row }));
}

// Snoozes a reminder (some minutes, or "tomorrow": the same time of day on the next day), or marks it done.
// Done ends the alarm; the task it is on stays open.
export function changeReminder(db, id, { snooze, done }) {
  const reminder = db.prepare('SELECT id, at FROM reminders WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!reminder) return null;
  const time = now();
  if (snooze === 'tomorrow') {
    const next = new Date();
    next.setDate(next.getDate() + 1); // setDate keeps the clock time, whatever the length of the day
    db.prepare('UPDATE reminders SET snoozed_until = ?, updated_at = ? WHERE id = ?').run(`${localDay(next)}T${reminder.at.slice(11)}`, time, id);
  } else if (snooze) {
    const until = new Date(Date.now() + snooze * 60_000);
    db.prepare('UPDATE reminders SET snoozed_until = ?, updated_at = ? WHERE id = ?').run(localMinute(until), time, id);
  }
  if (done) db.prepare("UPDATE reminders SET state = 'done', updated_at = ? WHERE id = ?").run(time, id);
  return { ...db.prepare('SELECT id, task_id, at, state, snoozed_until FROM reminders WHERE id = ?').get(id) };
}

// Every alarm in one state, with its task: waiting ones soonest first, done ones the latest first.
export function listReminders(db, { state = 'waiting', limit = 30 } = {}) {
  const order = state === 'waiting' ? 'r.at' : 'r.updated_at DESC, r.rowid DESC';
  return db.prepare(`SELECT r.id, r.at, r.state, r.snoozed_until, t.id AS task_id, t.text, t.done AS task_done
    FROM reminders r JOIN tasks t ON t.id = r.task_id
    WHERE r.state = ? AND r.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY ${order} LIMIT ?`)
    .all(state, Math.max(1, Math.min(200, Math.trunc(limit) || 30))).map((row) => ({ ...row, task_done: row.task_done === 1 }));
}
