// The assistant's tools (assistant-tools.js) over MCP (mcp.js), and its cards (assistant/2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, getNote, updateNote } from '../../notes.js';
import { createEntry } from '../../entries.js';
import { createTask, getTask, listTasks, localDay } from '../../tasks.js';
import { setModule } from '../../modules.js';
import { addDays } from '../../public/due.js';
import { runTool, applyAction, dismissAction, undoAction, getAction } from '../../assistant-tools.js';
import { createConversation } from '../../assistant.js';
import { setPermission } from '../../permissions.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];

function withConversation(db) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'));
  const conversation = createConversation(db, dir);
  const cards = [];
  const read = [];
  return { cards, read, run: { conversationId: conversation.id, messageId: null, card: (c) => cards.push(c), read: (p) => read.push(p) } };
}

test('search and read: notes, journal entries and people, by the same code the app uses', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Bank call', body: 'Called the bank about the mortgage.' });
  createEntry(db, { day: '2026-10-20', body: 'The bank said yes.' });
  const { run, read } = withConversation(db);
  const found = JSON.parse(runTool(db, 'search_notes', { query: 'bank' }, run));
  assert.deepEqual(found.map((f) => f.kind), ['note', 'journal entry']);
  assert.equal(found[0].path, `/notes/${note.id}`);
  const page = JSON.parse(runTool(db, 'read_note', { id: note.id }, run));
  assert.equal(page.text, 'Called the bank about the mortgage.');
  assert.deepEqual(read.map((p) => p.id), [note.id]);
  assert.equal(runTool(db, 'search_notes', { query: 'zebra' }, run), 'Nothing found for those words.');
  assert.throws(() => runTool(db, 'read_note', { id: 'nope' }, run), (err) => err.status === 404);
});

test('switched to Does it alone, what you asked for goes straight in, marked as made by the assistant, and Undo takes it back', () => {
  const db = emptyDb();
  setPermission(db, 'add_task', 'alone');
  const { run, cards } = withConversation(db);
  runTool(db, 'add_task', { text: 'Call the venue', due: '2026-10-30' }, run);
  const task = listTasks(db).find((t) => t.text === 'Call the venue');
  assert.equal(task.due, '2026-10-30');
  assert.equal(db.prepare('SELECT origin FROM tasks WHERE id = ?').get(task.id).origin, 'assistant');
  assert.deepEqual([cards[0].kind, cards[0].state], ['add_task', 'done']);
  undoAction(db, cards[0].id);
  assert.equal(getTask(db, task.id), null);
  assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM tasks WHERE id = ?').get(task.id).gone, 1, 'only marked deleted');
  assert.throws(() => runTool(db, 'add_task', { text: '' }, run), (err) => err.status === 400);

  runTool(db, 'append_to_journal', { text: 'Met Lena for lunch.' }, run);
  const entry = db.prepare("SELECT id, origin FROM journal_entries WHERE body = 'Met Lena for lunch.'").get();
  assert.equal(entry.origin, 'assistant');
  undoAction(db, cards[1].id);
  assert.ok(db.prepare('SELECT deleted_at FROM journal_entries WHERE id = ?').get(entry.id).deleted_at);
});

test('it proposes, you decide: nothing changes until Apply; Undo puts it back; Dismiss leaves it', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Ideas', body: 'first  idea\nsecond idea' });
  const { run, cards } = withConversation(db);
  runTool(db, 'propose_note_edit', { id: note.id, body: 'First idea\n\nSecond idea', reason: 'Tidied' }, run);
  assert.equal(getNote(db, note.id).body, 'first  idea\nsecond idea');
  assert.equal(cards[0].state, 'proposed');
  assert.equal(applyAction(db, cards[0].id).state, 'applied');
  assert.equal(getNote(db, note.id).body, 'First idea\n\nSecond idea');
  assert.throws(() => applyAction(db, cards[0].id), (err) => err.status === 409);
  assert.equal(undoAction(db, cards[0].id).state, 'undone');
  assert.equal(getNote(db, note.id).body, 'first  idea\nsecond idea');

  // Changed by hand after it was proposed. With Writing and thinking off, Apply refuses rather than overwrite.
  setModule(db, 'writing', false);
  runTool(db, 'propose_note_edit', { id: note.id, title: 'Better ideas', reason: 'A clearer name' }, run);
  updateNote(db, note.id, { body: 'typed since' });
  assert.throws(() => applyAction(db, cards[1].id), (err) => err.status === 409);
  assert.equal(dismissAction(db, cards[1].id).state, 'dismissed');
  assert.equal(getNote(db, note.id).title, 'Ideas');
  // With it on (the default), the two changes are merged: the words you typed stay, and the new name comes in (advanced/writing/5).
  setModule(db, 'writing', true);
  runTool(db, 'propose_note_edit', { id: note.id, title: 'Better ideas', reason: 'A clearer name' }, run);
  updateNote(db, note.id, { body: 'typed again' });
  assert.equal(applyAction(db, cards[2].id).state, 'applied');
  assert.deepEqual([getNote(db, note.id).title, getNote(db, note.id).body], ['Better ideas', 'typed again']);
  updateNote(db, note.id, { title: 'Ideas' });

  const task = createTask(db, { text: 'Pay rent', due: '2026-10-26' });
  runTool(db, 'propose_task_change', { id: task.id, done: true, reason: 'You said so' }, run);
  assert.equal(getTask(db, task.id).done, false);
  applyAction(db, cards[3].id);
  assert.equal(getTask(db, task.id).done, true);
  undoAction(db, cards[3].id);
  assert.equal(getTask(db, task.id).done, false);
  assert.equal(getAction(db, cards[3].id).state, 'undone');
});

test('a database from before the tools gets sources, context and cards, every message kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-v20-'));
  let db = openDatabase(dir);
  const conversation = createConversation(db, dir);
  db.prepare("INSERT INTO chat_messages (id, created_at, updated_at, conversation_id, role, text) VALUES ('m1', 'x', 'x', ?, 'user', 'Kept')").run(conversation.id);
  db.exec('DROP TABLE assistant_actions; ALTER TABLE chat_messages DROP COLUMN sources; ALTER TABLE chat_messages DROP COLUMN context; PRAGMA user_version = 20;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare('SELECT text, sources, context FROM chat_messages').get() }, { text: 'Kept', sources: '[]', context: '' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM assistant_actions').get().n, 0);
  db.close();
});

test('MCP: only with the app’s secret; tools listed and called; the stand-in Claude uses them end to end', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-api-'));
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = (url, body, headers = {}) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
  assert.equal((await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong' })).status, 401);

  const note = await (await post('/api/notes', { title: 'Bank call', body: 'They will send the new rate by Friday.' })).json();
  const conversation = await (await post('/api/conversations', {})).json();
  const ask = async (text, context) => {
    const lines = (await (await post(`/api/conversations/${conversation.id}/messages`, { text, ...(context ? { context } : {}) })).text()).trim().split('\n').map((l) => JSON.parse(l));
    return { lines, message: lines.at(-1).message };
  };
  const { message: about } = await ask('What did I write about the bank?');
  assert.equal(about.text, `You wrote in [Bank call](/notes/${note.id}): “They will send the new rate by Friday.”`);
  assert.deepEqual(about.sources, [{ id: note.id, kind: 'note', title: 'Bank call', path: `/notes/${note.id}` }]);
  assert.deepEqual(about.steps.map((s) => s.tool), ['mcp__app__search_notes', 'mcp__app__read_note']);
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'assistant', '.mcp', `${conversation.id}.json`), 'utf8')).mcpServers.app;
  assert.equal((fs.statSync(path.join(dataDir, 'assistant', '.mcp', `${conversation.id}.json`)).mode & 0o777), 0o600);
  const run = JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-claude-last-run.json'), 'utf8'));
  assert.ok(run.args.includes('--strict-mcp-config') && run.args.includes('mcp__app'));
  const listed = await (await post('/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, config.headers)).json();
  assert.deepEqual(listed.result.tools.map((tool) => tool.name),
    ['search_notes', 'read_note', 'docs_read', 'list_tasks', 'list_inbox', 'add_task', 'reconnect_list', 'log_interaction', 'calendar_list', 'calendar_propose', 'board_read', 'board_draw', 'list_comments', 'reply_to_comment', 'add_note', 'append_to_journal', 'propose_note_edit', 'approve_step', 'read_week', 'read_day', 'propose_plan', 'propose_close_day', 'propose_task_change']);

  await fetch(`${app.url}/api/assistant/permissions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'add_task', mode: 'alone' }) });
  const { lines, message: added } = await ask('Add a task: call the venue on 2026-10-30');
  assert.ok(lines.some((l) => l.type === 'card'), 'the card arrives while it answers');
  assert.deepEqual(added.cards.map((c) => [c.kind, c.state, c.title]), [['add_task', 'done', 'call the venue']]);
  assert.equal((await (await fetch(`${app.url}/api/tasks`)).json()).find((task) => task.text === 'call the venue').due, '2026-10-30');
  assert.equal((await (await post(`/api/assistant-actions/${added.cards[0].id}/undo`, {})).json()).state, 'undone');
  assert.equal((await post(`/api/assistant-actions/${added.cards[0].id}/undo`, {})).status, 409);

  const { message: decided } = await ask('What did I decide here?', { path: `/notes/${note.id}`, title: 'Bank call' });
  assert.match(decided.text, /Here you decided: “They will send the new rate by Friday\.”/);
  const shown = (await (await fetch(`${app.url}/api/conversations/${conversation.id}`)).json()).messages.at(-2);
  assert.deepEqual([shown.text, shown.context], ['What did I decide here?', { path: `/notes/${note.id}`, title: 'Bank call' }]);
});

test('the assistant adds a task from the owner’s own words, as quick add reads them; off, the words stay as they are', () => {
  const db = emptyDb();
  setPermission(db, 'add_task', 'alone');
  const { run } = withConversation(db);
  runTool(db, 'add_task', { text: 'reply to Lena tomorrow ~5m' }, run);
  runTool(db, 'add_task', { text: 'water the plants every monday 9am !like' }, run);
  runTool(db, 'add_task', { text: 'call the printer friday', due: '2026-12-01', estimate: 20 }, run); // said outright: wins over the words
  runTool(db, 'add_task', { text: 'tidy the desk' }, run);
  const tasks = Object.fromEntries(listTasks(db).map((t) => [t.text, t]));
  assert.equal(tasks['reply to Lena'].estimate, 5);
  assert.equal(tasks['reply to Lena'].due, addDays(localDay(), 1));
  assert.deepEqual([tasks['water the plants'].repeat, tasks['water the plants'].flag], ['every monday', 'like']);
  assert.match(db.prepare('SELECT at FROM reminders WHERE task_id = ?').get(tasks['water the plants'].id).at, /T09:00$/);
  assert.deepEqual([tasks['tidy the desk'].due, tasks['tidy the desk'].estimate], ['', null]);
  const outright = listTasks(db).find((t) => t.due === '2026-12-01');
  assert.deepEqual([outright.estimate, outright.text], [20, 'call the printer']);

  setModule(db, 'tasks-plus', false);
  runTool(db, 'add_task', { text: 'file the form tomorrow ~5m' }, run);
  const plain = listTasks(db).find((t) => t.text === 'file the form tomorrow ~5m');
  assert.deepEqual([plain.due, plain.estimate], ['', null]);
});
