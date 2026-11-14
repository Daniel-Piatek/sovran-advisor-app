import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../db.js';
import { createCapture, getCapture, letGo } from '../../captures.js';
import { addGlossary } from '../../glossary.js';
import { fixPhoneWords, rememberSpoken, readTidy, wordsChanged, startTidier, tidyPrompt } from '../../tidy.js';

const fake = [process.execPath, fileURLToPath(new URL('../fake-claude.js', import.meta.url))];
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const phoneNote = (db, said) => { const words = fixPhoneWords(db, said); const c = createCapture(db, { body: words.fixed }); rememberSpoken(db, c.id, words); return c; };

test('only punctuation, capitals and a word or two may change', () => {
  assert.equal(wordsChanged('hello so I am here', 'Hello, so I am here.'), 0);
  assert.equal(wordsChanged('the sovereign advisor', 'The Sovran Advisor'), 1);
  const said = 'hello so I am using my new capture app on my phone this should go to my computer';
  assert.equal(readTidy('Hello. So I am using my new capture app on my phone. This should go to my computer.', said), 'Hello. So I am using my new capture app on my phone. This should go to my computer.');
  assert.equal(readTidy('Here is a summary of your thought.', said), '');
  assert.equal(readTidy('', said), '');
  assert.match(tidyPrompt('words', ['Sovran Advisor']), /Sovran Advisor/);
});

test('a phone note: the Sovran glossary and your own fixes at once, then your assistant punctuates', async (t) => {
  const dataDir = temp(t);
  const db = openDatabase(dataDir);
  addGlossary(db, { term: 'Nordlicht', heard_as: 'north light' });
  const c = phoneNote(db, 'hello so this goes to the sovereign advisor about north light');
  assert.equal(c.body, 'hello so this goes to the Sovran Advisor about Nordlicht');
  const kept = phoneNote(db, 'please rewrite this one');
  const edited = phoneNote(db, 'i will edit this myself');
  db.prepare('UPDATE captures SET body = ? WHERE id = ?').run('I edited it.', edited.id);
  const gone = phoneNote(db, 'this one goes');
  letGo(db, gone.id);
  let done = 0;
  const tidier = startTidier({ db, dataDir, command: fake, every: 0, onDone: () => done++ });
  await tidier.catchUp();
  const now = getCapture(db, c.id);
  assert.equal(now.body, 'Hello so. this goes to the Sovran Advisor about Nordlicht.');
  assert.equal(now.spoken, 'hello so this goes to the sovereign advisor about north light');
  assert.equal(getCapture(db, kept.id).body, 'please rewrite this one', 'an answer with other words is refused');
  assert.equal(getCapture(db, edited.id).body, 'I edited it.', 'what you edited is left alone');
  const states = Object.fromEntries(db.prepare('SELECT capture_id, state FROM capture_tidy').all().map((r) => [r.capture_id, r.state]));
  assert.deepEqual([states[c.id], states[kept.id], states[edited.id], states[gone.id]], ['done', 'kept', 'kept', 'kept']);
  assert.equal(done, 1);
  db.close();
});

test('no assistant: the words stay as they came, tried three times at most', async (t) => {
  const dataDir = temp(t);
  const db = openDatabase(dataDir);
  const c = phoneNote(db, 'no assistant here');
  const tidier = startTidier({ db, dataDir, command: ['/nonexistent/claude'], every: 0 });
  for (let i = 0; i < 4; i++) await tidier.catchUp();
  assert.equal(getCapture(db, c.id).body, 'no assistant here');
  assert.equal(db.prepare('SELECT state FROM capture_tidy').get().state, 'kept');
  db.close();
});
