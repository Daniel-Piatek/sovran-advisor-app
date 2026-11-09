// Your own events (events.js) and their API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { createEvent, updateEvent, eventsBetween, deleteEvent, restoreEvent, listDeletedEvents, checkEventInput } from '../../events.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('an event has a name, a start and an end; it shows on the days it touches', () => {
  const db = emptyDb();
  const dentist = createEvent(db, { title: ' Dentist ', starts_at: '2026-10-26T12:00', ends_at: '2026-10-26T13:00', note: 'card' });
  createEvent(db, { title: 'Night train', starts_at: '2026-10-27T22:00', ends_at: '2026-10-28T06:30' });
  assert.equal(dentist.title, 'Dentist');
  assert.deepEqual(eventsBetween(db, '2026-10-26', '2026-10-26').map((e) => e.title), ['Dentist']);
  assert.deepEqual(eventsBetween(db, '2026-10-28', '2026-10-28').map((e) => e.title), ['Night train']);
  assert.deepEqual(eventsBetween(db, '2026-10-26', '2026-11-01').map((e) => e.title), ['Dentist', 'Night train']);
  assert.throws(() => createEvent(db, { title: 'Back to front', starts_at: '2026-10-26T13:00', ends_at: '2026-10-26T12:00' }), (err) => err.status === 400);
});

test('moving an event keeps it whole; deleting it can be undone', () => {
  const db = emptyDb();
  const call = createEvent(db, { title: 'Call', starts_at: '2026-10-26T10:00', ends_at: '2026-10-26T10:30' });
  assert.deepEqual([updateEvent(db, call.id, { starts_at: '2026-10-27T11:00', ends_at: '2026-10-27T11:30' }).starts_at], ['2026-10-27T11:00']);
  assert.throws(() => updateEvent(db, call.id, { ends_at: '2026-10-27T10:00' }), (err) => err.status === 400);
  deleteEvent(db, call.id);
  assert.equal(eventsBetween(db, '2026-10-27', '2026-10-27').length, 0);
  assert.deepEqual(listDeletedEvents(db).map((e) => e.title), ['Call']);
  restoreEvent(db, call.id);
  assert.equal(eventsBetween(db, '2026-10-27', '2026-10-27').length, 1);
});

test('what an event may be', () => {
  assert.equal(checkEventInput({ title: 'x', starts_at: '2026-10-26T10:00', ends_at: '2026-10-26T11:00' }, { creating: true }), null);
  for (const bad of [{ title: ' ', starts_at: '2026-10-26T10:00', ends_at: '2026-10-26T11:00' },
    { title: 'x', starts_at: '2026-02-30T10:00', ends_at: '2026-10-26T11:00' }, { title: 'x', starts_at: '2026-10-26T25:00', ends_at: '2026-10-26T11:00' },
    { title: 'x', starts_at: '10am', ends_at: '11am' }]) {
    assert.notEqual(checkEventInput(bad, { creating: true }), null, JSON.stringify(bad));
  }
});

test('the events API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const event = await (await send('POST', '/api/events', { title: 'Standup', starts_at: '2026-10-26T10:00', ends_at: '2026-10-26T10:15' })).json();
  assert.equal((await send('POST', '/api/events', { title: 'x' })).status, 400);
  assert.equal((await fetch(`${app.url}/api/events?from=monday`)).status, 400);
  assert.deepEqual((await (await fetch(`${app.url}/api/events?from=2026-10-26&to=2026-11-01`)).json()).map((e) => e.title), ['Standup']);
  assert.equal((await (await send('PATCH', `/api/events/${event.id}`, { note: 'agenda' })).json()).note, 'agenda');
  assert.equal((await send('DELETE', `/api/events/${event.id}`)).status, 200);
  assert.equal((await send('POST', `/api/events/${event.id}/restore`, {})).status, 200);
});

test('a day is a day when the clocks change', async () => {
  // The page moves events by days; the server keeps the clock time it is given.
  const db = emptyDb();
  const e = createEvent(db, { title: 'Before', starts_at: '2026-10-25T11:00', ends_at: '2026-10-25T12:00' });
  assert.equal(updateEvent(db, e.id, { starts_at: '2026-10-26T11:00', ends_at: '2026-10-26T12:00' }).starts_at, '2026-10-26T11:00');
});
