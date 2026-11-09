// Your own events (schema.sql, table events; time/1): what is fixed in a day, such as a
// call, a lunch, the dentist. An event has a title, a start and an end (YYYY-MM-DDTHH:MM in
// the owner's own time zone, like reminders) and a note. Tasks never go here: a task's date
// says when it is due, not when it happens. Deleting only sets deleted_at, as everywhere.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const MAX_EVENT_TITLE = 300;
const COLUMNS = 'id, title, starts_at, ends_at, note, origin, created_at, updated_at, deleted_at';

// A real moment: the day exists and the time is on the clock.
function isAt(text) {
  if (typeof text !== 'string' || !AT.test(text)) return false;
  const [day, time] = text.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d && h < 24 && min < 60;
}

// Checks what the page sent. Returns what is wrong, or null.
export function checkEventInput(input, { creating = false } = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (creating || 'title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim()) return 'An event needs a name.';
    if (input.title.length > MAX_EVENT_TITLE) return `title is longer than ${MAX_EVENT_TITLE} characters.`;
  }
  for (const field of ['starts_at', 'ends_at']) {
    if ((creating || field in input) && !isAt(input[field])) return `${field} is a moment: YYYY-MM-DDTHH:MM.`;
  }
  if ('note' in input && (typeof input.note !== 'string' || input.note.length > 10_000)) return 'note must be text.';
  if ('people' in input && !(Array.isArray(input.people) && input.people.length <= 20 && input.people.every((p) => typeof p === 'string'))) return 'people is a list of ids.';
  return null;
}

const row = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`).get(id);

export function getEvent(db, id, { deleted = false } = {}) {
  const event = row(db, id);
  return event && (deleted || !event.deleted_at) ? { ...event } : null;
}

// The people an event is with (Calendar 5): link rows from the event to each person, made again every time. Only people who are
// in the app count; the page of a person lists these as the events they are with.
export function setEventPeople(db, eventId, personIds) {
  db.prepare("DELETE FROM links WHERE from_kind = 'event' AND from_id = ?").run(eventId);
  const event = db.prepare('SELECT title FROM events WHERE id = ?').get(eventId) ?? db.prepare('SELECT title FROM google_events WHERE id = ?').get(eventId);
  const time = now();
  const insert = db.prepare(`INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id, link_text, context)
    VALUES (?, ?, ?, 'event', ?, 'person', ?, ?, ?)`);
  for (const id of [...new Set(personIds)]) {
    const person = db.prepare('SELECT name FROM people WHERE id = ? AND deleted_at IS NULL').get(id);
    if (person) insert.run(randomUUID(), time, time, eventId, id, person.name, event?.title ?? '');
  }
}

export function createEvent(db, { title, starts_at, ends_at, note = '', people = [] }) {
  if (ends_at <= starts_at) throw fail(400, 'An event ends after it starts.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO events (id, created_at, updated_at, title, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, title.trim(), starts_at, ends_at, note);
  if (people.length) setEventPeople(db, id, people);
  return getEvent(db, id);
}

export function updateEvent(db, id, changes) {
  const event = getEvent(db, id);
  if (!event) return null;
  const next = {
    title: 'title' in changes ? changes.title.trim() : event.title,
    starts_at: changes.starts_at ?? event.starts_at,
    ends_at: changes.ends_at ?? event.ends_at,
    note: changes.note ?? event.note,
  };
  if (next.ends_at <= next.starts_at) throw fail(400, 'An event ends after it starts.');
  if (Object.keys(next).every((f) => next[f] === event[f])) return event;
  db.prepare('UPDATE events SET title = ?, starts_at = ?, ends_at = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.starts_at, next.ends_at, next.note, now(), id);
  return getEvent(db, id);
}

// The events that touch the days from `from` to `to` (YYYY-MM-DD, both included).
export function eventsBetween(db, from, to) {
  return plain(db.prepare(`SELECT ${COLUMNS} FROM events WHERE deleted_at IS NULL AND starts_at < ? AND ends_at > ?
    ORDER BY starts_at, ends_at`).all(`${to}T24:00`, `${from}T00:00`));
}

export function deleteEvent(db, id) {
  const event = getEvent(db, id);
  if (!event) return null;
  db.prepare('UPDATE events SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getEvent(db, id, { deleted: true });
}

export function restoreEvent(db, id) {
  if (!row(db, id)) return null;
  db.prepare('UPDATE events SET deleted_at = NULL WHERE id = ?').run(id);
  return getEvent(db, id);
}

export const listDeletedEvents = (db) => plain(db.prepare(`SELECT ${COLUMNS} FROM events WHERE deleted_at IS NOT NULL
  ORDER BY deleted_at DESC`).all());
