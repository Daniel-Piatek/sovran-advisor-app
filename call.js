// Voice calls with your assistant (the Voice module, advanced/voice/3-7). A call is a thin front over the chat: the page
// listens, sends your words to your assistant as a normal chat message (same tools, same permissions), and speaks a short
// version of the answer. This file is the server's part of it:
//   speak        the words of an answer as sound: the free speaking voice on this computer (voice-local.js), or ElevenLabs
//                text to speech when there is an ElevenLabs key (the key never leaves this server)
//   route        plain questions answered straight from your own tables, no model (advanced/voice/6)
//   turns        how each turn went (call_turns): where the answer came from, the line said while it thought, the time
//                to the first word (advanced/voice/5); shown on the chat's messages and in Settings › Voice
//   voice log    every failure of a layer (advanced/voice/7)

import { randomUUID } from 'node:crypto';
import { readKey, hasKey } from './dictation.js';
import { speakLocal, localStatus, prepareLocal, warmLocal, wavOf } from './voice-local.js';
import { calendarList } from './calendar-assistant.js';
import { listTasks, localDay } from './tasks.js';
import { addAnswered, getConversation, createConversation } from './assistant.js';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// ---- Settings › Voice: the voice it speaks with and its speed ----

const SPEED_KEY = 'voice.callSpeed';
const VOICE_KEY = 'voice.callVoice';
const getSetting = (db, key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key);
  try { return row ? JSON.parse(row.value) : undefined; } catch { return undefined; }
};
const putSetting = (db, key, value) => {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`).run(randomUUID(), time, time, key, JSON.stringify(value));
};

export const LOCAL_VOICES = [{ id: 'alba', name: 'Alba (British English), on this computer' }];
const elevenBase = (env = process.env) => String(env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io').replace(/\/+$/, '');

// The voices ElevenLabs offers this key (names and ids only), asked once a while.
let elevenVoices = { at: 0, list: [] };
async function voicesOf(dataDir, env, fetcher) {
  if (Date.now() - elevenVoices.at < 10 * 60_000 && elevenVoices.list.length) return elevenVoices.list;
  try {
    const res = await fetcher(`${elevenBase(env)}/v1/voices`, { headers: { 'xi-api-key': readKey(dataDir, env) } });
    if (!res.ok) return elevenVoices.list;
    const { voices = [] } = await res.json();
    elevenVoices = { at: Date.now(), list: voices.filter((v) => v.voice_id && v.name).map((v) => ({ id: v.voice_id, name: v.name })).slice(0, 60) };
  } catch { /* not reached: the list stays as it was */ }
  return elevenVoices.list;
}

export async function callSettings(db, dataDir, { env = process.env, fetcher = fetch } = {}) {
  const eleven = hasKey(dataDir, env);
  const voices = eleven ? await voicesOf(dataDir, env, fetcher) : LOCAL_VOICES;
  const chosen = getSetting(db, VOICE_KEY);
  return {
    engine: eleven ? 'elevenlabs' : 'local',
    speed: Number(getSetting(db, SPEED_KEY)) || 1,
    voice: voices.some((v) => v.id === chosen) ? chosen : voices[0]?.id ?? '',
    voices,
    ears: eleven ? { state: 'ready' } : localStatus(dataDir, env, 'ears'),
    mouth: eleven ? { state: 'ready' } : localStatus(dataDir, env, 'mouth'),
  };
}

export function setCallSettings(db, input) {
  if (typeof input !== 'object' || input === null) throw fail(400, 'Send { speed?, voice? }.');
  if ('speed' in input) {
    const speed = Number(input.speed);
    if (!(speed >= 0.7 && speed <= 1.4)) throw fail(400, 'speed is between 0.7 and 1.4.');
    putSetting(db, SPEED_KEY, Math.round(speed * 100) / 100);
  }
  if ('voice' in input) {
    if (typeof input.voice !== 'string' || input.voice.length > 80) throw fail(400, 'voice is a voice id.');
    putSetting(db, VOICE_KEY, input.voice);
  }
}

// ---- Speaking ----

// The words as sound (a WAV file, or ElevenLabs' sound as WAV). ElevenLabs when there is a key, else the free voice.
export async function speak(db, dataDir, text, { env = process.env, fetcher = fetch } = {}) {
  const words = String(text ?? '').trim().slice(0, 1200);
  if (!words) throw fail(400, 'Nothing to say.');
  const settings = { speed: Number(getSetting(db, SPEED_KEY)) || 1, voice: getSetting(db, VOICE_KEY) };
  if (!hasKey(dataDir, env)) {
    const status = localStatus(dataDir, env, 'mouth');
    if (status.state !== 'ready') {
      if (status.state === 'missing' || status.state === 'failed') prepareLocal(dataDir, { env, fetcher, which: 'mouth' }).catch(() => {});
      throw fail(409, status.state === 'getting' ? `Getting the free speaking voice, once (${status.percent}% so far).` : status.message ?? 'The free speaking voice is not here yet.', 'mouth_not_ready');
    }
    return speakLocal(dataDir, words, { speed: settings.speed, env });
  }
  const voice = settings.voice || (await voicesOf(dataDir, env, fetcher))[0]?.id || 'JBFqnCBsd6RMkjVDRZzb';
  let res;
  try {
    res = await fetcher(`${elevenBase(env)}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_16000`, {
      method: 'POST', headers: { 'xi-api-key': readKey(dataDir, env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: words, model_id: 'eleven_flash_v2_5', voice_settings: { speed: Math.max(0.7, Math.min(1.2, settings.speed)) } }),
    });
  } catch { throw fail(502, 'ElevenLabs could not be reached. Is this computer online?', 'unreachable'); }
  if (!res.ok) throw fail(502, `ElevenLabs could not speak (${res.status}).`, 'refused');
  const bytes = Buffer.from(await res.arrayBuffer());
  const pcm = new Int16Array(Uint8Array.prototype.slice.call(bytes, 0, bytes.length - (bytes.length % 2)).buffer);
  return wavOf(Float32Array.from(pcm, (v) => v / 0x8000), 16000);
}

// Warm the call (advanced/voice/5): fetch what is missing, load what is here. { ready, ears, mouth }
export async function warmCall(db, dataDir, { env = process.env } = {}) {
  if (hasKey(dataDir, env)) return { ready: true, engine: 'elevenlabs' };
  for (const which of ['ears', 'mouth']) {
    const s = localStatus(dataDir, env, which).state;
    if (s === 'missing' || s === 'failed') prepareLocal(dataDir, { env, which }).catch(() => {});
  }
  const ears = localStatus(dataDir, env, 'ears');
  const mouth = localStatus(dataDir, env, 'mouth');
  const ready = ears.state === 'ready' && mouth.state === 'ready';
  if (ready) await warmLocal(dataDir, env).catch(() => {});
  return { ready, engine: 'local', ears, mouth };
}

// ---- Answers from your data, no model (advanced/voice/6) ----

const say = (n, one, many) => `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`;
const spokenTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const listWords = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

const ASKS = [
  { kind: 'today', test: /^(what('?s| is)|what do i have|what have i got|anything)\b.*\b(on |for )?today\b|^(my|today'?s) (day|schedule|calendar|events)\b|^what('?s| is) my day\b/ },
  { kind: 'next', test: /^what('?s| is) (next|my next (event|meeting|thing))\b|^(when|what) is my next (event|meeting)\b/ },
  { kind: 'tasks_due', test: /^how many (tasks|to-?dos|things)( are| do i have)?( due| left)?( today)?\b/ },
];

// Which plain question this is, or null. Only a short question in its usual words: anything else goes to your assistant.
export function plainQuestion(text) {
  const words = String(text ?? '').toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words || words.split(' ').length > 9) return null;
  return ASKS.find((a) => a.test.test(words))?.kind ?? null;
}

// The answer from your tables, in a short spoken sentence and a line for the chat. null when it is not one we know.
export function answerFromData(db, text, { day = localDay(), at = new Date() } = {}) {
  const kind = plainQuestion(text);
  if (!kind) return null;
  if (kind === 'tasks_due') {
    if (!moduleOn(db, 'tasks')) return null;
    const due = listTasks(db, { done: false }).filter((t) => t.due && t.due <= day);
    const late = due.filter((t) => t.due < day).length;
    const spoken = `You have ${say(due.length, 'task', 'tasks')} due today${late ? `, ${late} of them from earlier days` : ''}.`;
    return { kind, spoken, text: spoken };
  }
  if (!moduleOn(db, 'calendar')) return null;
  const events = calendarList(db, { from: day, to: day })[0]?.events ?? [];
  const nowAt = `${day}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (kind === 'next') {
    const next = events.filter((e) => !e.all_day && e.starts_at > nowAt)[0];
    const spoken = next ? `Next is ${next.title} at ${spokenTime(next.starts_at.slice(11))}.` : 'Nothing else is on your calendar today.';
    return { kind, spoken, text: spoken };
  }
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  if (!events.length) return { kind, spoken: 'Nothing is on your calendar today.', text: 'Nothing is on your calendar today.' };
  const parts = [...allDay.map((e) => `${e.title} all day`), ...timed.map((e) => `${e.title} at ${spokenTime(e.starts_at.slice(11))}`)];
  const spoken = `You have ${say(events.length, 'thing', 'things')} today: ${listWords(parts)}.`;
  const lines = [...allDay.map((e) => `- All day: ${e.title}`), ...timed.map((e) => `- ${e.starts_at.slice(11)}–${e.ends_at.slice(11)} ${e.title}`)];
  return { kind, spoken, text: `Today:\n\n${lines.join('\n')}` };
}

// A turn of a call: answered here from your data (the question and answer kept in the chat), or handed on (source assistant).
export function routeTurn(db, dataDir, input, { day, at } = {}) {
  const words = String(input?.text ?? '').trim();
  if (!words || words.length > 2000) throw fail(400, 'text is what you said.');
  const found = answerFromData(db, words, { day, at });
  if (!found) return { source: 'assistant' };
  let conversationId = input.conversation_id;
  if (!conversationId || !getConversation(db, conversationId)) conversationId = createConversation(db, dataDir).id;
  const { askedId, answerId } = addAnswered(db, conversationId, words, found.text);
  return { source: 'data', conversation_id: conversationId, asked_id: askedId, answer_id: answerId, spoken: found.spoken };
}

// ---- Turns, and the numbers (advanced/voice/5) ----

export function checkTurnInput(input) {
  if (typeof input !== 'object' || input === null) return 'Send a JSON object.';
  if (typeof input.call_id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.call_id)) return 'call_id is the call’s id.';
  if (typeof input.conversation_id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.conversation_id)) return 'conversation_id is the chat’s id.';
  if (input.kind !== undefined && !['turn', 'written'].includes(input.kind)) return 'kind is turn or written.';
  if (input.source !== undefined && !['data', 'assistant'].includes(input.source)) return 'source is data or assistant.';
  if (input.first_word_ms !== undefined && input.first_word_ms !== null && !(Number.isInteger(input.first_word_ms) && input.first_word_ms >= 0 && input.first_word_ms < 600_000)) return 'first_word_ms is a number of milliseconds.';
  if (input.filler !== undefined && (typeof input.filler !== 'string' || input.filler.length > 200)) return 'filler is a short line.';
  return null;
}

export function addTurn(db, input) {
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO call_turns (id, created_at, updated_at, call_id, conversation_id, asked_id, answer_id, kind, source, filler, first_word_ms, warm, engine)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, input.call_id, input.conversation_id, String(input.asked_id ?? ''), String(input.answer_id ?? ''),
    input.kind ?? 'turn', input.source ?? 'assistant', input.filler ?? '', input.first_word_ms ?? null, input.warm ? 1 : 0, input.engine === 'elevenlabs' ? 'elevenlabs' : 'local');
  return { id };
}

// What the chat shows of a call: on your words "Said on a call"; on an answer where it came from, the line said while it
// thought and the time to the first word; and after a message the line that the call went on in writing.
export function callMarks(db, conversationId) {
  const rows = db.prepare('SELECT * FROM call_turns WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(conversationId);
  const marks = {};
  for (const r of rows) {
    if (r.kind === 'written') { marks[`written:${r.id}`] = { written: true, created_at: r.created_at }; continue; }
    if (r.asked_id) marks[r.asked_id] = { said: true };
    if (r.answer_id) marks[r.answer_id] = { source: r.source, filler: r.filler, first_word_ms: r.first_word_ms, warm: r.warm === 1 };
  }
  return marks;
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// The last 20 calls: each call's median time to the first word, and the median of them all.
export function callStats(db) {
  const calls = db.prepare(`SELECT call_id, min(created_at) AS at, count(*) AS turns, group_concat(first_word_ms) AS times, max(warm) AS warm
    FROM call_turns WHERE deleted_at IS NULL AND kind = 'turn' AND first_word_ms IS NOT NULL GROUP BY call_id ORDER BY at DESC LIMIT 20`).all()
    .map((c) => ({ call_id: c.call_id, at: c.at, turns: c.turns, warm: c.warm === 1, median_ms: median(String(c.times).split(',').map(Number)) }));
  return { calls, median_ms: median(calls.map((c) => c.median_ms)), last_ms: calls[0]?.median_ms ?? null };
}

// ---- The Voice log (advanced/voice/7) ----

export function logVoice(db, input) {
  if (typeof input !== 'object' || input === null) throw fail(400, 'Send a JSON object.');
  if (!['voice', 'network', 'assistant'].includes(input.layer)) throw fail(400, 'layer is voice, network or assistant.');
  if (typeof input.what !== 'string' || !input.what.trim() || input.what.length > 300) throw fail(400, 'what is one short line.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO voice_log (id, created_at, updated_at, call_id, layer, what, tried) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, typeof input.call_id === 'string' ? input.call_id.slice(0, 36) : '', input.layer, input.what.trim(), input.tried ? 1 : 0);
  return db.prepare('SELECT id, created_at, call_id, layer, what, tried FROM voice_log WHERE id = ?').get(id);
}

export const listVoiceLog = (db) => db.prepare('SELECT id, created_at, call_id, layer, what, tried FROM voice_log WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 100').all()
  .map((r) => ({ ...r, tried: r.tried === 1 }));
