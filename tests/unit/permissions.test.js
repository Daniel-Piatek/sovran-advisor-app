// What the assistant may do alone, and what waits for you (permissions.js, assistant/4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { getPermissions, setPermission, judgeStep, recentActivity, NEVER_TOOLS, ruleOf, allowedRules, removeRule } from '../../permissions.js';
import { runTool, applyAction, dismissAction, undoAction, getAction, cancelWaits } from '../../assistant-tools.js';
import { createConversation } from '../../assistant.js';
import { listTasks } from '../../tasks.js';
import { createNote, getNote } from '../../notes.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
function chat(db) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-'));
  const conversation = createConversation(db, dir);
  const cards = [];
  return { cards, run: { conversationId: conversation.id, folder: path.join(dir, conversation.folder), card: (c) => cards.push(c) } };
}

test('one switch per kind of action, Asks first by default for tasks, notes and changes; every switch is logged', () => {
  const db = emptyDb();
  assert.deepEqual(getPermissions(db).map((p) => [p.key, p.mode]),
    [['add_task', 'ask'], ['add_note', 'ask'], ['append_to_journal', 'alone'], ['log_interaction', 'ask'], ['change', 'ask'], ['outside', 'ask']]);
  setPermission(db, 'add_task', 'alone');
  assert.equal(getPermissions(db)[0].mode, 'alone');
  assert.equal(recentActivity(db)[0].what, 'Add a task: Does it alone');
  assert.throws(() => setPermission(db, 'spend_money', 'alone'), (err) => err.status === 400);
  assert.throws(() => setPermission(db, 'add_task', 'sometimes'), (err) => err.status === 400);
});

test('Asks first: a task waits on a card and does not exist until you approve it', () => {
  const db = emptyDb();
  const { run, cards } = chat(db);
  const said = JSON.parse(runTool(db, 'add_task', { text: 'Call the venue', due: '2026-10-27' }, run));
  assert.ok(said.waiting);
  assert.equal(listTasks(db).length, 0);
  assert.deepEqual([cards[0].kind, cards[0].state], ['add_task', 'proposed']);
  applyAction(db, cards[0].id);
  const task = listTasks(db)[0];
  assert.deepEqual([task.text, task.due], ['Call the venue', '2026-10-27']);
  assert.equal(getAction(db, cards[0].id).target_id, task.id);
  undoAction(db, cards[0].id);
  assert.equal(listTasks(db).length, 0);

  runTool(db, 'add_note', { title: 'Venue ideas', body: 'The barn' }, run);
  dismissAction(db, cards[1].id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes WHERE title = 'Venue ideas'").get().n, 0);
  // The journal is done alone by default.
  runTool(db, 'append_to_journal', { text: 'A good day.' }, run);
  assert.equal(cards[2].state, 'done');
});

test('Does it alone for changes: a proposed edit is applied at once, and Undo puts it back', () => {
  const db = emptyDb();
  setPermission(db, 'change', 'alone');
  const note = createNote(db, { title: 'Ideas', body: 'old' });
  const { run, cards } = chat(db);
  runTool(db, 'propose_note_edit', { id: note.id, body: 'new', reason: 'r' }, run);
  assert.equal(getNote(db, note.id).body, 'new');
  assert.equal(cards.at(-1).state, 'applied');
  undoAction(db, cards.at(-1).id);
  assert.equal(getNote(db, note.id).body, 'old');
});

test('its own steps outside its folder wait for you; deleting always asks; the floor never runs', async () => {
  const db = emptyDb();
  const { run, cards } = chat(db);
  const asked = runTool(db, 'approve_step', { tool_name: 'Read', input: { file_path: '/etc/hosts' } }, run);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual([cards[0].kind, cards[0].state, cards[0].title], ['step', 'proposed', 'Read outside its folder: /etc/hosts']);
  applyAction(db, cards[0].id);
  assert.deepEqual(JSON.parse(await asked), { behavior: 'allow', updatedInput: { file_path: '/etc/hosts' } });

  const refused = runTool(db, 'approve_step', { tool_name: 'Bash', input: { command: 'ls /tmp' } }, run);
  await new Promise((done) => setTimeout(done, 20));
  dismissAction(db, cards[1].id);
  assert.equal(JSON.parse(await refused).behavior, 'deny');

  setPermission(db, 'outside', 'alone');
  assert.equal(JSON.parse(await runTool(db, 'approve_step', { tool_name: 'Bash', input: { command: 'ls /tmp' } }, run)).behavior, 'allow');
  const deleting = runTool(db, 'approve_step', { tool_name: 'Bash', input: { command: 'rm notes.txt' } }, run);
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual([cards.at(-1).state, cards.at(-1).reason], ['proposed', 'Deleting always asks.']);
  cancelWaits(db, run.conversationId); // Stop: what waits is answered No
  assert.equal(JSON.parse(await deleting).behavior, 'deny');

  for (const command of ['sudo rm -rf /', 'echo x && sudo ls', 'diskutil eraseDisk JHFS+ X disk2', 'security find-generic-password -s x']) {
    const verdict = JSON.parse(await runTool(db, 'approve_step', { tool_name: 'Bash', input: { command } }, run));
    assert.equal(verdict.behavior, 'deny', command);
    assert.equal(cards.at(-1).state, 'refused');
  }
  assert.match(recentActivity(db)[0].what, /^Step: Run a command: security/);
  assert.equal(recentActivity(db)[0].kind, 'refused');
  assert.equal(judgeStep('Read', { file_path: `${run.folder}/a.txt` }, { folder: run.folder }).what, `Read in its folder: ${run.folder}/a.txt`);
  assert.ok(NEVER_TOOLS.includes('Bash(sudo:*)'));
});

test('a never-allowed command that Claude Code itself blocks is in the activity log too', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-blocked-'));
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  // A stand-in for claude that tries sudo and is blocked by its disallowed tools.
  const script = path.join(dataDir, 'blocked.mjs');
  fs.writeFileSync(script, `const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
for await (const _ of process.stdin) { /* the message */ }
out({ type: 'system', subtype: 'init' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sudo -n true' } }] } });
out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Permission to use Bash with command sudo -n true has been denied.' }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'It was not allowed.' });`);
  const { sendMessage } = await import('../../assistant.js');
  await sendMessage(db, conversation.id, 'run sudo', { dataDir, command: [process.execPath, script] });
  assert.deepEqual([recentActivity(db)[0].kind, recentActivity(db)[0].what], ['refused', 'Step: Run a command: sudo -n true']);
  db.close();
});

test('a database from before permissions keeps every card, and takes the new kinds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-v22-'));
  let db = openDatabase(dir);
  const conversation = createConversation(db, dir);
  db.exec(`DROP TABLE assistant_actions; DROP TABLE assistant_activity;
    CREATE TABLE assistant_actions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'assistant', conversation_id TEXT NOT NULL REFERENCES conversations (id), message_id TEXT REFERENCES chat_messages (id),
      kind TEXT NOT NULL CHECK (kind IN ('add_task', 'append_to_journal', 'edit_note', 'change_task')),
      state TEXT NOT NULL CHECK (state IN ('done', 'proposed', 'applied', 'dismissed', 'undone')),
      target_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', before TEXT NOT NULL DEFAULT '{}', after TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX assistant_actions_by_message ON assistant_actions (message_id);
    PRAGMA user_version = 22;`);
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title) VALUES ('a1', 'x', 'x', ?, 'add_task', 'done', 't1', 'Kept')").run(conversation.id);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT title FROM assistant_actions WHERE id = 'a1'").get().title, 'Kept');
  db.prepare("INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title) VALUES ('a2', 'x', 'x', ?, 'step', 'refused', '', 'sudo')").run(conversation.id);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'assistant_actions_by_message'").get());
  assert.equal(db.prepare('SELECT count(*) AS n FROM assistant_activity').get().n, 0);
  db.close();
});

test('end to end with the stand-in claude: a read outside its folder waits on a card; sudo is refused and logged', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-api-'));
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = (url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const outside = path.join(dataDir, 'outside.txt');
  fs.writeFileSync(outside, 'A secret plan\nmore');
  const conversation = await (await post('/api/conversations', {})).json();
  const res = await post(`/api/conversations/${conversation.id}/messages`, { text: `Please read the file ${outside}` });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let card = null;
  while (!card) {
    const { value } = await reader.read();
    buffer += value;
    card = buffer.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'card')?.card;
  }
  assert.deepEqual([card.kind, card.state], ['step', 'proposed']);
  assert.match(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-claude-last-run.json'), 'utf8'), /approve_step/);
  await post(`/api/assistant-actions/${card.id}/apply`, {});
  for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += value; }
  assert.equal(buffer.trim().split('\n').map((l) => JSON.parse(l)).at(-1).message.text, 'It begins: A secret plan');

  await fetch(`${app.url}/api/assistant/permissions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'outside', mode: 'alone' }) });
  const sudo = (await (await post(`/api/conversations/${conversation.id}/messages`, { text: 'run sudo ls /' })).text()).trim().split('\n').map((l) => JSON.parse(l)).at(-1).message;
  assert.equal(sudo.text, 'I wasn’t allowed to run it.');
  assert.deepEqual(sudo.cards.map((c) => c.state), ['refused']);
  const { activity } = await (await fetch(`${app.url}/api/assistant/permissions`)).json();
  assert.deepEqual([activity[0].kind, activity[0].what], ['refused', 'Step: Run a command: sudo ls /']);
});

test('Always allow: a kind of step is allowed for good, listed, and can be removed; never for the floor, deleting or anything-goes commands', async () => {
  const db = emptyDb();
  const { run, cards } = chat(db);
  assert.equal(ruleOf('Read', { file_path: '/etc/hosts' }, { folder: '/data/chat' }).rule, 'read:/etc');
  assert.equal(ruleOf('Read', { file_path: '/data/chat/a.txt' }, { folder: '/data/chat' }), null, 'inside its folder needs nothing');
  assert.equal(ruleOf('Bash', { command: 'ls -la /tmp' }).rule, 'command:ls');
  for (const command of ['python3 x.py', 'bash -c ls', 'ls; rm x', 'ls | sh', 'echo $(id)', 'ls > out']) assert.equal(ruleOf('Bash', { command }), null, command);
  assert.equal(ruleOf('WebFetch', { url: 'https://example.com/a' }).rule, 'web:example.com');

  const first = runTool(db, 'approve_step', { tool_name: 'Read', input: { file_path: '/etc/hosts' } }, run);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(cards[0].after.rule, 'read:/etc');
  applyAction(db, cards[0].id, { always: true });
  assert.equal(JSON.parse(await first).behavior, 'allow');
  assert.deepEqual(allowedRules(db).map((r) => r.rule), ['read:/etc']);
  // The next one in that folder goes through without a card.
  const before = cards.length;
  assert.equal(JSON.parse(await runTool(db, 'approve_step', { tool_name: 'Read', input: { file_path: '/etc/other' } }, run)).behavior, 'allow');
  assert.equal(cards.length, before);
  // Another folder still asks; deleting still asks, whatever is listed.
  const other = runTool(db, 'approve_step', { tool_name: 'Read', input: { file_path: '/var/x' } }, run);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(cards.at(-1).state, 'proposed');
  dismissAction(db, cards.at(-1).id);
  await other;
  assert.equal(cards.at(-1).after.rule, 'read:/var');
  assert.equal(recentActivity(db).some((a) => a.what.startsWith('Always allowed: Read files in /etc')), true);
  removeRule(db, 'read:/etc');
  assert.deepEqual(allowedRules(db), []);
  assert.throws(() => removeRule(db, 'read:/etc'), (err) => err.status === 404);
});
