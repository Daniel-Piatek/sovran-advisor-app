// Your other calendars by iCal link (calendars.js): reading, repeats, exceptions, time
// zones, whole days, problems, and the API. No test reaches the internet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { addCalendar, readCalendar, calendarEventsBetween, listCalendars, removeCalendar, calendarUrl } from '../../calendars.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const pad = (n) => String(n).padStart(2, '0');
const local = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// A work calendar: a weekly standup at 9:00 Berlin time from Mon 5 Oct 2026, skipped on
// 19 Oct, moved to 10:30 on 26 Oct; an all-day offsite; a cancelled meeting.
export const WORK_ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'X-WR-CALNAME:Work',
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:standup@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Standup',
  'DTSTART;TZID=Europe/Berlin:20261005T090000', 'DTEND;TZID=Europe/Berlin:20261005T091500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Berlin:20261019T090000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:standup@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Standup (later)',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261026T090000',
  'DTSTART;TZID=Europe/Berlin:20261026T103000', 'DTEND;TZID=Europe/Berlin:20261026T104500', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:offsite@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Team offsite',
  'DTSTART;VALUE=DATE:20261028', 'DTEND;VALUE=DATE:20261030', 'LOCATION:Hamburg', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:gone@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED',
  'DTSTART:20261027T120000Z', 'DTEND:20261027T130000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const fakeFetch = (body, status = 200) => async () => ({ ok: status < 400, status, text: async () => body });

test('a calendar is read: repeats, a skipped and a moved one, time zones, whole days', async () => {
  const db = emptyDb();
  const work = addCalendar(db, { url: 'webcal://calendar.example/work.ics' });
  assert.equal(work.colour, 2, 'the first colour My events is not using (teal is theirs)');
  const read = await readCalendar(db, work.id, { fetcher: fakeFetch(WORK_ICS) });
  assert.equal(read.name, 'Work', 'its own name comes from the calendar');
  assert.equal(read.problem, '');
  const october = calendarEventsBetween(db, '2026-10-05', '2026-10-31');
  const standups = october.filter((e) => e.title.startsWith('Standup'));
  // Berlin 9:00 in this computer's own time zone (CEST until 25 Oct, then CET).
  assert.deepEqual(standups.map((e) => [e.title, e.starts_at]), [
    ['Standup', local('2026-10-05T07:00:00Z')],
    ['Standup', local('2026-10-12T07:00:00Z')],
    ['Standup (later)', local('2026-10-26T09:30:00Z')],
  ], 'skipped on the 19th, moved on the 26th');
  const offsite = october.find((e) => e.title === 'Team offsite');
  assert.deepEqual([offsite.all_day, offsite.starts_at, offsite.ends_at, offsite.location], [true, '2026-10-28T00:00', '2026-10-30T00:00', 'Hamburg']);
  assert.equal(october.some((e) => e.title === 'Cancelled thing'), false);
  assert.ok(october.every((e) => e.read_only && e.calendar.name === 'Work' && e.calendar.colour === 2));
  assert.deepEqual(calendarEventsBetween(db, '2026-10-19', '2026-10-19').map((e) => e.title), []);
});

test('a problem keeps the last good copy, in plain words, without the link', async () => {
  const db = emptyDb();
  const cal = addCalendar(db, { url: 'https://calendar.example/secret-key-123.ics', name: 'Family' });
  await readCalendar(db, cal.id, { fetcher: fakeFetch(WORK_ICS) });
  const failed = await readCalendar(db, cal.id, { fetcher: fakeFetch('', 404) });
  assert.equal(failed.problem, 'The link no longer works (not found).');
  assert.ok(calendarEventsBetween(db, '2026-10-05', '2026-10-05').length > 0, 'still shows');
  const notACalendar = await readCalendar(db, cal.id, { fetcher: fakeFetch('<html>Sign in</html>') });
  assert.match(notACalendar.problem, /not a calendar/);
  assert.equal(JSON.stringify(listCalendars(db)).includes('secret-key-123'), false, 'the link is never handed out');
  assert.equal(failed.name, 'Family', 'a name you gave stays');
});

test('calendar links: https, http and webcal; nothing else', () => {
  assert.equal(calendarUrl('webcal://p01.example.com/a.ics'), 'https://p01.example.com/a.ics');
  assert.equal(calendarUrl(' https://x.example/b.ics '), 'https://x.example/b.ics');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a link', '']) assert.equal(calendarUrl(bad), null, bad);
});

test('the calendars API reads a link at once; removing can be undone', async (t) => {
  const ics = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(WORK_ICS); });
  await new Promise((resolve) => ics.listen(0, '127.0.0.1', resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendars-test-'));
  const app = await startServer({ port: 0, dataDir, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); ics.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await send('POST', '/api/calendars', { url: 'file:///etc/hosts' })).status, 400);
  const work = await (await send('POST', '/api/calendars', { url: `http://127.0.0.1:${ics.address().port}/work.ics` })).json();
  assert.deepEqual([work.name, work.problem, Boolean(work.fetched_at), 'url' in work], ['Work', '', true, false]);
  const events = await (await fetch(`${app.url}/api/events?from=2026-10-05&to=2026-10-05`)).json();
  assert.deepEqual(events.map((e) => [e.title, e.read_only]), [['Standup', true]]);
  assert.equal((await send('PATCH', `/api/calendars/${work.id}`, { colour: 9 })).status, 400);
  assert.equal((await (await send('PATCH', `/api/calendars/${work.id}`, { colour: 3 })).json()).colour, 3);
  assert.equal((await send('DELETE', `/api/calendars/${work.id}`)).status, 200);
  assert.deepEqual(await (await fetch(`${app.url}/api/events?from=2026-10-05&to=2026-10-05`)).json(), []);
  assert.equal((await send('POST', `/api/calendars/${work.id}/restore`, {})).status, 200);
});

// ---- Notes about an event ----

import { createEvent } from '../../events.js';
import { noteAboutEvent, withNotes, eventAt } from '../../event-notes.js';
import { linkedFrom, linkTarget } from '../../links.js';

test('a note about your own event links to it; a second click opens the same note', () => {
  const db = emptyDb();
  const dentist = createEvent(db, { title: 'Dentist [new]', starts_at: '2026-10-26T12:00', ends_at: '2026-10-26T13:00' });
  const { note, existing } = noteAboutEvent(db, dentist.id);
  assert.equal(existing, false);
  assert.match(note.title, /^Dentist \[new\] · /);
  assert.match(note.body, new RegExp(`^About \\[Dentist \\\\\\[new\\\\\\] · .+\\]\\(/calendar/events/${dentist.id}\\)`));
  assert.deepEqual(linkedFrom(db, 'event', dentist.id).map((l) => l.from_id), [note.id]);
  assert.equal(linkTarget(db, 'event', dentist.id).title, 'Dentist [new]');
  assert.equal(noteAboutEvent(db, dentist.id).note.id, note.id);
  assert.equal(withNotes(db, [{ ...dentist, calendar: null }])[0].note_id, note.id);
});

test('a note about another calendar’s meeting gets a row to link to, kept when the calendar is read again', async () => {
  const db = emptyDb();
  const work = addCalendar(db, { url: 'https://calendar.example/work.ics' });
  await readCalendar(db, work.id, { fetcher: fakeFetch(WORK_ICS) });
  const [standup] = calendarEventsBetween(db, '2026-10-12', '2026-10-12');
  const { note } = noteAboutEvent(db, standup.id);
  const [linked] = withNotes(db, calendarEventsBetween(db, '2026-10-12', '2026-10-12'));
  assert.equal(linked.note_id, note.id);
  assert.equal(eventAt(db, linked.ref_id).starts_at, standup.starts_at);
  await readCalendar(db, work.id, { fetcher: fakeFetch(WORK_ICS) });
  assert.equal(withNotes(db, calendarEventsBetween(db, '2026-10-12', '2026-10-12'))[0].note_id, note.id, 'still there after reading again');
  assert.equal(withNotes(db, calendarEventsBetween(db, '2026-10-05', '2026-10-05'))[0].note_id, null, 'another week has no note yet');
  assert.throws(() => noteAboutEvent(db, 'cal:nope'), (err) => err.status === 404);
});

test('My events have a colour, teal unless changed; a new calendar takes one My events is not using', async () => {
  const { ownColour, setOwnColour } = await import('../../calendars.js');
  const db = emptyDb();
  assert.equal(ownColour(db), 1);
  assert.equal(setOwnColour(db, 4).colour, 4);
  assert.throws(() => setOwnColour(db, 7), (err) => err.status === 400);
  assert.equal(addCalendar(db, { url: 'https://calendar.example/a.ics' }).colour, 1);
  assert.equal(addCalendar(db, { url: 'https://calendar.example/b.ics' }).colour, 2);
  assert.equal(addCalendar(db, { url: 'https://calendar.example/c.ics' }).colour, 3);
  assert.equal(addCalendar(db, { url: 'https://calendar.example/d.ics' }).colour, 5, 'four is My events’');
});

test('with Calendar links off its events, its pane and its job are gone, and its rows stay', async () => {
  const { setModule } = await import('../../modules.js');
  const { calendarJob, readAllCalendars } = await import('../../calendars.js');
  const db = emptyDb();
  const added = addCalendar(db, { url: 'https://example.test/work.ics', name: 'Work' });
  await readCalendar(db, added.id, { fetcher: fakeFetch(WORK_ICS) });
  assert.ok(calendarEventsBetween(db, '2026-10-26', '2026-10-26').length > 0);
  assert.equal(calendarJob(db, 600_000).on, true);
  assert.equal(calendarJob(db, 600_000).every_minutes, 10);
  assert.ok(calendarJob(db, 600_000).last_run);

  setModule(db, 'calendar-links', false);
  assert.deepEqual(calendarEventsBetween(db, '2026-10-26', '2026-10-26'), []);
  assert.equal(calendarJob(db, 600_000).on, false);
  const before = db.prepare('SELECT fetched_at FROM calendars WHERE id = ?').get(added.id).fetched_at;
  await readAllCalendars(db, { fetcher: async () => { throw new Error('the job must not read'); } });
  assert.equal(db.prepare('SELECT fetched_at FROM calendars WHERE id = ?').get(added.id).fetched_at, before);
  assert.equal(listCalendars(db).length, 1); // the row stays

  setModule(db, 'calendar-links', true);
  assert.ok(calendarEventsBetween(db, '2026-10-26', '2026-10-26').length > 0);
});
