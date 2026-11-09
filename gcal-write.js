// Changing Google events, safely (Calendar in depth, advanced/calendar/8). A change shows in the app at once and waits in an outbox
// (calendar_outbox) with the version of the event it was made on, its etag. A job sends it to Google with If-Match: Google takes it
// only if it still has that version. If not, Google's version is kept, the change stays as a clash with Google's side beside it, and you
// decide: Use mine, or Keep Google's. Nothing is ever overwritten in silence. What may change is one switch and three guards:
//   switch  "Change your calendar" (the Google permission calendar.modify): off until you turn it on, and Google is asked for it then.
//   guard 1 which events: only meetings you organise; on someone else's meeting only your answer is yours (Calendar 9); calendar links never.
//   guard 2 which fields: title, day, start, length, place, description, each one switched on or off (Settings › Google Calendar).
//   guard 3 when to read again: the version is checked on every send (If-Match) and Google is read again at once when it says no.
// Changes to one event within a second become one, Google being busy is waited out (2, 4, 8, 16 seconds), and after five tries the
// change says "Not saved to Google yet" and stays in the outbox. Nothing here is ever deleted in Google.

import { randomUUID } from 'node:crypto';
import { accessToken } from './google.js';
import { moduleOn } from './modules.js';
import { rowOfEvent, shapeGoogle, readGoogleCalendar } from './gcal.js';
import { setEventPeople } from './events.js';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const apiBase = (env = process.env) => String(env.GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3').replace(/\/+$/, '');
const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
export const MERGE_WINDOW_MS = 1000;
export const MAX_TRIES = 5;

export const FIELDS = [
  { id: 'title', name: 'Title' }, { id: 'day', name: 'Day' }, { id: 'start', name: 'Start' },
  { id: 'length', name: 'Length' }, { id: 'location', name: 'Place' }, { id: 'description', name: 'Description' },
];
const GUARD_KEY = 'gcal.fields';
export const GUARD_RULES = [
  'Only meetings you organise can be changed here. On someone else’s meeting only your answer is yours. Calendar links are never written to.',
  'Only the fields switched on above can be changed.',
  'Every change goes with the version it was made on: if Google has a newer one, Google’s is kept and you decide.',
];

export function getGuards(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(GUARD_KEY);
  let on = FIELDS.map((f) => f.id);
  try { const v = JSON.parse(row?.value); if (Array.isArray(v)) on = v.filter((id) => FIELDS.some((f) => f.id === id)); } catch { /* the default: all */ }
  return { fields: FIELDS.map((f) => ({ ...f, on: on.includes(f.id) })), rules: GUARD_RULES };
}
export function setGuards(db, { fields }) {
  if (!Array.isArray(fields) || fields.some((id) => !FIELDS.some((f) => f.id === id))) throw fail(400, 'fields is a list of field names.');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`).run(randomUUID(), time, time, GUARD_KEY, JSON.stringify(fields));
  return getGuards(db);
}

const minutesOf = (at) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
const lengthOf = (row) => (new Date(`${row.ends_at}:00`) - new Date(`${row.starts_at}:00`)) / 60_000;

// Which fields a change touches, in the names of the guards.
function fieldsTouched(row, next) {
  const touched = [];
  if (next.title !== row.title) touched.push('title');
  if (next.starts_at.slice(0, 10) !== row.starts_at.slice(0, 10)) touched.push('day');
  if (next.starts_at.slice(11) !== row.starts_at.slice(11)) touched.push('start');
  if (lengthOf(next) !== lengthOf(row)) touched.push('length');
  if (next.location !== row.location) touched.push('location');
  if (next.description !== row.description) touched.push('description');
  return touched;
}

// A change of a Google event (by its id in google_events): the guards, the row changed at once, the outbox.
export function changeGoogleEvent(db, id, changes, { scope = 'this' } = {}) {
  const row = db.prepare('SELECT * FROM google_events WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw fail(404, 'No such Google event.');
  if (!moduleOn(db, 'calendar-google')) throw fail(409, 'Google Calendar is switched off (Settings › Modules).', 'module_off');
  const account = db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(row.account_id);
  if (!account || !list(account.enabled).includes('calendar.modify')) throw fail(409, 'Switch on “Change your calendar” for this account under Settings › Google first.', 'switched_off');
  if (JSON.parse(row.organizer || '{}').self !== true) throw fail(403, 'Only the organiser changes this meeting. You can answer it.', 'not_organiser');

  const next = {
    title: 'title' in changes ? String(changes.title).trim() : row.title,
    starts_at: changes.starts_at ?? row.starts_at, ends_at: changes.ends_at ?? row.ends_at,
    location: 'location' in changes ? String(changes.location) : row.location,
    description: 'note' in changes ? String(changes.note) : 'description' in changes ? String(changes.description) : row.description,
  };
  if (!next.title) throw fail(400, 'An event needs a name.');
  if (next.ends_at <= next.starts_at) throw fail(400, 'An event ends after it starts.');
  const touched = fieldsTouched(row, next);
  if (!touched.length) return shapeGoogle(db, row, { sync: syncOf(db, row.id) });
  if (scope === 'all') return moveSeries(db, row, next, touched);
  if (row.all_day && touched.some((f) => ['day', 'start', 'length'].includes(f))) throw fail(400, 'A whole-day event changes in Google Calendar itself.');
  const allowed = new Set(getGuards(db).fields.filter((f) => f.on).map((f) => f.id));
  const refused = touched.filter((f) => !allowed.has(f));
  if (refused.length) throw fail(403, `“${FIELDS.find((f) => f.id === refused[0]).name}” is switched off for changes (Settings › Google Calendar).`, 'field_off');

  const patch = {};
  if (next.title !== row.title) patch.title = next.title;
  if (next.starts_at !== row.starts_at) patch.starts_at = next.starts_at;
  if (next.ends_at !== row.ends_at) patch.ends_at = next.ends_at;
  if (next.location !== row.location) patch.location = next.location;
  if (next.description !== row.description) patch.description = next.description;
  const time = now();
  db.prepare('UPDATE google_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.starts_at, next.ends_at, next.location, next.description, time, row.id);
  // Changes to one event that has not gone yet become one: the version stays the one the first was made on.
  const waiting = db.prepare("SELECT * FROM calendar_outbox WHERE google_event_id = ? AND state = 'waiting' AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(row.id);
  const later = new Date(Date.now() + MERGE_WINDOW_MS).toISOString();
  if (waiting) {
    db.prepare('UPDATE calendar_outbox SET patch = ?, next_try_at = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(waiting.patch), ...patch }), later, time, waiting.id);
  } else {
    db.prepare('INSERT INTO calendar_outbox (id, created_at, updated_at, account_id, google_event_id, patch, etag, state, next_try_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), time, time, row.account_id, row.id, JSON.stringify(patch), row.etag, 'waiting', later);
  }
  return shapeGoogle(db, db.prepare('SELECT * FROM google_events WHERE id = ?').get(row.id), { sync: 'waiting' });
}


// ---- A repeating event: this one, or all ----
// "All" moves the whole series: its time moves by what this one moved (a day and a time of day, so a night when the clocks change is still right).
const shiftLocal = (at, dayDelta, minuteDelta) => {
  const d = new Date(`${at}:00`);
  d.setDate(d.getDate() + dayDelta);
  d.setMinutes(d.getMinutes() + minuteDelta);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const pad = (n) => String(n).padStart(2, '0');
const dayDiff = (a, b) => Math.round((new Date(`${b.slice(0, 10)}T12:00:00`) - new Date(`${a.slice(0, 10)}T12:00:00`)) / 86_400_000);

function shiftSeries(db, row, dayDelta, minuteDelta, lengthDelta = 0) {
  const rows = db.prepare('SELECT id, starts_at, ends_at FROM google_events WHERE account_id = ? AND calendar_id = ? AND recurring_event_id = ? AND deleted_at IS NULL').all(row.account_id, row.calendar_id, row.recurring_event_id);
  const time = now();
  for (const r of rows) db.prepare('UPDATE google_events SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?').run(shiftLocal(r.starts_at, dayDelta, minuteDelta), shiftLocal(shiftLocal(r.ends_at, dayDelta, minuteDelta), 0, lengthDelta), time, r.id);
}

function moveSeries(db, row, next, touched) {
  if (!row.recurring_event_id) throw fail(400, 'This event does not repeat.');
  if (touched.some((f) => ['title', 'location', 'description'].includes(f))) throw fail(400, 'All the events of a series change their time here; other changes are for “This one”.');
  const dayDelta = dayDiff(row.starts_at, next.starts_at);
  const minuteDelta = minutesOf(next.starts_at) - minutesOf(row.starts_at);
  const lengthDelta = lengthOf(next) - lengthOf(row);
  const allowed = new Set(getGuards(db).fields.filter((f) => f.on).map((f) => f.id));
  const refused = touched.filter((f) => !allowed.has(f));
  if (refused.length) throw fail(403, `“${FIELDS.find((f) => f.id === refused[0]).name}” is switched off for changes (Settings › Google Calendar).`, 'field_off');
  shiftSeries(db, row, dayDelta, minuteDelta, lengthDelta);
  const time = now();
  const later = new Date(Date.now() + MERGE_WINDOW_MS).toISOString();
  const waiting = db.prepare("SELECT * FROM calendar_outbox WHERE google_event_id = ? AND kind = 'move_all' AND state = 'waiting' AND deleted_at IS NULL LIMIT 1").get(row.id);
  if (waiting) {
    const p = JSON.parse(waiting.payload);
    db.prepare('UPDATE calendar_outbox SET payload = ?, next_try_at = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...p, day_delta: p.day_delta + dayDelta, minute_delta: p.minute_delta + minuteDelta, length_delta: (p.length_delta ?? 0) + lengthDelta }), later, time, waiting.id);
  } else {
    db.prepare("INSERT INTO calendar_outbox (id, created_at, updated_at, account_id, google_event_id, patch, etag, state, next_try_at, kind, payload) VALUES (?, ?, ?, ?, ?, '{}', ?, 'waiting', ?, 'move_all', ?)")
      .run(randomUUID(), time, time, row.account_id, row.id, row.etag, later, JSON.stringify({ recurring_event_id: row.recurring_event_id, day_delta: dayDelta, minute_delta: minuteDelta, length_delta: lengthDelta }));
  }
  return shapeGoogle(db, db.prepare('SELECT * FROM google_events WHERE id = ?').get(row.id), { sync: 'waiting' });
}

// ---- Your answer to an invitation ----
export const ANSWERS = ['accepted', 'tentative', 'declined'];
export function answerGoogleEvent(db, id, response) {
  if (!ANSWERS.includes(response)) throw fail(400, 'response is accepted, tentative or declined.');
  const row = db.prepare('SELECT * FROM google_events WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw fail(404, 'No such Google event.');
  if (!moduleOn(db, 'calendar-google')) throw fail(409, 'Google Calendar is switched off (Settings › Modules).', 'module_off');
  const account = db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(row.account_id);
  if (!account || !list(account.enabled).includes('calendar.modify')) throw fail(409, 'Switch on “Change your calendar” for this account under Settings › Google first.', 'switched_off');
  const attendees = JSON.parse(row.attendees || '[]');
  if (JSON.parse(row.organizer || '{}').self === true || !attendees.some((a) => a.self)) throw fail(400, 'Only a meeting someone else invited you to can be answered.');
  const time = now();
  db.prepare('UPDATE google_events SET attendees = ?, my_response = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(attendees.map((a) => (a.self ? { ...a, response } : a))), response, time, row.id);
  const waiting = db.prepare("SELECT * FROM calendar_outbox WHERE google_event_id = ? AND kind = 'answer' AND state = 'waiting' AND deleted_at IS NULL LIMIT 1").get(row.id);
  const later = new Date(Date.now() + MERGE_WINDOW_MS).toISOString();
  if (waiting) db.prepare('UPDATE calendar_outbox SET payload = ?, next_try_at = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ response }), later, time, waiting.id);
  else {
    db.prepare("INSERT INTO calendar_outbox (id, created_at, updated_at, account_id, google_event_id, patch, etag, state, next_try_at, kind, payload) VALUES (?, ?, ?, ?, ?, '{}', ?, 'waiting', ?, 'answer', ?)")
      .run(randomUUID(), time, time, row.account_id, row.id, row.etag, later, JSON.stringify({ response }));
  }
  return shapeGoogle(db, db.prepare('SELECT * FROM google_events WHERE id = ?').get(row.id), { sync: 'waiting' });
}

// ---- A new event, with guests and a Meet link ----
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOf = (person) => String(person.emails ?? '').split(/[\n,;]+/).map((x) => x.trim()).find((x) => EMAIL.test(x)) ?? '';

export function createGoogleEvent(db, input) {
  if (!moduleOn(db, 'calendar-google')) throw fail(409, 'Google Calendar is switched off (Settings › Modules).', 'module_off');
  const account = db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(String(input.account_id ?? ''));
  if (!account) throw fail(404, 'No such Google account.');
  if (!list(account.enabled).includes('calendar.modify')) throw fail(409, 'Switch on “Change your calendar” for this account under Settings › Google first.', 'switched_off');
  const calendar = db.prepare("SELECT * FROM google_calendars WHERE account_id = ? AND calendar_id = ? AND deleted_at IS NULL AND access_role IN ('owner', 'writer')").get(account.id, String(input.calendar_id ?? ''));
  if (!calendar) throw fail(400, 'That calendar cannot be written to.');
  const title = String(input.title ?? '').trim();
  if (!title) throw fail(400, 'An event needs a name.');
  const starts = String(input.starts_at ?? '');
  const ends = String(input.ends_at ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ends)) throw fail(400, 'starts_at and ends_at are moments: YYYY-MM-DDTHH:MM.');
  if (ends <= starts) throw fail(400, 'An event ends after it starts.');
  // Guests come from People: a person's first email address, so “Lena” is Lena Fischer with hers.
  const guests = [];
  const peopleIds = [];
  for (const pid of Array.isArray(input.people) ? input.people : []) {
    const person = db.prepare('SELECT id, name, emails FROM people WHERE id = ? AND deleted_at IS NULL').get(String(pid));
    if (!person) throw fail(400, 'There is no such person.');
    const email = emailOf(person);
    if (!email) throw fail(400, `${person.name} has no email address in People yet.`);
    if (!guests.some((g) => g.email.toLowerCase() === email.toLowerCase())) guests.push({ email, name: person.name });
    peopleIds.push(person.id);
  }
  for (const email of Array.isArray(input.emails) ? input.emails : []) {
    if (!EMAIL.test(String(email))) throw fail(400, `“${email}” is not an email address.`);
    if (!guests.some((g) => g.email.toLowerCase() === String(email).toLowerCase())) guests.push({ email: String(email), name: '' });
  }
  const key = randomUUID();
  const id = randomUUID();
  const time = now();
  const attendees = guests.map((g) => ({ name: g.name, email: g.email, response: 'needsAction', self: false, organizer: false }));
  db.prepare(`INSERT INTO google_events (id, created_at, updated_at, account_id, calendar_id, calendar_name, event_id, title, starts_at, ends_at, all_day, location, description, organizer, attendees)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
    .run(id, time, time, account.id, calendar.calendar_id, calendar.name, `local-${key}`, title, starts, ends, String(input.location ?? ''), String(input.note ?? ''),
      JSON.stringify({ name: '', email: account.email, self: true }), JSON.stringify(attendees));
  db.prepare("INSERT INTO calendar_outbox (id, created_at, updated_at, account_id, google_event_id, patch, etag, state, next_try_at, kind, payload) VALUES (?, ?, ?, ?, ?, '{}', '', 'waiting', ?, 'insert', ?)")
    .run(randomUUID(), time, time, account.id, id, new Date(Date.now() + MERGE_WINDOW_MS).toISOString(), JSON.stringify({ key, meet: input.meet === true, guests }));
  if (peopleIds.length) setEventPeople(db, id, peopleIds);
  return shapeGoogle(db, db.prepare('SELECT * FROM google_events WHERE id = ?').get(id), { sync: 'waiting' });
}

function syncOf(db, eventId) {
  const o = db.prepare("SELECT state FROM calendar_outbox WHERE google_event_id = ? AND state IN ('waiting', 'sending', 'clash', 'failed') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").get(eventId);
  return o ? (o.state === 'sending' ? 'waiting' : o.state) : '';
}

// What goes to Google for a patch: Google's own field names, whole-day events keep their dates.
function bodyOf(patch) {
  const body = {};
  if ('title' in patch) body.summary = patch.title;
  if ('location' in patch) body.location = patch.location;
  if ('description' in patch) body.description = patch.description;
  if ('starts_at' in patch) body.start = { dateTime: new Date(patch.starts_at).toISOString() };
  if ('ends_at' in patch) body.end = { dateTime: new Date(patch.ends_at).toISOString() };
  return body;
}

const BACKOFF_S = [2, 4, 8, 16, 32];
const attendeesBody = (attendees, response) => attendees.map((a) => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}), responseStatus: a.self ? response : (a.response || 'needsAction') }));
const isoOf = (local) => new Date(local).toISOString();

// One request for one outbox row, by what it is. Returns { res, after } where `after` runs once the row is marked sent.
async function attempt(db, o, row, token, { env, fetcher }) {
  const base = apiBase(env);
  const cal = encodeURIComponent(row.calendar_id);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = JSON.parse(o.payload || '{}');
  if (o.kind === 'insert') {
    // The app's own key travels with the event, so a retry whose answer was lost finds the one that was made and does not make a second.
    const found = await fetcher(`${base}/calendars/${cal}/events?${new URLSearchParams({ privateExtendedProperty: `appKey=${payload.key}`, singleEvents: 'true' })}`, { headers });
    if (found.ok) { const hit = (await found.json()).items?.[0]; if (hit) return { res: { ok: true, status: 200, json: async () => hit } }; }
    const body = {
      summary: row.title, location: row.location, description: row.description,
      start: { dateTime: isoOf(row.starts_at) }, end: { dateTime: isoOf(row.ends_at) },
      ...(payload.guests?.length ? { attendees: payload.guests.map((g) => ({ email: g.email, ...(g.name ? { displayName: g.name } : {}) })) } : {}),
      extendedProperties: { private: { appKey: payload.key } },
      ...(payload.meet ? { conferenceData: { createRequest: { requestId: payload.key, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    };
    return { res: await fetcher(`${base}/calendars/${cal}/events?conferenceDataVersion=1&sendUpdates=all`, { method: 'POST', headers, body: JSON.stringify(body) }) };
  }
  if (o.kind === 'answer') {
    const attendees = JSON.parse(row.attendees || '[]');
    return { res: await fetcher(`${base}/calendars/${cal}/events/${encodeURIComponent(row.event_id)}?sendUpdates=all`, { method: 'PATCH', headers: { ...headers, 'If-Match': o.etag }, body: JSON.stringify({ attendees: attendeesBody(attendees, payload.response) }) }) };
  }
  if (o.kind === 'move_all') {
    // The series is its first event: Google's own copy of it is read now and moved by what this one moved.
    const masterUrl = `${base}/calendars/${cal}/events/${encodeURIComponent(payload.recurring_event_id)}`;
    const got = await fetcher(masterUrl, { headers });
    if (!got.ok) return { res: got };
    const master = await got.json();
    const start = new Date(master.start.dateTime);
    const end = new Date(master.end.dateTime);
    const move = (d, extra = 0) => { const n = new Date(d); n.setDate(n.getDate() + payload.day_delta); n.setMinutes(n.getMinutes() + payload.minute_delta + extra); return n.toISOString(); };
    const body = {
      start: { dateTime: move(start), ...(master.start.timeZone ? { timeZone: master.start.timeZone } : {}) },
      end: { dateTime: move(end, payload.length_delta ?? 0), ...(master.end?.timeZone ? { timeZone: master.end.timeZone } : {}) },
    };
    return { res: await fetcher(`${masterUrl}?sendUpdates=all`, { method: 'PATCH', headers: { ...headers, 'If-Match': master.etag }, body: JSON.stringify(body) }), series: true };
  }
  return { res: await fetcher(`${base}/calendars/${cal}/events/${encodeURIComponent(row.event_id)}`, { method: 'PATCH', headers: { ...headers, 'If-Match': o.etag }, body: JSON.stringify(bodyOf(JSON.parse(o.patch))) }) };
}

// The sender: what waits and is due goes, one request each, with If-Match. `force` sends without waiting for the merge window.
export async function sendDue(db, keyStore, { env = process.env, fetcher = fetch, force = false } = {}) {
  const summary = { sent: 0, clash: 0, failed: 0, retry: 0 };
  if (!moduleOn(db, 'calendar-google')) return summary;
  const due = db.prepare("SELECT * FROM calendar_outbox WHERE state = 'waiting' AND deleted_at IS NULL ORDER BY created_at").all()
    .filter((o) => force || !o.next_try_at || o.next_try_at <= now());
  for (const o of due) {
    const claimed = db.prepare("UPDATE calendar_outbox SET state = 'sending', updated_at = ? WHERE id = ? AND state = 'waiting'").run(now(), o.id);
    if (!claimed.changes) continue; // taken by another round: never sent twice
    const row = db.prepare('SELECT * FROM google_events WHERE id = ?').get(o.google_event_id);
    const done = (fields) => { const keys = Object.keys(fields); db.prepare(`UPDATE calendar_outbox SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), now(), o.id); };
    if (!row || row.deleted_at) { done({ state: 'failed', problem: 'The event is gone from Google.' }); summary.failed += 1; continue; }
    try {
      const token = await accessToken(db, keyStore, { id: o.account_id, permission: 'calendar.modify', why: `Send ${{ insert: 'a new event', answer: 'an answer', move_all: 'a moved series' }[o.kind] ?? 'a change'} to Google Calendar` }, { env, fetcher });
      let sent;
      try { sent = await attempt(db, o, row, token, { env, fetcher }); } catch { sent = { res: null }; }
      const res = sent.res;
      if (res?.ok) {
        const event = await res.json();
        const kept = rowOfEvent(event, { calendarId: row.calendar_id, calendarName: row.calendar_name });
        if (o.kind === 'insert') {
          // The event Google made: its own id and version, its Meet link and its guests as Google has them.
          if (kept) db.prepare('UPDATE google_events SET event_id = ?, etag = ?, ical_uid = ?, meet_url = ?, html_link = ?, attendees = ?, organizer = ?, updated_at = ? WHERE id = ?')
            .run(event.id, kept.etag, kept.ical_uid, kept.meet_url, kept.html_link, kept.attendees, row.organizer, now(), row.id);
        } else if (kept && !sent.series) db.prepare('UPDATE google_events SET etag = ?, updated_at = ? WHERE id = ?').run(kept.etag, now(), row.id);
        done({ state: 'sent', sent_at: now(), etag: kept?.etag ?? o.etag, problem: '' });
        summary.sent += 1;
        if (sent.series) await readGoogleCalendar(db, keyStore, { accountId: o.account_id, env, fetcher }).catch(() => {}); // every event of the series, as Google now has it
      } else if (res?.status === 412) {
        // Google has a newer version: it is read again at once and kept; the change waits as a clash.
        const theirs = await readOne(db, keyStore, o.account_id, row, { env, fetcher });
        done({ state: 'clash', theirs: JSON.stringify(theirs ?? {}) });
        summary.clash += 1;
        if (o.kind === 'move_all') await readGoogleCalendar(db, keyStore, { accountId: o.account_id, env, fetcher }).catch(() => {});
      } else if (res && (res.status === 404 || res.status === 410)) {
        db.prepare('UPDATE google_events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id);
        done({ state: 'failed', problem: 'The event is gone from Google.' });
        summary.failed += 1;
      } else if (res && res.status >= 400 && res.status < 500 && res.status !== 429) {
        done({ state: 'failed', problem: `Google said no (${res.status}).` });
        summary.failed += 1;
      } else {
        const tries = o.tries + 1; // busy or away: wait and try again, up to five times
        if (tries >= MAX_TRIES) { done({ state: 'failed', tries, problem: 'Not saved to Google yet.' }); summary.failed += 1; }
        else { done({ state: 'waiting', tries, next_try_at: new Date(Date.now() + BACKOFF_S[tries - 1] * 1000).toISOString() }); summary.retry += 1; }
      }
    } catch (err) {
      done({ state: 'failed', problem: err.status ? err.message : 'Not saved to Google yet.' });
      summary.failed += 1;
    }
  }
  return summary;
}

// One event, read again from Google and kept (Google's version wins); returns what Google has now.
async function readOne(db, keyStore, accountId, row, { env, fetcher }) {
  const token = await accessToken(db, keyStore, { id: accountId, permission: 'calendar.read', why: 'Read an event again after a clash' }, { env, fetcher }).catch(() => null);
  if (!token) return null;
  let res;
  try { res = await fetcher(`${apiBase(env)}/calendars/${encodeURIComponent(row.calendar_id)}/events/${encodeURIComponent(row.event_id)}`, { headers: { Authorization: `Bearer ${token}` } }); } catch { return null; }
  if (!res.ok) return null;
  const kept = rowOfEvent(await res.json(), { calendarId: row.calendar_id, calendarName: row.calendar_name });
  if (!kept) return null;
  db.prepare('UPDATE google_events SET etag = ?, title = ?, starts_at = ?, ends_at = ?, location = ?, description = ?, attendees = ?, my_response = ?, meet_url = ?, updated_at = ? WHERE id = ?')
    .run(kept.etag, kept.title, kept.starts_at, kept.ends_at, kept.location, kept.description, kept.attendees, kept.my_response, kept.meet_url, now(), row.id);
  return { title: kept.title, starts_at: kept.starts_at, ends_at: kept.ends_at, location: kept.location, description: kept.description, my_response: kept.my_response };
}

// A clash settled: Use mine puts the change back in the outbox on Google's newer version; Keep Google's lets it go.
export function resolveClash(db, id, use) {
  const o = db.prepare("SELECT * FROM calendar_outbox WHERE id = ? AND state = 'clash' AND deleted_at IS NULL").get(id);
  if (!o) throw fail(404, 'No such clash.');
  if (!['mine', 'google'].includes(use)) throw fail(400, 'use is mine or google.');
  const time = now();
  if (use === 'mine') {
    const row = db.prepare('SELECT * FROM google_events WHERE id = ?').get(o.google_event_id);
    if (o.kind === 'answer') {
      const { response } = JSON.parse(o.payload || '{}');
      db.prepare('UPDATE google_events SET attendees = ?, my_response = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(JSON.parse(row.attendees || '[]').map((a) => (a.self ? { ...a, response } : a))), response, time, row.id);
    } else if (o.kind === 'move_all') {
      const p = JSON.parse(o.payload || '{}');
      shiftSeries(db, row, p.day_delta, p.minute_delta, p.length_delta ?? 0);
    } else {
      const patch = JSON.parse(o.patch);
      db.prepare('UPDATE google_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, description = ?, updated_at = ? WHERE id = ?')
        .run(patch.title ?? row.title, patch.starts_at ?? row.starts_at, patch.ends_at ?? row.ends_at, patch.location ?? row.location, patch.description ?? row.description, time, row.id);
    }
    db.prepare("UPDATE calendar_outbox SET state = 'waiting', etag = ?, tries = 0, theirs = '{}', problem = '', next_try_at = ?, updated_at = ? WHERE id = ?").run(row.etag, time, time, o.id);
  } else {
    db.prepare("UPDATE calendar_outbox SET state = 'dismissed', updated_at = ? WHERE id = ?").run(time, o.id);
  }
  return { id: o.id, state: use === 'mine' ? 'waiting' : 'dismissed' };
}

// A change that was not saved (five tries) goes back to waiting, for another five.
export function retryChange(db, id) {
  const o = db.prepare("SELECT * FROM calendar_outbox WHERE id = ? AND state = 'failed' AND deleted_at IS NULL").get(id);
  if (!o) throw fail(404, 'No such change.');
  db.prepare("UPDATE calendar_outbox SET state = 'waiting', tries = 0, problem = '', next_try_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  return { id, state: 'waiting' };
}

// What the Calendar's pane shows: what is not settled, then the last few that went.
export function listOutbox(db) {
  const rows = db.prepare(`SELECT o.*, e.title AS event_title, e.starts_at AS event_starts FROM calendar_outbox o JOIN google_events e ON e.id = o.google_event_id
    WHERE o.deleted_at IS NULL AND (o.state IN ('waiting', 'sending', 'clash', 'failed') OR (o.state = 'sent' AND o.sent_at > ?)) ORDER BY o.created_at DESC LIMIT 30`)
    .all(new Date(Date.now() - 10 * 60_000).toISOString());
  return rows.map((o) => ({
    id: o.id, kind: o.kind, payload: JSON.parse(o.payload || '{}'), event: o.event_title, event_starts: o.event_starts, state: o.state === 'sending' ? 'waiting' : o.state, patch: JSON.parse(o.patch), etag: o.etag,
    tries: o.tries, problem: o.problem, theirs: JSON.parse(o.theirs || '{}'), sent_at: o.sent_at,
  }));
}

// The job: every `every` ms what is due goes. After the computer sleeps the first round catches up once.
export function startGoogleCalendarSend(db, keyStore, { env, fetcher, every = 2000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sendDue(db, keyStore, { env, fetcher }); } catch { /* said on each change */ } finally { running = false; }
  };
  const timer = every ? setInterval(tick, every) : null;
  timer?.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
