// Voice calls (advanced/voice/3-7): what a call says aloud, the plain questions answered from your data with no model,
// the turns and the numbers, the Voice log, the settings and the free speaking voice. No real model: the stand-in speaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, SCHEMA_VERSION } from '../../db.js';
import { setModule } from '../../modules.js';
import { createEvent } from '../../events.js';
import { insertTask } from '../../tasks.js';
import { getConversation, createConversation } from '../../assistant.js';
import { plainQuestion, answerFromData, routeTurn, checkTurnInput, addTurn, callMarks, callStats, logVoice, listVoiceLog, callSettings, setCallSettings, speak, warmCall } from '../../call.js';
import { spokenVersion, cardSaid, asksToDo, yesOrNo, fillerFor, firstWordWords } from '../../public/spoken.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const day = '2026-11-12';
const at = new Date(2026, 10, 12, 9, 0);

test('the database is at the version with the call tables', () => {
  const db = emptyDb();
  assert.ok(SCHEMA_VERSION >= 70);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(tables.includes('call_turns') && tables.includes('voice_log'));
});

test('what is said aloud: plain words, short, the rest in the chat', () => {
  assert.equal(spokenVersion('## Today\n\n- **Call** [Lena](/people/1) at 10\n\n| a | b |\n|---|---|'), 'Today Call Lena at 10');
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const said = spokenVersion(long);
  assert.ok(said.endsWith('The rest is in the chat.') && said.length < 360);
  assert.equal(cardSaid('Add a task: “Call the venue” · Tomorrow'), 'Add a task, Call the venue, Tomorrow');
  assert.ok(asksToDo('add a task: book the hall') && asksToDo('Could you draft a note') && !asksToDo('what is next'));
  assert.equal(yesOrNo('Yes please.'), 'yes');
  assert.equal(yesOrNo('no, not now'), 'no');
  assert.equal(yesOrNo('maybe later'), null);
  assert.equal(fillerFor('tell me about my notes'), 'Let me look at your notes.');
  assert.equal(fillerFor('what is the weather'), 'Let me check.');
  assert.equal(firstWordWords(940), 'first word 0.9 s');
});

test('only a short question in its usual words is answered from your data', () => {
  assert.equal(plainQuestion('What is on today?'), 'today');
  assert.equal(plainQuestion("What's next?"), 'next');
  assert.equal(plainQuestion('How many tasks are due today?'), 'tasks_due');
  assert.equal(plainQuestion('What is on today and can you also tell me about the notes I wrote last week please'), null);
  assert.equal(plainQuestion('tell me about my notes'), null);
});

test('today, next and tasks due come from your tables; with Calendar or Tasks off it goes to your assistant', () => {
  const db = emptyDb();
  setModule(db, 'calendar', true);
  setModule(db, 'tasks', true);
  createEvent(db, { title: 'Call with Lena', starts_at: `${day}T10:30`, ends_at: `${day}T11:00` });
  createEvent(db, { title: 'Walk', starts_at: `${day}T08:00`, ends_at: `${day}T08:30` });
  const today = answerFromData(db, 'What is on today?', { day, at });
  assert.match(today.text, /08:00–08:30 Walk\n- 10:30–11:00 Call with Lena/);
  assert.equal(today.spoken, 'You have 2 things today: Walk at 8 AM and Call with Lena at 10:30 AM.');
  assert.equal(answerFromData(db, 'What is next?', { day, at }).spoken, 'Next is Call with Lena at 10:30 AM.');
  insertTask(db, { text: 'Pay the hall', due: day });
  insertTask(db, { text: 'Old one', due: '2026-11-01' });
  assert.equal(answerFromData(db, 'How many tasks are due today?', { day, at }).spoken, 'You have 2 tasks due today, 1 of them from earlier days.');
  setModule(db, 'calendar', false);
  assert.equal(answerFromData(db, 'What is on today?', { day, at }), null);
});

test('a turn answered from your data is kept in the chat as a question and an answer; anything else is handed on', () => {
  const db = emptyDb();
  setModule(db, 'calendar', true);
  const dir = tmp('call-');
  const answered = routeTurn(db, dir, { text: 'What is on today?' }, { day, at });
  assert.equal(answered.source, 'data');
  const messages = getConversation(db, answered.conversation_id).messages;
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[1].text, 'Nothing is on your calendar today.');
  assert.deepEqual(routeTurn(db, dir, { text: 'tell me about my notes' }, { day, at }), { source: 'assistant' });
  assert.throws(() => routeTurn(db, dir, { text: '' }), (err) => err.status === 400);
});

test('turns mark the chat, and the numbers are the median time to the first word of the last calls', () => {
  const db = emptyDb();
  const conversation_id = createConversation(db, tmp('call-turns-')).id;
  const first = randomUUID();
  const second = randomUUID();
  assert.equal(checkTurnInput({ call_id: 'x', conversation_id }), 'call_id is the call’s id.');
  assert.equal(checkTurnInput({ call_id: first, conversation_id, first_word_ms: -1 }), 'first_word_ms is a number of milliseconds.');
  addTurn(db, { call_id: first, conversation_id, asked_id: 'q1', answer_id: 'a1', source: 'data', first_word_ms: 400, warm: true });
  addTurn(db, { call_id: first, conversation_id, asked_id: 'q2', answer_id: 'a2', filler: 'Let me check.', first_word_ms: 1000 });
  addTurn(db, { call_id: first, conversation_id, first_word_ms: 600 });
  addTurn(db, { call_id: second, conversation_id, kind: 'written' });
  const marks = callMarks(db, conversation_id);
  assert.deepEqual(marks.q1, { said: true });
  assert.deepEqual(marks.a2, { source: 'assistant', filler: 'Let me check.', first_word_ms: 1000, warm: false });
  assert.equal(Object.values(marks).filter((m) => m.written).length, 1);
  const stats = callStats(db);
  assert.equal(stats.calls.length, 1); // the written one has no time
  assert.equal(stats.median_ms, 600);
  assert.equal(stats.last_ms, 600);
});

test('the Voice log keeps each failure of a layer, newest first, and refuses what is not one', () => {
  const db = emptyDb();
  logVoice(db, { layer: 'network', what: 'The network dropped.' });
  logVoice(db, { layer: 'voice', what: 'The voice service is not answering.', tried: true });
  const rows = listVoiceLog(db);
  assert.deepEqual(rows.map((r) => [r.layer, r.tried]), [['voice', true], ['network', false]]);
  assert.throws(() => logVoice(db, { layer: 'mars', what: 'x' }), (err) => err.status === 400);
  assert.throws(() => logVoice(db, { layer: 'voice', what: ' ' }), (err) => err.status === 400);
});

test('without a key, calls speak with Alba on this computer; the speed is kept; the stand-in voice speaks a WAV', async () => {
  const db = emptyDb();
  const dir = tmp('call-voice-');
  const env = { VOICE_FAKE_SPEECH: '1', VOICE_FAKE_TRANSCRIPT: 'hello' };
  const settings = await callSettings(db, dir, { env });
  assert.equal(settings.engine, 'local');
  assert.deepEqual(settings.voices.map((v) => v.name), ['Alba (British English), on this computer']);
  setCallSettings(db, { speed: 1.15 });
  assert.equal((await callSettings(db, dir, { env })).speed, 1.15);
  assert.throws(() => setCallSettings(db, { speed: 3 }), (err) => err.status === 400);
  const wav = await speak(db, dir, 'Hello there.', { env });
  assert.equal(Buffer.from(wav).subarray(0, 4).toString(), 'RIFF');
  assert.deepEqual((await warmCall(db, dir, { env })).ready, true);
});

test('without a key and without the speaking voice, speaking says it is not here yet (and starts fetching it)', async () => {
  const db = emptyDb();
  const dir = tmp('call-nomouth-');
  const fetcher = async () => ({ ok: false, status: 404, body: null });
  await assert.rejects(speak(db, dir, 'Hello.', { env: { VOICE_SPEAKER_URL: 'http://127.0.0.1:9/none' }, fetcher }), (err) => err.status === 409 && err.code === 'mouth_not_ready');
});
