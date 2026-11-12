// Model and effort (ai-pick.js, module ai-pick): off, Claude Code chooses as before; on, each chat keeps its own
// model and effort, a new chat starts with the last one chosen, and they reach the claude command as flags.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../db.js';
import { getPick, setPick, pickArgs } from '../../ai-pick.js';
import { startServer } from '../../server.js';

const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const fakeCodex = [process.execPath, fileURLToPath(new URL('../fake-codex.js', import.meta.url))];
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pick-'));
const lastRun = (dataDir, conversation) => JSON.parse(fs.readFileSync(path.join(dataDir, conversation.folder, '.fake-claude-last-run.json'), 'utf8'));
const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

test('a chat keeps its own choice; a new chat starts with the last one; only known values are taken', () => {
  const db = openDatabase(scratch());
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(getPick(db, a), { model: '', effort: '' }, 'Usual until chosen');
  setPick(db, { chat: a, provider: 'codex', model: 'gpt-6-luna', effort: 'max' });
  assert.deepEqual(getPick(db, a, 'claude'), { model: '', effort: '' }, 'ChatGPT’s choice is its own');
  setPick(db, { chat: a, model: 'haiku', effort: 'low' });
  setPick(db, { chat: b, model: 'opus' });
  assert.deepEqual(getPick(db, a), { model: 'haiku', effort: 'low' });
  assert.deepEqual(getPick(db, b), { model: 'opus', effort: 'low' }, 'what was not changed comes from the last choice');
  assert.deepEqual(getPick(db, null), { model: 'opus', effort: 'low' }, 'a new chat starts with the last choice');
  assert.deepEqual(getPick(db, a, 'codex'), { model: 'gpt-6-luna', effort: 'max' }, 'and Claude’s never touched it');
  assert.throws(() => setPick(db, { chat: a, model: 'gpt-6-luna' }), /model is one of/, 'a ChatGPT model is not a Claude one');
  assert.throws(() => setPick(db, { chat: a, provider: 'gemini' }), /claude or codex/);
  assert.throws(() => setPick(db, { effort: 'huge' }), /effort is one of/);
  assert.deepEqual(pickArgs({ model: '', effort: '' }), []);
  assert.deepEqual(pickArgs({ model: 'sonnet', effort: 'xhigh' }), ['--model', 'sonnet', '--effort', 'xhigh']);
  db.close();
});

test('off: no flags and no choosing; on: the chat’s choice reaches the claude command', async (t) => {
  const dataDir = scratch();
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = async (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const chat = await (await send('POST', '/api/conversations', {})).json();
  assert.equal((await (await send('GET', `/api/assistant/pick?chat=${chat.id}`)).json()).on, true, 'on in a new install');
  await send('PATCH', '/api/modules', { id: 'ai-pick', on: false });
  const state = await (await send('GET', `/api/assistant/pick?chat=${chat.id}`)).json();
  assert.equal(state.on, false, 'switched off');
  assert.equal((await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'haiku' })).status, 409);
  await (await send('POST', `/api/conversations/${chat.id}/messages`, { text: 'Hello' })).text();
  let args = lastRun(dataDir, chat).args;
  assert.equal(flag(args, '--model'), null);
  assert.equal(flag(args, '--effort'), null);

  assert.equal((await send('PATCH', '/api/modules', { id: 'ai-pick', on: true })).status, 200);
  assert.equal((await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'nope' })).status, 400);
  const kept = await (await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'haiku', effort: 'high' })).json();
  assert.deepEqual([kept.on, kept.model, kept.effort], [true, 'haiku', 'high']);
  await (await send('POST', `/api/conversations/${chat.id}/messages`, { text: 'Again' })).text();
  args = lastRun(dataDir, chat).args;
  assert.equal(flag(args, '--model'), 'haiku');
  assert.equal(flag(args, '--effort'), 'high');
  assert.ok(args.includes('--resume'), 'the same conversation carries on with the new model');

  assert.equal((await send('PATCH', '/api/modules', { id: 'ai-pick', on: false })).status, 200);
  await (await send('POST', `/api/conversations/${chat.id}/messages`, { text: 'Once more' })).text();
  assert.equal(flag(lastRun(dataDir, chat).args, '--model'), null, 'off again: Claude Code chooses, the choice is kept');
  assert.equal((await (await send('GET', `/api/assistant/pick?chat=${chat.id}`)).json()).model, 'haiku');
});

test('ChatGPT: the chat’s own model and effort reach the codex command; Claude’s choice stays apart', async (t) => {
  const dataDir = scratch();
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, codexCommand: fakeCodex, readCalendarsEvery: 0, readCaptures: false, writeTitles: false });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = async (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  await send('PATCH', '/api/modules', { id: 'ai-pick', on: true });
  const chat = await (await send('POST', '/api/conversations', {})).json();
  await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'opus' }); // Claude answers now
  await send('PUT', '/api/assistant/ai', { provider: 'codex' });
  const state = await (await send('GET', `/api/assistant/pick?chat=${chat.id}`)).json();
  assert.equal(state.provider, 'codex');
  assert.equal(state.model, '', 'ChatGPT starts at Usual');
  assert.ok(state.models.some((m) => m.id === 'gpt-6-luna') && !state.models.some((m) => m.id === 'opus'));
  assert.equal((await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'opus' })).status, 400, 'a Claude model is not offered to ChatGPT');
  await send('PUT', '/api/assistant/pick', { chat: chat.id, model: 'gpt-6-luna', effort: 'high' });
  await (await send('POST', `/api/conversations/${chat.id}/messages`, { text: 'Hello' })).text();
  const run = JSON.parse(fs.readFileSync(path.join(dataDir, chat.folder, '.fake-codex-last-run.json'), 'utf8'));
  assert.equal(flag(run.args, '--model'), 'gpt-6-luna');
  assert.ok(run.args.includes('model_reasoning_effort="high"'));
  await send('PUT', '/api/assistant/ai', { provider: 'claude' });
  assert.equal((await (await send('GET', `/api/assistant/pick?chat=${chat.id}`)).json()).model, 'opus', 'Claude’s choice was kept');
});
