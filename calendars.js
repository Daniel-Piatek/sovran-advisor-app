// Your other calendars, by their iCal link (schema.sql, table calendars; time/1). Google,
// Outlook and iCloud each give a calendar a private link ending in .ics. The app reads it
// every ten minutes, keeps what it read (so the calendar shows while offline), and shows
// its events read-only beside your own, each calendar with its own colour. It never writes
// to them. Reading uses ical.js (Mozilla's iCal reader): repeating meetings, their
// exceptions and time zones come out right, in this computer's own time zone.
// A link is a key to someone's calendar: it is never printed or logged.

import { randomUUID } from 'node:crypto';
import ICAL from 'ical.js';
import { moduleOn } from './modules.js';
import { googleEventsBetween } from './gcal.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));
const pad = (n) => String(n).padStart(2, '0');
const localAt = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const localDay = (date) => localAt(date).slice(0, 10);

export const COLOURS = 6;               // --cal-1 … --cal-6 in tokens.css
export const READ_EVERY_MS = 10 * 60_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_OCCURRENCES = 20_000;         // a repeat that never ends is read only this far
const PUBLIC_COLUMNS = 'id, name, colour, fetched_at, problem, created_at, updated_at, deleted_at';

// webcal:// is how calendars offer a link to subscribe to; it is https underneath.
export function calendarUrl(text) {
  if (typeof text !== 'string') return null;
  const url = text.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function checkCalendarInput(input, { creating = false } = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (creating && !calendarUrl(input.url)) return 'That is not a calendar link (https://… or webcal://…).';
  if ('name' in input && (typeof input.name !== 'string' || input.name.length > 100)) return 'name must be text.';
  if ('colour' in input && !(Number.isInteger(input.colour) && input.colour >= 1 && input.colour <= COLOURS)) return `colour is 1 to ${COLOURS}.`;
  return null;
}

// Your own events ("My events") have a colour too, kept in settings: teal unless you change it.
const OWN_KEY = 'calendar.own_colour';
export function ownColour(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(OWN_KEY);
  const colour = row ? JSON.parse(row.value) : 1;
  return Number.isInteger(colour) && colour >= 1 && colour <= COLOURS ? colour : 1;
}
export function setOwnColour(db, colour) {
  if (!(Number.isInteger(colour) && colour >= 1 && colour <= COLOURS)) throw fail(400, `colour is 1 to ${COLOURS}.`);
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, OWN_KEY, JSON.stringify(colour));
  return { colour: ownColour(db) };
}
// Your own event as the page shows it: no calendar of its own, in your own colour.
export const ownEvent = (db) => { const colour = ownColour(db); return (event) => ({ ...event, calendar: null, colour, all_day: false }); };

export const listCalendars = (db) => plain(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM calendars WHERE deleted_at IS NULL
  ORDER BY created_at`).all());

export function getCalendar(db, id, { deleted = false } = {}) {
  const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM calendars WHERE id = ?`).get(id);
  return row && (deleted || !row.deleted_at) ? { ...row } : null;
}

// A new calendar gets the next colour not yet taken.
export function addCalendar(db, { url, name = '' }) {
  const link = calendarUrl(url);
  if (!link) throw fail(400, 'That is not a calendar link.');
  const taken = new Set([ownColour(db), ...listCalendars(db).map((c) => c.colour)]);
  const colour = Array.from({ length: COLOURS }, (_, i) => i + 1).find((c) => !taken.has(c)) ?? (taken.size % COLOURS) + 1;
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO calendars (id, created_at, updated_at, name, url, colour) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, time, time, name.trim() || 'Calendar', link, colour);
  return getCalendar(db, id);
}

export function updateCalendar(db, id, { name, colour }) {
  const calendar = getCalendar(db, id);
  if (!calendar) return null;
  db.prepare('UPDATE calendars SET name = ?, colour = ?, updated_at = ? WHERE id = ?')
    .run(name?.trim() || calendar.name, colour ?? calendar.colour, now(), id);
  return getCalendar(db, id);
}

export function removeCalendar(db, id) {
  if (!getCalendar(db, id)) return null;
  db.prepare('UPDATE calendars SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getCalendar(db, id, { deleted: true });
}

export function restoreCalendar(db, id) {
  if (!getCalendar(db, id, { deleted: true })) return null;
  db.prepare('UPDATE calendars SET deleted_at = NULL WHERE id = ?').run(id);
  return getCalendar(db, id);
}

// Reads one calendar's link and keeps what came back. On a problem the last good copy
// stays, and the problem is noted (in plain words, without the link).
export async function readCalendar(db, id, { fetcher = fetch } = {}) {
  const row = db.prepare('SELECT id, url, name FROM calendars WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) return null;
  let problem = '';
  try {
    const res = await fetcher(row.url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/calendar, */*' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'The link no longer works (not found).' : `The calendar answered ${res.status}.`);
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error('That calendar is too large.');
    if (!/BEGIN:VCALENDAR/i.test(body)) throw new Error('That link is not a calendar (no BEGIN:VCALENDAR).');
    ICAL.parse(body); // fails here, not later, if it can't be read
    const name = /^X-WR-CALNAME:(.+)$/im.exec(body)?.[1]?.trim();
    db.prepare(`UPDATE calendars SET body = ?, fetched_at = ?, problem = '', updated_at = ?,
        name = CASE WHEN name = 'Calendar' AND ? IS NOT NULL THEN ? ELSE name END WHERE id = ?`)
      .run(body, now(), now(), name ?? null, name ?? null, id);
    parsed.delete(id);
  } catch (err) {
    problem = err.name === 'TimeoutError' ? 'The calendar did not answer in time.' : err.message.startsWith('The ') || err.message.startsWith('That ') ? err.message : "The calendar couldn't be read.";
    db.prepare('UPDATE calendars SET problem = ?, updated_at = ? WHERE id = ?').run(problem, now(), id);
  }
  return getCalendar(db, id);
}

export async function readAllCalendars(db, options) {
  if (!moduleOn(db, 'calendar-links')) return; // the module is off: the job does nothing
  for (const { id } of listCalendars(db)) await readCalendar(db, id, options);
}

// ---- Their events ----

// What was read, made into events once per reading.
const parsed = new Map(); // calendar id → { fetched_at, masters: [ICAL.Event] }
function eventsOf(calendar) {
  const cached = parsed.get(calendar.id);
  if (cached?.fetched_at === calendar.fetched_at) return cached.masters;
  const component = new ICAL.Component(ICAL.parse(calendar.body));
  for (const zone of component.getAllSubcomponents('vtimezone')) {
    const tz = new ICAL.Timezone(zone);
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz);
  }
  const masters = new Map();
  const exceptions = [];
  for (const vevent of component.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(`${event.uid}|${masters.size}`, event);
  }
  const byUid = new Map([...masters.values()].map((e) => [e.uid, e]));
  for (const exception of exceptions) byUid.get(exception.uid)?.relateException(exception);
  const list = [...masters.values()];
  parsed.set(calendar.id, { fetched_at: calendar.fetched_at, masters: list });
  return list;
}

// One occurrence as the page shows it: local times, or whole days.
function shape(calendar, item, start, end) {
  const allDay = start.isDate;
  const startDate = start.toJSDate();
  const endDate = end ? end.toJSDate() : startDate;
  const starts = allDay ? `${localDay(startDate)}T00:00` : localAt(startDate);
  let ends = allDay ? `${localDay(endDate)}T00:00` : localAt(endDate);
  if (ends <= starts) ends = allDay ? `${localDay(new Date(startDate.getTime() + 86_400_000))}T00:00` : starts;
  return {
    id: `cal:${calendar.id}:${item.uid}:${starts}`,
    uid: item.uid,
    title: item.summary || 'Busy',
    starts_at: starts,
    ends_at: ends,
    all_day: allDay,
    note: item.description ?? '',
    location: item.location ?? '',
    calendar: { id: calendar.id, name: calendar.name, colour: calendar.colour },
    read_only: true,
  };
}

// The events of every calendar that touch the days from `from` to `to`.
// The other calendars' events of the days from `from` to `to`: those read from a link (Calendar links) and your Google events
// (Google Calendar), each module's own switch hiding its own, all read only.
export function calendarEventsBetween(db, from, to) {
  const google = googleEventsBetween(db, from, to);
  return [...linkEventsBetween(db, from, to), ...google].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
function linkEventsBetween(db, from, to) {
  if (!moduleOn(db, 'calendar-links')) return []; // off: the other calendars' events are not shown (their rows stay)
  const calendars = db.prepare(`SELECT ${PUBLIC_COLUMNS}, body FROM calendars WHERE deleted_at IS NULL AND body IS NOT NULL`).all();
  const rangeEnd = new Date(`${to}T00:00:00`);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  const fromAt = `${from}T00:00`;
  const toAt = `${localDay(rangeEnd)}T00:00`;
  const found = [];
  for (const calendar of calendars) {
    let masters;
    try { masters = eventsOf(calendar); } catch { continue; }
    for (const master of masters) {
      if (!master.startDate) continue;
      if (master.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
      if (!master.isRecurring()) {
        const item = shape(calendar, master, master.startDate, master.endDate);
        if (item.starts_at < toAt && item.ends_at > fromAt) found.push(item);
        continue;
      }
      const iterator = master.iterator();
      for (let i = 0, next = iterator.next(); next && i < MAX_OCCURRENCES; i++, next = iterator.next()) {
        if (next.toJSDate() >= rangeEnd) break;
        const details = master.getOccurrenceDetails(next);
        const item = shape(calendar, details.item, details.startDate, details.endDate);
        if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
        if (item.starts_at < toAt && item.ends_at > fromAt) found.push(item);
      }
    }
  }
  return found.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

// The hourly-ish read as the Settings › Background jobs list shows it: what it is, how often, when it last ran.
export function calendarJob(db, everyMs = READ_EVERY_MS) {
  const last = db.prepare('SELECT MAX(fetched_at) AS at FROM calendars WHERE deleted_at IS NULL').get().at;
  return {
    id: 'calendar-read', label: 'Read your other calendars', module: 'calendar-links',
    every_minutes: everyMs ? Math.round(everyMs / 60_000) : 0, // 0: kept as last read (READ_CALENDARS=off)
    last_run: last ?? null, on: moduleOn(db, 'calendar-links') && everyMs > 0,
  };
}
