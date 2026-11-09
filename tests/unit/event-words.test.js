// An event from a sentence (public/event-words.js): the same words always give the same event.
// 2026-11-09 is a Monday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEvent } from '../../public/event-words.js';

const today = '2026-11-09';
const names = [{ id: 'lena', name: 'Lena Fischer' }, { id: 'jonas', name: 'Jonas Weber' }, { id: 'mara1', name: 'Mara Klein' }, { id: 'mara2', name: 'Mara Voss' }];
const read = (text) => readEvent(text, { today, names });

// [sentence, title, day, start, minutes]
const TABLE = [
  ['lunch with Lena thu 12:30 1h', 'lunch with Lena', '2026-11-12', '12:30', 60],
  ['lunch with Lena at the lake thu 12:30 1h', 'lunch with Lena at the lake', '2026-11-12', '12:30', 60],
  ['Dentist tomorrow 3pm', 'Dentist', '2026-11-10', '15:00', 60],
  ['Dentist tmr 3pm 45m', 'Dentist', '2026-11-10', '15:00', 45],
  ['Standup today 9:15 15m', 'Standup', '2026-11-09', '09:15', 15],
  ['Workshop dry run friday 14:00 90 min', 'Workshop dry run', '2026-11-13', '14:00', 90],
  ['Workshop dry run fri 2pm 1.5h', 'Workshop dry run', '2026-11-13', '14:00', 90],
  ['Call 10:00 1h30', 'Call', '2026-11-09', '10:00', 90],
  ['Call 10:00 1h30m', 'Call', '2026-11-09', '10:00', 90],
  ['Call at 14', 'Call', '2026-11-09', '14:00', 60],
  ['Call at 2', 'Call', '2026-11-09', '14:00', 60],
  ['Call at 9', 'Call', '2026-11-09', '09:00', 60],
  ['Call at 9 tomorrow', 'Call', '2026-11-10', '09:00', 60],
  ['Venue 2pm-3:30pm wed', 'Venue', '2026-11-11', '14:00', 90],
  ['Venue wed 9-10', 'Venue', '2026-11-11', '09:00', 60],
  ['Venue wed 9:00-10:30', 'Venue', '2026-11-11', '09:00', 90],
  ['Venue wed 2-3pm', 'Venue', '2026-11-11', '14:00', 60],
  ['Venue wed 9 to 11', 'Venue', '2026-11-11', '09:00', 120],
  ['Venue wed from 9-10', 'Venue', '2026-11-11', '09:00', 60],
  ['Review monday 11am', 'Review', '2026-11-09', '11:00', 60],
  ['Review next monday 11am', 'Review', '2026-11-16', '11:00', 60],
  ['Review this friday 11am', 'Review', '2026-11-13', '11:00', 60],
  ['Review on sunday 11:30', 'Review', '2026-11-15', '11:30', 60],
  ['Review 2026-12-01 10:00', 'Review', '2026-12-01', '10:00', 60],
  ['Review nov 20 10:00', 'Review', '2026-11-20', '10:00', 60],
  ['Review 20 nov 10:00', 'Review', '2026-11-20', '10:00', 60],
  ['Review nov 3rd 10:00', 'Review', '2027-11-03', '10:00', 60],
  ['Review jan 5 10:00', 'Review', '2027-01-05', '10:00', 60],
  ['Review in 3 days 10:00', 'Review', '2026-11-12', '10:00', 60],
  ['Review in 2 weeks 10:00', 'Review', '2026-11-23', '10:00', 60],
  ['Review half an hour', 'Review', '2026-11-09', '09:00', 30],
  ['Review an hour', 'Review', '2026-11-09', '09:00', 60],
  ['Review for 2 hours thu', 'Review', '2026-11-12', '09:00', 120],
  ['Review 2h', 'Review', '2026-11-09', '09:00', 120],
  ['Review 45m tue 4pm', 'Review', '2026-11-10', '16:00', 45],
  ['Call 12am', 'Call', '2026-11-09', '00:00', 60],
  ['Call 12pm', 'Call', '2026-11-09', '12:00', 60],
  ['Call 12:30pm', 'Call', '2026-11-09', '12:30', 60],
  ['Call 11:45am', 'Call', '2026-11-09', '11:45', 60],
  ['Call 23:30', 'Call', '2026-11-09', '23:30', 60],
  ['Lunch', 'Lunch', '2026-11-09', '09:00', 60],
  ['at the lake thu', 'at the lake', '2026-11-12', '09:00', 60],
  ['Meet at the station 8:15', 'Meet at the station', '2026-11-09', '08:15', 60],
  ['Take 2 tablets tomorrow 8pm', 'Take 2 tablets', '2026-11-10', '20:00', 60],
  ['Pick up 3 chairs sat 10:00', 'Pick up 3 chairs', '2026-11-14', '10:00', 60],
  ['may the fourth be with you', 'may the fourth be with you', '2026-11-09', '09:00', 60],
  ['Tuesday', '', '2026-11-10', '09:00', 60],
  ['', '', '2026-11-09', '09:00', 60],
  ['Lunch with Lena Thu, 12:30, 1h', 'Lunch with Lena', '2026-11-12', '12:30', 60],
  ['Coffee thu 25:00', 'Coffee 25:00', '2026-11-12', '09:00', 60],
];

for (const [sentence, title, day, start, minutes] of TABLE) {
  test(`“${sentence}”`, () => {
    const got = read(sentence);
    assert.deepEqual([got.title, got.day, got.start, got.minutes], [title, day, start, minutes]);
  });
}

test('what it found is said: a day, a time and a length are marked, the rest are guesses', () => {
  assert.deepEqual(read('lunch thu 12:30 1h').found, { day: true, time: true, length: true });
  assert.deepEqual(read('lunch').found, { day: false, time: false, length: false });
  assert.deepEqual(read('lunch 9-10').found, { day: false, time: true, length: true });
});

test('stamps: the event starts and ends on the day it says, and past midnight on the next day', () => {
  const got = read('Party fri 23:00 2h');
  assert.deepEqual([got.starts_at, got.ends_at], ['2026-11-13T23:00', '2026-11-14T01:00']);
  assert.equal(got.end, '01:00');
});

test('the people it knows by name are found and stay in the title; a first name two people share is not guessed', () => {
  assert.deepEqual(read('lunch with Lena thu 12:30').people, [{ id: 'lena', name: 'Lena Fischer' }]);
  assert.deepEqual(read('lunch with lena fischer').people, [{ id: 'lena', name: 'Lena Fischer' }]);
  assert.deepEqual(read('call Lena and Jonas').people.map((p) => p.id), ['lena', 'jonas']);
  assert.deepEqual(read('coffee with Mara').people, []);
  assert.deepEqual(read('coffee with Mara Voss').people, [{ id: 'mara2', name: 'Mara Voss' }]);
  assert.deepEqual(read('lunch with Helena').people, []);
  assert.equal(read('lunch with Lena thu').title, 'lunch with Lena');
});

test('no clock and no network: the same words give the same event twice, and nothing in it is a Date.now', () => {
  assert.deepEqual(read('lunch with Lena thu 12:30 1h'), read('lunch with Lena thu 12:30 1h'));
  assert.deepEqual(readEvent('Review monday 11am', { today: '2026-11-16', names }).day, '2026-11-16');
});

test('words that are only a table key are not a day or a month (constructor, toString)', () => {
  assert.equal(read('constructor toString').title, 'constructor toString');
  assert.equal(read('constructor toString').found.day, false);
});

// ---- Events with people (links from an own event; schema 60) ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createEvent, deleteEvent, restoreEvent, checkEventInput } from '../../events.js';
import { createPerson } from '../../people.js';
import { linkedFrom } from '../../links.js';

test('an event made with people is listed on their pages as an event; a deleted one is not, and comes back with Restore', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const event = createEvent(db, { title: 'lunch with Lena at the lake', starts_at: '2026-11-12T12:30', ends_at: '2026-11-12T13:30', people: [lena.id, lena.id, 'not-a-person'] });
  const rows = linkedFrom(db, 'person', lena.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].from_kind, rows[0].from_id, rows[0].label, rows[0].starts_at], ['event', event.id, 'lunch with Lena at the lake', '2026-11-12T12:30']);
  deleteEvent(db, event.id);
  assert.equal(linkedFrom(db, 'person', lena.id).length, 0);
  restoreEvent(db, event.id);
  assert.equal(linkedFrom(db, 'person', lena.id).length, 1);
  assert.equal(checkEventInput({ title: 'x', starts_at: '2026-11-12T12:30', ends_at: '2026-11-12T13:30', people: 'lena' }, { creating: true }), 'people is a list of ids.');
});

test('schema 60 moves an older database: links may come from an event, every link is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-old-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const note = db.prepare("SELECT 1").get() && null;
  db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'x', 'x', 'A note', '')").run();
  db.prepare("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id, link_text, context) VALUES ('l1', 'x', 'x', 'note', 'n1', 'person', ?, 'Lena', 'Lena is here')").run(lena.id);
  // Back to how links were before: no 'event' among where a link can come from.
  const old = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'links'").get().sql.replace("'interaction', 'event')", "'interaction')");
  assert.ok(!old.includes("'interaction', 'event')"));
  db.exec('DROP INDEX IF EXISTS links_to; DROP INDEX IF EXISTS links_from; ALTER TABLE links RENAME TO links_now;');
  db.exec(old);
  db.exec('INSERT INTO links SELECT * FROM links_now; DROP TABLE links_now; PRAGMA user_version = 59;');
  assert.throws(() => db.prepare("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id) VALUES ('l2', 'x', 'x', 'event', 'e', 'person', 'p')").run());
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(linkedFrom(db, 'person', lena.id)[0].from_id, 'n1', 'the old link is kept');
  const event = createEvent(db, { title: 'Lunch with Lena', starts_at: '2026-11-12T12:30', ends_at: '2026-11-12T13:30', people: [lena.id] });
  assert.deepEqual(linkedFrom(db, 'person', lena.id).map((r) => r.from_kind).sort(), ['event', 'note']);
  assert.ok(event.id);
  db.close();
});
