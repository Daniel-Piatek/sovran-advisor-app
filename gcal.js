// Google Calendar (Calendar in depth, advanced/calendar/7): the part of the app that talks to Google Calendar's own API, through
// the Google sign-in of google.js and only while "Read your calendar" is switched on for that account. Read only here:
//   read   the account's calendars, and for each one its events from two weeks back to three months ahead (recurring events
//          already split into their days), kept in google_events by Google's own ids: a second read changes nothing, an event
//          that is gone from Google or cancelled is marked deleted, never removed.
//   show   googleEventsBetween: the events of a stretch of days as the Calendar and the Planner draw them, read only, with a G.
// Nothing is ever written to Google by this file.

import { randomUUID } from 'node:crypto';
import { accessToken } from './google.js';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const apiBase = (env = process.env) => String(env.GOOGLE_CALENDAR_API_URL || 'https://www.googleapis.com/calendar/v3').replace(/\/+$/, '');
const pad = (n) => String(n).padStart(2, '0');
const localAt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const GOOGLE_COLOUR = 4; // --cal-4: the colour of Google's events; the G says whose they are
export const READ_BACK_DAYS = 14;
export const READ_AHEAD_DAYS = 92;
const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };

// The account to read: its Google sign-in, and the proof "Read your calendar" is on.
export function readableAccount(db, accountId) {
  const google = db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId);
  if (!google) throw fail(404, 'No such Google account.');
  if (!list(google.enabled).includes('calendar.read')) throw fail(409, 'Switch on “Read your calendar” for this account under Settings › Google first.', 'switched_off');
  return google;
}

function client(db, keyStore, googleId, { env, fetcher, why = 'Read your calendar' }) {
  return async (pathAndQuery) => {
    const token = await accessToken(db, keyStore, { id: googleId, permission: 'calendar.read', why }, { env, fetcher });
    let res;
    try { res = await fetcher(`${apiBase(env)}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } }); } catch { throw fail(502, 'Google Calendar could not be reached. Is this computer online?', 'unreachable'); }
    if (res.status === 404) throw fail(404, 'Google Calendar has no such thing (any more).', 'not_found');
    if (!res.ok) throw fail(res.status === 401 || res.status === 403 ? 409 : 502, `Google Calendar said no (${res.status}).`, 'refused');
    return res.json();
  };
}

// A moment as Google writes it ({ dateTime } with its offset, or { date } for a whole day) as this computer's local time.
function momentOf(point) {
  if (!point) return null;
  if (point.date) return { at: `${point.date}T00:00`, allDay: true };
  if (!point.dateTime) return null;
  const date = new Date(point.dateTime);
  return Number.isNaN(date.getTime()) ? null : { at: localAt(date), allDay: false };
}

// One Google event as a row.
export function rowOfEvent(item, { calendarId, calendarName }) {
  const start = momentOf(item.start);
  const end = momentOf(item.end);
  if (!start || !end) return null;
  const attendees = (item.attendees ?? []).map((a) => ({ name: a.displayName ?? '', email: a.email ?? '', response: a.responseStatus ?? 'needsAction', self: Boolean(a.self), organizer: Boolean(a.organizer) }));
  const meet = item.hangoutLink || item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || '';
  return {
    calendar_id: calendarId, calendar_name: calendarName, event_id: item.id, ical_uid: item.iCalUID ?? '', etag: item.etag ?? '',
    title: (item.summary ?? '').trim() || 'Busy', starts_at: start.at, ends_at: end.at <= start.at ? start.at : end.at, all_day: start.allDay ? 1 : 0,
    location: item.location ?? '', description: item.description ?? '',
    organizer: JSON.stringify({ name: item.organizer?.displayName ?? '', email: item.organizer?.email ?? '', self: Boolean(item.organizer?.self) }),
    attendees: JSON.stringify(attendees), my_response: attendees.find((a) => a.self)?.response ?? '',
    meet_url: meet, html_link: item.htmlLink ?? '', recurring_event_id: item.recurringEventId ?? '',
    cancelled: item.status === 'cancelled',
  };
}

// A change of yours that waits to go: when Google's version is still the one it was made on, the read leaves the event as it is. When Google
// changed the event too, the read takes Google's version and the change becomes a clash (Calendar 8), to be settled by you.
function pendingChange(db, before, row) {
  const pending = db.prepare("SELECT * FROM calendar_outbox WHERE google_event_id = ? AND state IN ('waiting', 'sending') AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(before.id);
  if (!pending) return false;
  if (row.etag === pending.etag) return true;
  db.prepare("UPDATE calendar_outbox SET state = 'clash', theirs = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ title: row.title, starts_at: row.starts_at, ends_at: row.ends_at, location: row.location, description: row.description }), now(), pending.id);
  return false;
}

// Read one account: every calendar it shows, the window of days, each event kept by its ids. Returns what changed.
export async function readGoogleCalendar(db, keyStore, { accountId, env = process.env, fetcher = fetch, at = new Date() }) {
  const google = readableAccount(db, accountId);
  const get = client(db, keyStore, google.id, { env, fetcher });
  const from = new Date(at); from.setDate(from.getDate() - READ_BACK_DAYS);
  const to = new Date(at); to.setDate(to.getDate() + READ_AHEAD_DAYS);
  const window = { from: localAt(from), to: localAt(to) };
  const result = { calendars: 0, added: 0, changed: 0, removed: 0 };
  try {
    const calendars = ((await get('/users/me/calendarList')).items ?? []).filter((c) => c.selected !== false);
    const find = db.prepare('SELECT * FROM google_events WHERE account_id = ? AND calendar_id = ? AND event_id = ?');
    const seen = new Set();
    for (const calendar of calendars) {
      result.calendars += 1;
      // The calendars it shows are kept, with what this account may do in each (a new event goes in one it may write to).
      const time0 = now();
      db.prepare(`INSERT INTO google_calendars (id, created_at, updated_at, account_id, calendar_id, name, access_role, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (account_id, calendar_id) DO UPDATE SET name = excluded.name, access_role = excluded.access_role, is_primary = excluded.is_primary, updated_at = excluded.updated_at, deleted_at = NULL`)
        .run(randomUUID(), time0, time0, google.id, calendar.id, calendar.summaryOverride || calendar.summary || calendar.id, calendar.accessRole ?? '', calendar.primary ? 1 : 0);
      let token = '';
      do {
        const query = new URLSearchParams({
          timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(token ? { pageToken: token } : {}),
        });
        const page = await get(`/calendars/${encodeURIComponent(calendar.id)}/events?${query}`);
        for (const item of page.items ?? []) {
          const row = rowOfEvent(item, { calendarId: calendar.id, calendarName: calendar.summaryOverride || calendar.summary || calendar.id });
          if (!row) continue;
          seen.add(`${calendar.id} ${item.id}`);
          const before = find.get(google.id, calendar.id, item.id);
          const time = now();
          if (row.cancelled) {
            if (before && !before.deleted_at) { db.prepare('UPDATE google_events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, before.id); result.removed += 1; }
            continue;
          }
          const values = [row.calendar_name, row.ical_uid, row.etag, row.title, row.starts_at, row.ends_at, row.all_day, row.location, row.description, row.organizer, row.attendees, row.my_response, row.meet_url, row.html_link, row.recurring_event_id];
          if (!before) {
            db.prepare(`INSERT INTO google_events (id, created_at, updated_at, account_id, calendar_id, event_id, calendar_name, ical_uid, etag, title, starts_at, ends_at, all_day,
              location, description, organizer, attendees, my_response, meet_url, html_link, recurring_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(randomUUID(), time, time, google.id, calendar.id, item.id, ...values);
            result.added += 1;
          } else if (pendingChange(db, before, row)) {
            continue; // a change of yours waits to go and Google's version is the one it was made on: it is not overwritten
          } else if (before.deleted_at || before.etag !== row.etag || before.starts_at !== row.starts_at || before.ends_at !== row.ends_at || before.title !== row.title || before.attendees !== row.attendees) {
            db.prepare(`UPDATE google_events SET deleted_at = NULL, updated_at = ?, calendar_name = ?, ical_uid = ?, etag = ?, title = ?, starts_at = ?, ends_at = ?, all_day = ?, location = ?, description = ?,
              organizer = ?, attendees = ?, my_response = ?, meet_url = ?, html_link = ?, recurring_event_id = ? WHERE id = ?`).run(time, ...values, before.id);
            result.changed += 1;
          }
        }
        token = page.nextPageToken ?? '';
      } while (token);
    }
    // What Google no longer lists inside the window is gone from Google: marked deleted here, never removed.
    const mine = db.prepare('SELECT id, calendar_id, event_id FROM google_events WHERE account_id = ? AND deleted_at IS NULL AND starts_at >= ? AND starts_at <= ?').all(google.id, window.from, window.to);
    for (const row of mine) {
      if (row.event_id.startsWith('local-')) continue; // a new event of yours that has not gone to Google yet
      if (!seen.has(`${row.calendar_id} ${row.event_id}`)) { const time = now(); db.prepare('UPDATE google_events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, row.id); result.removed += 1; }
    }
    db.prepare("UPDATE google_accounts SET calendar_read_at = ?, calendar_problem = '' WHERE id = ?").run(now(), google.id);
    return result;
  } catch (err) {
    db.prepare('UPDATE google_accounts SET calendar_problem = ? WHERE id = ?').run(err.status ? err.message : 'Reading Google Calendar stopped half way.', google.id);
    throw err;
  }
}

// One kept Google event as the Calendar and the Planner draw it. `read_only` is false only where the changing guards allow a change (Calendar 8):
// the Change your calendar switch is on for the account and you organise the meeting. `google.sync` says where a change of it is.
export function shapeGoogle(db, r, { enabled = null, sync = '' } = {}) {
  const on = enabled ?? list(db.prepare('SELECT enabled FROM google_accounts WHERE id = ?').get(r.account_id)?.enabled);
  const organizer = JSON.parse(r.organizer || '{}');
  const canChange = on.includes('calendar.modify') && organizer.self === true;
  const attendees = JSON.parse(r.attendees || '[]');
  const invited = organizer.self !== true && attendees.some((a) => a.self); // someone else's meeting you are a guest of: the one thing that is yours is your answer
  return {
    id: `google:${r.id}`, uid: r.ical_uid || r.event_id, title: r.title, starts_at: r.starts_at, ends_at: r.ends_at, all_day: r.all_day === 1,
    note: r.description, location: r.location, read_only: !canChange, source: 'google',
    calendar: { id: r.calendar_id, name: r.calendar_name, colour: GOOGLE_COLOUR },
    google: {
      meet_url: r.meet_url, html_link: r.html_link, my_response: r.my_response, recurring: Boolean(r.recurring_event_id), etag: r.etag, can_change: canChange, sync,
      invited, can_answer: invited && on.includes('calendar.modify'), organizer, attendees,
    },
  };
}
const SYNC_RANK = { clash: 3, failed: 2, waiting: 1, sending: 1 };
export function googleEventsBetween(db, from, to) {
  if (!moduleOn(db, 'calendar-google')) return [];
  const rows = db.prepare(`SELECT e.*, a.enabled FROM google_events e JOIN google_accounts a ON a.id = e.account_id AND a.deleted_at IS NULL
    WHERE e.deleted_at IS NULL AND e.starts_at < ? AND e.ends_at >= ? ORDER BY e.starts_at, e.ends_at`).all(`${to}T24:00`, `${from}T00:00`);
  const waiting = new Map();
  for (const o of db.prepare("SELECT google_event_id, state FROM calendar_outbox WHERE state IN ('waiting', 'sending', 'clash', 'failed') AND deleted_at IS NULL").all()) {
    const best = waiting.get(o.google_event_id);
    if (!best || SYNC_RANK[o.state] > SYNC_RANK[best]) waiting.set(o.google_event_id, o.state === 'sending' ? 'waiting' : o.state);
  }
  return rows.filter((r) => list(r.enabled).includes('calendar.read'))
    .map((r) => shapeGoogle(db, r, { enabled: list(r.enabled), sync: waiting.get(r.id) ?? '' }))
    .filter((e) => (e.all_day ? e.starts_at.slice(0, 10) <= to && e.ends_at.slice(0, 10) >= from : true));
}

// The job: every `every` ms, each account with "Read your calendar" on (and only while Google Calendar is on). After the computer
// sleeps the first round catches up once. `tick()` runs a round by hand.
export function startGoogleCalendarRead(db, keyStore, { env, fetcher, every = 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running || !moduleOn(db, 'calendar-google')) return;
    running = true;
    try {
      for (const a of db.prepare('SELECT id, enabled FROM google_accounts WHERE deleted_at IS NULL').all()) {
        if (!list(a.enabled).includes('calendar.read')) continue;
        try { await readGoogleCalendar(db, keyStore, { accountId: a.id, env, fetcher }); } catch { /* said on the account: calendar_problem */ }
      }
    } finally { running = false; }
  };
  const timer = every ? setInterval(tick, every) : null;
  timer?.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

// What Settings shows for each account: when it was last read, what went wrong, how many events are kept.
export function googleCalendarState(db) {
  return db.prepare('SELECT id, email, enabled, calendar_read_at, calendar_problem FROM google_accounts WHERE deleted_at IS NULL ORDER BY created_at, rowid').all().map((a) => ({
    account_id: a.id, email: a.email, on: list(a.enabled).includes('calendar.read'), read_at: a.calendar_read_at ?? null, problem: a.calendar_problem,
    events: db.prepare('SELECT count(*) AS n FROM google_events WHERE account_id = ? AND deleted_at IS NULL').get(a.id).n,
  }));
}

// The Settings › Background jobs row for the read.
export function googleCalendarJob(db, everyMs = 60_000) {
  const last = db.prepare('SELECT MAX(calendar_read_at) AS at FROM google_accounts WHERE deleted_at IS NULL').get().at;
  return {
    id: 'google-calendar-read', label: 'Read your Google calendars', module: 'calendar-google',
    every_minutes: everyMs ? Math.max(1, Math.round(everyMs / 60_000)) : 0, last_run: last ?? null, on: moduleOn(db, 'calendar-google') && everyMs > 0,
  };
}

// The Settings › Background jobs row for the sender of changes (every couple of seconds; it only does anything when a change waits).
export function googleCalendarSendJob(db, everyMs = 2000) {
  const last = db.prepare("SELECT MAX(sent_at) AS at FROM calendar_outbox WHERE state = 'sent'").get().at;
  return {
    id: 'google-calendar-send', label: 'Send your changes to Google Calendar', module: 'calendar-google',
    every_seconds: everyMs ? Math.round(everyMs / 1000) : 0, last_run: last ?? null, on: moduleOn(db, 'calendar-google') && everyMs > 0,
  };
}

// The calendars an account may write to (owner or writer): where a new event can go.
export function writableCalendars(db) {
  return db.prepare(`SELECT c.account_id, a.email, c.calendar_id, c.name, c.access_role, c.is_primary FROM google_calendars c
    JOIN google_accounts a ON a.id = c.account_id AND a.deleted_at IS NULL WHERE c.deleted_at IS NULL AND c.access_role IN ('owner', 'writer')
    AND a.enabled LIKE '%calendar.modify%' ORDER BY a.created_at, c.is_primary DESC, c.name`).all().map((r) => ({ ...r, is_primary: r.is_primary === 1 }));
}
