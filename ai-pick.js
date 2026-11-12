// Model and effort (the owner's wish, 2026-11-12): which model answers in a chat, and how hard it thinks,
// chosen above the box to ask in. Part of the module `ai-pick` (off in a new install; Settings › Modules).
// Each chat keeps its own choice (a settings row `assistant.pick.<chat id>`); the last choice made is also
// kept as `assistant.pick`, so a new chat starts with it. Claude and ChatGPT each have their own choice
// ({ claude: { model, effort }, codex: { model, effort } }), so switching the AI in Settings never mixes them.
// "Usual" (an empty value) passes nothing: the program then uses its own default, exactly as before this module.
// Claude: Claude Code's --model and --effort. ChatGPT: Codex's --model and model_reasoning_effort.

import { randomUUID } from 'node:crypto';

const USUAL_ROW = { id: '', label: 'Usual', hint: 'its own choice' };
// Claude Code's own short names: each always means the newest model of its kind.
// Codex has no short names, so its models are named as Codex lists them (2026-11-12, Codex 0.167):
// a newer ChatGPT model needs this list updated; Usual always follows Codex's own default.
export const MODELS = {
  claude: [
    { ...USUAL_ROW, hint: 'Claude Code’s own choice' },
    { id: 'haiku', label: 'Haiku', hint: 'quick and light' },
    { id: 'sonnet', label: 'Sonnet', hint: 'balanced' },
    { id: 'opus', label: 'Opus', hint: 'deep thinking' },
    { id: 'fable', label: 'Fable', hint: 'most capable, uses your plan fastest' },
  ],
  codex: [
    { ...USUAL_ROW, hint: 'ChatGPT’s own choice' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', hint: 'quick and light' },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', hint: 'everyday work' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', hint: 'most capable, uses your plan fastest' },
  ],
};
// Both programs take the same five levels.
const LEVELS = [
  { id: 'low', label: 'Low', hint: 'quick answers' },
  { id: 'medium', label: 'Medium', hint: 'a little thought' },
  { id: 'high', label: 'High', hint: 'thinks longer' },
  { id: 'xhigh', label: 'Extra high', hint: 'thinks much longer' },
  { id: 'max', label: 'Max', hint: 'as long as it takes' },
];
export const EFFORTS = {
  claude: [{ ...USUAL_ROW, hint: 'Claude Code’s own choice' }, ...LEVELS],
  codex: [{ ...USUAL_ROW, hint: 'ChatGPT’s own choice' }, ...LEVELS],
};
export const PICK_PROVIDERS = Object.keys(MODELS);

const USUAL = { model: '', effort: '' };
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const keyOf = (chatId) => (chatId ? `assistant.pick.${chatId}` : 'assistant.pick');
const known = (list, id) => list.some((x) => x.id === id);
const clean = (provider, value) => ({
  model: known(MODELS[provider], value?.model) ? value.model : '',
  effort: known(EFFORTS[provider], value?.effort) ? value.effort : '',
});

// A kept row, for each AI. A row from before ChatGPT had its own ({ model, effort }) is Claude's.
function read(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key);
  if (!row) return null;
  try {
    const value = JSON.parse(row.value);
    if (value && ('model' in value || 'effort' in value) && !value.claude) return { claude: clean('claude', value), codex: { ...USUAL } };
    return Object.fromEntries(PICK_PROVIDERS.map((p) => [p, clean(p, value?.[p])]));
  } catch { return null; }
}

function write(db, key, value) {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, key, JSON.stringify(value));
}

const allOf = (db, chatId) => (chatId && read(db, keyOf(chatId))) || read(db, keyOf(null))
  || Object.fromEntries(PICK_PROVIDERS.map((p) => [p, { ...USUAL }]));

// A chat's choice for one AI: its own, else the last one made (what a new chat starts with), else Usual.
export const getPick = (db, chatId = null, provider = 'claude') => ({ ...(allOf(db, chatId)[provider] ?? USUAL) });

export function checkPickInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('chat' in input && input.chat !== null && (typeof input.chat !== 'string' || !/^[0-9a-f-]{36}$/.test(input.chat))) return 'chat is a chat’s id.';
  const provider = input.provider ?? 'claude';
  if (!PICK_PROVIDERS.includes(provider)) return 'provider is claude or codex.';
  if ('model' in input && !known(MODELS[provider], input.model)) return `model is one of: ${MODELS[provider].map((m) => m.id || '""').join(', ')}.`;
  if ('effort' in input && !known(EFFORTS[provider], input.effort)) return `effort is one of: ${EFFORTS[provider].map((e) => e.id || '""').join(', ')}.`;
  return null;
}

// Keeps the choice for one AI, for the chat (when one is named) and as the one a new chat starts with.
export function setPick(db, { chat = null, provider = 'claude', ...change }) {
  const problem = checkPickInput({ chat, provider, ...change });
  if (problem) throw fail(400, problem);
  const changed = { ...getPick(db, chat, provider), ...change };
  const mine = { model: changed.model, effort: changed.effort };
  if (chat) write(db, keyOf(chat), { ...allOf(db, chat), [provider]: mine });
  write(db, keyOf(null), { ...allOf(db, null), [provider]: mine });
  return mine;
}

// What the page needs: the choices for the AI that answers now, and what this chat has.
export const pickState = (db, chatId, on, provider = 'claude') => ({
  on, provider, models: MODELS[provider] ?? MODELS.claude, efforts: EFFORTS[provider] ?? EFFORTS.claude, ...getPick(db, chatId, provider),
});

// The claude command's flags for a choice: none for Usual.
export const pickArgs = (pick) => [
  ...(pick?.model ? ['--model', pick.model] : []),
  ...(pick?.effort ? ['--effort', pick.effort] : []),
];
