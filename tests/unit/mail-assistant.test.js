// From mail to action, with your assistant (mail-assistant.js, advanced/mail/11): t makes a task; a draft is a card; the limits are code.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { importMboxText, listThreads } from '../../mail.js';
import { createPerson } from '../../people.js';
import { listTasks, getTask } from '../../tasks.js';
import { setPermission } from '../../permissions.js';
import { createConversation } from '../../assistant.js';
import { runTool, applyAction, dismissAction, undoAction, getAction, offeredTools } from '../../assistant-tools.js';
import { mailToTask, tasksOf, checkDraft, draftsToday, LIMITS, describeLimits } from '../../mail-assistant.js';
import { listSends } from '../../mail-send.js';
import { setModule } from '../../modules.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

function demo() {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  createPerson(db, { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  const conversation = createConversation(db, fs.mkdtempSync(path.join(os.tmpdir(), 'mail-asst-')));
  const cards = [];
  const run = { conversationId: conversation.id, messageId: null, folder: '/tmp', card: (c) => cards.push(c), readOnly: false };
  const id = (q) => listThreads(db, { q })[0].id;
  return { db, run, cards, id };
}

test('t on a mail: a task with the subject, linked back to the mail, which says where it went; from Money it is due in two weeks', () => {
  const { db, id } = demo();
  const invoice = id('invoice');
  const task = mailToTask(db, invoice, { split: 'money' });
  assert.equal(task.text, 'Invoice 2026-114');
  const inTwoWeeks = new Date(); inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);
  assert.equal(task.due, `${inTwoWeeks.getFullYear()}-${String(inTwoWeeks.getMonth() + 1).padStart(2, '0')}-${String(inTwoWeeks.getDate()).padStart(2, '0')}`);
  assert.equal(task.mail_thread_id, invoice);
  assert.equal(getTask(db, task.id).mail_thread_id, invoice);
  assert.deepEqual(tasksOf(db, invoice).map((t) => [t.text, t.done]), [['Invoice 2026-114', false]]);
  const reply = mailToTask(db, id('onboarding'), {});
  assert.deepEqual([reply.text, reply.due], ['Onboarding call on Thursday?', ''], 'Re: is taken off; no day unless it is Money');
  assert.equal(mailToTask(db, id('brief'), { title: 'Read page two first', due: '2026-12-01' }).text, 'Read page two first');
  assert.throws(() => mailToTask(db, 'nope'), /No such conversation/);
});

test('a draft is a card: nothing is sent, Send puts it in the outbox with ten seconds, Dismiss is nothing', () => {
  const { db, run, cards, id } = demo();
  const lena = id('onboarding');
  const out = JSON.parse(runTool(db, 'mail_draft', { thread_id: lena, text: 'Thursday works for me.' }, run));
  assert.match(out.note, /Nothing was sent/);
  assert.deepEqual(listSends(db), [], 'nothing is in the outbox yet');
  const card = getAction(db, out.waiting);
  assert.deepEqual([card.kind, card.state, card.after.to, card.after.subject, card.after.body], ['mail_send', 'proposed', ['lena@nordlicht.example'], 'Re: Onboarding call on Thursday?', 'Thursday works for me.']);

  assert.equal(applyAction(db, card.id).state, 'applied');
  const [row] = listSends(db);
  assert.deepEqual([row.state, row.to, row.body], ['waiting', ['lena@nordlicht.example'], 'Thursday works for me.']);
  assert.ok(new Date(row.send_at) - Date.now() > 8_000, 'ten seconds, as for a mail you wrote');
  undoAction(db, card.id);
  assert.equal(listSends(db)[0].state, 'undone');

  const second = JSON.parse(runTool(db, 'mail_draft', { thread_id: lena, text: 'Another.' }, run)).waiting;
  assert.equal(dismissAction(db, second).state, 'dismissed');
  assert.equal(listSends(db).length, 1);
  void cards;
});

test('the hard limits are checked in the tool, whatever the prompt says: only to the conversation, no attachment, ten a day', () => {
  const { db, run, id } = demo();
  const lena = id('onboarding');
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: lena, text: 'Hi', to: 'stranger@elsewhere.example' }, run), (e) => e.status === 403 && e.code === 'recipient' && /already in the conversation/.test(e.message));
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: lena, text: 'Hi', to: 'lena@nordlicht.example, stranger@elsewhere.example' }, run), (e) => e.code === 'recipient');
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: lena, text: 'Hi', attachments: ['plan.pdf'] }, run), (e) => e.status === 403 && e.code === 'attachments');
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: lena, text: '  ' }, run), /needs its words/);
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: 'nope', text: 'Hi' }, run), (e) => e.status === 404);
  assert.equal(draftsToday(db), 0, 'a refusal is not a draft');
  const ok = JSON.parse(runTool(db, 'mail_draft', { thread_id: lena, text: 'Hi', to: 'Lena@Nordlicht.example' }, run));
  assert.ok(ok.waiting);
  for (let i = 1; i < LIMITS.drafts_per_day; i++) runTool(db, 'mail_draft', { thread_id: lena, text: `Draft ${i}` }, run);
  assert.equal(draftsToday(db), 10);
  assert.throws(() => runTool(db, 'mail_draft', { thread_id: lena, text: 'The eleventh' }, run), (e) => e.status === 429 && e.code === 'per_day' && /at most 10 mails a day/.test(e.message));
  assert.deepEqual(LIMITS, { known_recipients_only: true, attachments: false, drafts_per_day: 10 });
  assert.equal(describeLimits().length, 4);
  assert.throws(() => checkDraft(db, { threadId: id('brief'), to: 'jonas@hafenkante.example', text: 'ok' }), (e) => e.code === 'per_day', 'the limit of the day holds for every conversation');
});

test('reading and searching mail, and a task from a conversation, respect the owner’s settings', () => {
  const { db, run, id } = demo();
  const found = JSON.parse(runTool(db, 'mail_search', { query: 'invoice' }, run));
  assert.deepEqual(found.map((f) => f.subject), ['Invoice 2026-114']);
  assert.equal(runTool(db, 'mail_search', { query: 'zebra' }, run), 'No conversation matches those words.');
  const read = JSON.parse(runTool(db, 'mail_read', { thread_id: id('onboarding') }, run));
  assert.deepEqual([read.messages.length, read.messages[1].from, read.messages[1].text.startsWith('Thursday works')], [3, 'Lena Fischer', true]);
  assert.throws(() => runTool(db, 'mail_read', { thread_id: 'nope' }, run), (e) => e.status === 404);

  const asked = JSON.parse(runTool(db, 'mail_to_task', { thread_id: id('invoice'), due: '2026-12-01' }, run));
  assert.ok(asked.waiting, 'it asks first, as add_task does by default');
  assert.equal(listTasks(db).length, 0);
  applyAction(db, asked.waiting);
  assert.deepEqual(listTasks(db).map((t) => [t.text, t.due, t.mail_thread_id === id('invoice')]), [['Invoice 2026-114', '2026-12-01', true]]);
  setPermission(db, 'add_task', 'alone');
  const alone = JSON.parse(runTool(db, 'mail_to_task', { thread_id: id('brief'), title: 'Read page two' }, run));
  assert.equal(alone.added.text, 'Read page two');
  assert.equal(alone.linked_to, 'Brief for the launch event');
});

test('the mail tools are there only while Mail is on', () => {
  const { db } = demo();
  const names = () => offeredTools(db).map((t) => t.name).filter((n) => n.startsWith('mail_'));
  setModule(db, 'mail', true); // off in a new install (Sovran Advisor)
  assert.deepEqual(names(), ['mail_search', 'mail_read', 'mail_draft', 'mail_to_task']);
  setModule(db, 'mail', false);
  assert.deepEqual(names(), []);
});

test('schema 48 moves an older database: tasks get their mail link, the assistant’s cards can be mail drafts, every row is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-asst-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO tasks (id, created_at, updated_at, source_kind, source_id, position, line, text, done, due) VALUES ('t1', 'a', 'a', 'own', '', 0, 0, 'Keep me', 0, '')");
  db.exec('ALTER TABLE tasks DROP COLUMN mail_thread_id; PRAGMA user_version = 47;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare("SELECT text, mail_thread_id FROM tasks WHERE id = 't1'").get() }, { text: 'Keep me', mail_thread_id: null });
  db.close();
});
