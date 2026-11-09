// A few words for a long task, by the assistant (short-titles.js), with the stand-in claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createTask, listTasks } from '../../tasks.js';
import { readTitle, isLong } from '../../short-titles.js';
import { startServer } from '../../server.js';

const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const LONG = 'Have to figure out how to iterate this thing so that I duplicate it as the changes come in';

test('only a long task gets a title, and only a short answer is kept', () => {
  assert.equal(isLong('Call the bank'), false);
  assert.equal(isLong(LONG), true);
  assert.equal(readTitle('"Plan the iteration."', LONG), 'Plan the iteration');
  assert.equal(readTitle('Title: Duplicate the app\nmore text', LONG), 'Duplicate the app');
  assert.equal(readTitle('This is far too long to be a short title for anything', LONG), '');
  assert.equal(readTitle('', LONG), '');
});

test('a long task gets its few words in the background; new words, new title; a short task is left alone', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titles-'));
  const app = await startServer({ port: 0, dataDir, assistantCommand: fake, readCalendarsEvery: 0, readCaptures: false });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const long = await send('POST', '/api/tasks', { text: LONG });
  await send('POST', '/api/tasks', { text: 'Call the bank' });
  const shortOf = async (text) => (await (await fetch(`${app.url}/api/tasks`)).json()).find((x) => x.text === text)?.short_text;
  for (let i = 0; i < 100 && !(await shortOf(LONG)); i++) await new Promise((done) => setTimeout(done, 30));
  assert.equal(await shortOf(LONG), 'Have to figure');
  assert.equal(await shortOf('Call the bank'), '');
  const changed = 'Find out how to keep two copies of the app in step while I build the new parts';
  await send('PATCH', `/api/tasks/${long.id}`, { text: changed });
  for (let i = 0; i < 100 && !(await shortOf(changed)); i++) await new Promise((done) => setTimeout(done, 30));
  assert.equal(await shortOf(changed), 'Find out how');
});

test('a database from before short titles gets short_text, every task kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titles-v25-'));
  let db = openDatabase(dir);
  createTask(db, { text: 'Kept' });
  db.exec('ALTER TABLE tasks DROP COLUMN short_text; PRAGMA user_version = 25;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listTasks(db).map((x) => [x.text, x.short_text]), [['Kept', '']]);
  db.close();
});
