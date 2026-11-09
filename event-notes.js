// Notes about an event (time/1): from the journal's day or the event itself, one click
// starts a note about an event, and the note links to it. The link points at the event's
// row: your own event's, or, for another calendar's event (read again every ten minutes,
// with no row of its own), a small row in event_refs naming that occurrence. An event
// with a note opens it instead of starting another.

import { randomUUID } from 'node:crypto';
import { createNote, getNote } from './notes.js';
import { getEvent } from './events.js';
import { calendarEventsBetween } from './calendars.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const escape = (text) => text.replace(/[\\[\]]/g, '\\$&');

// Another calendar's event, found again by its key (cal:<calendar>:<uid>:<start>).
function calendarEvent(db, key) {
  const match = /^cal:([0-9a-f-]{36}):(.+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.exec(key);
  if (!match) return null;
  return calendarEventsBetween(db, match[3].slice(0, 10), match[3].slice(0, 10)).find((e) => e.id === key) ?? null;
}

// The row a note about this event links to: its own id, or its event_refs row (made if new).
function refFor(db, eventId) {
  // A Google event (google:<its row>) has a row of its own in google_events: a note links straight to it.
  const google = /^google:([0-9a-f-]{36})$/.exec(eventId);
  if (google) {
    const row = db.prepare('SELECT id, title, starts_at FROM google_events WHERE id = ? AND deleted_at IS NULL').get(google[1]);
    if (!row) throw fail(404, 'No such event.');
    return { ref_id: row.id, title: row.title, starts_at: row.starts_at };
  }
  const own = getEvent(db, eventId);
  if (own) return { ref_id: own.id, title: own.title, starts_at: own.starts_at };
  const event = calendarEvent(db, eventId);
  if (!event) throw fail(404, 'No such event.');
  const found = db.prepare('SELECT id FROM event_refs WHERE calendar_id = ? AND uid = ? AND starts_at = ?')
    .get(event.calendar.id, event.uid, event.starts_at);
  const time = new Date().toISOString();
  if (found) {
    db.prepare('UPDATE event_refs SET title = ?, ends_at = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(event.title, event.ends_at, time, found.id);
    return { ref_id: found.id, title: event.title, starts_at: event.starts_at };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO event_refs (id, created_at, updated_at, calendar_id, uid, starts_at, ends_at, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, event.calendar.id, event.uid, event.starts_at, event.ends_at, event.title);
  return { ref_id: id, title: event.title, starts_at: event.starts_at };
}

// The latest note that links to this event, if any.
const noteOf = (db, refId) => db.prepare(`SELECT n.id FROM links l JOIN notes n ON n.id = l.from_id AND n.deleted_at IS NULL
  WHERE l.from_kind = 'note' AND l.to_kind = 'event' AND l.to_id = ? ORDER BY n.updated_at DESC LIMIT 1`).get(refId)?.id ?? null;

const when = (at) => new Date(`${at}:00`).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (at) => new Date(`${at}:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// The note about an event: the one there is, or a new one titled with the event and its day.
export function noteAboutEvent(db, eventId) {
  const ref = refFor(db, eventId);
  const existing = noteOf(db, ref.ref_id);
  if (existing) return { note: getNote(db, existing), existing: true };
  const note = createNote(db, {
    title: `${ref.title} · ${day(ref.starts_at)}`,
    body: `About [${escape(ref.title)} · ${when(ref.starts_at)}](/calendar/events/${ref.ref_id})\n\n`,
  });
  return { note, existing: false };
}

// Each event with the row a note would link to (if there is one yet) and its note.
export function withNotes(db, events) {
  const refs = db.prepare('SELECT id, calendar_id, uid, starts_at FROM event_refs WHERE deleted_at IS NULL').all();
  return events.map((event) => {
    const refId = event.source === 'google' ? event.id.slice('google:'.length)
      : event.calendar
      ? refs.find((r) => r.calendar_id === event.calendar.id && r.uid === event.uid && r.starts_at === event.starts_at)?.id ?? null
      : event.id;
    return { ...event, ref_id: refId, note_id: refId ? noteOf(db, refId) : null };
  });
}

// Where an event a note links to is: its day and start, to open it in the Calendar.
export function eventAt(db, refId) {
  const own = getEvent(db, refId);
  if (own) return { id: own.id, title: own.title, starts_at: own.starts_at };
  const ref = db.prepare('SELECT id, title, starts_at FROM event_refs WHERE id = ? AND deleted_at IS NULL').get(refId)
    ?? db.prepare('SELECT id, title, starts_at FROM google_events WHERE id = ? AND deleted_at IS NULL').get(refId);
  return ref ? { ...ref } : null;
}
