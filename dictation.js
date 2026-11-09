// Dictation (the Voice module, advanced/voice/1): hold a key in any field, speak, let go, and the
// words land at the cursor. The page streams the microphone to ElevenLabs speech-to-text (Scribe,
// realtime) over a WebSocket; this server only mints a short-lived token with the owner's key,
// which never leaves it: the key is read from the file data/elevenlabs.key (one line) or the
// environment (ELEVENLABS_API_KEY), is never sent to a page, never logged and never shown.
// Every dictation is kept as text in `dictations` (also one that found no field: Clipboard only).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export const HOLD_KEYS = [
  { code: 'AltRight', label: 'Right Option (⌥)' },
  { code: 'MetaRight', label: 'Right Command (⌘)' },
  { code: 'ControlRight', label: 'Right Control (^)' },
];
const HOLD_SETTING = 'voice.holdKey';
export const MAX_DICTATION = 20_000;

// ---- The key, and the token ----

const keyFile = (dataDir) => path.join(dataDir, 'elevenlabs.key');
export function readKey(dataDir, env = process.env) {
  const fromEnv = String(env.ELEVENLABS_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;
  try { return fs.readFileSync(keyFile(dataDir), 'utf8').trim(); } catch { return ''; }
}
export const hasKey = (dataDir, env) => Boolean(readKey(dataDir, env));
export const keySource = (dataDir, env = process.env) => (String(env.ELEVENLABS_API_KEY ?? '').trim() ? 'env' : readKey(dataDir, {}) ? 'file' : null);

// The owner types or pastes the key into Settings once; it is written to data/elevenlabs.key (readable by this
// user only) and is never given back to a page. Nothing else ever reads or shows it.
export function saveKey(dataDir, key) {
  const text = String(key ?? '').trim();
  if (text.length < 8 || text.length > 300 || /\s/.test(text)) throw fail(400, 'That does not look like a key: it is one piece of text with no spaces.');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keyFile(dataDir), `${text}\n`, { mode: 0o600 });
  fs.chmodSync(keyFile(dataDir), 0o600);
}
export function removeKey(dataDir) {
  fs.rmSync(keyFile(dataDir), { force: true });
}
const apiBase = (env = process.env) => String(env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io').replace(/\/+$/, '');

// A session for one dictation: the WebSocket address with a single-use token in it (it runs out
// in minutes and works once). `keyterms` are words the engine should expect (the glossary).
export async function startSession(dataDir, { keyterms = [] } = {}, { env = process.env, fetcher = fetch } = {}) {
  const key = readKey(dataDir, env);
  if (!key) throw fail(409, 'There is no ElevenLabs key yet. Put it in the file data/elevenlabs.key (one line), then try again.', 'no_key');
  let res;
  try {
    res = await fetcher(`${apiBase(env)}/v1/single-use-token/realtime_scribe`, { method: 'POST', headers: { 'xi-api-key': key } });
  } catch {
    throw fail(502, 'ElevenLabs could not be reached. Is this computer online?', 'unreachable');
  }
  if (!res.ok) throw fail(502, res.status === 401 || res.status === 403 ? 'ElevenLabs did not accept the key in data/elevenlabs.key.' : `ElevenLabs said no (${res.status}).`, 'refused');
  const { token } = await res.json().catch(() => ({}));
  if (typeof token !== 'string' || !token) throw fail(502, 'ElevenLabs gave no token.', 'refused');
  const params = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'manual', token });
  for (const term of keyterms.slice(0, 100)) params.append('keyterms', term);
  return { url: `${apiBase(env).replace(/^http/, 'ws')}/v1/speech-to-text/realtime?${params}`, sample_rate: 16000 };
}

// ---- The hold key ----

export function getDictationSettings(db, dataDir, env) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(HOLD_SETTING);
  let code = 'AltRight';
  try { if (HOLD_KEYS.some((k) => k.code === JSON.parse(row?.value ?? 'null'))) code = JSON.parse(row.value); } catch { /* the default */ }
  return { hold_key: code, hold_keys: HOLD_KEYS, has_key: hasKey(dataDir, env), key_source: keySource(dataDir, env) };
}

export function setHoldKey(db, code) {
  if (!HOLD_KEYS.some((k) => k.code === code)) throw fail(400, `hold_key is ${HOLD_KEYS.map((k) => k.code).join(', ')}.`);
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, HOLD_SETTING, JSON.stringify(code));
}

// ---- The history ----

export function checkDictationInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (typeof input.text !== 'string' || !input.text.trim()) return 'A dictation needs its words.';
  if (input.text.length > MAX_DICTATION) return `text is longer than ${MAX_DICTATION} characters.`;
  if ('went_to' in input && (typeof input.went_to !== 'string' || input.went_to.length > 300)) return 'went_to is short text.';
  if (!['inserted', 'clipboard'].includes(input.outcome)) return 'outcome is inserted or clipboard.';
  if ('fixed' in input && (!Number.isInteger(input.fixed) || input.fixed < 0)) return 'fixed is a count.';
  return null;
}

const rowOf = (row) => ({ id: row.id, text: row.text, went_to: row.went_to, outcome: row.outcome, fixed: row.fixed, created_at: row.created_at });

export function addDictation(db, { text, went_to = '', outcome, fixed = 0 }) {
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO dictations (id, created_at, updated_at, text, went_to, outcome, fixed) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, text.trim(), went_to.trim(), outcome, fixed);
  return rowOf(db.prepare('SELECT * FROM dictations WHERE id = ?').get(id));
}

// Newest first. q: every word somewhere in the text or where it went. before: a created_at, for the next page.
export function listDictations(db, { q = '', before = '', limit = 50 } = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const where = ['deleted_at IS NULL', ...(before ? ['created_at < ?'] : []),
    ...words.map(() => "(lower(text) LIKE ? ESCAPE '\\' OR lower(went_to) LIKE ? ESCAPE '\\')")];
  const params = [...(before ? [before] : []), ...words.flatMap((w) => { const like = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; return [like, like]; })];
  const n = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  return db.prepare(`SELECT * FROM dictations WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...params, n).map(rowOf);
}
