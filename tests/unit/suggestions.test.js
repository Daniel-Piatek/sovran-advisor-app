// Your assistant suggests where a capture goes (suggestions.js, assistant/3), with the
// stand-in claude command: no test depends on a real AI model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createCapture } from '../../captures.js';
import { createLifeItem } from '../../life.js';
import { readAnswer } from '../../suggestions.js';
import { setModule } from '../../modules.js';
import { startServer } from '../../server.js';

const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function server(t, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-'))) {
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0 });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  // Waits until the reader has read a capture (or given up).
  const read = async (id) => {
    for (let i = 0; i < 200; i++) {
      const { body } = await send('GET', `/api/captures/${id}`);
      if (body?.suggestion && body.suggestion.state !== 'reading') return body.suggestion;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('never read');
  };
  return { app, send, read, dataDir };
}

test('a capture is read in the background: a task with a day and a home, what it connects to, and why; Accept makes it', async (t) => {
  const { app, send, read } = await server(t);
  t.after(() => app.close());
  const car = (await send('POST', '/api/life', { kind: 'project', title: 'Car' })).body;
  const note = (await send('POST', '/api/notes', { title: 'Trip plan', body: 'The car service is due before the trip.' })).body;
  const started = Date.now();
  const capture = (await send('POST', '/api/captures', { body: 'book the car service tomorrow' })).body;
  assert.ok(Date.now() - started < 1000, 'saving never waits for the assistant');
  const suggestion = await read(capture.id);
  assert.deepEqual([suggestion.state, suggestion.kind, suggestion.day, suggestion.home?.title], ['ready', 'task', tomorrow(), 'Car']);
  assert.ok(suggestion.connects.some((c) => c.id === note.id));
  assert.equal(suggestion.why, 'It starts with something to do.');
  assert.equal((await send('GET', '/api/captures')).body[0].suggestion.kind, 'task');

  const accepted = (await send('POST', `/api/captures/${capture.id}/accept`, {})).body;
  assert.equal(accepted.made.kind, 'task');
  const task = (await send('GET', '/api/tasks')).body.find((x) => x.id === accepted.made.id);
  assert.deepEqual([task.text, task.due, task.home.id, task.capture.id], ['Book the car service tomorrow', tomorrow(), car.id, capture.id]);
  assert.equal((await send('POST', `/api/captures/${capture.id}/accept`, {})).status, 409);
  // Undo: it waits again, with its suggestion.
  await send('POST', `/api/captures/${capture.id}/undo`, {});
  assert.equal((await send('GET', `/api/captures/${capture.id}`)).body.suggestion.kind, 'task');
});

test('the journal, a note and let it go are suggested and accepted the same way', async (t) => {
  const { app, send, read } = await server(t);
  t.after(() => app.close());
  const ids = {};
  for (const body of ['Slept badly, a short walk helped', 'An idea for the garden: tulips by the fence', 'spam from a shop']) {
    ids[body] = (await send('POST', '/api/captures', { body })).body.id;
  }
  assert.equal((await read(ids['Slept badly, a short walk helped'])).kind, 'journal');
  assert.equal((await read(ids['An idea for the garden: tulips by the fence'])).kind, 'note');
  assert.equal((await read(ids['spam from a shop'])).kind, 'let_go');
  assert.equal((await send('POST', `/api/captures/${ids['Slept badly, a short walk helped']}/accept`, {})).body.made.kind, 'entry');
  assert.equal((await send('POST', `/api/captures/${ids['An idea for the garden: tulips by the fence']}/accept`, {})).body.made.kind, 'note');
  assert.equal((await send('POST', `/api/captures/${ids['spam from a shop']}/accept`, {})).body.kind, 'let_go');
  assert.equal((await send('GET', '/api/captures')).body.length, 0);
  assert.equal((await send('GET', '/api/captures?deleted=1')).body.length, 1, 'let go: in Recently deleted, never gone');
});

test('if the assistant is not available, the capture keeps its words and is read later', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-later-'));
  let { app, send, read } = await server(t, dataDir);
  const capture = (await send('POST', '/api/captures', { body: 'fail-suggest this one' })).body;
  const failed = await read(capture.id);
  assert.deepEqual([failed.state, failed.tries], ['failed', 1]);
  assert.equal((await send('GET', `/api/captures/${capture.id}`)).body.body, 'fail-suggest this one');
  await app.close();
  ({ app, send, read } = await server(t, dataDir));
  t.after(() => app.close());
  await new Promise((done) => setTimeout(done, 50));
  assert.equal((await read(capture.id)).tries, 2, 'tried again when the app started');
});

test('changed words are read again; the Inbox reader may only read', async (t) => {
  const { app, send, read, dataDir } = await server(t);
  t.after(() => app.close());
  const capture = (await send('POST', '/api/captures', { body: 'An idea about tulips' })).body;
  assert.equal((await read(capture.id)).kind, 'note');
  await send('PATCH', `/api/captures/${capture.id}`, { body: 'buy tulip bulbs' });
  assert.equal((await send('GET', `/api/captures/${capture.id}`)).body.suggestion, null, 'the old suggestion is gone at once');
  assert.equal((await read(capture.id)).kind, 'task');
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'assistant', '.mcp', 'inbox.json'), 'utf8')).mcpServers.app;
  const call = await (await fetch(config.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_task', arguments: { text: 'sneaky' } } }),
  })).json();
  assert.deepEqual([call.result.isError, call.result.content[0].text], [true, 'Here you may only read.']);
});

test('only an answer that fits is kept: a known kind, a real home, real pages', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const home = createLifeItem(db, { kind: 'project', title: 'Car' });
  assert.equal(readAnswer(db, 'no json here'), null);
  assert.equal(readAnswer(db, '{"kind": "poem"}'), null);
  const read = readAnswer(db, 'Here: {"title": "Note it", "kind": "note", "day": "2026-10-30", "home_id": "nope", "connects": ["x"], "why": "w"}');
  assert.deepEqual([read.kind, read.day, read.home_id, read.connects], ['note', '', null, '[]']);
  assert.equal(readAnswer(db, `{"kind": "task", "home_id": "${home.id}", "day": "soon"}`).home_id, home.id);
  assert.equal(readAnswer(db, `{"kind": "journal", "home_id": "${home.id}"}`).home_id, null);
});

test('a database from before suggestions gets their table, every capture kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-v21-'));
  let db = openDatabase(dir);
  createCapture(db, { body: 'Kept' });
  db.exec('DROP TABLE capture_suggestions; PRAGMA user_version = 21;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captures').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_suggestions').get().n, 0);
  db.close();
});

test('a read capture starts at the home suggested; a home chosen before is kept; Accept uses the home chosen', async (t) => {
  const { app, send, read } = await server(t);
  t.after(() => app.close());
  const car = (await send('POST', '/api/life', { kind: 'project', title: 'Car' })).body;
  const garage = (await send('POST', '/api/life', { kind: 'project', title: 'Garage' })).body;
  const first = (await send('POST', '/api/captures', { body: 'book the Car service' })).body;
  await read(first.id);
  assert.equal((await send('GET', `/api/captures/${first.id}`)).body.home.id, car.id);
  // Changed by hand, it stays the changed one; Accept uses it.
  assert.equal((await send('PATCH', `/api/captures/${first.id}`, { home_id: garage.id })).body.home.id, garage.id);
  const accepted = (await send('POST', `/api/captures/${first.id}/accept`, {})).body;
  assert.equal((await send('GET', '/api/tasks')).body.find((x) => x.id === accepted.made.id).home.id, garage.id);
  // With no home at all, none is made up.
  assert.equal((await send('PATCH', `/api/captures/${first.id}`, { home_id: null })).body.home, null);
  assert.equal((await send('PATCH', `/api/captures/${first.id}`, { nothing: 1 })).status, 400);
});

test('something from the Outer World is never suggested as a task of the owner’s: a note to keep, or let go', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const answer = '{"title": "Read it", "kind": "task", "day": "2026-10-30", "why": "w"}';
  assert.equal(readAnswer(db, answer).kind, 'task', 'your own thought');
  assert.equal(readAnswer(db, answer, { world: 'inner' }).kind, 'task');
  const outer = readAnswer(db, answer, { world: 'outer' });
  assert.deepEqual([outer.kind, outer.day], ['note', '']);
  assert.equal(readAnswer(db, '{"kind": "let_go"}', { world: 'outer' }).kind, 'let_go');
  setModule(db, 'tasks-plus', false);
  assert.equal(readAnswer(db, answer, { world: 'outer' }).kind, 'task', 'with the module off, nothing is changed');
});
