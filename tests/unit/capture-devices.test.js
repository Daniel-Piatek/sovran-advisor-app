// Capture from anywhere (capture-devices.js, Tasks in depth 6): a token per device, one address, the Inbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { startServer } from '../../server.js';
import { fileKeyStore } from '../../google.js';
import { addDevice, listDevices, revokeDevice, deviceForToken, checkShareInput, shareCapture } from '../../capture-devices.js';
import { waitingCaptures } from '../../captures.js';
import { setModule } from '../../modules.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a device has its own token, kept in the key store; the table only knows the device', async () => {
  const db = emptyDb();
  const dir = tmp('capture-keys-');
  const keys = fileKeyStore(dir);
  const { device, token } = await addDevice(db, keys, { name: ' Work   browser ', kind: 'browser' });
  assert.deepEqual([device.name, device.kind, device.last_used_at, device.uses], ['Work browser', 'browser', null, 0]);
  const secret = token.split('.')[1];
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM capture_devices').all()).includes(secret), false);
  assert.equal(fs.readdirSync(dir).some((f) => fs.readFileSync(path.join(dir, f), 'utf8') === secret), true);

  assert.equal((await deviceForToken(db, keys, token)).id, device.id);
  assert.equal(listDevices(db)[0].uses, 0, 'only a kept capture counts as a use');
  shareCapture(db, device, { text: 'a thought' });
  assert.equal(listDevices(db)[0].uses, 1);
  assert.ok(listDevices(db)[0].last_used_at);
  for (const bad of ['', 'nothing', `${device.id}.wrong`, `${device.id}.`, `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${secret}`, null, undefined]) {
    assert.equal(await deviceForToken(db, keys, bad), null, String(bad));
  }
  await assert.rejects(addDevice(db, keys, { name: '' }), /short name/);
  await assert.rejects(addDevice(db, keys, { name: 'x', kind: 'toaster' }), /kind is/);

  assert.equal((await revokeDevice(db, keys, device.id)).name, 'Work browser');
  assert.equal(await deviceForToken(db, keys, token), null, 'revoked');
  assert.deepEqual(listDevices(db), []);
  assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM capture_devices').get().gone, 1, 'only marked deleted');
  assert.equal(await revokeDevice(db, keys, device.id), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what is shared: text and a link make a capture from that device, in the Outer pile', async () => {
  const db = emptyDb();
  const keys = fileKeyStore(tmp('capture-keys-'));
  const { device } = await addDevice(db, keys, { name: 'Phone', kind: 'phone' });
  const a = shareCapture(db, device, { text: 'Link from Lena', link: 'https://example.com/pricing' });
  assert.deepEqual([a.body, a.world, a.origin, a.shared_from], ['Link from Lena\nhttps://example.com/pricing', 'outer', 'captured', 'Phone']);
  const b = shareCapture(db, device, { text: 'Idea: see https://example.com/x', link: 'https://example.com/x' });
  assert.equal(b.body, 'Idea: see https://example.com/x', 'the link is not written twice');
  const c = shareCapture(db, device, { text: 'a thought from my phone' });
  assert.deepEqual([c.world, c.shared_from], ['outer', 'Phone']);
  assert.equal(waitingCaptures(db).length, 3);
  assert.equal(checkShareInput({}), 'Send some text, a link, or both.');
  assert.match(checkShareInput({ link: 'javascript:alert(1)' }), /web address/);
  assert.match(checkShareInput({ text: 5 }), /text is text/);
  assert.match(checkShareInput([]), /JSON object/);
  assert.equal(checkShareInput({ text: 'x'.repeat(20_001) }), 'That is too long for a capture.');
  assert.equal(checkShareInput({ link: 'https://example.com' }), null);
});

test('a database from before capture devices gets the column and the table, every capture kept', () => {
  const dir = tmp('capture-old-');
  let db = openDatabase(dir);
  db.exec("INSERT INTO captures (id, created_at, updated_at, body, captured_at) VALUES ('c1', 'a', 'a', 'Keep me', 'a')");
  db.exec('ALTER TABLE captures DROP COLUMN device_id; DROP TABLE capture_devices; PRAGMA user_version = 40;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(waitingCaptures(db)[0].body, 'Keep me');
  assert.equal(listDevices(db).length, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function server(t) {
  const dataDir = tmp('capture-api-');
  const storeDir = tmp('capture-store-');
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, linkFetcher: async () => 'A page', google: { captureKeyStore: fileKeyStore(storeDir), keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }; };
  const share = (token, body, extra = {}) => fetch(`${app.url}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Capture-Token': token } : {}), ...extra }, body: JSON.stringify(body) });
  return { app, dataDir, storeDir, json, share };
}

test('POST /capture: a wrong token is refused, the right one lands in the Inbox with its device; the token is nowhere in the data', async (t) => {
  const { app, dataDir, storeDir, json, share } = await server(t);
  const made = await json('POST', '/api/capture/devices', { name: 'Phone', kind: 'phone' });
  assert.equal(made.status, 201);
  const { token } = made.body;
  assert.equal(JSON.stringify((await json('GET', '/api/capture/devices')).body).includes(token.split('.')[1]), false, 'the list never shows a token');

  assert.equal((await share('nope', { text: 'x' })).status, 401);
  assert.equal((await share(null, { text: 'x' })).status, 401);
  assert.equal((await json('GET', '/api/captures')).body.length, 0);

  const ok = await share(token, { text: 'Newsletter: pricing ideas', link: 'https://example.com/pricing' });
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  const [capture] = (await json('GET', '/api/captures')).body;
  assert.deepEqual([capture.body, capture.shared_from, capture.origin, capture.world], ['Newsletter: pricing ideas\nhttps://example.com/pricing', 'Phone', 'captured', 'outer']);
  const viaBearer = await fetch(`${app.url}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'with a bearer header' }) });
  assert.equal(viaBearer.status, 201);
  assert.equal((await share(token, {})).status, 400);
  assert.equal((await share(token, { link: 'ftp://x' })).status, 400);
  const [device] = (await json('GET', '/api/capture/devices')).body;
  assert.deepEqual([device.uses, Boolean(device.last_used_at)], [2, true]);

  const secret = token.split('.')[1];
  const files = fs.readdirSync(dataDir, { recursive: true }).map((f) => path.join(dataDir, f)).filter((f) => fs.statSync(f).isFile());
  for (const file of files) assert.equal(fs.readFileSync(file).includes(secret), false, `${path.basename(file)} holds the token`);
  assert.equal(fs.readdirSync(storeDir).some((f) => fs.readFileSync(path.join(storeDir, f), 'utf8') === secret), true);

  assert.equal((await json('DELETE', `/api/capture/devices/${device.id}`)).status, 200);
  assert.equal((await share(token, { text: 'after revoking' })).status, 401);
  assert.equal((await json('DELETE', `/api/capture/devices/${device.id}`)).status, 404);
  assert.equal((await json('GET', '/api/capture/devices')).body.length, 0);
});

test('another website may ask first: the preflight answers, with the token as the only key', async (t) => {
  const { app } = await server(t);
  const res = await fetch(`${app.url}/capture`, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-capture-token, content-type', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /X-Capture-Token/);
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
  // the rest of the app does not say yes to other websites
  const other = await fetch(`${app.url}/api/notes`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${app.url}/capture`, { method: 'PUT' })).status, 405);
});

test('with Tasks in depth off the address answers "This module is off" and the captures stay', async (t) => {
  const { app, json, share } = await server(t);
  const { body: { token } } = await json('POST', '/api/capture/devices', { name: 'Phone', kind: 'phone' });
  assert.equal((await share(token, { text: 'kept' })).status, 201);
  await json('PATCH', '/api/modules', { id: 'tasks-plus', on: false });
  const refused = await share(token, { text: 'refused' });
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, 'This module is off.');
  assert.equal((await json('GET', '/api/captures')).body.length, 1);
  await json('PATCH', '/api/modules', { id: 'tasks-plus', on: true });
  assert.equal((await share(token, { text: 'back' })).status, 201);
  void app; void setModule;
});
