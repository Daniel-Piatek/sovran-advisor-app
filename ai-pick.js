// Model and effort (the owner's wish, 2026-11-12): which Claude model answers in a chat, and how hard it
// thinks, chosen above the box to ask in. Part of the module `ai-pick` (off in a new install; Settings › Modules).
// Each chat keeps its own choice (a settings row `assistant.pick.<chat id>`); the last choice made is also
// kept as `assistant.pick`, so a new chat starts with it. "Usual" (an empty value) passes nothing: Claude Code
// then uses its own default, exactly as before this module. Only for Claude (Claude Code's --model and --effort);
// ChatGPT answers as it always did.

import { randomUUID } from 'node:crypto';

// Claude Code's own short names: each always means the newest model of its kind.
export const MODELS = [
  { id: '', label: 'Usual', hint: 'Claude Code’s own choice' },
  { id: 'haiku', label: 'Haiku', hint: 'quick and light' },
  { id: 'sonnet', label: 'Sonnet', hint: 'balanced' },
  { id: 'opus', label: 'Opus', hint: 'deep thinking' },
  { id: 'fable', label: 'Fable', hint: 'most capable, uses your plan fastest' },
];
export const EFFORTS = [
  { id: '', label: 'Usual', hint: 'Claude Code’s own choice' },
  { id: 'low', label: 'Low', hint: 'quick answers' },
  { id: 'medium', label: 'Medium', hint: 'a little thought' },
  { id: 'high', label: 'High', hint: 'thinks longer' },
  { id: 'xhigh', label: 'Extra high', hint: 'thinks much longer' },
  { id: 'max', label: 'Max', hint: 'as long as it takes' },
];

const USUAL = { model: '', effort: '' };
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const keyOf = (chatId) => (chatId ? `assistant.pick.${chatId}` : 'assistant.pick');

function read(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key);
  if (!row) return null;
  try {
    const value = JSON.parse(row.value);
    return {
      model: MODELS.some((m) => m.id === value?.model) ? value.model : '',
      effort: EFFORTS.some((e) => e.id === value?.effort) ? value.effort : '',
    };
  } catch { return null; }
}

function write(db, key, pick) {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, key, JSON.stringify(pick));
}

// A chat's choice: its own, else the last one made (what a new chat starts with), else Usual.
export const getPick = (db, chatId = null) => (chatId && read(db, keyOf(chatId))) || read(db, keyOf(null)) || { ...USUAL };

export function checkPickInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('chat' in input && input.chat !== null && (typeof input.chat !== 'string' || !/^[0-9a-f-]{36}$/.test(input.chat))) return 'chat is a chat’s id.';
  if ('model' in input && !MODELS.some((m) => m.id === input.model)) return `model is one of: ${MODELS.map((m) => m.id || '""').join(', ')}.`;
  if ('effort' in input && !EFFORTS.some((e) => e.id === input.effort)) return `effort is one of: ${EFFORTS.map((e) => e.id || '""').join(', ')}.`;
  return null;
}

// Keeps the choice for the chat (when one is named) and as the one a new chat starts with.
export function setPick(db, { chat = null, ...change }) {
  const problem = checkPickInput({ chat, ...change });
  if (problem) throw fail(400, problem);
  const pick = { ...getPick(db, chat), ...change };
  const kept = { model: pick.model, effort: pick.effort };
  if (chat) write(db, keyOf(chat), kept);
  write(db, keyOf(null), kept);
  return kept;
}

// What the page needs: the choices and what this chat has.
export const pickState = (db, chatId, on) => ({ on, models: MODELS, efforts: EFFORTS, ...getPick(db, chatId) });

// The claude command's flags for a choice: none for Usual.
export const pickArgs = (pick) => [
  ...(pick?.model ? ['--model', pick.model] : []),
  ...(pick?.effort ? ['--effort', pick.effort] : []),
];
