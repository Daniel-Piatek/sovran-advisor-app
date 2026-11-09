// Your assistant and your calendar (Calendar in depth, advanced/calendar/10). Two tools:
//   calendar_list     reading: the events of a stretch of days (yours, other calendars' and Google's), and the free time left in your plan.
//   calendar_propose  a new or moved event as an approval card. It NEVER makes or moves anything itself: a meeting is agreed with other people,
//                     so the card always waits for your yes (the "Change a note or a task" switch does not let it through), and only
//                     Approve puts the event in your calendar (a Google calendar through the same outbox as every change, to Google).
// The note on the card says when it overlaps something. Undo takes back what has not gone to Google yet.

import { eventsBetween, createEvent, updateEvent, deleteEvent, getEvent } from './events.js';
import { calendarEventsBetween, ownEvent } from './calendars.js';
import { getSettings } from './planner.js';
import { listTasks } from './tasks.js';
import { writableCalendars } from './gcal.js';
import { createGoogleEvent, changeGoogleEvent } from './gcal-write.js';
import { findPerson } from './interactions.js';
import { dayOrder } from './public/day-order.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const plusDays = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MAX_DAYS = 21;

const eventsOn = (db, day) => [...eventsBetween(db, day, day).map(ownEvent(db)), ...calendarEventsBetween(db, day, day)];
const sourceOf = (e) => (e.source === 'google' ? 'google' : e.calendar ? 'calendar link' : 'yours');

// The events of the days, and for each day the free time left once the plan is in it: the gaps between its events inside the
// Planner's day, less what the tasks placed in them take (the same function the Planner's Order is drawn from).
export function calendarList(db, { from, to } = {}) {
  if (!isDay(from)) throw fail(400, 'from is a day (YYYY-MM-DD).');
  const last = to === undefined ? from : to;
  if (!isDay(last) || last < from) throw fail(400, 'to is a day (YYYY-MM-DD) on or after from.');
  const days = [];
  for (let d = from; d <= last; d = plusDays(d, 1)) { days.push(d); if (days.length > MAX_DAYS) throw fail(400, `At most ${MAX_DAYS} days at a time.`); }
  const settings = getSettings(db);
  const tasks = listTasks(db).filter((t) => !t.done);
  return days.map((day) => {
    const events = eventsOn(db, day);
    const timed = events.filter((e) => !e.all_day);
    const startOf = (e) => (e.starts_at.slice(0, 10) < day ? 0 : mins(e.starts_at.slice(11)));
    const endOf = (e) => (e.ends_at.slice(0, 10) > day ? 24 * 60 : mins(e.ends_at.slice(11)));
    const planned = tasks.filter((t) => t.due === day && t.plan_part && !t.block_id);
    const split = mins(settings.split);
    const order = dayOrder({
      from: mins(settings.day_start), to: mins(settings.day_end),
      anchors: timed.map((e) => ({ id: e.id, title: e.title, start: startOf(e), end: endOf(e) })),
      tasks: planned.map((t) => ({ id: t.id, start: t.plan_at ? mins(t.plan_at) : t.plan_part === 'morning' ? mins(settings.day_start) : split, minutes: t.pin_minutes && t.pin_at ? t.pin_minutes : t.estimate ?? settings.no_estimate_minutes })),
    });
    return {
      day,
      events: events.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: Boolean(e.all_day), source: sourceOf(e), calendar: e.calendar?.name ?? 'My events', changeable: e.read_only === false || !e.read_only })),
      planned_tasks: planned.length,
      free: order.gaps.filter((g) => g.free >= 30).map((g) => ({ from: hhmm(g.from), to: hhmm(g.to), free_minutes: g.free, after: g.after?.title ?? null })),
    };
  });
}

// A proposal, checked: what it would make or move, where, with whom, and what it overlaps.
export function planProposal(db, args) {
  const title = String(args.title ?? '').trim();
  const move = args.move_event_id ? String(args.move_event_id) : '';
  const startsAt = String(args.starts_at ?? '');
  if (!AT.test(startsAt)) throw fail(400, 'starts_at is a moment: YYYY-MM-DDTHH:MM.');
  let endsAt = String(args.ends_at ?? '');
  if (!endsAt && Number.isInteger(args.minutes) && args.minutes > 0) {
    const d = new Date(`${startsAt}:00`); d.setMinutes(d.getMinutes() + args.minutes);
    endsAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (!AT.test(endsAt) || endsAt <= startsAt) throw fail(400, 'ends_at is a moment after starts_at (or give minutes).');
  const plan = { move: false, title, starts_at: startsAt, ends_at: endsAt, where: 'mine', people: [], meet: false, overlaps: [] };

  if (move) {
    // Moving an event that exists: yours (by id), or one in Google that you organise (google:<id>).
    const own = !move.startsWith('google:') ? getEvent(db, move) : null;
    const google = move.startsWith('google:') ? db.prepare('SELECT * FROM google_events WHERE id = ? AND deleted_at IS NULL').get(move.slice('google:'.length)) : null;
    if (!own && !google) throw fail(404, 'No such event. Look at the calendar first for the ids.');
    if (google && (JSON.parse(google.organizer || '{}').self !== true)) throw fail(403, 'That meeting is someone else’s: only the organiser moves it.');
    const current = own ?? google;
    Object.assign(plan, { move: true, event_id: move, title: title || current.title, where: google ? 'google' : 'mine', was: { starts_at: current.starts_at, ends_at: current.ends_at, title: current.title } });
  } else {
    if (!title) throw fail(400, 'An event needs a name.');
    if (args.where === 'google') {
      const cal = writableCalendars(db)[0];
      if (!cal) throw fail(409, 'No Google calendar can be written to: “Change your calendar” is off (Settings › Google). Propose it for your own calendar instead.');
      Object.assign(plan, { where: 'google', account_id: cal.account_id, calendar_id: cal.calendar_id, calendar_name: cal.name || cal.email, meet: args.meet === true });
      for (const name of Array.isArray(args.guests) ? args.guests : []) {
        const matches = findPerson(db, String(name));
        if (!matches.length) throw fail(404, `There is nobody called “${name}” in People.`);
        if (matches.length > 1) throw fail(400, `“${name}” could be ${matches.map((m) => m.name).join(' or ')}: use the full name.`);
        const full = db.prepare('SELECT id, name, emails FROM people WHERE id = ?').get(matches[0].id);
        if (!/\S+@\S+/.test(full.emails ?? '')) throw fail(400, `${full.name} has no email address in People yet.`);
        plan.people.push({ id: full.id, name: full.name });
      }
    }
  }
  // What it overlaps: events of those days (not the one being moved), so the card can say so.
  const day = startsAt.slice(0, 10);
  for (const e of eventsOn(db, day)) {
    if (e.id === move || e.all_day) continue;
    if (e.starts_at < endsAt && e.ends_at > startsAt) plan.overlaps.push({ title: e.title, starts_at: e.starts_at, ends_at: e.ends_at });
  }
  return plan;
}

// Approve: the event is made or moved, the way the app makes any.
export function applyProposal(db, plan) {
  if (plan.move) {
    if (plan.event_id.startsWith('google:')) { changeGoogleEvent(db, plan.event_id.slice('google:'.length), { starts_at: plan.starts_at, ends_at: plan.ends_at, ...(plan.title !== plan.was.title ? { title: plan.title } : {}) }); return plan.event_id; }
    updateEvent(db, plan.event_id, { starts_at: plan.starts_at, ends_at: plan.ends_at, ...(plan.title !== plan.was.title ? { title: plan.title } : {}) });
    return plan.event_id;
  }
  if (plan.where === 'google') {
    const made = createGoogleEvent(db, { account_id: plan.account_id, calendar_id: plan.calendar_id, title: plan.title, starts_at: plan.starts_at, ends_at: plan.ends_at, people: plan.people.map((p) => p.id), meet: plan.meet });
    return made.id;
  }
  const event = createEvent(db, { title: plan.title, starts_at: plan.starts_at, ends_at: plan.ends_at, people: plan.people.map((p) => p.id) });
  return event.id;
}

// Undo: what has not gone to Google yet is taken back; what has gone is Google's to delete.
export function undoProposal(db, plan, targetId) {
  if (plan.move) {
    if (plan.event_id.startsWith('google:')) { changeGoogleEvent(db, plan.event_id.slice('google:'.length), { starts_at: plan.was.starts_at, ends_at: plan.was.ends_at, ...(plan.title !== plan.was.title ? { title: plan.was.title } : {}) }); return; }
    updateEvent(db, plan.event_id, { starts_at: plan.was.starts_at, ends_at: plan.was.ends_at, ...(plan.title !== plan.was.title ? { title: plan.was.title } : {}) });
    return;
  }
  if (plan.where === 'google') {
    const id = String(targetId).replace(/^google:/, '');
    const waiting = db.prepare("SELECT id FROM calendar_outbox WHERE google_event_id = ? AND kind = 'insert' AND state = 'waiting' AND deleted_at IS NULL").get(id);
    if (!waiting) throw fail(409, 'It is already in Google Calendar: delete it there.');
    const time = new Date().toISOString();
    db.prepare("UPDATE calendar_outbox SET state = 'dismissed', updated_at = ? WHERE id = ?").run(time, waiting.id);
    db.prepare('UPDATE google_events SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, id);
    return;
  }
  deleteEvent(db, targetId);
}

export const proposalWords = (plan) => {
  const when = `${plan.starts_at.slice(0, 10)} ${plan.starts_at.slice(11)}–${plan.ends_at.slice(11)}`;
  return plan.move ? `Move “${plan.was.title}” to ${when}` : `Add “${plan.title}” ${when}${plan.where === 'google' ? ' in Google Calendar' : ''}${plan.people.length ? ` with ${plan.people.map((p) => p.name).join(', ')}` : ''}`;
};
