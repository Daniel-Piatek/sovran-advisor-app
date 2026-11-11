// Live with Gmail (mail-sync.js, advanced/mail/4): Gmail's changes in, yours out through the outbox, and both kept when both
// sides changed a mail. Stand-ins for Google's sign-in and for Gmail's API: nothing here touches the real ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';
import { fileKeyStore } from '../../google.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { startFakeGoogle, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';
import { startFakeGmail, messagesOf, mailboxOf } from '../fake-gmail.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const EMAIL = 'work@mypractice.com';

// Signed in, Read your mail on, the whole mailbox kept (a Takeout file of everything), Gmail holding the same.
async function setup(t, { modify = true } = {}) {
  const dataDir = tmp('sync-data-');
  const storeDir = tmp('sync-store-');
  const google = await startFakeGoogle();
  const everything = messagesOf(makeMailbox({ filler: 30 }).text).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const gmail = await startFakeGmail({ messages: everything.map((m) => ({ ...m, labels: [...m.labels] })), email: EMAIL });
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, google: { env: { ...google.env, ...gmail.env }, keyStore: fileKeyStore(storeDir) } });
  t.after(async () => { await app.close(); await google.close(); await gmail.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(storeDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await json('PUT', '/api/google/client', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow((await json('POST', '/api/google/connect', {})).body);
  const [account] = (await json('GET', '/api/google')).body.accounts;
  await follow((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.read', on: true })).body);
  if (modify) await follow((await json('PATCH', `/api/google/accounts/${account.id}`, { permission: 'mail.modify', on: true })).body);
  const upload = await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: EMAIL })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'takeout.mbox' }, body: Buffer.from(mailboxOf(everything)),
  });
  assert.equal(upload.status, 200);
  const mailId = (await json('GET', '/api/mail')).body.accounts[0].id;
  const rowFor = async (subjectStart) => {
    const threads = (await json('GET', `/api/mail/threads?q=${encodeURIComponent(subjectStart)}&limit=5`)).body;
    const thread = (await json('GET', `/api/mail/threads/${threads[0].id}`)).body;
    return thread.messages.at(-1);
  };
  const sync = () => json('POST', '/api/mail/sync', { account_id: mailId });
  return { app, gmail, google, json, mailId, rowFor, sync, everything, account };
}

const labelsOf = async (ctx, subject) => (await ctx.rowFor(subject)).labels;

test('the first round only notes where Gmail is; later rounds bring in what changed', async (t) => {
  const ctx = await setup(t);
  const first = await ctx.sync();
  assert.deepEqual([first.status, first.body.baseline, first.body.added, first.body.label_changes], [200, true, 0, 0]);
  const calls = ctx.gmail.seen.length;
  const idle = await ctx.sync();
  assert.deepEqual([idle.body.baseline, idle.body.added, idle.body.label_changes], [false, 0, 0]);
  assert.ok(ctx.gmail.seen.slice(calls).some((c) => c.path === '/users/me/history' && c.query.startHistoryId === '1000'));
  const state = (await ctx.json('GET', '/api/mail')).body.accounts[0].sync;
  assert.deepEqual([state.started, Boolean(state.synced_at), state.sync_error], [true, true, '']);
});

test('Gmail’s changes come in: a new mail, a label added, a label removed, a mail deleted', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const target = ctx.everything.find((m) => /^Invoice/.test(parseSubject(m)));
  // a new mail "arrives in Gmail" (a copy of an old one with a new id)
  const fresh = { ...ctx.everything[0], id: 'abc123def4567890', threadId: 'ffff000000000001', labels: ['Inbox'], sentAt: new Date().toISOString(), raw: ctx.everything[0].raw.replace(/^Message-ID:.*$/m, 'Message-ID: <fresh@demo.example>').replace(/^Subject:.*$/m, 'Subject: Just arrived') };
  ctx.gmail.receive(fresh);
  ctx.gmail.addLabel(target.id, 'Projects');
  ctx.gmail.removeLabel(target.id, 'Starred');
  const round = await ctx.sync();
  assert.deepEqual([round.body.added, round.body.label_changes], [1, 2]);
  const labels = await labelsOf(ctx, 'Invoice');
  assert.ok(labels.includes('Projects') && !labels.includes('Starred'));
  assert.deepEqual(await labelsOf(ctx, 'Just arrived'), ['Inbox']);

  ctx.gmail.delete(target.id);
  assert.equal((await ctx.sync()).body.deleted, 1);
  assert.equal((await ctx.json('GET', '/api/mail/threads?q=invoice')).body.length, 0);
  // again: nothing is applied twice
  const again = await ctx.sync();
  assert.deepEqual([again.body.added, again.body.label_changes, again.body.deleted], [0, 0, 0]);
});

const parseSubject = (m) => /^Subject: (.*)$/m.exec(m.raw)?.[1] ?? '';

test('a mail Gmail no longer has is skipped: the round still finishes and moves on', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const copy = (id, subject) => ({ ...ctx.everything[0], id, threadId: `f${id.slice(1)}`, labels: ['Inbox'], sentAt: new Date().toISOString(), raw: ctx.everything[0].raw.replace(/^Message-ID:.*$/m, `Message-ID: <${id}@demo.example>`).replace(/^Subject:.*$/m, `Subject: ${subject}`) });
  ctx.gmail.receive(copy('abc0000000000001', 'Gone before it was read'));
  ctx.gmail.receive(copy('abc0000000000002', 'Still here'));
  // deleted in Gmail without a history entry for it (Trash emptied): Gmail lists it as added, then answers 404 for it
  ctx.gmail.messages = ctx.gmail.messages.filter((m) => m.id !== 'abc0000000000001');
  const round = await ctx.sync();
  assert.equal(round.status, 200);
  assert.equal(round.body.added, 1);
  assert.equal((await ctx.json('GET', '/api/mail/threads?q=Still%20here')).body.length, 1);
  const state = (await ctx.json('GET', '/api/mail')).body.accounts[0].sync;
  assert.equal(state.sync_error, '');
  const calls = ctx.gmail.seen.length;
  await ctx.sync(); // the next round starts after it, not from the same place again
  const history = ctx.gmail.seen.slice(calls).find((c) => c.path === '/users/me/history');
  assert.equal(history.query.startHistoryId, String(ctx.gmail.historyId));
});

test('archive here: the list changes at once, the change waits in the outbox, then goes to Gmail, and is not echoed back', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const digest = await ctx.rowFor('This week');
  assert.ok(digest.labels.includes('Inbox'));
  const done = await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { remove: ['Inbox'] });
  assert.equal(done.status, 200);
  assert.equal(done.body.message.labels.includes('Inbox'), false, 'the list changed at once');
  let outbox = (await ctx.json('GET', '/api/mail/outbox')).body;
  assert.deepEqual(outbox.map((o) => [o.subject, o.remove, o.state]), [[digest.subject, ['Inbox'], 'waiting']]);
  assert.equal((await ctx.json('GET', '/api/mail')).body.accounts[0].sync.waiting, 1);
  assert.equal(ctx.gmail.sent.length, 0, 'not sent yet');

  const round = await ctx.sync();
  assert.equal(round.body.sent, 1);
  assert.deepEqual(ctx.gmail.sent, [{ id: digest.gmail_id, add: [], remove: ['Inbox'] }]);
  outbox = (await ctx.json('GET', '/api/mail/outbox')).body;
  assert.deepEqual([outbox[0].state, Boolean(outbox[0].sent_at)], ['sent', true]);

  const echo = await ctx.sync(); // Gmail now reports our own change: nothing changes, nothing is sent again
  assert.deepEqual([echo.body.label_changes, echo.body.sent], [0, 0]);
  assert.equal(ctx.gmail.sent.length, 1);
  assert.equal((await labelsOf(ctx, 'This week')).includes('Inbox'), false);
});

test('without “Change your mail in Gmail” the change only waits, and nothing is written to Gmail', async (t) => {
  const ctx = await setup(t, { modify: false });
  await ctx.sync();
  const digest = await ctx.rowFor('This week');
  await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { remove: ['Inbox'] });
  const round = await ctx.sync();
  assert.deepEqual([round.body.sent, round.body.waiting], [0, 1]);
  assert.match(round.body.problem, /Change your mail in Gmail/);
  assert.equal(ctx.gmail.seen.filter((c) => c.method === 'POST').length, 0);
});

test('with the network off the change waits and goes when it is back', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const digest = await ctx.rowFor('This week');
  await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { add: ['Starred'] });
  ctx.gmail.offline = true;
  assert.equal((await ctx.sync()).status, 502);
  assert.match((await ctx.json('GET', '/api/mail')).body.accounts[0].sync.sync_error, /could not be reached/);
  assert.equal((await ctx.json('GET', '/api/mail/outbox')).body[0].state, 'waiting');
  ctx.gmail.offline = false;
  const back = await ctx.sync();
  assert.equal(back.body.sent, 1);
  assert.deepEqual(ctx.gmail.sent, [{ id: digest.gmail_id, add: ['Starred'], remove: [] }]);
  assert.equal((await ctx.json('GET', '/api/mail')).body.accounts[0].sync.sync_error, '');
});

test('both changed it: a star here and a label there are both kept; the same label on both sides goes to Gmail', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const brief = await ctx.rowFor('Brief for');
  await ctx.json('POST', `/api/mail/messages/${brief.id}/labels`, { add: ['Starred'] }); // here, not sent yet
  ctx.gmail.addLabel(brief.gmail_id, 'Events'); // in Gmail, the same minute
  const merged = await ctx.sync();
  assert.equal(merged.body.sent, 1);
  const labels = await labelsOf(ctx, 'Brief for');
  assert.ok(labels.includes('Starred') && labels.includes('Events'), `both kept: ${labels}`);
  assert.ok(ctx.gmail.messages.find((m) => m.id === brief.gmail_id).labels.includes('Starred'), 'ours reached Gmail');
  assert.ok(ctx.gmail.messages.find((m) => m.id === brief.gmail_id).labels.includes('Events'));

  // The same label on both sides before it was sent: Gmail's change wins, ours is skipped (and said so).
  const lena = await ctx.rowFor('Onboarding call');
  assert.ok(lena.labels.includes('Projects'));
  await ctx.json('POST', `/api/mail/messages/${lena.id}/labels`, { remove: ['Projects'] }); // here: take it off, not sent yet
  ctx.gmail.removeLabel(lena.gmail_id, 'Projects');
  ctx.gmail.addLabel(lena.gmail_id, 'Projects'); // Gmail, later: it stays ON
  const clash = await ctx.sync();
  assert.equal(clash.body.skipped, 1);
  assert.equal((await labelsOf(ctx, 'Onboarding call')).includes('Projects'), true);
  const skipped = (await ctx.json('GET', '/api/mail/outbox')).body.find((o) => o.state === 'skipped');
  assert.match(skipped.problem, /Gmail changed the same label later/);
  assert.equal(ctx.gmail.sent.some((s) => s.id === lena.gmail_id), false);
});

test('archive and then un-archive before it was sent is nothing to send', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const digest = await ctx.rowFor('This week');
  await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { remove: ['Inbox'] });
  await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { add: ['Inbox'] });
  const outbox = (await ctx.json('GET', '/api/mail/outbox')).body;
  assert.deepEqual(outbox.map((o) => [o.state, o.problem]), [['skipped', 'Undone before it was sent.']]);
  assert.equal((await ctx.sync()).body.sent, 0);
  assert.equal(ctx.gmail.sent.length, 0);
  const nothing = await ctx.json('POST', `/api/mail/messages/${digest.id}/labels`, { add: ['Inbox'] });
  assert.equal(nothing.body.changed, false);
  assert.equal((await ctx.json('POST', '/api/mail/messages/00000000-0000-0000-0000-000000000000/labels', { add: ['x'] })).status, 404);
});

test('Gmail forgot the history: the sync says so in words, and a fill puts it right', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  ctx.gmail.historyGone = true;
  const gone = await ctx.sync();
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'history_gone');
  assert.match((await ctx.json('GET', '/api/mail')).body.accounts[0].sync.sync_error, /no longer has the history/);
  ctx.gmail.historyGone = false;
  assert.equal((await ctx.sync()).body.baseline, true, 'it starts again from where Gmail is now');
});

test('Live is a switch, off until it is switched on, and needs “Read your mail”', async (t) => {
  const ctx = await setup(t);
  assert.equal((await ctx.json('GET', '/api/mail')).body.accounts[0].sync.live, false);
  assert.equal((await ctx.json('POST', '/api/mail/live', { account_id: ctx.mailId, on: 'yes' })).status, 400);
  const on = await ctx.json('POST', '/api/mail/live', { account_id: ctx.mailId, on: true });
  assert.equal(on.body.live, true);
  assert.equal((await ctx.json('POST', '/api/mail/live', { account_id: ctx.mailId, on: false })).body.live, false);
  await ctx.json('PATCH', `/api/google/accounts/${ctx.account.id}`, { permission: 'mail.read', on: false });
  assert.equal((await ctx.json('POST', '/api/mail/live', { account_id: ctx.mailId, on: true })).status, 409);
  assert.equal((await ctx.json('POST', '/api/mail/sync', { account_id: ctx.mailId })).status, 409);
});

// ---- Delete (#): to Gmail's Trash, never deleted for good ----

const threadFor = async (ctx, subject) => (await ctx.json('GET', `/api/mail/threads?q=${encodeURIComponent(subject)}&limit=5`)).body[0];
const splitTotal = async (ctx) => Object.entries((await ctx.json('GET', '/api/mail/inbox?split=important')).body.counts).reduce((a, [id, n]) => a + (id === 'inbox' ? 0 : n), 0); // Inbox is the five together

test('delete here: hidden at once everywhere, then Gmail’s own trash; Undo untrashes and puts it back in the Inbox', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const thread = await threadFor(ctx, 'This week');
  const digest = await ctx.rowFor('This week');
  assert.ok(digest.labels.includes('Inbox'));
  const total = await splitTotal(ctx);
  const kept = (await ctx.json('GET', '/api/mail')).body.messages;

  const gone = await ctx.json('POST', `/api/mail/threads/${thread.id}/trash`, {});
  assert.equal(gone.status, 200);
  assert.ok(gone.body.messages.includes(digest.id) && gone.body.inbox.includes(digest.id));
  assert.equal(await splitTotal(ctx), total - 1, 'out of every split, Done included');
  assert.equal(await threadFor(ctx, 'This week'), undefined, 'not found by search');
  assert.equal((await ctx.json('GET', `/api/mail/threads/${thread.id}`)).status, 404, 'not shown when opened');
  assert.equal((await ctx.json('GET', '/api/mail')).body.messages, kept, 'the row is kept, only hidden');
  assert.equal(ctx.gmail.trashed.length, 0, 'not sent yet');

  const round = await ctx.sync();
  assert.equal(round.body.sent, gone.body.messages.length);
  assert.deepEqual(ctx.gmail.trashed.find((x) => x.id === digest.gmail_id), { id: digest.gmail_id, action: 'trash' });
  assert.ok(ctx.gmail.sent.some((s) => s.id === digest.gmail_id && s.remove.includes('Inbox')));
  assert.ok(!ctx.gmail.seen.some((c) => c.method === 'DELETE' || /\/delete$/.test(c.path)), 'never a delete for good');
  const inGmail = ctx.gmail.messages.find((m) => m.id === digest.gmail_id);
  assert.ok(inGmail.labels.includes('Trash') && !inGmail.labels.includes('Inbox'));
  const echo = await ctx.sync();
  assert.deepEqual([echo.body.label_changes, echo.body.sent], [0, 0]);

  const back = await ctx.json('POST', `/api/mail/threads/${thread.id}/undo-trash`, { messages: gone.body.messages, inbox: gone.body.inbox });
  assert.equal(back.status, 200);
  assert.equal(await splitTotal(ctx), total);
  assert.ok((await ctx.rowFor('This week')).labels.includes('Inbox'));
  await ctx.sync();
  assert.ok(ctx.gmail.trashed.some((x) => x.id === digest.gmail_id && x.action === 'untrash'));
  assert.ok(inGmail.labels.includes('Inbox') && !inGmail.labels.includes('Trash'));
});

test('delete and Undo before it was sent is nothing to send', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const thread = await threadFor(ctx, 'This week');
  const gone = (await ctx.json('POST', `/api/mail/threads/${thread.id}/trash`, {})).body;
  await ctx.json('POST', `/api/mail/threads/${thread.id}/undo-trash`, gone);
  const round = await ctx.sync();
  assert.equal(round.body.sent, 0);
  assert.deepEqual([ctx.gmail.trashed.length, ctx.gmail.sent.length], [0, 0]);
  assert.ok((await ctx.rowFor('This week')).labels.includes('Inbox'));
});

test('trashed in Gmail: hidden here on the next round, the row kept', async (t) => {
  const ctx = await setup(t);
  await ctx.sync();
  const digest = await ctx.rowFor('This week');
  const total = await splitTotal(ctx);
  const kept = (await ctx.json('GET', '/api/mail')).body.messages;
  ctx.gmail.addLabel(digest.gmail_id, 'Trash');
  ctx.gmail.removeLabel(digest.gmail_id, 'Inbox');
  await ctx.sync();
  assert.equal(await splitTotal(ctx), total - 1);
  assert.equal(await threadFor(ctx, 'This week'), undefined);
  assert.equal((await ctx.json('GET', '/api/mail')).body.messages, kept);
});

test('the Outbox’s label changes: only failed ones and stuck ones show; Try again waits once more, Let it go skips it and Gmail is not touched', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { prepareDatabase } = await import('../../db.js');
  const { importMboxText } = await import('../../mail.js');
  const { changeLabels, pendingChanges, retryMailChange, dismissMailChange } = await import('../../mail-sync.js');
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  db.exec("UPDATE mail_messages SET gmail_id = 'g' || rowid");
  const [a, b] = db.prepare("SELECT id FROM mail_messages WHERE labels LIKE '%\"Inbox\"%' LIMIT 2").all();
  changeLabels(db, a.id, { remove: ['Inbox'] });
  changeLabels(db, b.id, { add: ['Starred'] });
  assert.deepEqual(pendingChanges(db), [], 'a change that just waits is not worth a line');
  const later = new Date(Date.now() + 5 * 60_000);
  assert.equal(pendingChanges(db, { at: later }).length, 2, 'waiting for minutes: stuck');
  const [first] = db.prepare('SELECT id FROM mail_outbox WHERE message_id = ?').all(a.id);
  db.prepare("UPDATE mail_outbox SET state = 'failed', problem = 'Gmail has no label called “X”.' WHERE id = ?").run(first.id);
  assert.deepEqual(pendingChanges(db).map((c) => [c.state, c.remove]), [['failed', ['Inbox']]]);
  assert.equal(retryMailChange(db, first.id).state, 'waiting');
  assert.throws(() => retryMailChange(db, first.id), /Only a change that failed/);
  assert.equal(dismissMailChange(db, first.id).state, 'skipped');
  assert.deepEqual(pendingChanges(db, { at: later }).map((c) => c.add), [['Starred']]);
});
