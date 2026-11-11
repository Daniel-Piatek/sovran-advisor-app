// Google Calendar (gcal.js, Calendar in depth 7): read, keep by Google's ids, show with a G, switch off. Stand-ins for Google's
// sign-in and for Google Calendar's API; the calendars are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';
import { openDatabase, SCHEMA_VERSION } from '../../db.js';
import { fileKeyStore } from '../../google.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';
import { startFakeGcal } from '../fake-gcal.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

async function setup(t, { pageSize = 5 } = {}) {
  const dataDir = tmp('gcal-data-');
  const storeDir = tmp('gcal-store-');
  const google = await startFakeGoogle();
  const gcal = await startFakeGcal({ pageSize });
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, googleCalendarEvery: 0, google: { env: { ...google.env, ...gcal.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gcal.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  await json('PATCH', '/api/modules', { id: 'calendar-google', on: true }); // off in a new install
  const signIn = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await signIn((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  const switchOn = async (permission) => signIn((await json('PATCH', `/api/google/accounts/${account.id}`, { permission, on: true })).body);
  const read = () => json('POST', '/api/gcal/read', { account_id: account.id });
  const events = async (from = day(-30), to = day(120)) => (await json('GET', `/api/events?from=${from}&to=${to}`)).body;
  return { app, dataDir, google, gcal, json, account, switchOn, read, events };
}

test('“Read your calendar” asks Google for that one permission; with it on, a read keeps the events by Google’s ids, read only, with their guests and Meet link', async (t) => {
  const { google, gcal, json, account, switchOn, read, events } = await setup(t);
  gcal.add({ id: 'kickoff', summary: 'Kick-off Nordlicht', start: `${day(3)}T10:00`, end: `${day(3)}T11:00`, location: 'Nordlicht Studio', meet: 'https://meet.example/abc-defg-hij',
    attendees: [{ email: 'jonas@hafenkante.example', displayName: 'Jonas Weber', responseStatus: 'accepted' }, { email: 'work@mypractice.com', self: true, responseStatus: 'needsAction' }] });
  gcal.add({ id: 'offsite', summary: 'Offsite', start: day(5), end: day(7) });

  // Switched off: nothing is read, nothing is shown, and the app says why.
  assert.equal((await read()).status, 409);
  assert.deepEqual(await events(), []);

  await switchOn('calendar.read');
  const asked = google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope);
  assert.ok(asked.at(-1).includes(SCOPES.calendarRead), 'Google was asked for the calendar permission');
  assert.ok(!asked.at(-1).includes(SCOPES.calendarModify), 'and not for changing it');
  assert.deepEqual((await json('GET', '/api/google')).body.accounts[0].permissions.filter((p) => p.on).map((p) => p.id), ['calendar.read']);

  const first = await read();
  assert.deepEqual([first.status, first.body.calendars, first.body.added], [200, 1, 2]);
  const shown = await events();
  const kickoff = shown.find((e) => e.title === 'Kick-off Nordlicht');
  assert.deepEqual([kickoff.read_only, kickoff.source, kickoff.starts_at, kickoff.ends_at, kickoff.location], [true, 'google', `${day(3)}T10:00`, `${day(3)}T11:00`, 'Nordlicht Studio']);
  assert.equal(kickoff.google.meet_url, 'https://meet.example/abc-defg-hij');
  assert.deepEqual(kickoff.google.attendees.map((a) => [a.name, a.response]), [['Jonas Weber', 'accepted'], ['', 'needsAction']]);
  assert.equal(kickoff.google.my_response, 'needsAction');
  assert.equal(shown.find((e) => e.title === 'Offsite').all_day, true);

  // A second read changes nothing.
  const second = (await read()).body;
  assert.deepEqual([second.added, second.changed, second.removed], [0, 0, 0]);
  assert.equal((await events()).length, shown.length);
  // Read only: it cannot be changed here.
  assert.notEqual((await json('PATCH', `/api/events/${kickoff.id}`, { title: 'x' })).status, 200);
  assert.ok(account.id);
});

test('what changes in Google changes here, what is gone from Google is marked deleted and not removed, and a long list is read in pages', async (t) => {
  const { gcal, switchOn, read, events, dataDir } = await setup(t, { pageSize: 5 });
  await switchOn('calendar.read');
  for (let i = 0; i < 12; i += 1) gcal.add({ id: `e${i}`, summary: `Meeting ${i}`, start: `${day(1 + i)}T09:00`, end: `${day(1 + i)}T10:00` });
  assert.equal((await read()).body.added, 12, 'three pages');
  assert.equal(gcal.seen.filter((c) => /events$/.test(c.path)).length >= 3, true);

  gcal.change('primary', 'e0', { summary: 'Meeting zero, moved', start: { dateTime: new Date(`${day(2)}T11:00`).toISOString() }, end: { dateTime: new Date(`${day(2)}T12:00`).toISOString() } });
  gcal.remove('primary', 'e1');
  gcal.cancel('primary', 'e2');
  const result = (await read()).body;
  assert.deepEqual([result.added, result.changed, result.removed], [0, 1, 2]);
  const shown = await events();
  assert.ok(shown.find((e) => e.title === 'Meeting zero, moved' && e.starts_at === `${day(2)}T11:00`));
  assert.ok(!shown.find((e) => e.title === 'Meeting 1' || e.title === 'Meeting 2'));
  // Never really removed.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM google_events').get().n, 12);
  assert.equal(db.prepare('SELECT count(*) AS n FROM google_events WHERE deleted_at IS NOT NULL').get().n, 2);
  db.close();
  // Back in Google, it is back here.
  gcal.add({ id: 'e1', summary: 'Meeting 1', start: `${day(2)}T09:00`, end: `${day(2)}T10:00` });
  assert.equal((await read()).body.changed, 1);
  assert.ok((await events()).find((e) => e.title === 'Meeting 1'));
});

test('switching the permission off takes Google’s events away and your own stay; on again brings them back; no token is kept on disk', async (t) => {
  const { gcal, google, json, account, switchOn, read, events, dataDir } = await setup(t);
  await switchOn('calendar.read');
  gcal.add({ id: 'g1', summary: 'In Google', start: `${day(1)}T10:00`, end: `${day(1)}T11:00` });
  await json('POST', '/api/events', { title: 'Mine', starts_at: `${day(1)}T14:00`, ends_at: `${day(1)}T15:00` });
  await read();
  assert.deepEqual((await events()).map((e) => e.title).sort(), ['In Google', 'Mine']);

  await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'calendar.read', on: false });
  assert.deepEqual((await events()).map((e) => e.title), ['Mine']);
  assert.equal((await read()).status, 409);
  await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'calendar.read', on: true });
  assert.deepEqual((await events()).map((e) => e.title).sort(), ['In Google', 'Mine']);

  // The tokens are in neither the folder nor its database.
  const files = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) (f.isDirectory() ? walk(path.join(dir, f.name)) : files.push(path.join(dir, f.name))); };
  walk(dataDir);
  for (const file of files.filter((f) => !f.endsWith('.bak'))) {
    const text = fs.readFileSync(file, 'latin1');
    for (const secret of [...google.secrets.refresh, ...google.secrets.access, FAKE_CLIENT_SECRET]) assert.ok(!text.includes(secret), `${path.basename(file)} holds a secret`);
  }
});

test('the module’s switch hides Google’s events and its job, and keeps the rows and the sign-in; the job is in Settings › Background jobs', async (t) => {
  const { gcal, json, switchOn, read, events } = await setup(t);
  await switchOn('calendar.read');
  gcal.add({ id: 'g1', summary: 'In Google', start: `${day(1)}T10:00`, end: `${day(1)}T11:00` });
  await read();
  const jobs = (await json('GET', '/api/jobs')).body;
  const job = jobs.find((j) => j.id === 'google-calendar-read');
  assert.equal(job.label, 'Read your Google calendars');
  assert.ok(job.last_run);
  assert.equal((await json('GET', '/api/gcal')).body[0].events, 1);

  await json('PATCH', '/api/modules', { id: 'calendar-google', on: false });
  assert.deepEqual(await events(), []);
  assert.equal((await read()).status, 409);
  assert.equal((await json('GET', '/api/jobs')).body.find((j) => j.id === 'google-calendar-read').on, false);
  assert.equal((await json('GET', '/api/google')).body.accounts.length, 1, 'the sign-in stays');
  await json('PATCH', '/api/modules', { id: 'calendar-google', on: true });
  assert.equal((await events()).length, 1, 'the rows stayed');
});

test('a problem is said in words on the account, and Google being away keeps what was read', async (t) => {
  const { gcal, json, switchOn, read, events } = await setup(t);
  await switchOn('calendar.read');
  gcal.add({ id: 'g1', summary: 'In Google', start: `${day(1)}T10:00`, end: `${day(1)}T11:00` });
  await read();
  gcal.offline = true;
  const failed = await read();
  assert.ok(failed.status >= 400);
  assert.match((await json('GET', '/api/gcal')).body[0].problem, /could not be reached/);
  assert.equal((await events()).length, 1, 'what was read is kept');
  gcal.offline = false;
  await read();
  assert.equal((await json('GET', '/api/gcal')).body[0].problem, '');
});

test('schema 62 moves an older database: Google events are new, an account says when its calendar was read, every account is kept', async () => {
  const dir = tmp('gcal-old-');
  let db = openDatabase(dir);
  db.prepare("INSERT INTO google_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', 'work@mypractice.com')").run();
  db.exec('DROP TABLE google_events; ALTER TABLE google_accounts DROP COLUMN calendar_read_at; ALTER TABLE google_accounts DROP COLUMN calendar_problem; PRAGMA user_version = 61;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT email, calendar_read_at, calendar_problem FROM google_accounts').get().email, 'work@mypractice.com');
  assert.equal(db.prepare('SELECT count(*) AS n FROM google_events').get().n, 0);
  db.close();
});

test('a note about a Google event links to its row, opens again as the same note, and the event is found from the note', async (t) => {
  const { gcal, json, switchOn, read, events } = await setup(t);
  await switchOn('calendar.read');
  gcal.add({ id: 'g1', summary: 'Kick-off', start: `${day(2)}T10:00`, end: `${day(2)}T11:00` });
  await read();
  const [event] = await events();
  assert.equal(event.note_id, null);
  const made = (await json('POST', '/api/events/note', { id: event.id })).body;
  assert.ok(made.note.id);
  assert.match(made.note.body, /\/calendar\/events\//);
  const again = (await json('POST', '/api/events/note', { id: event.id })).body;
  assert.equal(again.note.id, made.note.id);
  assert.equal((await events())[0].note_id, made.note.id);
});
