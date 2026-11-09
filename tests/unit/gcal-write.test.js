// Changing Google events, safely (gcal-write.js, Calendar in depth 8): the switch, three guards, an outbox with etags, a clash kept for you.
// Stand-ins for Google's sign-in and for Google Calendar; the calendars are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../../server.js';
import { openDatabase, SCHEMA_VERSION } from '../../db.js';
import { fileKeyStore } from '../../google.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';
import { startFakeGcal } from '../fake-gcal.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

async function setup(t, { change = true } = {}) {
  const dataDir = tmp('gw-data-');
  const storeDir = tmp('gw-store-');
  const google = await startFakeGoogle();
  const gcal = await startFakeGcal();
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, google: { env: { ...google.env, ...gcal.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gcal.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  await json('PATCH', '/api/modules', { id: 'calendar-google', on: true }); // off in a new install
  const signIn = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await signIn((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  const switchOn = async (permission) => signIn((await json('PATCH', `/api/google/accounts/${account.id}`, { permission, on: true })).body);
  await switchOn('calendar.read');
  gcal.add({ id: 'kickoff', summary: 'Kick-off Nordlicht', start: `${day(3)}T10:00`, end: `${day(3)}T11:00`, location: 'Studio' });
  gcal.add({ id: 'theirs', summary: 'Their meeting', start: `${day(3)}T14:00`, end: `${day(3)}T15:00`, organizer: { email: 'jonas@hafenkante.example', displayName: 'Jonas Weber' },
    attendees: [{ email: 'work@mypractice.com', self: true, responseStatus: 'accepted' }] });
  const read = () => json('POST', '/api/gcal/read', { account_id: account.id });
  if (change) await switchOn('calendar.modify');
  await read();
  const events = async () => (await json('GET', `/api/events?from=${day(0)}&to=${day(10)}`)).body;
  const find = async (title) => (await events()).find((e) => e.title === title);
  const send = () => json('POST', '/api/gcal/outbox/send', {});
  const patch = (e, changes) => json('PATCH', `/api/gevents/${e.id.slice('google:'.length)}`, changes);
  return { app, dataDir, google, gcal, json, account, switchOn, read, events, find, send, patch };
}

test('“Change your calendar” asks Google for that one permission; until it is on, a Google event is read only and nothing is sent', async (t) => {
  const { google, gcal, json, find, patch, switchOn, send } = await setup(t, { change: false });
  const kickoff = await find('Kick-off Nordlicht');
  assert.equal(kickoff.read_only, true);
  const refused = await patch(kickoff, { title: 'x' });
  assert.deepEqual([refused.status, /Switch on “Change your calendar”/.test(refused.body.error)], [409, true]);
  await switchOn('calendar.modify');
  const asked = google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope).at(-1);
  assert.ok(asked.includes(SCOPES.calendarModify) && !asked.includes(SCOPES.read), 'only that permission was asked for');
  assert.equal((await find('Kick-off Nordlicht')).read_only, false);
  assert.equal((await find('Their meeting')).read_only, true, 'someone else’s meeting stays read only');
  await send();
  assert.equal(gcal.patches.length, 0, 'nothing went to Google');
  assert.ok(json);
});

test('a change shows at once, waits with the etag it was made on, and goes to Google with If-Match; Google’s new version is kept', async (t) => {
  const { gcal, json, find, patch, send, events } = await setup(t);
  const kickoff = await find('Kick-off Nordlicht');
  const etag = kickoff.google.etag;
  const moved = await patch(kickoff, { starts_at: `${day(3)}T11:00`, ends_at: `${day(3)}T12:00` });
  assert.deepEqual([moved.status, moved.body.starts_at, moved.body.google.sync], [200, `${day(3)}T11:00`, 'waiting']);
  assert.equal((await find('Kick-off Nordlicht')).starts_at, `${day(3)}T11:00`, 'shown at once');
  const [waiting] = (await json('GET', '/api/gcal/outbox')).body;
  assert.deepEqual([waiting.state, waiting.etag, waiting.event], ['waiting', etag, 'Kick-off Nordlicht']);
  assert.equal(gcal.patches.length, 0, 'not sent yet');

  assert.deepEqual(await send().then((r) => r.body), { sent: 1, clash: 0, failed: 0, retry: 0 });
  assert.equal(gcal.patches.length, 1);
  assert.equal(gcal.patches[0].ifMatch, etag);
  assert.deepEqual(Object.keys(gcal.patches[0].body).sort(), ['end', 'start']);
  const after = await find('Kick-off Nordlicht');
  assert.deepEqual([after.google.sync, after.google.etag === etag], ['', false], 'Google’s new version is the one kept');
  assert.equal((await json('GET', '/api/gcal/outbox')).body[0].state, 'sent');
  assert.equal((await send().then((r) => r.body)).sent, 0, 'never sent twice');
  assert.ok(events);
});

test('changes to one event that has not gone yet become one request, on the version the first was made on', async (t) => {
  const { gcal, json, find, patch, send } = await setup(t);
  const kickoff = await find('Kick-off Nordlicht');
  await patch(kickoff, { title: 'Kick-off Nordlicht (new)' });
  await patch(kickoff, { location: 'Online' });
  await patch(kickoff, { note: 'Bring the plan' });
  assert.equal((await json('GET', '/api/gcal/outbox')).body.length, 1);
  await send();
  assert.equal(gcal.patches.length, 1);
  assert.equal(gcal.patches[0].ifMatch, kickoff.google.etag);
  assert.deepEqual(gcal.patches[0].body, { summary: 'Kick-off Nordlicht (new)', location: 'Online', description: 'Bring the plan' });
});

test('three guards: not your meeting, a field switched off, and an event that cannot change its day', async (t) => {
  const { gcal, json, find, patch, send, read } = await setup(t);
  gcal.add({ id: 'offsite', summary: 'Offsite', start: day(5), end: day(6) });
  await read();
  const theirs = await find('Their meeting');
  assert.deepEqual([(await patch(theirs, { title: 'x' })).status, (await patch(theirs, { title: 'x' })).body.error], [403, 'Only the organiser changes this meeting. You can answer it.']);
  // Guard 2: the fields. Place is switched off.
  const guards = (await json('PATCH', '/api/gcal/guards', { fields: ['title', 'day', 'start', 'length', 'description'] })).body;
  assert.equal(guards.fields.find((f) => f.id === 'location').on, false);
  assert.equal(guards.rules.length, 3);
  const kickoff = await find('Kick-off Nordlicht');
  const place = await patch(kickoff, { location: 'Elsewhere' });
  assert.deepEqual([place.status, place.body.error], [403, '“Place” is switched off for changes (Settings › Google Calendar).']);
  assert.equal((await find('Kick-off Nordlicht')).location, 'Studio', 'nothing changed');
  assert.equal((await patch(kickoff, { title: 'Allowed' })).status, 200);
  // Nothing that is not a change is a change.
  assert.equal((await json('GET', '/api/gcal/outbox')).body.length, 1);
  await patch(await find('Allowed'), { title: 'Allowed' });
  assert.equal((await json('GET', '/api/gcal/outbox')).body.length, 1);
  // A whole-day event changes in Google itself, and an end before the start is refused.
  const offsite = await find('Offsite');
  assert.equal(offsite.read_only, false);
  assert.equal((await patch(offsite, { starts_at: `${day(5)}T10:00`, ends_at: `${day(5)}T11:00` })).status, 400);
  assert.equal((await patch(await find('Allowed'), { starts_at: `${day(3)}T12:00`, ends_at: `${day(3)}T11:00` })).status, 400);
  await send();
  assert.ok(gcal.patches.every((p) => !('location' in p.body)));
});

test('a clash: Google changed the meeting too, so Google’s version is kept, the change waits with “Use mine” and “Keep Google’s”', async (t) => {
  const { gcal, json, find, patch, send, read } = await setup(t);
  const kickoff = await find('Kick-off Nordlicht');
  // Someone changes it in Google; before this app has read Google again, you change it here.
  gcal.change('primary', 'kickoff', { start: { dateTime: new Date(`${day(3)}T15:00`).toISOString() }, end: { dateTime: new Date(`${day(3)}T16:00`).toISOString() } });
  await patch(kickoff, { starts_at: `${day(3)}T11:00`, ends_at: `${day(3)}T12:00` });
  assert.deepEqual(await send().then((r) => r.body), { sent: 0, clash: 1, failed: 0, retry: 0 });
  // Google's time is kept here; nothing was overwritten.
  const kept = await find('Kick-off Nordlicht');
  assert.deepEqual([kept.starts_at, kept.google.sync], [`${day(3)}T15:00`, 'clash']);
  const [clash] = (await json('GET', '/api/gcal/outbox')).body;
  assert.equal(clash.state, 'clash');
  assert.equal(clash.patch.starts_at, `${day(3)}T11:00`, 'mine is kept');
  assert.equal(clash.theirs.starts_at, `${day(3)}T15:00`, 'and Google’s side beside it');
  assert.equal(gcal.events.get('primary').find((e) => e.id === 'kickoff').start.dateTime, new Date(`${day(3)}T15:00`).toISOString(), 'Google still has its own');

  // Use mine: it goes again, on Google's newer version.
  await json('POST', `/api/gcal/outbox/${clash.id}/resolve`, { use: 'mine' });
  assert.equal((await find('Kick-off Nordlicht')).starts_at, `${day(3)}T11:00`);
  assert.deepEqual(await send().then((r) => r.body), { sent: 1, clash: 0, failed: 0, retry: 0 });
  assert.equal(gcal.events.get('primary').find((e) => e.id === 'kickoff').start.dateTime, new Date(`${day(3)}T11:00`).toISOString());
  assert.ok(read);
});

test('Keep Google’s lets the change go and nothing is sent; a read that finds Google changed while a change waits makes the clash by itself', async (t) => {
  const { gcal, json, find, patch, send, read } = await setup(t);
  const kickoff = await find('Kick-off Nordlicht');
  await patch(kickoff, { starts_at: `${day(3)}T11:00`, ends_at: `${day(3)}T12:00` });
  // Google changes it, then the app reads Google before the change went: the clash is found by the read.
  gcal.change('primary', 'kickoff', { summary: 'Kick-off (renamed in Google)' });
  await read();
  const [clash] = (await json('GET', '/api/gcal/outbox')).body;
  assert.equal(clash.state, 'clash');
  assert.equal((await find('Kick-off (renamed in Google)')).starts_at, `${day(3)}T10:00`, 'Google’s version is kept');
  await json('POST', `/api/gcal/outbox/${clash.id}/resolve`, { use: 'google' });
  assert.equal((await json('GET', '/api/gcal/outbox')).body.length, 0);
  await send();
  assert.equal(gcal.patches.length, 0);
});

test('Google being busy is waited out with a growing wait and tried again; after five tries it says “Not saved to Google yet” and keeps the change', async (t) => {
  const { gcal, json, find, patch, send, dataDir } = await setup(t);
  const kickoff = await find('Kick-off Nordlicht');
  await patch(kickoff, { title: 'Renamed' });
  const waits = () => {
    const db = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
    const row = db.prepare('SELECT tries, next_try_at, state FROM calendar_outbox').get();
    db.close();
    return row;
  };
  gcal.busy = 2;
  assert.deepEqual(await send().then((r) => r.body), { sent: 0, clash: 0, failed: 0, retry: 1 });
  const first = waits();
  assert.deepEqual([first.state, first.tries], ['waiting', 1]);
  const wait1 = new Date(first.next_try_at) - Date.now();
  assert.ok(wait1 > 500 && wait1 <= 2100, 'about two seconds');
  assert.deepEqual(await send().then((r) => r.body), { sent: 0, clash: 0, failed: 0, retry: 1 });
  const wait2 = new Date(waits().next_try_at) - Date.now();
  assert.ok(wait2 > wait1 + 1000, 'a longer wait each time');
  assert.deepEqual(await send().then((r) => r.body), { sent: 1, clash: 0, failed: 0, retry: 0 });
  assert.equal((await find('Renamed')).google.sync, '');

  // Google stays busy: five tries, then it is said in words and the change stays.
  await patch(await find('Renamed'), { title: 'Renamed again' });
  gcal.busy = 99;
  for (let i = 0; i < 4; i += 1) assert.equal((await send().then((r) => r.body)).retry, 1);
  assert.deepEqual(await send().then((r) => r.body), { sent: 0, clash: 0, failed: 1, retry: 0 });
  const failed = (await json('GET', '/api/gcal/outbox')).body.find((o) => o.state === 'failed');
  assert.deepEqual([failed.problem, failed.patch.title], ['Not saved to Google yet.', 'Renamed again']);
  assert.equal((await find('Renamed again')).google.sync, 'failed', 'it still shows here, marked');
});

test('schema 63 moves an older database: the outbox is new, every Google event is kept', async () => {
  const dir = tmp('gw-old-');
  let db = openDatabase(dir);
  db.prepare("INSERT INTO google_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', 'work@mypractice.com')").run();
  db.prepare("INSERT INTO google_events (id, created_at, updated_at, account_id, calendar_id, event_id, title, starts_at, ends_at) VALUES ('e1', 'x', 'x', 'a1', 'primary', 'g1', 'Kept', '2026-11-12T10:00', '2026-11-12T11:00')").run();
  db.exec('DROP TABLE calendar_outbox; PRAGMA user_version = 62;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT title FROM google_events').get().title, 'Kept');
  assert.equal(db.prepare('SELECT count(*) AS n FROM calendar_outbox').get().n, 0);
  db.close();
});
