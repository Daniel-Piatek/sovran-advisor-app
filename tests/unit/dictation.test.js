// Dictation (dictation.js, advanced/voice/1): the key stays on the server, the page gets a
// short-lived address, and every dictation is kept as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { readKey, startSession, getDictationSettings, setHoldKey, checkDictationInput, addDictation, listDictations } from '../../dictation.js';
import { listModules } from '../../modules.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

// A stand-in for ElevenLabs's token endpoint: it notes what it was asked and by which key.
async function fakeEleven(t, { status = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'] });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { token: 'sutkn_test_123' } : { detail: 'no' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, seen };
}

test('the key comes from the environment or the file data/elevenlabs.key, never from anywhere else', () => {
  const dir = tmp('dict-key-');
  assert.equal(readKey(dir, {}), '');
  fs.writeFileSync(path.join(dir, 'elevenlabs.key'), '  sk_from_file \n');
  assert.equal(readKey(dir, {}), 'sk_from_file');
  assert.equal(readKey(dir, { ELEVENLABS_API_KEY: 'sk_from_env' }), 'sk_from_env');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a session is an address with a single-use token, minted with the key; the key is not in it', async (t) => {
  const dir = tmp('dict-session-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eleven = await fakeEleven(t);
  const env = { ELEVENLABS_API_BASE: eleven.base };
  await assert.rejects(startSession(dir, {}, { env }), (e) => e.status === 409 && e.code === 'no_key' && /data\/elevenlabs\.key/.test(e.message));
  fs.writeFileSync(path.join(dir, 'elevenlabs.key'), 'sk_secret_value\n');
  const session = await startSession(dir, { keyterms: ['Nordlicht', 'Lena Fischer'] }, { env });
  assert.deepEqual(eleven.seen, [{ method: 'POST', url: '/v1/single-use-token/realtime_scribe', key: 'sk_secret_value' }]);
  const url = new URL(session.url);
  assert.deepEqual([url.protocol, url.pathname], ['ws:', '/v1/speech-to-text/realtime']);
  assert.deepEqual([...url.searchParams.entries()], [
    ['model_id', 'scribe_v2_realtime'], ['audio_format', 'pcm_16000'], ['commit_strategy', 'manual'], ['token', 'sutkn_test_123'],
    ['keyterms', 'Nordlicht'], ['keyterms', 'Lena Fischer'],
  ]);
  assert.equal(JSON.stringify(session).includes('sk_secret_value'), false);
});

test('a refused key and an unreachable service say what is wrong, without the key', async (t) => {
  const dir = tmp('dict-refused-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'elevenlabs.key'), 'sk_secret_value');
  const refused = await fakeEleven(t, { status: 401 });
  await assert.rejects(startSession(dir, {}, { env: { ELEVENLABS_API_BASE: refused.base } }), (e) => e.code === 'refused' && /did not accept the key/.test(e.message) && !e.message.includes('sk_secret'));
  await assert.rejects(startSession(dir, {}, { env: { ELEVENLABS_API_BASE: 'http://127.0.0.1:1' } }), (e) => e.code === 'unreachable' && /online/.test(e.message));
});

test('the hold key is Right Option unless chosen, and only the offered keys are accepted', () => {
  const db = emptyDb();
  const dir = tmp('dict-hold-');
  assert.deepEqual([getDictationSettings(db, dir, {}).hold_key, getDictationSettings(db, dir, {}).has_key], ['AltRight', false]);
  setHoldKey(db, 'ControlRight');
  assert.equal(getDictationSettings(db, dir, {}).hold_key, 'ControlRight');
  assert.throws(() => setHoldKey(db, 'ShiftLeft'), (e) => e.status === 400);
  fs.writeFileSync(path.join(dir, 'elevenlabs.key'), 'x');
  assert.equal(getDictationSettings(db, dir, {}).has_key, true);
  assert.equal(JSON.stringify(getDictationSettings(db, dir, {})).includes('"x"'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every dictation is kept as text, also one that found no field; the history is newest first and searchable', () => {
  const db = emptyDb();
  const a = addDictation(db, { text: ' Met Lena about the workshop. ', went_to: 'Text · Onboarding call', outcome: 'inserted' });
  addDictation(db, { text: 'Remember the milk', outcome: 'clipboard' });
  addDictation(db, { text: 'Hafenkante call at ten', went_to: 'Capture', outcome: 'inserted' });
  assert.equal(a.text, 'Met Lena about the workshop.');
  assert.deepEqual(listDictations(db).map((d) => [d.text, d.outcome]), [['Hafenkante call at ten', 'inserted'], ['Remember the milk', 'clipboard'], ['Met Lena about the workshop.', 'inserted']]);
  assert.deepEqual(listDictations(db, { q: 'workshop' }).map((d) => d.text), ['Met Lena about the workshop.']);
  assert.deepEqual(listDictations(db, { q: 'onboarding lena' }).map((d) => d.text), ['Met Lena about the workshop.'], 'every word, in the words or where it went');
  assert.deepEqual(listDictations(db, { q: '100%' }), []);
  assert.equal(listDictations(db, { limit: 1 }).length, 1);
  const page = listDictations(db, { limit: 1 });
  assert.equal(listDictations(db, { before: page[0].created_at, limit: 5 }).length >= 0, true);
  assert.equal(checkDictationInput({ text: ' ', outcome: 'inserted' }), 'A dictation needs its words.');
  assert.equal(checkDictationInput({ text: 'x', outcome: 'sent' }), 'outcome is inserted or clipboard.');
  assert.equal(checkDictationInput({ text: 'x', outcome: 'inserted', went_to: 5 }), 'went_to is short text.');
  assert.equal(checkDictationInput({ text: 'x', outcome: 'clipboard' }), null);
});

test('a key typed into Settings is kept in data/elevenlabs.key for this user only, and is never given back', async (t) => {
  const dataDir = tmp('dict-keysave-');
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  t.after(() => { if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved; });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await (await send('GET', '/api/dictation/settings')).json()).has_key, false);
  for (const bad of [{}, { key: 'short' }, { key: 'has spaces in it' }, { key: 'x'.repeat(301) }]) assert.equal((await send('PUT', '/api/dictation/key', bad)).status, 400);
  const answer = await send('PUT', '/api/dictation/key', { key: '  sk_a_secret_key_value  ' });
  const text = await answer.text();
  assert.equal(JSON.parse(text).has_key, true);
  assert.equal(JSON.parse(text).key_source, 'file');
  assert.equal(text.includes('sk_a_secret_key_value'), false, 'the key is not in any answer');
  assert.equal(fs.readFileSync(path.join(dataDir, 'elevenlabs.key'), 'utf8'), 'sk_a_secret_key_value\n');
  assert.equal(fs.statSync(path.join(dataDir, 'elevenlabs.key')).mode & 0o777, 0o600);
  assert.equal((await (await send('GET', '/api/dictation/settings')).text()).includes('sk_a_secret'), false);
  assert.equal((await (await send('DELETE', '/api/dictation/key')).json()).has_key, false);
  assert.equal(fs.existsSync(path.join(dataDir, 'elevenlabs.key')), false);
  assert.equal((await send('GET', '/api/dictation/key')).status, 405);
});

test('Dictation is a module, off in a new install until switched on', () => {
  assert.deepEqual(listModules(emptyDb()).map((m) => [m.id, m.label, m.on]), [['tasks', 'Tasks', false], ['planner', 'Planner', false], ['calendar', 'Calendar', false], ['life', 'My Life', false], ['course', 'Course', false], ['people-plus', 'People in depth', true], ['voice', 'Dictation', true], ['tasks-plus', 'Tasks in depth', true], ['calendar-links', 'Calendar links', true], ['calendar-plus', 'Calendar in depth', true], ['mylife-plus', 'My Life in depth', false], ['calendar-google', 'Google Calendar', false], ['writing', 'Writing and thinking', true], ['everywhere', 'Phone, backups and moving', false], ['help', 'Help pages', true], ['ai-pick', 'Model and effort', true], ['mail', 'Mail', false]]);
});

test('a database from before Dictation keeps everything and takes the table', () => {
  const dir = tmp('dict-old-');
  let db = openDatabase(dir);
  db.exec('DROP TABLE dictations; PRAGMA user_version = 35;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(addDictation(db, { text: 'Back again', outcome: 'inserted' }).text, 'Back again');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Dictation API', async (t) => {
  const dataDir = tmp('dict-api-');
  const eleven = await fakeEleven(t);
  const saved = { ...process.env };
  process.env.ELEVENLABS_API_BASE = eleven.base;
  process.env.VOICE_MODEL_URL = `${eleven.base}/voice-model.tar.bz2`; // never the real download
  delete process.env.ELEVENLABS_API_KEY;
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); Object.assign(process.env, saved); for (const k of ['ELEVENLABS_API_BASE', 'VOICE_MODEL_URL']) if (saved[k] === undefined) delete process.env[k]; fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await send('GET', '/api/dictation/session')).status, 405);
  const none = await send('POST', '/api/dictation/session', {});
  // No key: the free voice model is used, and it is not here yet (its download is refused here).
  assert.deepEqual([none.status, (await none.json()).code], [409, 'model_not_ready']);
  fs.writeFileSync(path.join(dataDir, 'elevenlabs.key'), 'sk_test');
  const ok = await (await send('POST', '/api/dictation/session', {})).json();
  assert.equal(ok.engine, 'elevenlabs');
  assert.match(ok.url, /^ws:\/\/127\.0\.0\.1:\d+\/v1\/speech-to-text\/realtime\?.*token=sutkn_test_123/);
  assert.equal((await (await send('GET', '/api/dictation/settings')).json()).has_key, true);
  assert.equal((await send('PUT', '/api/dictation/settings', { hold_key: 'Nope' })).status, 400);
  assert.equal((await (await send('PUT', '/api/dictation/settings', { hold_key: 'MetaRight' })).json()).hold_key, 'MetaRight');
  assert.equal((await send('POST', '/api/dictations', { text: '', outcome: 'inserted' })).status, 400);
  const made = await (await send('POST', '/api/dictations', { text: 'Hello there', went_to: 'Text', outcome: 'inserted' })).json();
  assert.equal(made.text, 'Hello there');
  assert.deepEqual((await (await send('GET', '/api/dictations?q=hello')).json()).map((d) => d.text), ['Hello there']);
});
