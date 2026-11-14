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
import { startServer } from '../../server.js';

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-drop-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The Sovran drop box (cloud/phone-drop), kept in memory: the same answers as the web function.
function fakeBox() {
  const boxes = new Map();
  let next = 1;
  const calls = [];
  const fetcher = async (url, { body }) => {
    assert.equal(url, DROP_URL);
    const msg = JSON.parse(body);
    calls.push(msg);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    const b = boxes.get(msg.box);
    if (msg.action === 'open') { boxes.set(msg.box, { drop_hash: msg.drop_hash, pull_hash: msg.pull_hash, notes: [] }); return reply(200, { opened: true }); }
    if (msg.action === 'drop') {
      if (!b || sha(msg.drop) !== b.drop_hash) return reply(404, { error: 'This link has been replaced.' });
      b.notes.push({ id: next++, sealed: msg.sealed }); return reply(200, { kept: true });
    }
    if (!b || sha(msg.pull) !== b.pull_hash) return reply(404, { error: 'No such box.' });
    if (msg.action === 'take') return reply(200, { notes: b.notes.slice(0, 50) });
    if (msg.action === 'done') { const before = b.notes.length; b.notes = b.notes.filter((n) => !msg.ids.includes(n.id)); return reply(200, { deleted: before - b.notes.length }); }
    if (msg.action === 'close') { boxes.delete(msg.box); return reply(200, { closed: true }); }
    return reply(400, {});
  };
  const phoneDrops = async (link, note) => fetcher(DROP_URL, { body: JSON.stringify({ action: 'drop', box: link.box, drop: link.drop, sealed: await seal(link.key, note) }) });
  return { boxes, calls, fetcher, phoneDrops };
}

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
