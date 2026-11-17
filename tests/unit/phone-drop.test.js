import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase } from '../../db.js';
import { seal, unseal, randomB64, readLinkPart } from '../../phone/seal.js';
import { linkPhone, unlinkPhone, collect, phoneDropState, DROP_URL, PAGE_URL } from '../../phone-drop.js';
import { waitingCaptures } from '../../captures.js';
import { entriesOfDay, generalJournal, localDay } from '../../entries.js';
import { SCHEMA_VERSION } from '../../db.js';
import { startServer } from '../../server.js';
import { fakeBox } from '../fake-drop-box.js';

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-drop-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('a note sealed with the key opens only with that key', async () => {
  const key = randomB64(32);
  const sealed = await seal(key, { body: 'Ask Sam', world: 'inner' });
  assert.match(sealed, /^[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes('Sam'));
  assert.deepEqual(await unseal(key, sealed), { body: 'Ask Sam', world: 'inner' });
  await assert.rejects(unseal(randomB64(32), sealed));
});

test('the phone link carries box, drop token and key after "#", and the cloud gets only hashes', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const state = await linkPhone(db, { fetcher: box.fetcher });
  assert.ok(state.link.startsWith(`${PAGE_URL}#v1.`));
  const link = readLinkPart(state.link.split('#')[1]);
  assert.ok(link);
  const open = box.calls[0];
  assert.equal(open.action, 'open');
  assert.equal(open.drop_hash, sha(link.drop));
  assert.ok(!JSON.stringify(open).includes(link.key) && !JSON.stringify(open).includes(link.drop));
  // asked again: the same box
  assert.equal((await linkPhone(db, { fetcher: box.fetcher })).link, state.link);
  db.close();
});

test('what the phone leaves comes into the Inbox and is deleted from the box; a foreign note is dropped', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  await box.phoneDrops(link, { body: 'Ask Sam about the venue', world: 'inner' });
  await box.phoneDrops(link, { body: 'From Ana: call back', world: 'outer' });
  await box.phoneDrops({ ...link, key: randomB64(32) }, { body: 'not ours', world: 'inner' });
  assert.equal(await collect(db, { fetcher: box.fetcher }), 2);
  assert.deepEqual(waitingCaptures(db).map((c) => [c.world, c.body]).sort(), [['inner', 'Ask Sam about the venue'], ['outer', 'From Ana: call back']]);
  assert.equal(box.boxes.get(link.box).notes.length, 0);
  assert.equal(phoneDropState(db).collected, 2);
  db.close();
});

test('a journal entry from the phone goes straight into the Journal, on the day and at the time it was written', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  // Written two days ago in the evening (the computer was off since), and one today.
  const then = new Date(Date.now() - 2 * 86400_000);
  then.setHours(21, 40, 0, 0);
  const now = new Date(Date.now() - 60_000);
  await box.phoneDrops(link, { body: 'walked by the sea with the sovereign advisor in mind', world: 'inner', kind: 'journal', at: then.toISOString(), day: localDay(then) });
  await box.phoneDrops(link, { body: 'Today, a second entry', world: 'inner', kind: 'journal', at: now.toISOString(), day: localDay(now) });
  await box.phoneDrops(link, { body: 'A thought, as before', world: 'inner', at: now.toISOString() });
  assert.equal(await collect(db, { fetcher: box.fetcher }), 3);
  assert.deepEqual(waitingCaptures(db).map((c) => c.body), ['A thought, as before'], 'only the thought waits in the Inbox');
  const [old] = entriesOfDay(db, localDay(then));
  assert.equal(old.preview, 'walked by the sea with the Sovran Advisor in mind', 'the glossary fixes a journal entry too');
  assert.equal(old.written_at, then.toISOString());
  assert.equal(old.journal_id, generalJournal(db).id);
  assert.equal(old.origin, 'captured');
  assert.equal(db.prepare('SELECT spoken, state FROM entry_tidy WHERE entry_id = ?').get(old.id).spoken, 'walked by the sea with the sovereign advisor in mind');
  assert.deepEqual(entriesOfDay(db, localDay(now)).map((e) => e.preview), ['Today, a second entry']);
  assert.equal(box.boxes.get(link.box).notes.length, 0);
  assert.equal(phoneDropState(db).collected, 3);
  db.close();
});

test('a journal entry with a wrong day or clock still lands in the Journal; a kind not known yet lands in the Inbox', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  const ahead = new Date(Date.now() + 5 * 86400_000).toISOString();
  await box.phoneDrops(link, { body: 'No day and no time', kind: 'journal' });
  await box.phoneDrops(link, { body: 'A clock five days ahead', kind: 'journal', at: ahead, day: 'next week' });
  await box.phoneDrops(link, { body: 'Something from a newer Sovran Go', world: 'outer', kind: 'not-known-yet', at: new Date().toISOString() });
  assert.equal(await collect(db, { fetcher: box.fetcher }), 3);
  const today = entriesOfDay(db, localDay());
  assert.deepEqual(today.map((e) => e.preview).sort(), ['A clock five days ahead', 'No day and no time']);
  assert.ok(today.every((e) => new Date(e.written_at) <= new Date()), 'never written in the future');
  assert.deepEqual(waitingCaptures(db).map((c) => [c.world, c.body]), [['outer', 'Something from a newer Sovran Go']]);
  db.close();
});

test('schema 76 adds the table for tidying journal entries to an older database and keeps everything else', async (t) => {
  const dir = temp(t);
  let db = openDatabase(dir);
  const box = fakeBox();
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  await box.phoneDrops(link, { body: 'Kept from before', world: 'inner' });
  await collect(db, { fetcher: box.fetcher });
  db.exec('DROP TABLE entry_tidy; PRAGMA user_version = 75;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(waitingCaptures(db).map((c) => c.body), ['Kept from before']);
  await box.phoneDrops(link, { body: 'A journal entry after the update', kind: 'journal', at: new Date().toISOString(), day: localDay() });
  assert.equal(await collect(db, { fetcher: box.fetcher }), 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM entry_tidy').get().n, 1);
  db.close();
});

test('a new link stops the old one; switching off closes the box', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const first = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  const second = readLinkPart((await linkPhone(db, { fetcher: box.fetcher, fresh: true })).link.split('#')[1]);
  assert.notEqual(first.box, second.box);
  assert.equal((await box.phoneDrops(first, { body: 'x' })).status, 404);
  assert.equal((await box.phoneDrops(second, { body: 'y' })).status, 200);
  await unlinkPhone(db, { fetcher: box.fetcher });
  assert.equal(box.boxes.size, 0);
  assert.equal(phoneDropState(db).linked, false);
  db.close();
});

test('the server: off by default, then link, code and check', async (t) => {
  const box = fakeBox();
  const app = await startServer({ dataDir: temp(t), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0, phoneDropFetch: box.fetcher });
  t.after(() => app.close());
  const api = (method, p, body) => fetch(app.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await api('GET', '/api/phone-drop')).status, 409);
  assert.equal((await api('PATCH', '/api/modules', { id: 'phone-drop', on: true })).status, 200);
  const state = await (await api('POST', '/api/phone-drop/link', {})).json();
  assert.equal(state.linked, true);
  const qr = await api('GET', '/api/phone-drop/qr.svg');
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /^<svg/);
  await box.phoneDrops(readLinkPart(state.link.split('#')[1]), { body: 'From the phone', world: 'inner' });
  assert.equal((await (await api('POST', '/api/phone-drop/check', {})).json()).collected, 1);
  assert.equal((await api('PATCH', '/api/modules', { id: 'phone-drop', on: false })).status, 200);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(box.boxes.size, 0);
});

test('a 20,000-character thought, of the widest characters, still fits the drop box once sealed', async () => {
  const key = randomB64(32);
  const { MAX_PHONE_TEXT } = await import('../../phone-drop.js');
  assert.equal(MAX_PHONE_TEXT, 20000);
  const SEALED = /^[A-Za-z0-9_-]{30,170000}$/; // cloud/phone-drop/index.ts and phone-drop.sql
  for (const body of ['a'.repeat(20000), 'é'.repeat(20000), '€'.repeat(20000), '😀'.repeat(10000), '\u0001'.repeat(20000)]) {
    const sealed = await seal(key, { body, world: 'inner', at: new Date().toISOString() });
    assert.ok(SEALED.test(sealed), `sealed length ${sealed.length}`);
    assert.equal((await unseal(key, sealed)).body, body);
  }
  const fn = fs.readFileSync(new URL('../../cloud/phone-drop/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /\{30,170000\}/);
});
