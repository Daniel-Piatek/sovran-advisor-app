// Which AI answers (Sovran Advisor): the owner's own Claude (Claude Code) or their own ChatGPT
// (OpenAI's Codex), chosen in Settings › Your assistant. Either one runs on this computer,
// signed in with the owner's own plan, never an API key. Kept in settings (assistant.provider);
// Claude unless the owner chose ChatGPT. Changing it never touches the owner's data: the next
// answer, and every background helper, uses the one chosen.

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { codexArgs, lineReader } from './codex.js';

export const PROVIDERS = ['claude', 'codex'];
export const PROVIDER_NAMES = { claude: 'Claude', codex: 'ChatGPT' };
export const PROGRAM_NAMES = { claude: 'Claude Code', codex: 'Codex' };

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

export function getProvider(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'assistant.provider' AND deleted_at IS NULL").get();
  let value = 'claude';
  try { value = row ? JSON.parse(row.value) : 'claude'; } catch { /* the default */ }
  return PROVIDERS.includes(value) ? value : 'claude';
}

export function setProvider(db, provider) {
  if (!PROVIDERS.includes(provider)) throw fail(400, 'Choose claude or codex.');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, 'assistant.provider', JSON.stringify(provider));
  return provider;
}

// The one chosen, with the command that starts it: commands is { claude: [...], codex: [...] }.
export const chosenAI = (db, commands) => {
  const provider = getProvider(db);
  return { provider, command: commands[provider] };
};

// Is its program there? Asked once per program per run of the app (it takes a moment).
const found = new Map();
export function programReady(command) {
  const key = JSON.stringify(command);
  // Only a yes is kept: a program installed while the app runs is found on the next look.
  if (!found.get(key)) {
    const result = spawnSync(command[0], [...command.slice(1), '--version'], { timeout: 10_000, stdio: 'ignore', shell: process.platform === 'win32' });
    found.set(key, !result.error && result.status === 0);
  }
  return found.get(key);
}

// What a page sees: the choice, and whether each program is installed.
export const getAssistantChoice = (db, commands) => ({
  provider: getProvider(db),
  ready: Object.fromEntries(PROVIDERS.map((p) => [p, programReady(commands[p])])),
});

// The Check button (Settings › Your assistant’s AI, 2026-11-12, the owner’s wish): is the AI program
// on this computer, signed in, on a plan that may use it, and does it answer? It asks one tiny
// question, the way the Assistant does (the owner’s own sign-in, never an API key), and gives one
// plain result: working, missing (no program), signed_out, free (Claude’s Free plan: Claude Code
// needs Pro or higher) or other (with what the program said). The page turns it into steps.
export const CHECK_QUESTION = 'Reply with the single word: ready';
export const CHECK_TIMEOUT_MS = 120_000;

// One run of the program: { code, stdout, stderr, error, timedOut }, never a throw.
function run(command, args, { input = null, timeout = 20_000, env = process.env, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], [...command.slice(1), ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (error) { resolve({ code: null, stdout: '', stderr: '', error, timedOut: false }); return; }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => done({ code: null, stdout, stderr, error, timedOut }));
    child.on('close', (code) => done({ code, stdout, stderr, error: null, timedOut }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.trim())
  .filter((l) => l && !/^WARNING|^\d{4}-\d\d-\d\dT/.test(l))[0] ?? '';
// What a failure says, sorted: signed out, a plan that may not use it, or something else.
export function sortProblem(reason, provider = 'claude') {
  const text = String(reason ?? '');
  if (/not logged in|log ?in|sign(ed)? ?in|authenticat|unauthori[sz]ed|\b401\b|oauth|token (has )?(expired|revoked)|credentials/i.test(text)) return 'signed_out';
  if (provider === 'claude' && /free plan|upgrade|subscription|(do|does)(n['’]t| not) have access|not (available|included) (on|in|with) your plan|requires? (a )?(paid|pro\b)/i.test(text)) return 'free';
  return 'other';
}

export async function checkAssistant({ provider, command, folder, env, platform = process.platform }) {
  const base = { provider, program: PROGRAM_NAMES[provider], platform, command: command[0], plan: '', detail: '' };
  const result = (outcome, more = {}) => ({ ...base, result: outcome, ...more });
  // 1. Is it there?
  const version = await run(command, ['--version'], { env, timeout: 20_000 });
  if (version.error || version.code !== 0) return result('missing');
  found.set(JSON.stringify(command), true);
  // 2. Signed in? (Claude Code and Codex both say so without asking anything.)
  if (provider === 'claude') {
    const status = await run(command, ['auth', 'status', '--json'], { env, timeout: 30_000 });
    let state = null;
    try { state = JSON.parse(status.stdout); } catch { /* an older Claude Code: the question below tells */ }
    if (state && typeof state === 'object') {
      if (state.loggedIn === false) return result('signed_out');
      base.plan = typeof state.subscriptionType === 'string' ? state.subscriptionType : '';
      if (state.authMethod === 'claude.ai' && base.plan === 'free') return result('free');
    }
  } else {
    const status = await run(command, ['login', 'status'], { env, timeout: 30_000 });
    if (/not logged in|not signed in/i.test(`${status.stdout}\n${status.stderr}`)) return result('signed_out');
  }
  // 3. Does it answer? One tiny question, with nothing it may touch.
  fs.mkdirSync(folder, { recursive: true });
  const args = provider === 'codex'
    ? codexArgs(command, { sandbox: 'read-only' }).slice(command.length - 1)
    : ['-p', '--output-format', 'json', '--setting-sources', 'user', '--tools=', '--disable-slash-commands', '--no-session-persistence'];
  const asked = await run(command, args, { input: CHECK_QUESTION, env, cwd: folder, timeout: CHECK_TIMEOUT_MS });
  if (asked.timedOut) return result('other', { detail: `${PROGRAM_NAMES[provider]} didn’t answer within two minutes.` });
  let answer = '';
  let problem = '';
  if (provider === 'codex') {
    const reader = lineReader('codex', (event) => {
      if (event.type !== 'result') return;
      if (event.is_error) problem = event.result; else answer = event.result;
    });
    for (const line of asked.stdout.split('\n')) reader.line(line);
    if (!answer && !problem) problem = reader.state.problem ?? '';
  } else {
    let event = null;
    try { event = JSON.parse(asked.stdout.trim().split('\n').pop()); } catch { /* nothing readable */ }
    if (event?.is_error) problem = String(event.result ?? '');
    else if (event && typeof event.result === 'string') answer = event.result;
  }
  if (answer.trim() && asked.code === 0) return result('working');
  const reason = (problem || firstLine(asked.stderr) || firstLine(asked.stdout) || `It stopped (${asked.code}).`).slice(0, 300);
  return result(sortProblem(reason, provider), { detail: reason });
}
