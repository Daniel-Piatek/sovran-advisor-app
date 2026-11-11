// The Mail app's splits (mail-splits.js, advanced/mail/5): six splits by rules that can be read, the first that matches wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { importMboxText } from '../../mail.js';
import { createPerson } from '../../people.js';
import { startServer } from '../../server.js';
import { SPLITS, classify, inboxView, explainThread, describeSplits } from '../../mail-splits.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const known = new Set(['lena@nordlicht.example']);
const mail = (over) => ({ from_name: '', from_email: 'x@x.example', subject: '', labels: [], bulk: 0, list_unsubscribe: 0, has_invite: 0, ...over });

test('the rules are read from top to bottom, the first that matches wins, and each says why', () => {
  assert.deepEqual(SPLITS.map((s) => s.id), ['important', 'calendar', 'money', 'news', 'other']);
  assert.deepEqual(classify(mail({ from_email: 'lena@nordlicht.example', from_name: 'Lena', subject: 'Invoice' }), known), { split: 'important', why: 'Important: from Lena, who is in your People, and it is not a bulk mail.' });
  assert.equal(classify(mail({ from_email: 'lena@nordlicht.example', bulk: 1, has_invite: 1 }), known).split, 'calendar', 'a known sender of a bulk mail is not Important');
  assert.deepEqual(classify(mail({ has_invite: 1, list_unsubscribe: 1 }), known), { split: 'calendar', why: 'Calendar: it carries an invitation.' });
  assert.equal(classify(mail({ subject: 'Einladung zum Fest' }), known).split, 'calendar');
  assert.deepEqual(classify(mail({ subject: 'Invoice 2026-114', list_unsubscribe: 1 }), known), { split: 'money', why: 'Money: the subject says invoice, receipt or payment.' });
  assert.equal(classify(mail({ subject: 'Ihre Rechnung' }), known).split, 'money');
  assert.equal(classify(mail({ list_unsubscribe: 1 }), known).why, 'Newsletters: it has an unsubscribe link.');
  assert.equal(classify(mail({ labels: ['Inbox', 'Category Promotions'] }), known).why, 'Newsletters: Gmail filed it under Category Promotions.');
  assert.equal(classify(mail({ bulk: 1 }), known).split, 'news');
  assert.deepEqual(classify(mail({ subject: 'Hello' }), known), { split: 'other', why: 'Other: no rule matched.' });
  assert.deepEqual(describeSplits().map((s) => s.id), ['inbox', 'important', 'calendar', 'money', 'news', 'other', 'done', 'drafts', 'sent', 'outbox']);
});

function demo(filler = 0) {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  createPerson(db, { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  createPerson(db, { name: 'Jonas Weber', emails: 'jonas@hafenkante.example' });
  importMboxText(db, makeMailbox({ filler }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  return db;
}

test('the five conversations land where the lesson says: Lena and Jonas Important, the invitation Calendar, the invoice Money, the digest Newsletters', () => {
  const db = demo();
  const at = (split) => inboxView(db, { split }).threads.map((t) => t.subject);
  assert.deepEqual(at('important').sort(), ['Brief for the launch event', 'Onboarding call on Thursday?']);
  assert.deepEqual(at('calendar'), ['Eingeladen: Gartenfest 🌟']);
  assert.deepEqual(at('money'), ['Invoice 2026-114']);
  assert.deepEqual(at('news'), ['This week: 5 ideas and a question']);
  assert.deepEqual(at('other'), []);
  const counts = inboxView(db, { split: 'other' }).counts;
  assert.deepEqual(counts, { inbox: 5, important: 2, calendar: 1, money: 1, news: 1, other: 0, done: 0, drafts: 0, sent: 2, outbox: 0 });
});

// The six splits hold every conversation once; Sent and Outbox are views beside them, not counted in the sum.
const sixSum = (counts) => ['important', 'calendar', 'money', 'news', 'other', 'done'].reduce((a, id) => a + counts[id], 0);

test('Done is what is not in the Inbox any more; Spam and Trash are in no split; every conversation is in exactly one', () => {
  const db = demo(60);
  const all = inboxView(db, { split: 'other' });
  const total = db.prepare('SELECT count(*) AS n FROM mail_threads WHERE deleted_at IS NULL').get().n;
  assert.equal(sixSum(all.counts), total);
  const doneBefore = all.counts.done;

  // Archive the digest (take it off the Inbox): it is Done now.
  db.exec("UPDATE mail_messages SET labels = '[\"Category Promotions\",\"Newsletters\"]' WHERE subject LIKE 'This week%'");
  const after = inboxView(db, { split: 'done', limit: 200 });
  assert.equal(after.counts.done, doneBefore + 1);
  assert.ok(after.threads.some((t) => t.subject.startsWith('This week')));
  assert.equal(after.threads.find((t) => t.subject.startsWith('This week')).why, 'Done: it is not in your Inbox any more.');

  // Spam: out of every split, Done included.
  db.exec("UPDATE mail_messages SET labels = '[\"Spam\"]' WHERE subject LIKE 'Invoice%'");
  const gone = inboxView(db, { split: 'money' });
  assert.equal(gone.counts.money, 0);
  assert.equal(sixSum(gone.counts), total - 1);
});

test('one account or all, newest first, with a page', () => {
  const db = demo(80);
  importMboxText(db, makeMailbox({ filler: 3 }).text, { email: 'private@example.com', filename: 'private.mbox' });
  const [first, second] = db.prepare('SELECT id, email FROM mail_accounts ORDER BY created_at, rowid').all();
  const all = inboxView(db, { split: 'other', limit: 200 });
  const one = inboxView(db, { split: 'other', account: second.id, limit: 200 });
  assert.ok(one.threads.length < all.threads.length);
  assert.ok(one.threads.every((t) => t.account === second.id && t.account_letter === 'P'));
  assert.ok(all.threads.some((t) => t.account_letter === 'D') && first.email === 'demo@example.com');
  assert.deepEqual(all.threads.map((t) => t.last_at), [...all.threads.map((t) => t.last_at)].sort().reverse());
  const page = inboxView(db, { split: 'other', limit: 5 });
  assert.equal(page.threads.length, 5);
  assert.equal(page.more, true);
  const next = inboxView(db, { split: 'other', limit: 5, before: page.threads.at(-1).last_at });
  assert.ok(next.threads.every((t) => t.last_at < page.threads.at(-1).last_at));
});

test('Sent: every conversation you wrote in (Gmail’s Sent label or your own address), the latest you sent first; Trash and Spam left out', () => {
  const db = demo(20);
  const sent = inboxView(db, { split: 'sent', limit: 200 });
  const expected = db.prepare(`SELECT count(DISTINCT thread_id) AS n FROM mail_messages WHERE deleted_at IS NULL AND (labels LIKE '%"Sent"%' OR lower(from_email) = 'demo@example.com')`).get().n;
  assert.ok(expected > 0);
  assert.equal(sent.counts.sent, expected);
  assert.equal(sent.threads.length, expected);
  assert.deepEqual(sent.threads.map((t) => t.last_at), [...sent.threads.map((t) => t.last_at)].sort().reverse(), 'the latest you sent first');
  assert.ok(sent.threads.every((t) => t.split === 'sent'));
  // A conversation in Sent is still in its split too: Sent is a view beside the six.
  const lena = sent.threads.find((t) => t.subject.startsWith('Onboarding'));
  assert.ok(lena && inboxView(db, { split: 'important' }).threads.some((t) => t.id === lena.id));
  // A new mail you wrote that nobody answered (no Inbox label) is findable in Sent, and still Done.
  const thread = db.prepare("SELECT id FROM mail_threads LIMIT 1").get().id;
  db.exec(`UPDATE mail_messages SET labels = '["Sent"]', from_email = 'demo@example.com' WHERE thread_id = '${thread}'`);
  assert.ok(inboxView(db, { split: 'sent', limit: 200 }).threads.some((t) => t.id === thread));
  assert.ok(inboxView(db, { split: 'done', limit: 200 }).threads.some((t) => t.id === thread));
  // Trash: out of Sent as well.
  db.exec(`UPDATE mail_messages SET labels = '["Sent","Trash"]' WHERE thread_id = '${thread}'`);
  const after = inboxView(db, { split: 'sent', limit: 200 });
  assert.ok(!after.threads.some((t) => t.id === thread));
  assert.equal(after.counts.sent, inboxView(db, { split: 'sent', limit: 200 }).threads.length);
});

test('Inbox: every conversation with mail in the Inbox, the five splits together; Done, Trash and Spam left out', () => {
  const db = demo(60);
  const view = inboxView(db, { split: 'inbox', limit: 200 });
  const five = ['important', 'calendar', 'money', 'news', 'other'];
  assert.equal(view.counts.inbox, five.reduce((a, id) => a + view.counts[id], 0));
  assert.equal(view.threads.length, view.counts.inbox);
  assert.ok(view.threads.every((t) => five.includes(t.split)), 'no Done conversation in the Inbox');
  assert.ok(view.threads.every((t, i, all) => i === 0 || (all[i - 1].last_at ?? '') >= (t.last_at ?? '')), 'newest first');
  assert.equal(inboxView(db).counts.inbox, view.counts.inbox, 'Inbox is the view with no split given');
  const before = view.counts.inbox;
  db.exec("UPDATE mail_messages SET labels = '[\"Spam\"]' WHERE subject LIKE 'Invoice%'");
  db.exec("UPDATE mail_messages SET labels = '[\"Category Promotions\"]' WHERE subject LIKE 'This week%'");
  const after = inboxView(db, { split: 'inbox', limit: 200 });
  assert.equal(after.counts.inbox, before - 2);
  assert.ok(!after.threads.some((t) => /^(Invoice|This week)/.test(t.subject)));
});

test('the line over an open mail: the rule behind where it is', () => {
  const db = demo();
  const invoice = inboxView(db, { split: 'money' }).threads[0];
  assert.equal(explainThread(db, invoice.id).why, 'Money: the subject says invoice, receipt or payment.');
  const lena = inboxView(db, { split: 'important' }).threads.find((t) => t.subject.startsWith('Onboarding'));
  assert.match(explainThread(db, lena.id).why, /^Important: from Lena Fischer/);
});

test('the API: splits, counts, a wrong split refused, and an open conversation carries its rule', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splits-api-'));
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = async (url) => ({ status: (await fetch(app.url + url)).status, body: await (await fetch(app.url + url)).json() });
  await fetch(`${app.url}/api/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lena Fischer', emails: 'lena@nordlicht.example' }) });
  const up = await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'demo@example.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'd.mbox' }, body: Buffer.from(makeMailbox({ filler: 0 }).text) });
  assert.equal(up.status, 200);
  assert.deepEqual((await get('/api/mail/splits')).body.map((s) => s.name), ['Inbox', 'Important', 'Calendar', 'Money', 'Newsletters', 'Other', 'Done', 'Drafts', 'Sent', 'Outbox']);
  const important = await get('/api/mail/inbox?split=important');
  assert.deepEqual(important.body.threads.map((x) => x.subject), ['Onboarding call on Thursday?']); // Jonas is not in People here
  assert.equal(important.body.counts.other, 1);
  assert.equal((await get('/api/mail/inbox?split=nope')).status, 400);
  const inbox = await get('/api/mail/inbox');
  assert.deepEqual(inbox.body.threads.map((x) => x.split).sort(), ['calendar', 'important', 'money', 'news', 'other']); // with no split: the Inbox, every split together
  const open = (await get(`/api/mail/threads/${important.body.threads[0].id}`)).body;
  assert.match(open.rule.why, /^Important: from Lena Fischer/);
});
