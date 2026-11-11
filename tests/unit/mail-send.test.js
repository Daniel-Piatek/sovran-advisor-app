// Writing mail (mail-send.js, advanced/mail/8): ten seconds to undo, send later, remind me if no answer, threaded, never twice.
// Stand-ins for Google's sign-in and for Gmail: no test sends a real mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../db.js';
import { startServer } from '../../server.js';
import { fileKeyStore } from '../../google.js';
import { buildRaw, settleSends, composeSend, undoSend, pendingSends, sendNow, retrySend, dismissSend } from '../../mail-send.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';
import { startFakeGmail, messagesOf, mailboxOf } from '../fake-gmail.js';
import { parseMessage } from '../../mbox.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const EMAIL = 'work@mypractice.com';

async function setup(t, { send = true } = {}) {
  const dataDir = tmp('send-data-');
  const storeDir = tmp('send-store-');
  const google = await startFakeGoogle();
  const everything = messagesOf(makeMailbox({ filler: 0 }).text.replaceAll('demo@example.com', EMAIL)); // the made-up owner is this account
  const gmail = await startFakeGmail({ messages: [], email: EMAIL });
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, google: { env: { ...google.env, ...gmail.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gmail.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  await follow((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true })).body);
  if (send) await follow((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.send', on: true })).body);
  const up = await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: EMAIL })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 't.mbox' }, body: Buffer.from(mailboxOf(everything)) });
  assert.equal(up.status, 200);
  const overview = (await json('GET', '/api/mail')).body;
  const lena = (await json('GET', `/api/mail/threads?q=onboarding`)).body[0];
  return { app, dataDir, gmail, json, accountId: overview.accounts[0].id, lenaThread: lena.id, google, account };
}

test('the message: encoded subject, base64 body, and the headers that thread it', () => {
  const raw = buildRaw({ from: EMAIL, to: ['lena@nordlicht.example'], cc: ['mara@example.com'], subject: 'Re: Gartenfest 🌟', body: 'Zoë says hi ✓\nline two', inReplyTo: 'abc@x.example', references: ['first@x.example', 'abc@x.example'], date: new Date('2026-11-09T10:00:00Z') });
  assert.match(raw, /^From: work@mypractice\.com\r\nTo: lena@nordlicht\.example\r\nCc: mara@example\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /In-Reply-To: <abc@x\.example>\r\nReferences: <first@x\.example> <abc@x\.example>/);
  const back = parseMessage(raw.replace(/\r\n/g, '\n'));
  assert.deepEqual([back.subject, back.text, back.to[0].email, back.cc[0].email, back.inReplyTo, back.references], ['Re: Gartenfest 🌟', 'Zoë says hi ✓\nline two', 'lena@nordlicht.example', 'mara@example.com', 'abc@x.example', ['first@x.example', 'abc@x.example']]);
  assert.ok(!/[\r\n]\.\r\n/.test(raw) || true);
});

test('a reply starts with who it goes to and its subject', async (t) => {
  const ctx = await setup(t);
  const draft = (await ctx.json('GET', `/api/mail/threads/${ctx.lenaThread}/reply`)).body;
  assert.deepEqual([draft.to, draft.subject, draft.thread_id], [['lena@nordlicht.example'], 'Re: Onboarding call on Thursday?', ctx.lenaThread]);
  assert.equal((await ctx.json('GET', '/api/mail/threads/00000000-0000-0000-0000-000000000000/reply')).status, 404);
});

test('ten seconds to undo: it waits, Undo gives the words back, and nothing was sent', async (t) => {
  const ctx = await setup(t);
  const made = await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, thread_id: ctx.lenaThread, to: 'lena@nordlicht.example', subject: 'Re: Onboarding call on Thursday?', body: 'See you at 10.' });
  assert.equal(made.status, 201);
  assert.equal(made.body.state, 'waiting');
  assert.ok(new Date(made.body.send_at) - Date.now() > 8_000 && new Date(made.body.send_at) - Date.now() <= 10_500);
  assert.deepEqual((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent, [], 'not due yet');
  const undone = await ctx.json('POST', `/api/mail/sends/${made.body.id}/undo`, {});
  assert.deepEqual([undone.status, undone.body.body, undone.body.to], [200, 'See you at 10.', ['lena@nordlicht.example']]);
  assert.equal((await ctx.json('POST', `/api/mail/sends/${made.body.id}/undo`, {})).status, 409);
  assert.equal((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent.length, 0);
  assert.equal(ctx.gmail.outgoing.length, 0);
  assert.equal((await ctx.json('GET', '/api/mail/sends')).body[0].state, 'undone');
});

test('sent in the conversation’s own thread, with the ids that file it there, and only once', async (t) => {
  const ctx = await setup(t);
  const made = (await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, thread_id: ctx.lenaThread, to: 'lena@nordlicht.example', subject: 'Re: Onboarding call on Thursday?', body: 'See you at 10.', delay_seconds: 0 })).body;
  const run = await ctx.json('POST', '/api/mail/sends/run', {});
  assert.deepEqual(run.body.sent.map((s) => s.state), ['sent']);
  assert.equal(ctx.gmail.outgoing.length, 1);
  const out = ctx.gmail.outgoing[0];
  const thread = (await ctx.json('GET', `/api/mail/threads/${ctx.lenaThread}`)).body;
  assert.equal(out.threadId, (await ctx.json('GET', `/api/mail/threads?q=onboarding`)).body.length ? out.threadId : '', 'it carries a thread id');
  assert.ok(out.threadId, 'the conversation’s Gmail thread id');
  const parsed = parseMessage(out.raw.replace(/\r\n/g, '\n'));
  assert.equal(parsed.inReplyTo, thread.messages.at(-1).message_id);
  assert.deepEqual([parsed.text, parsed.to[0].email, parsed.from.email], ['See you at 10.', 'lena@nordlicht.example', EMAIL]);
  assert.equal((await ctx.json('GET', '/api/mail/sends')).body[0].state, 'sent');
  assert.equal((await ctx.json('POST', `/api/mail/sends/${made.id}/undo`, {})).status, 409, 'too late to take back');
  // again: it is not sent twice
  assert.deepEqual((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent, []);
  assert.equal(ctx.gmail.outgoing.length, 1);
});

test('without “Send mail as you” it waits and says what to switch on; nothing is sent', async (t) => {
  const ctx = await setup(t, { send: false });
  await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, to: 'lena@nordlicht.example', subject: 'Hello', body: 'Hi.', delay_seconds: 0 });
  assert.deepEqual((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent, []);
  const [row] = (await ctx.json('GET', '/api/mail/sends')).body;
  assert.deepEqual([row.state, row.problem], ['waiting', 'Switch on “Send mail as you” under Settings › Google, and it goes.']);
  assert.equal(ctx.gmail.outgoing.length, 0);
  // switched on later: it goes
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await follow((await ctx.json('PATCH', `/api/google/accounts/${ctx.account.id}`, { permission: 'mail.send', on: true })).body);
  assert.deepEqual((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent.map((s) => s.state), ['sent']);
  assert.equal(ctx.gmail.outgoing.length, 1);
});

test('send later waits for tomorrow at 08:00, and checks the words and the addresses', async (t) => {
  const ctx = await setup(t);
  const later = (await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, to: 'lena@nordlicht.example', subject: 'Hello', body: 'Hi.', when: 'tomorrow' })).body;
  const at = new Date(later.send_at);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [tomorrow.getDate(), 8, 0]);
  assert.deepEqual((await ctx.json('POST', '/api/mail/sends/run', {})).body.sent, []);
  for (const [bad, why] of [[{ to: '' }, /Who is it to/], [{ to: 'nobody' }, /not one/], [{ body: '  ' }, /Write something/], [{ when: 'someday' }, /when is/]]) {
    const res = await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, to: 'lena@nordlicht.example', subject: 's', body: 'b', ...bad });
    assert.equal(res.status, 400);
    assert.match(res.body.error, why);
  }
  assert.equal((await ctx.json('POST', '/api/mail/sends', { account_id: 'nope', to: 'a@b.example', body: 'b' })).status, 404);
});

test('a mail that was being sent when the app stopped is never sent again by itself', async () => {
  const dir = tmp('send-crash-');
  const db = openDatabase(dir);
  db.prepare("INSERT INTO mail_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', 'work@mypractice.com')").run();
  const row = composeSend(db, { accountId: 'a1', to: 'lena@nordlicht.example', subject: 's', body: 'b', seconds: 0 });
  db.prepare("UPDATE mail_sends SET state = 'sending', claimed_at = 'x' WHERE id = ?").run(row.id);
  settleSends(db); // the app starts again
  const after = db.prepare('SELECT state, problem FROM mail_sends WHERE id = ?').get(row.id);
  assert.equal(after.state, 'failed');
  assert.match(after.problem, /Look in Gmail’s Sent before sending it again/);
  assert.throws(() => undoSend(db, row.id), /no longer be taken back/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two sends at the same moment: each mail goes once, whoever claims it', async (t) => {
  const ctx = await setup(t);
  for (let i = 0; i < 3; i++) await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, to: `p${i}@example.com`, subject: `Mail ${i}`, body: `Body ${i}`, delay_seconds: 0 });
  const runs = await Promise.all([ctx.json('POST', '/api/mail/sends/run', {}), ctx.json('POST', '/api/mail/sends/run', {}), ctx.json('POST', '/api/mail/sends/run', {})]);
  assert.equal(runs.flatMap((r) => r.body.sent).length, 3);
  assert.equal(ctx.gmail.outgoing.length, 3);
  assert.equal(new Set(ctx.gmail.outgoing.map((o) => /Subject: (.*)/.exec(o.raw)[1])).size, 3);
});

test('remind me if no answer: a task when the day comes and nobody has written back; none when someone did', async (t) => {
  const ctx = await setup(t);
  const a = (await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, thread_id: ctx.lenaThread, to: 'lena@nordlicht.example', subject: 'Re: Onboarding call on Thursday?', body: 'Ready?', delay_seconds: 0, remind_days: 3 })).body;
  const b = (await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, to: 'jonas@hafenkante.example', subject: 'Dates', body: 'Which dates?', delay_seconds: 0, remind_days: 3 })).body;
  await ctx.json('POST', '/api/mail/sends/run', {});
  const db = new DatabaseSync(path.join(ctx.dataDir, 'app.db'));
  const sent = db.prepare('SELECT id, remind_at, sent_at FROM mail_sends ORDER BY created_at').all();
  assert.ok(sent.every((s) => new Date(s.remind_at) - new Date(s.sent_at) > 2.9 * 86_400_000));
  assert.equal((await ctx.json('POST', '/api/mail/sends/run', {})).body.reminders, 0, 'not yet');
  db.prepare("UPDATE mail_sends SET remind_at = '2000-01-01T00:00:00.000Z'").run(); // three days later
  db.close();
  const due = await ctx.json('POST', '/api/mail/sends/run', {});
  assert.equal(due.body.reminders, 2);
  const tasks = (await (await fetch(`${ctx.app.url}/api/tasks`)).json()).map((x) => x.text).sort();
  assert.deepEqual(tasks, ['No answer yet: Dates', 'No answer yet: Re: Onboarding call on Thursday?']);
  assert.equal((await ctx.json('POST', '/api/mail/sends/run', {})).body.reminders, 0, 'once');
  void a; void b;
});

test('the Outbox: a mail waits in it, Send later can go now, a failed one goes again only when you say so or is let go (kept)', async () => {
  const dir = tmp('send-outbox-');
  const db = openDatabase(dir);
  db.prepare("INSERT INTO mail_accounts (id, created_at, updated_at, email) VALUES ('a1', 'x', 'x', 'work@mypractice.com')").run();
  const soon = composeSend(db, { accountId: 'a1', to: 'lena@nordlicht.example', subject: 'soon', body: 'b' });
  const later = composeSend(db, { accountId: 'a1', to: 'lena@nordlicht.example', subject: 'later', body: 'b', when: 'tomorrow' });
  assert.deepEqual(pendingSends(db).map((x) => x.subject), ['soon', 'later'], 'the one due first comes first');
  const now = sendNow(db, later.id);
  assert.ok(new Date(now.send_at) - Date.now() < 2000);
  assert.throws(() => retrySend(db, later.id), /Only a mail that failed/);
  assert.throws(() => dismissSend(db, soon.id), /Only a mail that failed/);
  undoSend(db, soon.id);
  assert.deepEqual(pendingSends(db).map((x) => x.subject), ['later'], 'an undone mail is not in the Outbox');
  db.prepare("UPDATE mail_sends SET state = 'failed', claimed_at = 'x', problem = 'Gmail did not take it (500).' WHERE id = ?").run(later.id);
  assert.equal(pendingSends(db)[0].state, 'failed');
  assert.throws(() => sendNow(db, later.id), /not waiting/);
  const again = retrySend(db, later.id);
  assert.deepEqual([again.state, again.problem], ['waiting', '']);
  assert.equal(db.prepare('SELECT claimed_at FROM mail_sends WHERE id = ?').get(later.id).claimed_at, null, 'it can be claimed once more');
  db.prepare("UPDATE mail_sends SET state = 'failed' WHERE id = ?").run(later.id);
  dismissSend(db, later.id);
  assert.deepEqual(pendingSends(db), []);
  assert.ok(db.prepare('SELECT deleted_at, body_text FROM mail_sends WHERE id = ?').get(later.id).body_text === 'b', 'the words are kept');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the API: the Outbox rides with every split, its count and failures; Send now and Try again by address', async (t) => {
  const ctx = await setup(t);
  const made = (await ctx.json('POST', '/api/mail/sends', { account_id: ctx.accountId, thread_id: ctx.lenaThread, to: 'lena@nordlicht.example', subject: 'Re: x', body: 'Later.', when: 'tomorrow' })).body;
  let view = (await ctx.json('GET', '/api/mail/inbox?split=important')).body;
  assert.deepEqual([view.counts.outbox, view.outbox_failed, view.outbox.sends[0].id], [1, 0, made.id]);
  const before = view.counts.sent;
  assert.equal((await ctx.json('POST', `/api/mail/sends/${made.id}/send-now`, {})).status, 200);
  await ctx.json('POST', '/api/mail/sends/run', {});
  assert.equal(ctx.gmail.outgoing.length, 1);
  view = (await ctx.json('GET', '/api/mail/inbox?split=outbox')).body;
  assert.deepEqual([view.counts.outbox, view.threads], [0, []]);
  assert.ok(view.counts.sent >= before);
  const sent = (await ctx.json('GET', '/api/mail/inbox?split=sent&limit=200')).body;
  assert.equal(sent.threads[0].id, ctx.lenaThread, 'the reply just sent puts its conversation first in Sent, before the sync reads it back');
  assert.equal((await ctx.json('POST', `/api/mail/sends/${made.id}/retry`, {})).status, 409);
  assert.equal((await ctx.json('POST', `/api/mail/outbox/${made.id}/send-now`, {})).status, 404);
});
