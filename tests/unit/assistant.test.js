// The assistant (assistant.js, assistant/1), answered by the stand-in claude command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, SCHEMA_VERSION } from '../../db.js';
import {
  createConversation, getConversation, listConversations, sendMessage, stopAnswer, settleAnswers, deleteConversation,
  restoreConversation,
} from '../../assistant.js';
import { startServer } from '../../server.js';

const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
const lastRun = (dataDir, conversation) => JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-claude-last-run.json'), 'utf8'));

test('a conversation has its own folder; the answer streams in, and the next turn continues the same Claude conversation', async () => {
  const dataDir = scratch();
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  assert.equal(conversation.folder, path.join('assistant', conversation.id));
  assert.ok(fs.existsSync(path.join(dataDir, conversation.folder)));
  fs.writeFileSync(path.join(dataDir, conversation.folder, 'plan.txt'), 'x');
  process.env.ANTHROPIC_API_KEY = 'not-to-be-used';
  const parts = [];
  const answer = await sendMessage(db, conversation.id, 'What is in this folder?', { dataDir, command: fake, send: (e) => parts.push(e) });
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual([answer.role, answer.state, answer.text], ['assistant', 'done', 'This folder has: plan.txt.']);
  assert.ok(parts.filter((e) => e.type === 'text').length > 2, 'it arrives in parts');
  assert.equal(parts.at(-1).type, 'done');
  const first = lastRun(dataDir, conversation);
  assert.equal(first.api_key, false, 'never an API key: the owner’s own Claude login');
  assert.ok(first.args.includes('--session-id') && first.args.includes(conversation.session_id));
  assert.ok(first.args.includes('--tools=Read,Glob,Grep,Write'), 'an allow-list of built-ins, by name');
  assert.ok(first.args.includes('--disable-slash-commands'));
  assert.equal(getConversation(db, conversation.id).title, 'What is in this folder?');

  const again = await sendMessage(db, conversation.id, 'What did I ask?', { dataDir, command: fake });
  assert.equal(again.text, 'You asked: What is in this folder?');
  assert.deepEqual(lastRun(dataDir, conversation).args.slice(-2), ['--resume', conversation.session_id]);
  assert.deepEqual(getConversation(db, conversation.id).messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  db.close();
});

test('its steps: the tools it uses and the files it makes are kept with the answer', async () => {
  const dataDir = scratch();
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  const answer = await sendMessage(db, conversation.id, 'Please make a file hello.txt', { dataDir, command: fake });
  assert.equal(answer.text, 'Made hello.txt.');
  assert.deepEqual(answer.steps.map((s) => [s.tool, s.file, s.state]), [['Write', 'hello.txt', 'done']]);
  assert.ok(fs.existsSync(path.join(dataDir, conversation.folder, 'hello.txt')));
  db.close();
});

test('Stop ends the answer and keeps what came; one answer at a time; a failure says why', async () => {
  const dataDir = scratch();
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  let words = 0;
  const answering = sendMessage(db, conversation.id, 'slow please', { dataDir, command: fake, send: (e) => { if (e.type === 'text') words++; } });
  assert.throws(() => sendMessage(db, conversation.id, 'another', { dataDir, command: fake }), (err) => err.status === 409);
  while (words < 3) await new Promise((done) => setTimeout(done, 20));
  assert.equal(stopAnswer(conversation.id), true);
  const stopped = await answering;
  assert.equal(stopped.state, 'stopped');
  assert.match(stopped.text, /^word1 word2/);
  assert.ok(!stopped.text.includes('word50'));
  assert.equal(stopAnswer(conversation.id), false);

  const failed = await sendMessage(db, conversation.id, 'fail', { dataDir, command: fake });
  assert.equal(failed.state, 'failed');
  assert.match(failed.text, /Not logged in/);
  const missing = await sendMessage(db, conversation.id, 'hello', { dataDir, command: ['/nowhere/claude'] });
  assert.equal(missing.state, 'failed');
  assert.match(missing.text, /not installed/);
  db.close();
});

test('an answer cut off when the app stopped is marked stopped; deleting a conversation can be undone', () => {
  const dataDir = scratch();
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  db.prepare("INSERT INTO chat_messages (id, created_at, updated_at, conversation_id, role, text, state) VALUES ('m1', 'x', 'x', ?, 'assistant', 'Half', 'answering')").run(conversation.id);
  settleAnswers(db);
  assert.equal(getConversation(db, conversation.id).messages[0].state, 'stopped');
  deleteConversation(db, conversation.id);
  assert.deepEqual(listConversations(db), []);
  restoreConversation(db, conversation.id);
  assert.equal(listConversations(db).length, 1);
  db.close();
});

test('a database from before the assistant gets its tables, every row kept', () => {
  const dir = scratch();
  let db = openDatabase(dir);
  db.prepare("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'x', 'x', 'Kept', '')").run();
  db.exec('DROP TABLE chat_messages; DROP TABLE conversations; PRAGMA user_version = 19;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 1);
  assert.equal(createConversation(db, dir).messages.length, 0);
  db.close();
});

test('the assistant API streams the answer as lines; the app restarted, the conversation carries on', async (t) => {
  const dataDir = scratch();
  let app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const conversation = await (await send('POST', '/api/conversations', {})).json();
  assert.equal((await send('POST', `/api/conversations/${conversation.id}/messages`, { text: '  ' })).status, 400);
  const res = await send('POST', `/api/conversations/${conversation.id}/messages`, { text: 'Hello there' });
  assert.equal(res.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.at(-1).message.text, 'You said: Hello there');
  await app.close();
  app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  const reopened = await (await fetch(`${app.url}/api/conversations/${conversation.id}`)).json();
  assert.deepEqual(reopened.messages.map((m) => m.text), ['Hello there', 'You said: Hello there']);
  const follow = await (await send('POST', `/api/conversations/${conversation.id}/messages`, { text: 'What did I ask?' })).text();
  assert.match(follow, /You asked: Hello there/);
  assert.equal((await (await fetch(`${app.url}/api/conversations`)).json()).length, 1);
  assert.equal((await send('POST', `/api/conversations/${conversation.id}/stop`, {})).status, 200);
  assert.equal((await send('DELETE', `/api/conversations/${conversation.id}`)).status, 200);
  assert.equal((await fetch(`${app.url}/api/conversations/${conversation.id}`)).status, 404);
});
