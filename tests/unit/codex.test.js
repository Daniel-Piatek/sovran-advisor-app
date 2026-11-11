// ChatGPT as the assistant (ai.js, codex.js): chosen in Settings, answered by the stand-in codex
// command, the same way the stand-in claude answers for Claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../db.js';
import { createConversation, getConversation, sendMessage } from '../../assistant.js';
import { asClaudeEvents, codexArgs, codexEnv, TOKEN_ENV } from '../../codex.js';
import { getProvider, setProvider } from '../../ai.js';
import { startServer } from '../../server.js';

const fakeCodex = [process.execPath, fileURLToPath(new URL('../fake-codex.js', import.meta.url))];
const fakeClaude = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
const lastRun = (dataDir, conversation) => JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-codex-last-run.json'), 'utf8'));

test('the choice: Claude unless ChatGPT was chosen; nothing else is taken', () => {
  const db = openDatabase(scratch());
  assert.equal(getProvider(db), 'claude');
  setProvider(db, 'codex');
  assert.equal(getProvider(db), 'codex');
  assert.throws(() => setProvider(db, 'gemini'), /claude or codex/);
  assert.equal(getProvider(db), 'codex');
  db.close();
});

test('Codex’s events read as Claude Code’s: the thread, each step, the words, the end', () => {
  const state = {};
  const all = [
    { type: 'thread.started', thread_id: 't1' },
    { type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'app', tool: 'search_notes', arguments: { query: 'bank' }, status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'app', tool: 'search_notes', arguments: { query: 'bank' }, status: 'completed' } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'One.' } },
    { type: 'item.completed', item: { id: 'i3', type: 'command_execution', command: 'ls', exit_code: 1, status: 'failed' } },
    { type: 'error', message: 'Reconnecting... 1/5' },
    { type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: 'Two.' } },
    { type: 'turn.completed', usage: {} },
  ].flatMap((e) => asClaudeEvents(e, state));
  assert.deepEqual(all[0], { type: 'system', subtype: 'init', session_id: 't1' });
  assert.equal(all[1].message.content[0].name, 'mcp__app__search_notes');
  assert.equal(all.filter((e) => e.type === 'user')[0].message.content[0].is_error, false);
  assert.equal(all.filter((e) => e.type === 'user')[1].message.content[0].is_error, true, 'a failed command is a failed step');
  assert.deepEqual(all.filter((e) => e.type === 'stream_event').map((e) => e.event.delta.text), ['One.', '\n\nTwo.']);
  assert.deepEqual(all.at(-1), { type: 'result', subtype: 'success', is_error: false, result: 'One.\n\nTwo.' });
  assert.equal(state.problem, 'Reconnecting... 1/5', 'kept only as a reason, if no answer comes');
  assert.deepEqual(asClaudeEvents({ type: 'turn.failed', error: { message: 'Not signed in' } }, {}).at(-1).result, 'Not signed in');
});

test('Codex runs locked down: no shell, no web, not the owner’s own settings; the secret only in its environment', () => {
  const args = codexArgs(fakeCodex, { instructions: 'Be “brief”.', servers: { app: { url: 'http://127.0.0.1:1/api/mcp?conversation=c', token: true } }, sandbox: 'workspace-write', resume: 't9' });
  const config = args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));
  assert.ok(args.includes('--ignore-user-config') && args.includes('--skip-git-repo-check') && args.includes('--json'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'workspace-write']);
  assert.ok(config.includes('approval_policy="never"') && config.includes('web_search="disabled"'));
  assert.ok(config.includes('developer_instructions="Be “brief”."'));
  assert.ok(config.includes(`mcp_servers.app.bearer_token_env_var="${TOKEN_ENV}"`));
  assert.ok(!args.join(' ').includes('Bearer'), 'the secret never goes in the arguments');
  assert.deepEqual(args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 4), ['--disable', 'shell_tool', '--disable', 'apps'], 'only the parts this Codex has');
  assert.deepEqual(args.slice(-3), ['resume', 't9', '-']);
  process.env.OPENAI_API_KEY = 'not-to-be-used';
  const env = codexEnv('s3cret');
  delete process.env.OPENAI_API_KEY;
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env[TOKEN_ENV], 's3cret');
});

test('a conversation with ChatGPT carries on its own thread; switching AI starts afresh there, told what was said', async () => {
  const dataDir = scratch();
  process.env.CODEX_HOME = path.join(dataDir, '.codex-home');
  const db = openDatabase(dataDir);
  const conversation = createConversation(db, dataDir);
  const parts = [];
  process.env.OPENAI_API_KEY = 'not-to-be-used';
  const first = await sendMessage(db, conversation.id, 'Hello there', { dataDir, command: fakeCodex, provider: 'codex', send: (e) => parts.push(e) });
  delete process.env.OPENAI_API_KEY;
  assert.deepEqual([first.state, first.text], ['done', 'You said: Hello there']);
  assert.deepEqual([first.ai, first.model], ['codex', 'gpt-6.1-sol'], 'each answer says which AI and model gave it');
  assert.equal(parts.at(-1).type, 'done');
  assert.equal(lastRun(dataDir, conversation).api_key, false, 'never an API key: their ChatGPT sign-in');
  const thread = getConversation(db, conversation.id).session_id;
  assert.match(thread, /^codex:/);

  const again = await sendMessage(db, conversation.id, 'What did I ask?', { dataDir, command: fakeCodex, provider: 'codex' });
  assert.equal(again.text, 'You asked: Hello there');
  assert.deepEqual(lastRun(dataDir, conversation).args.slice(-3), ['resume', thread.slice(6), '-']);

  // Now with Claude: a fresh Claude conversation, told what was said so far.
  const claude = await sendMessage(db, conversation.id, 'What did I ask?', { dataDir, command: fakeClaude });
  assert.equal(claude.state, 'done');
  assert.deepEqual([claude.ai, claude.model], ['claude', 'claude-opus-5-5']);
  assert.equal(getConversation(db, conversation.id).messages.find((m) => m.role === 'user').ai, '', 'only answers carry an AI');
  const now = getConversation(db, conversation.id);
  assert.doesNotMatch(now.session_id, /^codex:/);
  const claudeRun = JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-claude-last-run.json'), 'utf8'));
  assert.ok(claudeRun.args.includes('--session-id'), 'a new Claude conversation, not a resume');
  const told = JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, `.fake-claude-${now.session_id}.json`), 'utf8'))[0];
  assert.match(told, /began with the owner’s other assistant/);
  assert.match(told, /Owner: Hello there/);

  const failed = await sendMessage(db, createConversation(db, dataDir).id, 'fail', { dataDir, command: fakeCodex, provider: 'codex' });
  assert.equal(failed.state, 'failed');
  assert.match(failed.text, /not signed in to ChatGPT/);
  delete process.env.CODEX_HOME;
  db.close();
});

test('through the app: Settings chooses ChatGPT, and it uses the app’s tools end to end', async (t) => {
  const dataDir = scratch();
  const app = await startServer({ port: 0, dataDir, assistantCommand: fakeClaude, codexCommand: fakeCodex, readCalendarsEvery: 0, readCaptures: false, writeTitles: false });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const call = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.deepEqual(await (await call('GET', '/api/assistant/ai')).json(), { provider: 'claude', ready: { claude: true, codex: true } });
  assert.equal((await call('PUT', '/api/assistant/ai', { provider: 'nope' })).status, 400);
  assert.equal((await (await call('PUT', '/api/assistant/ai', { provider: 'codex' })).json()).provider, 'codex');
  assert.equal((await (await call('GET', '/api/welcome')).json()).provider, 'codex');

  const note = await (await call('POST', '/api/notes', { title: 'Bank call', body: 'They will send the new rate by Friday.' })).json();
  const conversation = await (await call('POST', '/api/conversations', {})).json();
  const lines = (await (await call('POST', `/api/conversations/${conversation.id}/messages`, { text: 'What did I write about the bank?' })).text())
    .trim().split('\n').map((l) => JSON.parse(l));
  const answer = lines.at(-1).message;
  assert.equal(answer.text, `Let me look.\n\nYou wrote in [Bank call](/notes/${note.id}): “They will send the new rate by Friday.”`);
  assert.deepEqual(answer.steps.map((s) => [s.tool, s.state]), [['mcp__app__search_notes', 'done'], ['mcp__app__read_note', 'done']]);
  assert.deepEqual(answer.sources.map((s) => s.title), ['Bank call']);
  const run = lastRun(dataDir, conversation);
  assert.equal(run.token, true, 'the app’s secret reached it, in its environment');
});

test('the model, named in a few words; the chat list says which AI answered last', async () => {
  const { modelName, aiLabel } = await import('../../public/ai-names.js');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelName('gpt-6.1-sol'), 'GPT-6.1 Sol');
  assert.equal(modelName(''), '');
  assert.equal(aiLabel({ ai: 'codex', model: 'gpt-6.1-sol' }), 'ChatGPT (GPT-6.1 Sol)');
  assert.equal(aiLabel({ ai: 'claude', model: '' }), 'Claude');
  assert.equal(aiLabel({ ai: 'claude', model: 'claude-opus-5-5' }), 'Claude Opus 5.5');
  assert.equal(aiLabel({ ai: '', model: '' }), '');
  const dataDir = scratch();
  const db = openDatabase(dataDir);
  const { listConversations } = await import('../../assistant.js');
  const a = createConversation(db, dataDir);
  createConversation(db, dataDir);
  await sendMessage(db, a.id, 'Hello', { dataDir, command: fakeCodex, provider: 'codex' });
  assert.deepEqual(listConversations(db).map((c) => c.last_ai).sort(), ['', 'codex']);
  db.close();
});
