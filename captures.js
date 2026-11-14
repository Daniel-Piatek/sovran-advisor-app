// Quick capture and the Inbox (schema.sql, table captures). A capture keeps a thought with
// its time and asks nothing else. It waits in the Inbox until it is sorted:
//   into the journal   a new entry on today, in General
//   into a note        a new note, or added to the end of a note you pick
//   into a task        a task of its own (tasks/3), with the day and the rest read from it
//   done               nothing to make: it is simply handled
//   let go             deleted (and so, like any delete, it can be brought back)
// Whatever a capture is made into remembers it (capture_id), and every decision can be
// undone, which puts the capture back in the Inbox.

import { randomUUID } from 'node:crypto';
import { MAX_BODY_LENGTH } from './notes.js';
import { createNote, getNote, deleteNote, setNoteBody, updateNote } from './notes.js';
import { createEntry, getEntry, deleteEntry, localDay, isDay } from './entries.js';
import { insertTask, getTask } from './tasks.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));

const COLUMNS = `id, body, captured_at, state, sorted_at, sorted_into, sorted_id, home_id, snoozed_until, world, link_url, link_title, origin, created_at, updated_at, deleted_at,
  device_id, (SELECT name FROM capture_devices d WHERE d.id = captures.device_id) AS shared_from,
  (SELECT spoken FROM capture_tidy t WHERE t.capture_id = captures.id) AS spoken`; // a phone note's words as said (tidy.js)

export const WORLDS = ['inner', 'outer'];

export function checkCaptureInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (typeof input.body !== 'string') return 'body must be text.';
  if (input.body.length > MAX_BODY_LENGTH) return `body is longer than ${MAX_BODY_LENGTH} characters.`;
  if ('world' in input && !WORLDS.includes(input.world)) return 'world is inner or outer.';
  return null;
}

// PATCH: the words and/or the home (null: no home).
export function checkCaptureChange(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('body' in input) return checkCaptureInput(input);
  if ('world' in input) return WORLDS.includes(input.world) ? null : 'world is inner or outer.';
  if ('snooze_until' in input) {
    const at = input.snooze_until;
    if (at !== null && !(typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(at) && !Number.isNaN(Date.parse(at)))) return 'snooze_until must be a time, or null.';
    return null;
  }
  if (!('home_id' in input)) return 'Send body, home_id or snooze_until.';
  if (input.home_id !== null && typeof input.home_id !== 'string') return 'home_id must be an id.';
  return null;
}

// device: the device that shared it from outside (origin captured), if any.
export function createCapture(db, { body, world = 'inner', device = null }) {
  if (!body.trim()) throw fail(400, 'An empty capture is not kept.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO captures (id, created_at, updated_at, origin, body, captured_at, world, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, device ? 'captured' : 'typed', body, time, world, device);
  return getCapture(db, id);
}

export function getCapture(db, id, { deleted = false } = {}) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM captures WHERE id = ? ${deleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
  return row ? { ...row } : null;
}

// The home chosen for a capture, as { id, kind, title }; null when none, or it was deleted.
export function homeOf(db, capture) {
  const home = capture.home_id ? db.prepare('SELECT id, kind, title FROM life_items WHERE id = ? AND deleted_at IS NULL').get(capture.home_id) : null;
  return home ? { ...home } : null;
}

// What waits in the Inbox, oldest first.
// World: Inner (your own thought) or Outer (something someone else made).
export function setWorld(db, id, world) {
  const capture = getCapture(db, id);
  if (!capture) return null;
  if (capture.world !== world) db.prepare('UPDATE captures SET world = ?, updated_at = ? WHERE id = ?').run(world, now(), id);
  return getCapture(db, id);
}

// A snoozed capture is not in the Inbox until its time: it comes back by itself.
const awake = "(snoozed_until IS NULL OR snoozed_until <= ?)";
export function waitingCaptures(db) {
  return plain(db.prepare(`SELECT ${COLUMNS} FROM captures WHERE state = 'waiting' AND deleted_at IS NULL AND ${awake}
    ORDER BY captured_at, rowid`).all(now()));
}

export function waitingCount(db) {
  return db.prepare(`SELECT count(*) AS n FROM captures WHERE state = 'waiting' AND deleted_at IS NULL AND ${awake}`).get(now()).n;
}

// How many are asleep, and when the first wakes.
export function snoozedCaptures(db) {
  return plain(db.prepare(`SELECT ${COLUMNS} FROM captures WHERE state = 'waiting' AND deleted_at IS NULL AND snoozed_until > ?
    ORDER BY snoozed_until, rowid`).all(now()));
}

// What was marked done (it needed nothing): kept, out of the Inbox, newest first.
export function doneCaptures(db) {
  return plain(db.prepare(`SELECT ${COLUMNS} FROM captures WHERE state = 'done' AND deleted_at IS NULL ORDER BY sorted_at DESC, rowid DESC`).all());
}

// The Inbox's four views, each with its count: to sort, snoozed, done, and the Trash (let go).
export function captureCounts(db) {
  const n = (sql, ...args) => db.prepare(sql).get(...args).n;
  return {
    waiting: waitingCount(db),
    snoozed: n("SELECT count(*) AS n FROM captures WHERE state = 'waiting' AND deleted_at IS NULL AND snoozed_until > ?", now()),
    done: n("SELECT count(*) AS n FROM captures WHERE state = 'done' AND deleted_at IS NULL"),
    trash: n('SELECT count(*) AS n FROM captures WHERE deleted_at IS NOT NULL'),
  };
}

// Snooze: until a time (ISO), or null to wake it now.
export function snoozeCapture(db, id, until) {
  const capture = getCapture(db, id);
  if (!capture) return null;
  if (capture.state !== 'waiting') throw fail(409, 'This capture has already been sorted.');
  const at = until === null ? null : new Date(until).toISOString();
  db.prepare('UPDATE captures SET snoozed_until = ?, updated_at = ? WHERE id = ?').run(at, now(), id);
  return getCapture(db, id);
}

export function updateCapture(db, id, { body, home_id: homeId }) {
  const capture = getCapture(db, id);
  if (!capture) return null;
  const next = { body: body ?? capture.body, home_id: homeId === undefined ? capture.home_id : homeId || null };
  if (next.home_id !== capture.home_id && next.home_id
    && !db.prepare('SELECT 1 FROM life_items WHERE id = ? AND deleted_at IS NULL').get(next.home_id)) {
    throw fail(400, 'That home is not in My Life.');
  }
  if (next.body === capture.body && next.home_id === capture.home_id) return capture;
  db.prepare('UPDATE captures SET body = ?, home_id = ?, updated_at = ? WHERE id = ?').run(next.body, next.home_id, now(), id);
  return getCapture(db, id);
}

// A note made from a capture: its first line is the title, the rest the text.
export function noteFromCapture(body) {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim());
  const title = (lines[first] ?? '')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/, '')
    .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\\$/, '')
    .trim();
  const rest = lines.slice(first + 1).join('\n').replace(/^\s*\n/, '').trimEnd();
  return { title, body: rest };
}

function waiting(db, id) {
  const capture = getCapture(db, id);
  if (!capture) throw fail(404, 'No such capture');
  if (capture.state !== 'waiting') throw fail(409, 'This capture has already been sorted.');
  return capture;
}

function markSorted(db, id, { state, into = null, made = null, noteBody = null }) {
  const time = now();
  db.prepare(`UPDATE captures SET state = ?, sorted_at = ?, sorted_into = ?, sorted_id = ?, sorted_note_body = ?, updated_at = ?
    WHERE id = ?`).run(state, time, into, made, noteBody, time, id);
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

// Sorts a waiting capture. `to` is journal, note, task or done; for journal, `day` (YYYY-MM-DD,
// today when none) is the day of the entry and `body` the words, if they were changed on the
// way; for note, `note_id` adds it to that note instead of making a new one; for task, `task`
// holds the task's words, day and the rest (see tasks.js). Returns { capture, made }.
export function sortCapture(db, id, { to, note_id, task, day, body }) {
  return inTransaction(db, () => {
    const capture = waiting(db, id);
    if (to === 'journal') {
      if (day !== undefined && !isDay(day)) throw fail(400, 'day must be a date like 2026-10-25.');
      if (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > MAX_BODY_LENGTH)) throw fail(400, 'The words must be text, not empty.');
      const entry = createEntry(db, { day: day ?? localDay(), body: body ?? capture.body, origin: 'captured', capture_id: id });
      markSorted(db, id, { state: 'sorted', into: 'journal', made: entry.id });
      return { capture: getCapture(db, id), made: { kind: 'entry', ...entry } };
    }
    if (to === 'note' && note_id) {
      const note = getNote(db, note_id);
      if (!note) throw fail(400, 'There is no such note.');
      const body = note.body.trim() ? `${note.body.trimEnd()}\n\n${capture.body}` : capture.body;
      setNoteBody(db, note_id, body);
      markSorted(db, id, { state: 'sorted', into: 'note', made: note_id, noteBody: note.body });
      return { capture: getCapture(db, id), made: { kind: 'note', ...getNote(db, note_id) } };
    }
    if (to === 'note') {
      const note = createNote(db, { ...noteFromCapture(capture.body), origin: 'captured', capture_id: id });
      if (homeOf(db, capture)) updateNote(db, note.id, { home_id: capture.home_id });
      markSorted(db, id, { state: 'sorted', into: 'note', made: note.id });
      return { capture: getCapture(db, id), made: { kind: 'note', ...note } };
    }
    if (to === 'task') {
      const home_id = task && 'home_id' in task ? task.home_id : homeOf(db, capture)?.id ?? null;
      const made = insertTask(db, { ...task, home_id, origin: 'captured', capture_id: id });
      markSorted(db, id, { state: 'sorted', into: 'task', made: made.id });
      return { capture: getCapture(db, id), made: { kind: 'task', ...getTask(db, made.id) } };
    }
    if (to === 'done') {
      markSorted(db, id, { state: 'done' });
      return { capture: getCapture(db, id), made: null };
    }
    throw fail(400, 'Sort it to journal, note, task or done.');
  });
}

// Letting a capture go: it is deleted, and waits in Recently deleted.
export function letGo(db, id) {
  const capture = waiting(db, id);
  db.prepare('UPDATE captures SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getCapture(db, capture.id, { deleted: true });
}

// Undoing a decision puts the capture back in the Inbox. What it was made into is deleted
// (and so can still be brought back from Recently deleted); text added to an existing note
// is taken out again, unless the note has been changed since.
export function undoCapture(db, id) {
  return inTransaction(db, () => {
    const capture = getCapture(db, id, { deleted: true });
    if (!capture) throw fail(404, 'No such capture');
    if (capture.deleted_at) {
      db.prepare('UPDATE captures SET deleted_at = NULL WHERE id = ?').run(id);
      return getCapture(db, id);
    }
    if (capture.state === 'waiting') {
      if (!capture.snoozed_until) return capture;
      return snoozeCapture(db, id, null); // undoing a Snooze wakes it
    }
    if (capture.sorted_into === 'journal' && getEntry(db, capture.sorted_id)) deleteEntry(db, capture.sorted_id);
    if (capture.sorted_into === 'task') db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), capture.sorted_id);
    if (capture.sorted_into === 'note') {
      const { sorted_note_body: before } = db.prepare('SELECT sorted_note_body FROM captures WHERE id = ?').get(id);
      const note = getNote(db, capture.sorted_id);
      if (note && before === null) deleteNote(db, capture.sorted_id);
      else if (note) {
        const added = before.trim() ? `${before.trimEnd()}\n\n${capture.body}` : capture.body;
        if (note.body === added) {
          setNoteBody(db, note.id, before);
        } else if (note.body.endsWith(`\n\n${capture.body}`)) {
          setNoteBody(db, note.id, note.body.slice(0, -(capture.body.length + 2)));
        }
      }
    }
    db.prepare(`UPDATE captures SET state = 'waiting', sorted_at = NULL, sorted_into = NULL, sorted_id = NULL,
      sorted_note_body = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
    return getCapture(db, id);
  });
}

export function listDeletedCaptures(db) {
  return plain(db.prepare(`SELECT ${COLUMNS} FROM captures WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid DESC`).all());
}
