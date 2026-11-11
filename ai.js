// Which AI answers (Sovran Advisor): the owner's own Claude (Claude Code) or their own ChatGPT
// (OpenAI's Codex), chosen in Settings › Your assistant. Either one runs on this computer,
// signed in with the owner's own plan, never an API key. Kept in settings (assistant.provider);
// Claude unless the owner chose ChatGPT. Changing it never touches the owner's data: the next
// answer, and every background helper, uses the one chosen.

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
  if (!found.has(key)) {
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
