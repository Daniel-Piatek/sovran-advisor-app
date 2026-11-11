// Mail (mail.js, advanced/mail/2): a Takeout .mbox read into the app's own tables, once, safe to run twice,
// and the API that streams a file in. Everything is made up (scripts/demo-mail.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, prepareDatabase, SCHEMA_VERSION } from '../../db.js';
import { startServer } from '../../server.js';
import { listModules } from '../../modules.js';
import { importMboxText, mailOverview, listThreads, getThread, findOrCreateAccount, checkAccountEmail, settleImports } from '../../mail.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const ME = 'demo@example.com';

test('schema 39 moves an older database: the mail tables are new, every row is kept', () => {
  const dir = tmp('mail-old-');
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', '')");
  db.exec('DROP TABLE mail_imports; DROP TABLE mail_labels; DROP TABLE mail_messages; DROP TABLE mail_threads; DROP TABLE mail_accounts; PRAGMA user_version = 38;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const table of ['mail_accounts', 'mail_threads', 'mail_messages', 'mail_labels', 'mail_imports']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Mail module declares its permissions and its tables, and every one of them exists', () => {
  const db = emptyDb();
  const mail = listModules(db).find((m) => m.id === 'mail');
  assert.deepEqual(mail.permissions, ['mail.read', 'mail.send', 'mail.modify']);
  assert.deepEqual(mail.tables.filter((t) => t.startsWith('mail_')), ['mail_accounts', 'mail_threads', 'mail_messages', 'mail_labels', 'mail_imports', 'mail_outbox', 'mail_senders', 'mail_sends', 'mail_opens', 'mail_confirm_people']);
  for (const table of mail.tables) assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1, table);
});

test('addresses are checked and one account is made once per address', () => {
  const db = emptyDb();
  assert.equal(checkAccountEmail(' Ana@Example.com '), 'ana@example.com');
  for (const bad of ['', 'nobody', 'a@b', 'a b@c.de', null]) assert.equal(checkAccountEmail(bad), null);
  const a = findOrCreateAccount(db, 'Demo@Example.com');
  assert.equal(findOrCreateAccount(db, 'demo@example.com'), a);
  assert.throws(() => findOrCreateAccount(db, 'no'), /Which address/);
  // an account made for a signed-in Google account is joined to it
  db.exec("INSERT INTO google_accounts (id, created_at, updated_at, email) VALUES ('g1', 'a', 'a', 'ana@example.com')");
  const b = findOrCreateAccount(db, 'ana@example.com');
  assert.equal(db.prepare('SELECT google_account_id FROM mail_accounts WHERE id = ?').get(b).google_account_id, 'g1');
});

test('a file is read into accounts, threads, messages and labels, and the counts agree', () => {
  const db = emptyDb();
  const { text, total } = makeMailbox();
  const result = importMboxText(db, text, { email: ME, filename: 'demo.mbox', size: text.length });
  assert.deepEqual([total, result.read, result.added, result.already_here, result.skipped], [1284, 1284, 1284, 0, 0]);
  const overview = mailOverview(db);
  assert.equal(overview.messages, 1284);
  assert.equal(overview.labels.length, 9);
  assert.equal(overview.labels.find((l) => l.name === 'Inbox').count, 1122);
  assert.equal(overview.labels.find((l) => l.name === 'Category Promotions').kind, 'category');
  assert.equal(overview.labels.find((l) => l.name === 'Finance').kind, 'user');
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_labels').get().n, 9);
  // every message is an imported row with the base columns, and every thread's count is the messages it holds
  assert.equal(db.prepare("SELECT count(*) AS n FROM mail_messages WHERE origin <> 'imported' OR deleted_at IS NOT NULL").get().n, 0);
  assert.equal(db.prepare('SELECT sum(message_count) AS n FROM mail_threads').get().n, 1284);
  assert.deepEqual(overview.imports.map((i) => [i.filename, i.status, i.read, i.added, i.account]), [['demo.mbox', 'done', 1284, 1284, ME]]);
});

test('the five conversations: who wrote, how many messages, attachments, encodings', () => {
  const db = emptyDb();
  importMboxText(db, makeMailbox().text, { email: ME, filename: 'demo.mbox' });
  const find = (q) => listThreads(db, { q })[0];

  const lena = getThread(db, find('onboarding').id);
  assert.deepEqual([lena.subject, lena.message_count, lena.participants], ['Onboarding call on Thursday?', 3, ['Demo Owner', 'Lena Fischer']]);
  assert.deepEqual(lena.messages.map((m) => m.from.name), ['Demo Owner', 'Lena Fischer', 'Demo Owner']);
  assert.match(lena.messages[1].text, /^Thursday works\. I will send the drafts before - the new palette is nice/);
  assert.deepEqual(lena.messages[1].labels, ['Inbox', 'Important', 'Projects']);
  assert.deepEqual(lena.messages[0].to, [{ name: 'Lena Fischer', email: 'lena@nordlicht.example' }]);

  const jonas = getThread(db, find('brief').id);
  assert.equal(jonas.message_count, 2);
  assert.deepEqual(jonas.messages[0].attachments, ['launch-brief.pdf']);
  assert.deepEqual(jonas.messages[0].cc, [{ name: 'Mara Klein', email: 'mara@example.com' }]);

  const invoice = getThread(db, find('invoice').id);
  assert.equal(invoice.messages[0].text, 'Your invoice 2026-114 for 120.00 EUR is attached. Payable within 14 days.'); // base64
  assert.deepEqual([invoice.messages[0].attachments, invoice.messages[0].labels], [['invoice-2026-114.pdf'], ['Inbox', 'Starred', 'Finance']]);

  const digest = getThread(db, find('ideas').id);
  assert.equal(digest.messages[0].text, 'Five ideas\nFish & chips, café notes and a question: what did you ship?\nRead it on deepwork.news\nRead more'); // html only

  const invite = getThread(db, find('Gartenfest').id);
  assert.equal(invite.subject, 'Eingeladen: Gartenfest 🌟'); // an encoded subject
  assert.equal(invite.messages[0].from.name, 'Zoë Dubois');
});

test('reading the same file again, or a newer export, adds only what is new; a deleted message stays deleted', () => {
  const db = emptyDb();
  const first = makeMailbox({ filler: 30 });
  importMboxText(db, first.text, { email: ME, filename: 'first.mbox' });
  const again = importMboxText(db, first.text, { email: ME, filename: 'again.mbox' });
  assert.deepEqual([again.read, again.added, again.already_here], [38, 0, 38]);
  assert.equal(mailOverview(db).messages, 38);

  const newer = makeMailbox({ filler: 36 });
  const grown = importMboxText(db, newer.text, { email: ME, filename: 'newer.mbox' });
  assert.deepEqual([grown.read, grown.added, grown.already_here], [44, 6, 38]);
  assert.equal(mailOverview(db).messages, 44);
  assert.equal(db.prepare('SELECT sum(message_count) AS n FROM mail_threads').get().n, 44);

  db.exec("UPDATE mail_messages SET deleted_at = '2026-11-09T00:00:00.000Z' WHERE subject LIKE 'Brief for%'");
  const third = importMboxText(db, newer.text, { email: ME, filename: 'third.mbox' });
  assert.deepEqual([third.added, third.already_here], [0, 44]);
  assert.equal(mailOverview(db).messages, 43); // the deleted one is not shown, and not made again
  assert.equal(mailOverview(db).imports.length, 4);
});

test('the same mail for another address is kept apart', () => {
  const db = emptyDb();
  const { text } = makeMailbox({ filler: 5 });
  importMboxText(db, text, { email: ME, filename: 'a.mbox' });
  const other = importMboxText(db, text, { email: 'other@example.com', filename: 'b.mbox' });
  assert.equal(other.added, 13);
  assert.equal(mailOverview(db).messages, 26);
  assert.equal(mailOverview(db, { account: other.account_id }).messages, 13);
  assert.equal(listThreads(db, { account: other.account_id }).every((t) => t.account === 'other@example.com'), true);
});

test('without Gmail’s ids a message is found by its Message-ID, and a reply joins the conversation it answers', () => {
  const db = emptyDb();
  const file = [
    'From someone@x.example Mon Nov 09 10:00:00 +0000 2026', 'Message-ID: <one@x.example>', 'From: A <a@x.example>', 'To: b@x.example', 'Subject: Plan', 'Date: Mon, 09 Nov 2026 10:00:00 +0000', '', 'The plan.', '',
    'From someone@x.example Mon Nov 09 11:00:00 +0000 2026', 'Message-ID: <two@x.example>', 'In-Reply-To: <one@x.example>', 'From: B <b@x.example>', 'To: a@x.example', 'Subject: Re: Plan', 'Date: Mon, 09 Nov 2026 11:00:00 +0000', '', 'Yes.', '',
    'From someone@x.example Mon Nov 09 12:00:00 +0000 2026', 'From: C <c@x.example>', 'Subject: Without any id', 'Date: Mon, 09 Nov 2026 12:00:00 +0000', '', 'Nothing to identify me but my text.', '',
  ].join('\n');
  const r = importMboxText(db, file, { email: ME, filename: 'plain.mbox' });
  assert.deepEqual([r.added, mailOverview(db).threads], [3, 2]);
  assert.equal(listThreads(db, { q: 'plan' })[0].message_count, 2);
  const again = importMboxText(db, file, { email: ME, filename: 'plain-again.mbox' });
  assert.deepEqual([again.added, again.already_here], [0, 3]); // the one with no id is found by its content
  assert.deepEqual(db.prepare('SELECT gmail_id FROM mail_messages').all().map((r2) => r2.gmail_id), ['', '', '']);
});

test('a message that cannot be read is counted and left out; the rest goes in', () => {
  const db = emptyDb();
  const { text } = makeMailbox({ filler: 2 });
  const broken = `${text}\nFrom 5@xxx Tue Mar 09 12:00:00 +0000 2021\n\n\n`;
  const r = importMboxText(db, broken, { email: ME, filename: 'x.mbox' });
  assert.equal(r.added + r.skipped, r.read);
  assert.ok(r.added >= 10);
});

test('lists: by label, by words, newest first, with a page', () => {
  const db = emptyDb();
  importMboxText(db, makeMailbox().text, { email: ME, filename: 'demo.mbox' });
  const events = listThreads(db, { label: 'Events', limit: 200 });
  assert.ok(events.length > 50);
  assert.equal(events.some((t) => t.subject.startsWith('Eingeladen')), true);
  const all = listThreads(db, { limit: 200 });
  assert.deepEqual(all.map((t) => t.last_at), [...all.map((t) => t.last_at)].sort().reverse());
  const older = listThreads(db, { before: all[9].last_at, limit: 5 });
  assert.equal(older.length, 5);
  assert.equal(older.every((t) => t.last_at < all[9].last_at), true);
  assert.deepEqual(listThreads(db, { q: 'zoë gartenfest' }).map((t) => t.subject), ['Eingeladen: Gartenfest 🌟']);
  assert.deepEqual(listThreads(db, { q: '100%' }), []);
  assert.equal(getThread(db, 'no-such'), null);
});

test('interrupted imports are marked when the app starts again', () => {
  const db = emptyDb();
  const account = findOrCreateAccount(db, ME);
  db.prepare("INSERT INTO mail_imports (id, created_at, updated_at, account_id, filename, status) VALUES ('i1', 'a', 'a', ?, 'big.mbox', 'running')").run(account);
  settleImports(db);
  assert.equal(db.prepare("SELECT status FROM mail_imports WHERE id = 'i1'").get().status, 'interrupted');
});

// ---- The API ----

async function server(t) {
  const dataDir = tmp('mail-api-');
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = async (url) => (await fetch(app.url + url)).json();
  const upload = (body, { account = ME, name = 'takeout.mbox', headers = {}, signal } = {}) => fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(name ? { 'X-File-Name': encodeURIComponent(name) } : {}), ...headers }, body, duplex: 'half', signal,
  });
  return { app, get, upload };
}

test('the API reads an uploaded file as it arrives, and answers with the counts per label', async (t) => {
  const { get, upload } = await server(t);
  const { text } = makeMailbox({ filler: 60 });
  const res = await upload(Buffer.from(text));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.read, body.added, body.already_here], [68, 68, 0]);
  assert.ok(body.labels.Inbox > 40);
  const overview = await get('/api/mail');
  assert.equal(overview.messages, 68);
  assert.equal(overview.labels.length, 9);
  assert.equal(overview.imports[0].filename, 'takeout.mbox');
  assert.equal(overview.accounts[0].email, ME);
  assert.deepEqual(overview.labels.map((l) => l.count), [...overview.labels.map((l) => l.count)].sort((a, b) => b - a));
  const threads = await get('/api/mail/threads?q=onboarding');
  const thread = await get(`/api/mail/threads/${threads[0].id}`);
  assert.equal(thread.messages.length, 3);
  const status = await get('/api/mail/import/status');
  assert.deepEqual([status.running, status.read, status.added, status.filename, status.problem], [false, 68, 68, 'takeout.mbox', '']);
});

test('while a file is being read the page can ask how far it is, and a second file waits', async (t) => {
  const { get, upload } = await server(t);
  const { text } = makeMailbox({ filler: 400 });
  const bytes = Buffer.from(text);
  const half = bytes.length >> 1;
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < half; i += 50_000) controller.enqueue(bytes.subarray(i, Math.min(i + 50_000, half)));
      await stalled;
      for (let i = half; i < bytes.length; i += 50_000) controller.enqueue(bytes.subarray(i, Math.min(i + 50_000, bytes.length)));
      controller.close();
    },
  });
  const first = upload(stream, { headers: { 'Content-Length': String(bytes.length) } });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await get('/api/mail/import/status');
    if (status.running && status.read > 50) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(status.running, true);
  assert.ok(status.read > 50 && status.read < 408, `read so far: ${status.read}`);
  assert.ok(Object.keys(status.labels).length > 0);
  assert.equal(status.filename, 'takeout.mbox');
  const second = await upload(Buffer.from('From a@b Mon Nov 09 10:00:00 +0000 2026\n\nx'), { name: 'second.mbox' });
  assert.equal(second.status, 409);
  release();
  const done = await (await first).json();
  assert.equal(done.read, 408);
  assert.equal((await get('/api/mail')).messages, 408);
  assert.equal((await get('/api/mail/import/status')).running, false);
});

test('a file that stops coming is marked stopped, what came in stays, and reading it again goes on', async (t) => {
  const { get, upload } = await server(t);
  const { text } = makeMailbox({ filler: 400 });
  const bytes = Buffer.from(text);
  const abort = new AbortController();
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length / 2; i += 40_000) controller.enqueue(bytes.subarray(i, i + 40_000));
      // never closed: the connection is cut instead
    },
  });
  const cut = upload(stream, { signal: abort.signal, headers: { 'Content-Length': String(bytes.length) } }).catch((err) => err);
  for (let i = 0; i < 100; i++) {
    if ((await get('/api/mail/import/status')).read > 100) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  abort.abort();
  assert.equal((await cut).name, 'AbortError');
  let overview;
  for (let i = 0; i < 100; i++) {
    overview = await get('/api/mail');
    if (overview.imports[0]?.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(overview.imports[0].status, 'interrupted');
  assert.ok(overview.messages > 100 && overview.messages < 408, `kept so far: ${overview.messages}`);
  assert.equal((await get('/api/mail/import/status')).running, false);

  const rest = await (await upload(bytes, { name: 'takeout.mbox' })).json();
  assert.equal(rest.read, 408);
  assert.equal(rest.added, 408 - overview.messages);
  assert.equal((await get('/api/mail')).messages, 408);
  assert.equal((await get('/api/mail')).imports[0].status, 'done');
});

test('bad requests are refused in plain words', async (t) => {
  const { app, upload } = await server(t);
  assert.equal((await upload(Buffer.from('x'), { name: '' })).status, 400); // no file name
  const noAddress = await upload(Buffer.from('x'), { account: 'nobody' });
  assert.equal(noAddress.status, 400);
  assert.match((await noAddress.json()).error, /Which address/);
  for (const [method, url] of [['GET', '/api/mail/import'], ['POST', '/api/mail'], ['POST', '/api/mail/threads'], ['POST', '/api/mail/import/status']]) {
    assert.equal((await fetch(app.url + url, { method })).status, 405, `${method} ${url}`);
  }
  assert.equal((await fetch(`${app.url}/api/mail/threads/00000000-0000-0000-0000-000000000000`)).status, 404);
});
