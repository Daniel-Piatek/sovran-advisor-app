// Gmail (gmail.js, advanced/mail/3): fill everything newer than the export, count both sides label by label, keep each
// attachment once. Stand-ins for Google (sign-in) and for Gmail's API; the mailbox is made up (scripts/demo-mail.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../../server.js';
import { fileKeyStore } from '../../google.js';
import { labelName } from '../../gmail.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';
import { startFakeGmail, messagesOf, mailboxOf } from '../fake-gmail.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const EMAIL = 'work@mypractice.com'; // who the fake Google signs in

async function setup(t, { newest = 17, filler = 60 } = {}) {
  const dataDir = tmp('gmail-data-');
  const storeDir = tmp('gmail-store-');
  const google = await startFakeGoogle();
  const everything = messagesOf(makeMailbox({ filler }).text).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const gmail = await startFakeGmail({ messages: everything, email: EMAIL });
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, google: { env: { ...google.env, ...gmail.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gmail.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const signIn = async (connected) => {
    const toGoogle = await fetch(connected.url, { redirect: 'manual' });
    await fetch(toGoogle.headers.get('location'), { redirect: 'manual' });
  };
  // Signed in with Google, Read your mail on.
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await signIn((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  await signIn((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true })).body);
  // The export: everything but the newest `newest`, read from a Takeout file.
  const exported = everything.slice(0, everything.length - newest);
  const upload = await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: EMAIL })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'takeout.mbox' }, body: Buffer.from(mailboxOf(exported)),
  });
  assert.equal(upload.status, 200);
  const overview = (await json('GET', '/api/mail')).body;
  return { app, dataDir, google, gmail, json, everything, exported, mailId: overview.accounts[0].id, overview };
}

test('Gmail’s own label ids are named as Takeout names them', () => {
  assert.deepEqual([{ id: 'INBOX', type: 'system' }, { id: 'CATEGORY_PROMOTIONS', type: 'system' }, { id: 'Label_3', name: 'Finance', type: 'user' }].map(labelName), ['Inbox', 'Category Promotions', 'Finance']);
});

test('the fill brings in what is newer than the export; running it twice adds nothing', async (t) => {
  const { json, gmail, mailId, overview } = await setup(t);
  assert.equal(overview.messages, 51);
  assert.deepEqual([overview.accounts[0].signed_in, overview.accounts[0].can_read], [true, true]);

  const first = await json('POST', '/api/mail/fill', { account_id: mailId });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.added, first.body.already_here, first.body.read], [17, 0, 17]);
  assert.equal((await json('GET', '/api/mail')).body.messages, 68);
  assert.ok(gmail.seen.every((c) => /^Bearer access-/.test(c.auth)), 'every call carried the sign-in');
  assert.ok(gmail.seen.some((c) => c.path === '/users/me/messages' && c.query.pageToken), 'a long list is read page by page');
  assert.ok(gmail.seen.some((c) => c.query.format === 'raw'));

  const calls = gmail.seen.length;
  const second = await json('POST', '/api/mail/fill', { account_id: mailId });
  assert.deepEqual([second.body.added, second.body.read], [0, 0]);
  assert.equal(gmail.seen.slice(calls).filter((c) => c.query.format === 'raw').length, 0, 'nothing already kept is read twice');
  assert.equal((await json('GET', '/api/mail')).body.messages, 68);
  const log = (await json('GET', '/api/google')).body.log.map((l) => l.what);
  assert.ok(log.some((w) => /Fill from Gmail used “Read your mail”/.test(w)));
});

test('a filled message keeps Gmail’s own id, thread and labels, in its conversation', async (t) => {
  const { json, mailId, everything } = await setup(t);
  await json('POST', '/api/mail/fill', { account_id: mailId });
  const newestOne = everything.at(-1);
  const threads = (await json('GET', '/api/mail/threads?limit=200')).body;
  const thread = (await json('GET', `/api/mail/threads/${threads[0].id}`)).body;
  const kept = thread.messages.find((m) => m.gmail_id === newestOne.id);
  assert.ok(kept, 'found by Gmail’s id');
  assert.deepEqual(kept.labels, newestOne.labels);
});

test('counted on both sides: equal after the fill; a row gone shows one to fill, and the fill makes it equal again', async (t) => {
  const { json, mailId, dataDir } = await setup(t);
  const before = (await json('POST', '/api/mail/count-check', { account_id: mailId })).body;
  assert.equal(before.equal, false);
  assert.deepEqual([before.total.gmail, before.total.ours], [68, 51]);
  assert.ok(before.rows.some((r) => r.to_fill > 0));

  await json('POST', '/api/mail/fill', { account_id: mailId });
  const after = (await json('POST', '/api/mail/count-check', { account_id: mailId })).body;
  assert.equal(after.equal, true);
  assert.deepEqual([after.total.gmail, after.total.ours, after.total.equal], [68, 68, true]);
  assert.ok(after.rows.length >= 9);
  assert.equal(after.rows.every((r) => r.gmail === r.ours), true);

  // Delete one row on purpose (really, as a test would): its labels show one to fill.
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  const gone = db.prepare("SELECT id, labels FROM mail_messages WHERE subject LIKE 'Invoice%'").get();
  db.prepare('DELETE FROM mail_messages WHERE id = ?').run(gone.id);
  db.close();
  const missing = (await json('POST', '/api/mail/count-check', { account_id: mailId })).body;
  assert.equal(missing.equal, false);
  for (const name of JSON.parse(gone.labels)) assert.equal(missing.rows.find((r) => r.label === name).to_fill, 1, name);
  assert.equal((await json('POST', '/api/mail/fill', { account_id: mailId })).body.added, 0, 'newer only: an old hole is not in its window');
  const refilled = await json('POST', '/api/mail/fill', { account_id: mailId, everything: true });
  assert.equal(refilled.body.added, 1);
  assert.equal((await json('POST', '/api/mail/count-check', { account_id: mailId })).body.equal, true);
});

test('an attachment is kept once in the files, however many mails carry it', async (t) => {
  const { json, mailId, dataDir } = await setup(t, { newest: 17 });
  await json('POST', '/api/mail/fill', { account_id: mailId });
  const overview = (await json('GET', '/api/mail')).body;
  assert.ok(overview.attachments.links >= 2, 'the brief and the invoice');
  assert.equal(overview.attachments.files, 1, 'the same made-up PDF in two mails is one file');
  const filesDir = path.join(dataDir, 'files');
  assert.equal(fs.readdirSync(filesDir).filter((f) => !f.startsWith('.')).length, 1);
  const threads = (await json('GET', '/api/mail/threads?q=brief')).body;
  const thread = (await json('GET', `/api/mail/threads/${threads[0].id}`)).body;
  const [file] = thread.messages.find((m) => m.attachments.includes('launch-brief.pdf')).attachment_files;
  assert.equal(file.name, 'launch-brief.pdf');
  assert.equal(fs.readFileSync(path.join(filesDir, file.sha256), 'utf8'), '%PDF-1.4 a made-up file');
});

test('without “Read your mail”, or without a sign-in, nothing is asked of Gmail', async (t) => {
  const { json, mailId, gmail } = await setup(t);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: false });
  const calls = gmail.seen.length;
  const refused = await json('POST', '/api/mail/fill', { account_id: mailId });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Read your mail/);
  assert.equal((await json('POST', '/api/mail/count-check', { account_id: mailId })).status, 409);
  assert.equal(gmail.seen.length, calls);
  assert.equal((await json('GET', '/api/mail')).body.accounts[0].can_read, false);
  assert.equal((await json('POST', '/api/mail/fill', { account_id: 'nope' })).status, 404);
});

test('Gmail not answering is said plainly, and what was kept stays', async (t) => {
  const { json, mailId, gmail } = await setup(t);
  gmail.offline = true;
  const down = await json('POST', '/api/mail/fill', { account_id: mailId });
  assert.equal(down.status, 502);
  assert.match(down.body.error, /could not be reached/);
  assert.equal((await json('GET', '/api/mail')).body.messages, 51);
  assert.equal((await json('GET', '/api/mail/import/status')).body.running, false);
  assert.deepEqual((await json('GET', '/api/mail')).body.imports.map((i) => [i.filename, i.status]), [['takeout.mbox', 'done']]); // it failed before it began: nothing to mark
  gmail.offline = false;
  assert.equal((await json('POST', '/api/mail/fill', { account_id: mailId })).body.added, 17);
});
