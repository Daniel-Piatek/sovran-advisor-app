// Google (google.js, advanced/mail/1): one sign-in per account, a switch per permission, tokens only in
// the key store, a health per account. A stand-in for Google (tests/fake-google.js) and a stand-in key
// store (a folder) are used: no test talks to the real Google or touches the real Keychain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, prepareDatabase, SCHEMA_VERSION } from '../../db.js';
import { startServer } from '../../server.js';
import { listModules } from '../../modules.js';
import { fileKeyStore, macKeyStore, defaultKeyStore, accessToken, safeReturn } from '../../google.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

async function setup(t) {
  const dataDir = tmp('google-data-');
  const storeDir = tmp('google-store-');
  const fake = await startFakeGoogle();
  const keyStore = fileKeyStore(storeDir);
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, google: { env: fake.env, keyStore } });
  t.after(async () => { await app.close(); await fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (method, url, body) => (await send(method, url, body)).json();
  // What the browser does: go to Google's page (it says yes at once), then back to the app's callback.
  const signIn = async (connected) => {
    const toGoogle = await fetch(connected.url, { redirect: 'manual' });
    const back = await fetch(toGoogle.headers.get('location'), { redirect: 'manual' });
    return back.headers.get('location');
  };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  return { app, dataDir, storeDir, fake, keyStore, send, json, signIn };
}

test('schema 38 moves an older database: Google tables are new, every row is kept', () => {
  const dir = tmp('google-old-');
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', '')");
  db.exec('DROP TABLE google_log; DROP TABLE google_accounts; PRAGMA user_version = 37;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION >= 38, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM google_accounts').get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Mail is a module with a manifest, off in a new install until it is switched on', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const mail = listModules(db).find((m) => m.id === 'mail');
  assert.equal(mail.on, false);
  assert.deepEqual(mail.permissions, ['mail.read', 'mail.send', 'mail.modify']);
});

test('the client: its secret goes to the key store, never to the database, and is never sent back', async (t) => {
  const { dataDir, storeDir, json, send, keyStore } = await setup(t);
  const state = await json('GET', '/api/google');
  assert.equal(state.configured, true);
  assert.equal(state.client_id, FAKE_CLIENT_ID);
  assert.equal(JSON.stringify(state).includes(FAKE_CLIENT_SECRET), false);
  assert.equal(await keyStore.get('client-secret'), FAKE_CLIENT_SECRET);
  assert.equal(fs.readdirSync(dataDir, { recursive: true }).filter((f) => fs.statSync(path.join(dataDir, f)).isFile()).some((f) => fs.readFileSync(path.join(dataDir, f)).includes(FAKE_CLIENT_SECRET)), false); // the backups too
  assert.equal(fs.readdirSync(storeDir).length, 1);
  assert.equal((await send('PUT', '/api/google/client', { client_id: 'x', client_secret: 'y' })).status, 400);
  assert.equal((await send('PUT', '/api/google', {})).status, 405);
  assert.equal((await json('DELETE', '/api/google/client')).configured, false);
  assert.equal(await keyStore.get('client-secret'), null);
  assert.equal((await send('POST', '/api/google/connect', {})).status, 409);
});

test('signing in: identity only, PKCE, the tokens in the key store and nowhere else', async (t) => {
  const { app, dataDir, storeDir, fake, json, signIn } = await setup(t);
  const connected = await json('POST', '/api/google/connect', {});
  const params = new URL(connected.url).searchParams;
  assert.equal(params.get('scope'), 'openid email'); // no mail permission asked yet
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('redirect_uri'), `${app.url}/api/google/callback`);
  assert.equal(params.get('access_type'), 'offline');
  assert.equal(await signIn(connected), '/settings?google=ok');

  const [account] = (await json('GET', '/api/google')).accounts;
  assert.equal(account.email, 'work@mypractice.com');
  assert.equal(account.health, 'ok');
  assert.deepEqual(account.permissions.map((p) => [p.id, p.granted, p.on]), [['mail.read', false, false], ['mail.send', false, false], ['mail.modify', false, false], ['calendar.read', false, false], ['calendar.modify', false, false]]);

  // The proof of the sign-in is in the key store; a search of the app's folder and database finds none of it.
  const tokens = [...fake.secrets.refresh, ...fake.secrets.access];
  const everywhere = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile());
  for (const file of everywhere(dataDir)) for (const secret of [...tokens, FAKE_CLIENT_SECRET]) assert.equal(fs.readFileSync(file).includes(secret), false, `${path.basename(file)} holds a secret`);
  assert.equal(everywhere(storeDir).some((f) => fs.readFileSync(f, 'utf8').includes(fake.secrets.refresh[0])), true);
  assert.equal(JSON.stringify(await json('GET', '/api/google')).includes(fake.secrets.refresh[0]), false);
});

test('a callback that was not started here, or that Google refused, signs nobody in and says why once', async (t) => {
  const { app, fake, json, signIn } = await setup(t);
  const stray = await fetch(`${app.url}/api/google/callback?code=x&state=nope`, { redirect: 'manual' });
  assert.equal(stray.headers.get('location'), '/settings?google=failed');
  assert.match((await json('GET', '/api/google')).problem, /not started here/);
  assert.equal((await json('GET', '/api/google')).problem, undefined); // told once

  fake.deny = true;
  assert.equal(await signIn(await json('POST', '/api/google/connect', {})), '/settings?google=denied');
  assert.match((await json('GET', '/api/google')).problem, /not allowed to sign you in/);
  assert.deepEqual((await json('GET', '/api/google')).accounts, []);
});

test('a switch asks Google only for its own permission, the first time, and keeps what was allowed before', async (t) => {
  const { fake, json, signIn } = await setup(t);
  await signIn(await json('POST', '/api/google/connect', {}));
  const [account] = (await json('GET', '/api/google')).accounts;

  // Read your mail: Google is asked for the read permission and nothing else, naming the account.
  const askRead = await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true });
  const readParams = new URL(askRead.url).searchParams;
  assert.equal(readParams.get('scope'), `openid email ${SCOPES.read}`);
  assert.equal(readParams.get('login_hint'), 'work@mypractice.com');
  assert.equal(await signIn(askRead), '/settings?google=ok');
  let now = (await json('GET', '/api/google')).accounts[0];
  assert.deepEqual(now.permissions.map((p) => [p.id, p.granted, p.on]), [['mail.read', true, true], ['mail.send', false, false], ['mail.modify', false, false], ['calendar.read', false, false], ['calendar.modify', false, false]]);
  assert.equal((await json('GET', '/api/google')).accounts.length, 1);

  // Off and on again: the app's own switch, Google is not asked a second time.
  assert.equal((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: false })).account.permissions[0].on, false);
  const again = await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true });
  assert.equal(again.url, undefined);
  assert.equal(again.account.permissions[0].on, true);

  // Send mail as you: only the send permission is asked for; read stays allowed.
  const askSend = await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.send', on: true });
  assert.equal(new URL(askSend.url).searchParams.get('scope'), `openid email ${SCOPES.send}`);
  await signIn(askSend);
  now = (await json('GET', '/api/google')).accounts[0];
  assert.deepEqual(now.permissions.map((p) => [p.granted, p.on]), [[true, true], [true, true], [false, false], [false, false], [false, false]]);
  assert.deepEqual(fake.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope.split(' ').slice(2)), [[], [SCOPES.read], [SCOPES.send]]);
});

test('signing in as a different account while switching one on is refused', async (t) => {
  const { fake, json, signIn } = await setup(t);
  await signIn(await json('POST', '/api/google/connect', {}));
  const [account] = (await json('GET', '/api/google')).accounts;
  const ask = await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true });
  const url = new URL(ask.url);
  url.searchParams.delete('login_hint'); // the person chose another account on Google's page
  fake.email = 'someone@else.com';
  assert.equal(await signIn({ url: url.href }), '/settings?google=failed');
  assert.match((await json('GET', '/api/google')).problem, /someone@else.com, not work@mypractice.com/);
  assert.equal((await json('GET', '/api/google')).accounts[0].permissions[0].granted, false);
});

test('health: connected, then Google no longer lets the app in, then back after signing in again', async (t) => {
  const { fake, json, signIn } = await setup(t);
  await signIn(await json('POST', '/api/google/connect', {}));
  const [account] = (await json('GET', '/api/google')).accounts;
  assert.equal((await json('POST', `/api/google/accounts/${account.id}/check`, {})).health, 'ok');

  fake.offline = true;
  assert.equal((await json('POST', `/api/google/accounts/${account.id}/check`, {})).health, 'unreachable');
  fake.offline = false;

  for (const token of fake.secrets.refresh) fake.revoked.add(token); // removed in the Google account
  const gone = await json('POST', `/api/google/accounts/${account.id}/check`, {});
  assert.equal(gone.health, 'needs_signin');
  assert.ok(gone.health_checked_at);

  await signIn(await json('POST', '/api/google/connect', { account_id: account.id }));
  const state = await json('GET', '/api/google');
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].health, 'ok');
  assert.ok(state.log.some((l) => /no longer lets the app in/.test(l.what)));
});

test('a part of the app asks for a token: only for a switched-on permission, and every use is logged', async (t) => {
  const { dataDir, fake, json, signIn, keyStore } = await setup(t);
  await signIn(await json('POST', '/api/google/connect', {}));
  const [account] = (await json('GET', '/api/google')).accounts;
  const env = fake.env;
  // The app's database opened a second time, as another part of the app would use google.js.
  const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  await assert.rejects(accessToken(sqlite, keyStore, { id: account.id, permission: 'mail.read', why: 'The mail reader' }, { env }), /switched off/);
  await signIn(await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true }));
  const token = await accessToken(sqlite, keyStore, { id: account.id, permission: 'mail.read', why: 'The mail reader' }, { env });
  assert.match(token, /^access-/);
  await assert.rejects(accessToken(sqlite, keyStore, { id: account.id, permission: 'mail.send', why: 'The mail sender' }, { env }), /switched off/);
  sqlite.close();
  const log = (await json('GET', '/api/google')).log.map((l) => l.what);
  assert.ok(log.some((w) => /Refused: The mail reader asked for “Read your mail”/.test(w)));
  assert.ok(log.some((w) => /The mail reader used “Read your mail” on work@mypractice.com/.test(w)));
  assert.ok(log.some((w) => /Refused: The mail sender asked for “Send mail as you”/.test(w)));
});

test('disconnecting tells Google, empties the key store, and the account can be added again', async (t) => {
  const { storeDir, fake, json, signIn, send } = await setup(t);
  await signIn(await json('POST', '/api/google/connect', {}));
  const [account] = (await json('GET', '/api/google')).accounts;
  const refresh = fake.secrets.refresh[0];
  const state = await json('DELETE', `/api/google/accounts/${account.id}`);
  assert.deepEqual(state.accounts, []);
  assert.ok(fake.revoked.has(refresh));
  assert.equal(fs.readdirSync(storeDir).length, 1); // only the client's secret is left
  assert.equal((await send('POST', `/api/google/accounts/${account.id}/check`, {})).status, 404);
  assert.equal(await signIn(await json('POST', '/api/google/connect', {})), '/settings?google=ok');
  assert.equal((await json('GET', '/api/google')).accounts.length, 1);
});

test('the Keychain store keeps, changes and forgets a secret (the real Keychain, a throwaway name)', { skip: process.platform !== 'darwin' }, async () => {
  const store = macKeyStore({ service: `Sovran Advisor test ${process.pid} ${Date.now()}` });
  try {
    assert.equal(await store.get('a'), null);
    await store.set('a', '{"x":"päss \\" word"}');
    assert.equal(await store.get('a'), '{"x":"päss \\" word"}');
    await store.set('a', 'second');
    assert.equal(await store.get('a'), 'second');
  } finally {
    await store.remove('a');
  }
  assert.equal(await store.get('a'), null);
});

test('without a stand-in the key store is the Keychain on a Mac, and nothing at all elsewhere', async () => {
  assert.equal(defaultKeyStore({}, 'darwin').name, 'the macOS Keychain');
  assert.equal(defaultKeyStore({ GOOGLE_KEY_STORE_DIR: '/tmp/x' }, 'darwin').name, 'a test key store');
  const none = defaultKeyStore({}, 'linux');
  assert.equal(await none.get('a'), null);
  await assert.rejects(none.set('a', 'b'), /no key store/);
});

test('a sign-in can come back to the page it started from (a path of this app, nothing else)', async (t) => {
  const { app, fake, json } = await (async () => {
    const dataDir = tmp('google-return-');
    const storeDir = tmp('google-return-store-');
    const fake = await startFakeGoogle();
    const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, google: { env: fake.env, keyStore: fileKeyStore(storeDir) } });
    t.after(async () => { await app.close(); await fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
    const json = async (method, url, body) => (await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
    await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
    return { app, fake, json };
  })();
  const walk = async (connected) => {
    const toGoogle = await fetch(connected.url, { redirect: 'manual' });
    return (await fetch(toGoogle.headers.get('location'), { redirect: 'manual' })).headers.get('location');
  };
  assert.equal(await walk(await json('POST', '/api/google/connect', {})), '/settings?google=ok');
  const [account] = (await json('GET', '/api/google')).accounts;
  assert.equal(await walk(await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true, return_to: '/mail?split=money&thread=abc-123' })), '/mail?split=money&thread=abc-123');
  assert.equal(safeReturn('/mail?split=money&thread=abc-123'), '/mail?split=money&thread=abc-123');
  for (const bad of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', '/mail\nSet-Cookie: x=1', 'mail', '/a b', null, undefined]) assert.equal(safeReturn(bad), '', String(bad));
  void app; void fake;
});
