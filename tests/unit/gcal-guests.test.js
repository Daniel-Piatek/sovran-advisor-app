// Guests, Meet, repeats and answers (gcal-write.js, Calendar in depth 9): new events through the outbox with the app's own key, a series moved as one,
// your answer to an invitation. Stand-ins for Google's sign-in and for Google Calendar; the calendars are made up.
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
import { runTool, applyAction, undoAction } from '../../assistant-tools.js';
import { createConversation } from '../../assistant.js';

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
  for (let i = 0; i < 3; i += 1) gcal.add({ id: `review_${i}`, summary: 'Weekly review', start: `${day(4 + 7 * i)}T16:00`, end: `${day(4 + 7 * i)}T17:00`, recurringEventId: 'review' });
  gcal.add({ id: 'review', summary: 'Weekly review', start: `${day(4)}T16:00`, end: `${day(4)}T17:00`, recurrence: ['RRULE:FREQ=WEEKLY'], timeZone: 'Europe/Berlin' });
  gcal.add({ id: 'invite', summary: 'Nordlicht review', start: `${day(2)}T09:00`, end: `${day(2)}T10:00`, organizer: { email: 'jonas@hafenkante.example', displayName: 'Jonas Weber' },
    attendees: [{ email: 'jonas@hafenkante.example', displayName: 'Jonas Weber', organizer: true, responseStatus: 'accepted' }, { email: 'work@mypractice.com', self: true, responseStatus: 'needsAction' }] });
  const read = () => json('POST', '/api/gcal/read', { account_id: account.id });
  if (change) await switchOn('calendar.modify');
  await read();
  const events = async () => (await json('GET', `/api/events?from=${day(0)}&to=${day(30)}`)).body;
  const find = async (title) => (await events()).find((e) => e.title === title);
  const findAll = async (title) => (await events()).filter((e) => e.title === title);
  const rw = () => new DatabaseSync(path.join(dataDir, 'app.db'));
  const send = () => json('POST', '/api/gcal/outbox/send', {});
  const patch = (e, changes) => json('PATCH', `/api/gevents/${e.id.slice('google:'.length)}`, changes);
  return { app, dataDir, google, gcal, json, account, switchOn, read, events, find, findAll, send, patch, rw };
}


test('a new event with a guest from People and a Meet link: it shows at once, goes to Google once with the app’s own key, and the guest’s page lists it', async (t) => {
  const { gcal, json, account, find, send, rw } = await setup(t);
  const lena = (await json('POST', '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' })).body;
  const made = await json('POST', '/api/gevents', { account_id: account.id, calendar_id: 'primary', title: 'Workshop dry run', starts_at: `${day(3)}T14:00`, ends_at: `${day(3)}T15:00`, people: [lena.id], meet: true });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.google.sync, made.body.read_only, made.body.starts_at], ['waiting', false, `${day(3)}T14:00`]);
  assert.equal((await find('Workshop dry run')).google.attendees[0].email, 'lena@nordlicht.example');
  assert.equal(gcal.inserts.length, 0, 'not sent yet');

  assert.deepEqual(await send().then((r) => r.body), { sent: 1, clash: 0, failed: 0, retry: 1 - 1 });
  assert.equal(gcal.inserts.length, 1);
  const [sent] = gcal.inserts;
  assert.deepEqual(sent.params, { conferenceDataVersion: '1', sendUpdates: 'all' });
  assert.deepEqual(sent.body.attendees, [{ email: 'lena@nordlicht.example', displayName: 'Lena Fischer' }]);
  assert.equal(sent.body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.match(sent.body.extendedProperties.private.appKey, /^[0-9a-f-]{36}$/);
  const after = await find('Workshop dry run');
  assert.deepEqual([after.google.sync, after.google.meet_url], ['', 'https://meet.example/made1']);

  // The answer was lost and the app asks again: it finds the event it made by its own key, and makes no second one.
  const db = rw();
  const row = db.prepare('SELECT id FROM google_events WHERE title = ?').get('Workshop dry run');
  db.prepare("UPDATE google_events SET event_id = 'local-' || ?, meet_url = '' WHERE id = ?").run(sent.body.extendedProperties.private.appKey, row.id);
  db.prepare("UPDATE calendar_outbox SET state = 'waiting' WHERE kind = 'insert'").run();
  db.close();
  assert.equal((await send().then((r) => r.body)).sent, 1);
  assert.equal(gcal.inserts.length, 1, 'still one new event in Google');
  assert.equal(gcal.events.get('primary').filter((e) => e.summary === 'Workshop dry run').length, 1);
  assert.equal((await find('Workshop dry run')).google.meet_url, 'https://meet.example/made1');

  // The guest's page lists it as an event with her.
  const linked = (await json('GET', `/api/links/to?kind=person&id=${lena.id}`)).body;
  assert.deepEqual(linked.map((l) => [l.from_kind, l.label]), [['event', 'Workshop dry run']]);
});

test('a new event is refused in words: a guest without an email, a calendar that cannot be written to, Change your calendar off', async (t) => {
  const { gcal, json, account, switchOn } = await setup(t);
  const nobody = (await json('POST', '/api/people', { name: 'Mara Klein' })).body;
  const base = { account_id: account.id, calendar_id: 'primary', title: 'x', starts_at: `${day(3)}T14:00`, ends_at: `${day(3)}T15:00` };
  assert.equal((await json('POST', '/api/gevents', { ...base, people: [nobody.id] })).body.error, 'Mara Klein has no email address in People yet.');
  assert.match((await json('POST', '/api/gevents', { ...base, emails: ['not-an-address'] })).body.error, /not an email address/);
  assert.equal((await json('POST', '/api/gevents', { ...base, calendar_id: 'nowhere' })).body.error, 'That calendar cannot be written to.');
  assert.equal((await json('POST', '/api/gevents', { ...base, title: ' ' })).body.error, 'An event needs a name.');
  assert.equal((await json('POST', '/api/gevents', { ...base, ends_at: base.starts_at })).body.error, 'An event ends after it starts.');
  gcal.calendars.push({ id: 'family', summary: 'Family', selected: true, accessRole: 'reader' });
  gcal.events.set('family', []);
  await json('POST', '/api/gcal/read', { account_id: account.id });
  const where = (await json('GET', '/api/gcal/calendars')).body;
  assert.deepEqual(where.map((c) => c.calendar_id), ['primary'], 'only a calendar that may be written to');
  assert.equal((await json('POST', '/api/gevents', { ...base, calendar_id: 'family' })).status, 400);
  await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'calendar.modify', on: false });
  assert.equal((await json('POST', '/api/gevents', base)).status, 409);
  assert.deepEqual((await json('GET', '/api/gcal/calendars')).body, []);
  assert.ok(switchOn);
});

test('a repeating event: “This one” moves one week, “All” moves the series by what this one moved, through the series itself', async (t) => {
  const { gcal, json, findAll, patch, send } = await setup(t);
  const [first, second] = await findAll('Weekly review');
  assert.equal(first.google.recurring, true);
  // This one.
  await patch(second, { starts_at: `${day(11)}T17:00`, ends_at: `${day(11)}T18:00` });
  await send();
  assert.equal(gcal.patches.at(-1).id, 'review_1', 'only that week');
  assert.deepEqual((await findAll('Weekly review')).map((e) => e.starts_at.slice(11)), ['16:00', '17:00', '16:00']);

  // All: the whole series, half an hour later, shown at once.
  const moved = await json('PATCH', `/api/gevents/${first.id.slice('google:'.length)}`, { starts_at: `${day(4)}T16:30`, ends_at: `${day(4)}T17:30`, scope: 'all' });
  assert.equal(moved.status, 200);
  assert.deepEqual((await findAll('Weekly review')).map((e) => e.starts_at.slice(11)), ['16:30', '17:30', '16:30'], 'every week, at once');
  const masterEtag = gcal.events.get('primary').find((e) => e.id === 'review').etag;
  const sent = await send().then((r) => r.body);
  assert.equal(sent.sent, 1);
  const master = gcal.patches.at(-1);
  assert.equal(master.id, 'review', 'the series itself');
  assert.equal(master.ifMatch, masterEtag, 'with the series’ own version');
  assert.equal(master.body.start.timeZone, 'Europe/Berlin', 'a repeating event needs its time zone');
  assert.equal(new Date(master.body.start.dateTime).getTime(), new Date(`${day(4)}T16:30`).getTime());
  assert.deepEqual((await findAll('Weekly review')).map((e) => e.starts_at.slice(11)), ['16:30', '17:30', '16:30'], 'then read back from Google: the week moved on its own keeps its own time, shifted too');
  assert.equal((await findAll('Weekly review'))[0].google.sync, '');

  // Other changes are for This one only.
  const other = await json('PATCH', `/api/gevents/${first.id.slice('google:'.length)}`, { title: 'Renamed', scope: 'all' });
  assert.equal(other.status, 400);
});

test('an invitation: it waits dashed for your answer, Yes goes to Google with every guest kept and the version it was answered on; your own meeting cannot be answered', async (t) => {
  const { gcal, json, find, send } = await setup(t);
  const invite = await find('Nordlicht review');
  assert.deepEqual([invite.google.my_response, invite.read_only], ['needsAction', true]);
  const answered = await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'accepted' });
  assert.deepEqual([answered.status, answered.body.google.my_response, answered.body.google.sync], [200, 'accepted', 'waiting']);
  assert.equal((await find('Nordlicht review')).google.my_response, 'accepted', 'shown at once');
  assert.equal(gcal.patches.length, 0);
  assert.equal((await send().then((r) => r.body)).sent, 1);
  const sent = gcal.patches[0];
  assert.equal(sent.id, 'invite');
  assert.equal(sent.ifMatch, invite.google.etag);
  assert.deepEqual(sent.body.attendees.map((a) => [a.email, a.responseStatus]), [['jonas@hafenkante.example', 'accepted'], ['work@mypractice.com', 'accepted']]);
  assert.deepEqual(gcal.events.get('primary').find((e) => e.id === 'invite').attendees.map((a) => [a.email, a.responseStatus, a.self ?? false]), [['jonas@hafenkante.example', 'accepted', false], ['work@mypractice.com', 'accepted', true]]);

  // Another answer, changed before it went: one answer goes, the last.
  await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'tentative' });
  await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'declined' });
  assert.equal((await json('GET', '/api/gcal/outbox')).body.filter((o) => o.state === 'waiting').length, 1);
  await send();
  assert.equal(gcal.patches.at(-1).body.attendees.find((a) => a.email === 'work@mypractice.com').responseStatus, 'declined');

  assert.equal((await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'maybe' })).status, 400);
  const mine = await find('Kick-off Nordlicht');
  assert.equal((await json('POST', `/api/gevents/${mine.id.slice('google:'.length)}/answer`, { response: 'accepted' })).status, 400);
});

test('an answer that clashes keeps Google’s version, and “Use mine” sends it again; with Change your calendar off nothing can be answered', async (t) => {
  const { gcal, json, account, find, send } = await setup(t);
  const invite = await find('Nordlicht review');
  gcal.change('primary', 'invite', { location: 'Moved to the studio' });
  await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'accepted' });
  assert.deepEqual(await send().then((r) => r.body), { sent: 0, clash: 1, failed: 0, retry: 0 });
  assert.equal((await find('Nordlicht review')).google.my_response, 'needsAction', 'Google’s version is kept');
  const [clash] = (await json('GET', '/api/gcal/outbox')).body;
  assert.deepEqual([clash.state, clash.kind, clash.payload.response], ['clash', 'answer', 'accepted']);
  await json('POST', `/api/gcal/outbox/${clash.id}/resolve`, { use: 'mine' });
  assert.equal((await find('Nordlicht review')).google.my_response, 'accepted');
  assert.equal((await send().then((r) => r.body)).sent, 1);
  assert.equal(gcal.events.get('primary').find((e) => e.id === 'invite').attendees.find((a) => a.self).responseStatus, 'accepted');

  await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'calendar.modify', on: false });
  assert.equal((await json('POST', `/api/gevents/${invite.id.slice('google:'.length)}/answer`, { response: 'declined' })).status, 409);
});

test('schema 64 moves an older database: the outbox says what kind of change it holds, calendars are kept, every change is kept', async () => {
  const dir = tmp('g9-old-');
  let db = openDatabase(dir);
  db.prepare("INSERT INTO google_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', 'work@mypractice.com')").run();
  db.prepare("INSERT INTO google_events (id, created_at, updated_at, account_id, calendar_id, event_id, title, starts_at, ends_at) VALUES ('e1', 'x', 'x', 'a1', 'primary', 'g1', 'Kept', '2026-11-12T10:00', '2026-11-12T11:00')").run();
  db.prepare("INSERT INTO calendar_outbox (id, created_at, updated_at, account_id, google_event_id, patch) VALUES ('o1', 'x', 'x', 'a1', 'e1', '{\"title\":\"x\"}')").run();
  db.exec("DROP TABLE google_calendars; ALTER TABLE calendar_outbox DROP COLUMN kind; ALTER TABLE calendar_outbox DROP COLUMN payload; PRAGMA user_version = 63;");
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual([db.prepare('SELECT kind, payload FROM calendar_outbox').get().kind, db.prepare('SELECT count(*) AS n FROM google_calendars').get().n], ['update', 0]);
  db.close();
});

test('your assistant proposes an event in Google as a card: nothing is in Google or in your calendar until Approve, then it goes through the outbox; Undo works until it has gone', async (t) => {
  const { gcal, json, dataDir, find, send, rw } = await setup(t);
  await json('POST', '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  const db = rw();
  const run = { conversationId: createConversation(db, dataDir).id, messageId: null, card: () => {} };
  const out = JSON.parse(runTool(db, 'calendar_propose', { title: 'Workshop dry run', starts_at: `${day(3)}T14:00`, minutes: 60, where: 'google', guests: ['Lena Fischer'], meet: true, reason: 'Thursday is free' }, run));
  assert.ok(out.waiting);
  assert.equal(await find('Workshop dry run'), undefined, 'not in your calendar yet');
  await send();
  assert.equal(gcal.inserts.length, 0, 'and Google has nothing');

  applyAction(db, out.waiting);
  assert.equal((await find('Workshop dry run')).google.sync, 'waiting', 'now in your calendar, on its way');
  // Undo while it waits: it is taken back and never goes.
  undoAction(db, out.waiting);
  assert.equal(await find('Workshop dry run'), undefined);
  await send();
  assert.equal(gcal.inserts.length, 0);

  // A second proposal, approved and sent: it is in Google, and Undo says so in words.
  const again = JSON.parse(runTool(db, 'calendar_propose', { title: 'Workshop dry run', starts_at: `${day(3)}T14:00`, minutes: 60, where: 'google', guests: ['Lena Fischer'], meet: true }, run));
  applyAction(db, again.waiting);
  await send();
  assert.equal(gcal.inserts.length, 1);
  assert.deepEqual(gcal.inserts[0].body.attendees, [{ email: 'lena@nordlicht.example', displayName: 'Lena Fischer' }]);
  assert.throws(() => undoAction(db, again.waiting), /already in Google Calendar/);
  db.close();
});
