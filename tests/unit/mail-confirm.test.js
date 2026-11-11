// Read confirmations (mail-confirm.js, advanced/mail/9): Opened, never Read; scanners listed and not counted; off by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { startServer } from '../../server.js';
import { fileKeyStore } from '../../google.js';
import { buildRaw, composeSend } from '../../mail-send.js';
import { classifyOpen, recordOpen, confirmationsOf, setPixelBase, pixelBase, defaultFor, rememberPeople, PIXEL, EARLY_SECONDS } from '../../mail-confirm.js';
import { parseMessage } from '../../mbox.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';
import { startFakeGmail, messagesOf, mailboxOf } from '../fake-gmail.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const EMAIL = 'work@mypractice.com';
const sentAt = '2026-11-09T10:00:00.000Z';
const at = (seconds) => new Date(new Date(sentAt).getTime() + seconds * 1000);

test('what a fetch means: a person’s counts; a scanner, a privacy proxy and a fetch right after sending do not', () => {
  assert.deepEqual(classifyOpen({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit Safari', sentAt, at: at(3600) }), { kind: 'opened', counted: true, why: '' });
  assert.equal(classifyOpen({ userAgent: 'Mozilla/5.0 Proofpoint URL Defense', sentAt, at: at(3600) }).kind, 'scanner');
  assert.equal(classifyOpen({ userAgent: 'python-requests/2.31', sentAt, at: at(3600) }).counted, false);
  assert.deepEqual(classifyOpen({ userAgent: 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)', sentAt, at: at(3600) }), { kind: 'proxy', counted: false, why: 'a privacy proxy' });
  const early = classifyOpen({ userAgent: 'Mozilla/5.0 Safari', sentAt, at: at(EARLY_SECONDS - 1) });
  assert.deepEqual([early.kind, early.counted], ['early', false]);
  assert.equal(classifyOpen({ userAgent: 'Mozilla/5.0 Safari', sentAt, at: at(EARLY_SECONDS + 1) }).counted, true);
});

test('the public address for the picture: https, or this computer; no path; nothing else', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  assert.equal(pixelBase(db), '');
  assert.equal(setPixelBase(db, 'https://mail.example.org/').base, 'https://mail.example.org');
  assert.equal(setPixelBase(db, 'http://127.0.0.1:3000').base, 'http://127.0.0.1:3000');
  for (const bad of ['http://example.org', 'https://example.org/path', 'ftp://x.example', 'example.org', 'https://a.example/?q=1', 'javascript:alert(1)']) assert.throws(() => setPixelBase(db, bad), /Give the address as https/, bad);
  assert.equal(setPixelBase(db, '').base, '');
  assert.equal(pixelBase(db), '');
});

test('the message with a confirmation has the picture in an html version, beside its text; without, it is text only', () => {
  const plain = buildRaw({ from: EMAIL, to: ['lena@nordlicht.example'], subject: 'Hello', body: 'Hi <b> & more' });
  assert.ok(!/multipart|<img/i.test(plain));
  const raw = buildRaw({ from: EMAIL, to: ['lena@nordlicht.example'], subject: 'Hello', body: 'Hi <b> & more', pixelUrl: 'https://mail.example.org/o/tok123.gif' });
  assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
  const back = parseMessage(raw.replace(/\r\n/g, '\n'));
  assert.equal(back.text, 'Hi <b> & more', 'the text version is untouched');
  assert.match(back.html, /<img src="https:\/\/mail\.example\.org\/o\/tok123\.gif" width="1" height="1"/);
  assert.match(back.html, /Hi &lt;b&gt; &amp; more/);
});

test('off by default, remembered per person; a mail with one needs the address, and says so without it', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  db.prepare("INSERT INTO mail_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', ?)").run(EMAIL);
  const base = { accountId: 'a1', to: 'lena@nordlicht.example', subject: 's', body: 'b' };
  assert.equal(composeSend(db, base).confirm, false);
  assert.equal(defaultFor(db, ['lena@nordlicht.example']), false, 'never on by itself');
  assert.throws(() => composeSend(db, { ...base, confirm: true }), (err) => err.code === 'no_pixel_base' && /public address/.test(err.message));
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_sends WHERE pixel_token IS NOT NULL').get().n, 0);
  setPixelBase(db, 'https://mail.example.org');
  const on = composeSend(db, { ...base, confirm: true });
  assert.equal(on.confirm, true);
  assert.match(db.prepare('SELECT pixel_token FROM mail_sends WHERE id = ?').get(on.id).pixel_token, /^[A-Za-z0-9_-]{20,40}$/);
  assert.equal(defaultFor(db, ['lena@nordlicht.example']), true, 'remembered for her');
  assert.equal(defaultFor(db, ['lena@nordlicht.example', 'jonas@hafenkante.example']), false, 'every person must have been chosen');
  composeSend(db, base); // the next one without: remembered as off
  assert.equal(defaultFor(db, ['lena@nordlicht.example']), false);
  rememberPeople(db, ['jonas@hafenkante.example'], true);
  assert.equal(defaultFor(db, ['Jonas@Hafenkante.example']), true);
});

test('opens are rows on the mail that was sent; an unknown token writes nothing', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  db.prepare("INSERT INTO mail_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', ?)").run(EMAIL);
  db.prepare("INSERT INTO mail_threads (id, created_at, updated_at, account_id, source_key) VALUES ('t1', 'x', 'x', 'a1', 't:1')").run();
  setPixelBase(db, 'https://mail.example.org');
  const row = composeSend(db, { accountId: 'a1', threadId: 't1', to: 'lena@nordlicht.example', subject: 'Re: Hello', body: 'b', confirm: true });
  const token = db.prepare('SELECT pixel_token FROM mail_sends WHERE id = ?').get(row.id).pixel_token;
  assert.equal(recordOpen(db, token, { userAgent: 'Safari', at: at(60) }), null, 'not sent yet: nothing to open');
  db.prepare("UPDATE mail_sends SET state = 'sent', sent_at = ? WHERE id = ?").run(sentAt, row.id);
  assert.equal(recordOpen(db, 'x'.repeat(24), { userAgent: 'Safari', at: at(60) }), null);
  assert.equal(recordOpen(db, 'short', { userAgent: 'Safari' }), null);
  recordOpen(db, token, { userAgent: 'Proofpoint', at: at(5) });
  recordOpen(db, token, { userAgent: 'Mozilla/5.0 Safari', at: at(3600) });
  recordOpen(db, token, { userAgent: 'Mozilla/5.0 Safari', at: at(7200) });
  const [c] = confirmationsOf(db, 't1');
  assert.deepEqual([c.subject, c.opened_at, c.opens], ['Re: Hello', at(3600).toISOString(), 2]);
  assert.deepEqual(c.not_counted.map((n) => [n.kind, n.why]), [['scanner', 'a mail scanner']]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_opens').get().n, 3);
});

test('the one public address: it answers the pixel to anyone, counts only what is real, and reaches nothing else of the app', async (t) => {
  const dataDir = tmp('confirm-data-');
  const storeDir = tmp('confirm-store-');
  const google = await startFakeGoogle();
  const gmail = await startFakeGmail({ messages: [], email: EMAIL });
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, google: { env: { ...google.env, ...gmail.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gmail.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  await json('PATCH', '/api/modules', { id: 'mail', on: true }); // off in a new install (Sovran Advisor)
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  for (const p of ['mail.read', 'mail.send']) await follow((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: p, on: true })).body);
  const text = makeMailbox({ filler: 0 }).text.replaceAll('demo@example.com', EMAIL);
  await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: EMAIL })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'x.mbox' }, body: Buffer.from(mailboxOf(messagesOf(text))) });
  const mail = (await json('GET', '/api/mail')).body.accounts[0];
  const thread = (await json('GET', '/api/mail/threads?q=onboarding')).body[0];

  assert.equal((await json('POST', '/api/mail/sends', { account_id: mail.id, thread_id: thread.id, to: 'lena@nordlicht.example', subject: 'Re: x', body: 'Hi', confirm: true })).status, 409);
  assert.equal((await json('PUT', '/api/mail/pixel-base', { base: 'ftp://x' })).status, 400);
  assert.equal((await json('PUT', '/api/mail/pixel-base', { base: app.url })).status, 200);
  assert.deepEqual((await json('GET', '/api/mail/confirmations')).body, { base: app.url, people: [] });
  const made = (await json('POST', '/api/mail/sends', { account_id: mail.id, thread_id: thread.id, to: 'lena@nordlicht.example', subject: 'Re: x', body: 'Hi', confirm: true, delay_seconds: 0 })).body;
  assert.equal(made.confirm, true);
  assert.equal((await json('POST', '/api/mail/sends/run', {})).body.sent.length, 1);
  const out = parseMessage(gmail.outgoing[0].raw.replace(/\r\n/g, '\n'));
  const pixel = /src="([^"]+\.gif)"/.exec(out.html)[1];
  assert.match(pixel, new RegExp(`^${app.url.replace(/\./g, '\\.')}/o/[A-Za-z0-9_-]{20,40}\\.gif$`));

  const hit = async (url, ua) => { const res = await fetch(url, { headers: { 'User-Agent': ua } }); return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: Buffer.from(await res.arrayBuffer()) }; };
  const first = await hit(pixel, 'Mozilla/5.0 Safari');
  assert.deepEqual([first.status, first.type, first.cache], [200, 'image/gif', 'no-store, max-age=0']);
  assert.ok(first.body.equals(PIXEL));
  const unknown = await hit(`${app.url}/o/${'z'.repeat(24)}.gif`, 'Safari');
  assert.ok(unknown.body.equals(PIXEL), 'the same picture for a token it does not know');
  await hit(pixel, 'Proofpoint');
  const shown = (await json('GET', `/api/mail/threads/${thread.id}`)).body.confirmations[0];
  assert.deepEqual([shown.opens, shown.not_counted.map((n) => n.kind).sort()], [0, ['early', 'scanner']], 'both fetches were within thirty seconds of sending');
  assert.equal((await fetch(`${app.url}/o/${'z'.repeat(24)}.png`)).headers.get('content-type') !== 'image/gif', true, 'only the .gif address is the picture');
  assert.deepEqual((await json('GET', '/api/mail/confirmations')).body.people, [{ email: 'lena@nordlicht.example', confirm: true }]);
});
