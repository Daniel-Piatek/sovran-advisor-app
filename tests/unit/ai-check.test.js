// The Check button (ai.js): one plain result from the real steps, run against the stand-in programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssistant, sortProblem } from '../../ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeClaude = [process.execPath, path.join(here, '..', 'fake-claude.js')];
const fakeCodex = [process.execPath, path.join(here, '..', 'fake-codex.js')];

function setUp(auth) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-check-'));
  if (auth) fs.writeFileSync(path.join(dir, 'fake-claude-auth.json'), JSON.stringify(auth));
  return { folder: path.join(dir, 'check'), env: { ...process.env, DATA_DIR: dir } };
}

test('signed in on Pro and answering: works, with the plan', async () => {
  const state = await checkAssistant({ provider: 'claude', command: fakeClaude, ...setUp(), platform: 'darwin' });
  assert.equal(state.result, 'working');
  assert.equal(state.plan, 'pro');
  assert.equal(state.program, 'Claude Code');
  assert.equal(state.platform, 'darwin');
});

test('no program: missing', async () => {
  const state = await checkAssistant({ provider: 'claude', command: ['sovran-no-such-program'], ...setUp() });
  assert.equal(state.result, 'missing');
});

test('not signed in: signed_out, without asking anything', async () => {
  const state = await checkAssistant({ provider: 'claude', command: fakeClaude, ...setUp({ loggedIn: false, authMethod: 'none' }) });
  assert.equal(state.result, 'signed_out');
});

test('a Free plan: free', async () => {
  const state = await checkAssistant({ provider: 'claude', command: fakeClaude, ...setUp({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'free' }) });
  assert.equal(state.result, 'free');
});

test('signed in but the sign-in expired when asked: signed_out', async () => {
  const state = await checkAssistant({ provider: 'claude', command: fakeClaude, ...setUp({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', fails: 'OAuth token has expired · Please run /login' }) });
  assert.equal(state.result, 'signed_out');
});

test('anything else: other, with what it said', async () => {
  const state = await checkAssistant({ provider: 'claude', command: fakeClaude, ...setUp({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', fails: 'You’ve hit your limit · resets 3pm' }) });
  assert.equal(state.result, 'other');
  assert.match(state.detail, /hit your limit/);
});

test('ChatGPT (Codex) signed in and answering: works', async () => {
  const state = await checkAssistant({ provider: 'codex', command: fakeCodex, ...setUp() });
  assert.equal(state.result, 'working');
  assert.equal(state.program, 'Codex');
});

test('sorts what a failure says', () => {
  assert.equal(sortProblem('Not logged in · Please run /login'), 'signed_out');
  assert.equal(sortProblem('Invalid API key · Please run /login'), 'signed_out');
  assert.equal(sortProblem('You are not signed in to ChatGPT. Run codex and sign in.', 'codex'), 'signed_out');
  assert.equal(sortProblem('Your account does not have access to Claude Code. Upgrade to Pro.'), 'free');
  assert.equal(sortProblem('Please upgrade your plan', 'codex'), 'other');
  assert.equal(sortProblem('Unable to connect to API (ECONNREFUSED)'), 'other');
});
