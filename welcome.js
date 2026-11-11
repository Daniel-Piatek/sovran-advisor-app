// The welcome (Sovran Advisor): what a new student sees the first time the app opens. It
// keeps two things in settings: their name (owner.name) and that the welcome was seen
// (welcome.seen). It also says whether their assistant can start: the assistant is their
// own Claude Code (or ChatGPT's Codex, chosen in Settings) on this computer, signed in with
// their own account.

import { randomUUID } from 'node:crypto';
import { programReady } from './ai.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

const read = (db, key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
};
const write = (db, key, value) => {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, key, JSON.stringify(value));
};

// Is the chosen AI's program there (ai.js)? Asked once per run of the app (it takes a moment).
export const claudeReady = (command) => programReady(command);

export const getWelcome = (db, { command, provider = 'claude' }) => ({
  provider,
  seen: read(db, 'welcome.seen') === true,
  name: read(db, 'owner.name') ?? '',
  assistant_ready: claudeReady(command),
});

export function checkWelcomeInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('name' in input && (typeof input.name !== 'string' || input.name.trim().length > 80)) return 'A name is up to 80 letters.';
  if ('seen' in input && typeof input.seen !== 'boolean') return 'seen is true or false.';
  return null;
}

export function setWelcome(db, input, { command, provider = 'claude' }) {
  const problem = checkWelcomeInput(input);
  if (problem) throw fail(400, problem);
  if ('name' in input) write(db, 'owner.name', input.name.trim());
  if ('seen' in input) write(db, 'welcome.seen', input.seen);
  return getWelcome(db, { command, provider });
}
