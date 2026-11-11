// Mail drafts (mail-drafts.js, schema 69): a mail being written is kept as you type, waits in the Outbox, and is never lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { importMboxText } from '../../mail.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { saveDraft, listDrafts, getDraft, discardDraft, restoreDraft } from '../../mail-drafts.js';
import { startServer } from '../../server.js';

function demo() {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  return { db, account: db.prepare('SELECT id FROM mail_accounts').get().id, thread: db.prepare('SELECT id FROM mail_threads LIMIT 1').get().id };
}

test('an empty composer keeps nothing; words make a draft, the same draft is saved again, and emptied it goes', () => {
  const { db, account } = demo();
  assert.equal(saveDraft(db, { account_id: account, to: '', subject: '', body: '  ' }), null);
  const first = saveDraft(db, { account_id: account, to: 'lena@nordlicht.example', subject: 'Hello', body: '' });
  assert.ok(first.id, 'a new mail with only To and Subject is worth keeping');
  const second = saveDraft(db, { id: first.id, account_id: account, to: 'lena@nordlicht.example', subject: 'Hello', body: 'Words.', remind_days: 3, confirm: true });
  assert.equal(second.id, first.id);
  assert.deepEqual([second.body, second.remind_days, second.confirm], ['Words.', 3, true]);
  assert.deepEqual(listDrafts(db).map((d) => d.id), [first.id]);
  assert.equal(saveDraft(db, { id: first.id, account_id: account, to: '', subject: '', body: '' }), null);
  assert.deepEqual(listDrafts(db), []);
  assert.ok(db.prepare('SELECT deleted_at FROM mail_drafts WHERE id = ?').get(first.id).deleted_at, 'kept, marked deleted');
});

test('a reply’s draft stays with its conversation: an answer with no words is nothing, writing again continues the one draft', () => {
  const { db, account, thread } = demo();
  assert.equal(saveDraft(db, { account_id: account, thread_id: thread, to: 'lena@nordlicht.example', subject: 'Re: x', body: '' }), null);
  const a = saveDraft(db, { account_id: account, thread_id: thread, to: 'lena@nordlicht.example', subject: 'Re: x', body: 'One' });
  const b = saveDraft(db, { account_id: account, thread_id: thread, to: 'lena@nordlicht.example', subject: 'Re: x', body: 'One two' });
  assert.equal(a.id, b.id);
  assert.equal(listDrafts(db).length, 1);
  assert.equal(getDraft(db, a.id).thread_id, thread);
  assert.throws(() => saveDraft(db, { account_id: account, thread_id: '00000000-0000-0000-0000-000000000000', body: 'x' }), /No such conversation/);
  assert.throws(() => saveDraft(db, { account_id: 'nope', body: 'x' }), /No such mail account/);
});

test('discard is kept and Undo brings it back', () => {
  const { db, account } = demo();
  const d = saveDraft(db, { account_id: account, to: 'a@b.example', body: 'Keep me' });
  discardDraft(db, d.id);
  assert.deepEqual(listDrafts(db), []);
  assert.throws(() => getDraft(db, d.id), /not here any more/);
  assert.equal(restoreDraft(db, d.id).body, 'Keep me');
  assert.equal(listDrafts(db).length, 1);
});

test(`moving a database of schema 68 adds mail_drafts, keeps every row, and copies it first (now ${SCHEMA_VERSION})`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-move-'));
  const db = openDatabase(dir);
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  const messages = db.prepare('SELECT count(*) AS n FROM mail_messages').get().n;
  db.exec('DROP TABLE mail_drafts; PRAGMA user_version = 68');
  db.close();
  const again = openDatabase(dir);
  assert.equal(again.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(again.prepare('SELECT count(*) AS n FROM mail_messages').get().n, messages);
  assert.ok(again.prepare("SELECT 1 FROM sqlite_master WHERE name = 'mail_drafts'").get());
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the API: saved, listed in the Outbox with its count, ended by the send it became, and Undo brings it back', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-api-'));
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'demo@example.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'd.mbox' }, body: Buffer.from(makeMailbox({ filler: 0 }).text) });
  const account = (await json('GET', '/api/mail')).body.accounts[0].id;
  const { draft } = (await json('POST', '/api/mail/unsent', { account_id: account, to: 'lena@nordlicht.example', subject: 'Plan', body: 'First words' })).body;
  let view = (await json('GET', '/api/mail/inbox?split=outbox')).body;
  assert.deepEqual([view.counts.drafts, view.counts.outbox, view.outbox.drafts.map((d) => d.subject)], [1, 0, ['Plan']]);
  const made = await json('POST', '/api/mail/sends', { account_id: account, to: 'lena@nordlicht.example', subject: 'Plan', body: 'First words', draft_id: draft.id });
  assert.equal(made.status, 201);
  view = (await json('GET', '/api/mail/inbox?split=outbox')).body;
  assert.deepEqual([view.counts.drafts, view.outbox.sends.length, view.counts.outbox], [0, 1, 1], 'the draft became the mail on its way');
  assert.equal((await json('POST', `/api/mail/unsent/${draft.id}/restore`, {})).body.body, 'First words');
  assert.equal((await json('DELETE', `/api/mail/unsent/${draft.id}`)).status, 200);
  assert.equal((await json('GET', `/api/mail/unsent/${draft.id}`)).status, 404);
  assert.equal((await json('PUT', `/api/mail/unsent/${draft.id}`)).status, 405);
});
