// Keep this chat saved: the sealing (cloud/library-save/sealing.js), the Sovran Library's save tool
// (cloud/library-save/save.js) against a stand-in drop box, and the joining into one Inbox item (chat-saves.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../../db.js';
import { readLinkPart } from '../../phone/seal.js';
import { linkPhone, collect } from '../../phone-drop.js';
import { waitingCaptures, updateCapture, letGo, getCapture } from '../../captures.js';
import { setLibraryKey } from '../../sovran-library.js';
import { makeSaveKeys, sealTo, openSealed, PUBLIC_KEY } from '../../cloud/library-save/sealing.js';
import { SAVE_TOOL, SAVE_INSTRUCTIONS, saveToAdvisor, redactSave, MAX_SAVE_CHARS } from '../../cloud/library-save/save.js';
import { renderChat, aiOf } from '../../chat-saves.js';
import { listConversations, getConversation, deleteConversation } from '../../assistant.js';
import { startServer } from '../../server.js';
import { fakeBox } from '../fake-drop-box.js';
import { useReports } from '../../reports.js';

// A library key is set here, and Reports is on in a new install: the copies for the phone's shelf (phone-shelf.js) must
// never ask the real Sovran Library from a test.
useReports({ fetch: async () => new Response('{}', { status: 401 }) });

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-saves-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const KEY = 'sovran_madeupmadeupmadeupmadeup';
const STUDENT = 'client-madeup';

// A student's computer, linked, with a library key the stand-in library knows; and their AI's save tool.
async function student(t, { known = true, ...boxOptions } = {}) {
  const db = openDatabase(temp(t));
  const box = fakeBox(boxOptions);
  if (known) box.students.set(box.sha(KEY), STUDENT);
  setLibraryKey(db, KEY);
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  const save = (args) => saveToAdvisor(box.libraryTx(STUDENT), { id: STUDENT }, args);
  const collects = () => collect(db, { fetcher: box.fetcher });
  return { db, box, link, save, collects };
}
const chatId = (text) => /chat_id: ([a-z0-9]{12})\./.exec(text)[1];

test('sealed to a public key, it opens only with the matching private key, and not once changed', async () => {
  const keys = await makeSaveKeys();
  assert.match(keys.public, PUBLIC_KEY);
  const sealed = await sealTo(keys.public, { kind: 'chat', turns: [{ asked: 'What is my Pattern?', answer: 'A mirror.' }] });
  assert.match(sealed, /^[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes('Pattern'));
  assert.notEqual(sealed, await sealTo(keys.public, { kind: 'chat', turns: [{ asked: 'What is my Pattern?', answer: 'A mirror.' }] }), 'never the same twice');
  assert.equal((await openSealed(keys, sealed)).turns[0].answer, 'A mirror.');
  await assert.rejects(openSealed(await makeSaveKeys(), sealed));
  const changed = sealed.slice(0, -3) + (sealed.endsWith('AAA') ? 'BBB' : 'AAA');
  await assert.rejects(openSealed(keys, changed));
  await assert.rejects(sealTo('not-a-key', {}));
});

test('the tool says when to offer and how to keep saving, and its log line never holds the words', () => {
  assert.equal(SAVE_TOOL.name, 'save_to_my_sovran_advisor');
  for (const words of [SAVE_TOOL.description, SAVE_INSTRUCTIONS]) assert.match(words, /Would you like me to keep this chat saved to your Sovran Central\?/);
  assert.match(SAVE_INSTRUCTIONS, /Never save without the student's yes/);
  const logged = redactSave(SAVE_TOOL.name, { chat_id: 'abcdefghij12', title: 'Secret title', turns: [{ number: 1, asked: 'my secret question', answer: 'a private answer' }] });
  assert.deepEqual(logged, { chat_id: 'abcdefghij12', turns: 1, chars: 34 });
  assert.ok(!JSON.stringify(logged).includes('secret'));
  assert.deepEqual(redactSave('search_teaching', { query: 'STOP' }), { query: 'STOP' }, 'other tools are logged as before');
});

test('a chat is saved in parts and arrives as one Inbox item, in order, each turn once', async (t) => {
  const { db, box, save, collects } = await student(t);
  assert.equal(await collects(), 0); // the first look registers this computer's public key
  const register = box.calls.find((c) => c.action === 'register');
  assert.match(register.public, PUBLIC_KEY);
  assert.ok(!JSON.stringify(box.calls).includes('"d"'), 'the private key never leaves the computer');
  assert.equal(box.calls.filter((c) => c.action === 'register').length, 1);

  const first = await save({ title: 'My Pattern and work', assistant: 'Claude', turns: [
    { number: 1, asked: 'What does my Pattern say about work?', answer: 'It speaks of **steady building**.\n\n- one\n- two' },
    { number: 2, asked: 'And rest?', answer: 'Rest is part of the work.' }] });
  assert.match(first.text, /^Saved \(questions 1 to 2\)\. chat_id: [a-z0-9]{12}\./);
  assert.equal(first.results, 2);
  const id = chatId(first.text);
  const waitingSealed = [...box.boxes.values()][0].notes[0].sealed;
  assert.ok(!waitingSealed.includes('Pattern') && !Buffer.from(waitingSealed, 'base64url').toString('latin1').includes('Pattern'), 'nothing readable waits in the box');
  assert.equal(await collects(), 1);
  let [item] = waitingCaptures(db);
  assert.equal(item.body, 'My Pattern and work\n\n---\n\n**You asked:** What does my Pattern say about work?\n\nIt speaks of **steady building**.\n\n- one\n- two\n\n---\n\n**You asked:** And rest?\n\nRest is part of the work.');
  assert.equal(item.world, 'outer');
  assert.deepEqual({ ...JSON.parse(item.chat), at: null }, { assistant: 'Claude', questions: 2, at: null });
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_tidy').get().n, 0, 'a saved chat is not re-punctuated');

  // The next answer: only the new turn is sent, and it joins the same item. Sent twice, it is kept once.
  const second = await save({ chat_id: id, turns: [{ number: 3, asked: 'One more?', answer: 'Yes.' }] });
  assert.match(second.text, /^Saved \(question 3\)\. chat_id: /);
  assert.equal(chatId(second.text), id);
  await save({ chat_id: id, turns: [{ number: 3, asked: 'One more?', answer: 'Yes.' }] });
  // "save this" later sends everything again, with a turn that was missed: still one item, in order.
  await save({ chat_id: id, turns: [{ number: 5, asked: 'Fifth', answer: 'E' }, { number: 4, asked: 'Fourth', answer: 'D' }, { number: 1, asked: 'What does my Pattern say about work?', answer: 'It speaks of **steady building**.\n\n- one\n- two' }] });
  assert.equal(await collects(), 3);
  const items = waitingCaptures(db);
  assert.equal(items.length, 1);
  [item] = items;
  assert.deepEqual([...item.body.matchAll(/\*\*You asked:\*\* (.*)/g)].map((m) => m[1]), ['What does my Pattern say about work?', 'And rest?', 'One more?', 'Fourth', 'Fifth']);
  assert.equal(JSON.parse(item.chat).questions, 5);
  assert.equal([...box.boxes.values()][0].notes.length, 0);

  // Another chat is another item.
  await save({ title: 'A second chat', turns: [{ number: 1, asked: 'Hello?', answer: 'Hello.' }] });
  await collects();
  assert.equal(waitingCaptures(db).length, 2);
  db.close();
});

test('a saved chat is also a chat in Sovran Advisor, each turn once, and carried on there it is told the new turns', async (t) => {
  const { db, save, collects } = await student(t);
  await collects();
  const id = chatId((await save({ title: 'My Pattern and work', assistant: 'Claude', turns: [
    { number: 1, asked: 'What does my Pattern say about work?', answer: 'Steady building.' },
    { number: 2, asked: 'And rest?', answer: 'Rest is part of the work.' }] })).text);
  await collects();
  let [chat] = listConversations(db);
  assert.equal(chat.title, 'My Pattern and work');
  assert.equal(chat.origin, 'imported');
  assert.equal(chat.last_ai, 'claude');
  let { messages } = getConversation(db, chat.id);
  assert.deepEqual(messages.map((m) => [m.role, m.text, m.ai]), [
    ['user', 'What does my Pattern say about work?', ''], ['assistant', 'Steady building.', 'claude'],
    ['user', 'And rest?', ''], ['assistant', 'Rest is part of the work.', 'claude']]);

  // Sent again with a new turn: only the new one is added. Already carried on in the app, it starts afresh next time.
  db.prepare('UPDATE conversations SET started = 1 WHERE id = ?').run(chat.id);
  const session = getConversation(db, chat.id).session_id;
  await save({ chat_id: id, turns: [{ number: 2, asked: 'And rest?', answer: 'Rest is part of the work.' }, { number: 3, asked: 'One more?', answer: 'Yes.' }] });
  await collects();
  assert.equal(listConversations(db).length, 1);
  chat = getConversation(db, chat.id);
  assert.equal(chat.messages.length, 6);
  assert.equal(chat.messages.at(-1).text, 'Yes.');
  assert.equal(chat.started, false);
  assert.notEqual(chat.session_id, session);

  // Deleted in Sovran Advisor: what comes after starts a new chat, with only the new turn. The Inbox item goes on.
  deleteConversation(db, chat.id);
  await save({ chat_id: id, turns: [{ number: 4, asked: 'Fourth?', answer: 'Four.' }] });
  await collects();
  [chat] = listConversations(db);
  assert.equal(listConversations(db).length, 1);
  assert.deepEqual(getConversation(db, chat.id).messages.map((m) => m.text), ['Fourth?', 'Four.']);
  assert.equal(waitingCaptures(db).length, 1);
  assert.match(waitingCaptures(db)[0].body, /Fourth\?/);

  // ChatGPT's chats are ChatGPT's; an AI it does not know is named by none.
  await save({ title: 'From ChatGPT', assistant: 'ChatGPT', turns: [{ number: 1, asked: 'Hi?', answer: 'Hi.' }] });
  await collects();
  assert.equal(listConversations(db).find((c) => c.title === 'From ChatGPT').last_ai, 'codex');
  assert.deepEqual(['Claude', 'claude.ai', 'ChatGPT', 'GPT-6', 'Gemini', ''].map(aiOf), ['claude', 'claude', 'codex', 'codex', '', '']);
  db.close();
});

test('an item you edited, sorted or deleted is left alone; what comes after starts a new item, continued', async (t) => {
  const { db, save, collects } = await student(t);
  await collects();
  const id = chatId((await save({ title: 'Edited chat', turns: [{ number: 1, asked: 'First?', answer: 'One.' }] })).text);
  await collects();
  const [item] = waitingCaptures(db);
  updateCapture(db, item.id, { body: `${item.body}\n\nMy own note.` });
  await save({ chat_id: id, turns: [{ number: 1, asked: 'First?', answer: 'One.' }, { number: 2, asked: 'Second?', answer: 'Two.' }] });
  await collects();
  const items = waitingCaptures(db);
  assert.equal(items.length, 2);
  assert.match(getCapture(db, item.id).body, /My own note\.$/, 'your edit stays');
  const more = items.find((c) => c.id !== item.id);
  assert.equal(more.body, 'Edited chat (continued)\n\n---\n\n**You asked:** Second?\n\nTwo.', 'only what the first item does not hold');
  // The continued item takes what follows; deleted, a third begins, still "(continued)" once.
  await save({ chat_id: id, turns: [{ number: 3, asked: 'Third?', answer: 'Three.' }] });
  await collects();
  assert.match(getCapture(db, more.id).body, /Third\?/);
  letGo(db, more.id);
  await save({ chat_id: id, turns: [{ number: 4, asked: 'Fourth?', answer: 'Four.' }] });
  await collects();
  const third = waitingCaptures(db).find((c) => c.id !== item.id);
  assert.equal(third.body, 'Edited chat (continued)\n\n---\n\n**You asked:** Fourth?\n\nFour.');
  // Everything saved before, sent again: nothing new is made.
  await save({ chat_id: id, turns: [{ number: 4, asked: 'Fourth?', answer: 'Four.' }] });
  await collects();
  assert.equal(waitingCaptures(db).length, 2);
  db.close();
});

test('what the tool refuses, in words the AI can pass on', async (t) => {
  const { db, box, save, collects } = await student(t);
  assert.match((await save({ turns: [{ number: 1, asked: 'Too early', answer: 'x' }] })).text, /^Not saved\. This Sovran Central is not set up for saving chats yet\..*go Sovran/s, 'before the computer registered');
  await collects();
  assert.match((await save({ turns: [] })).text, /^Not saved: send at least one turn/);
  assert.match((await save({ turns: [{ asked: 'No number', answer: 'x' }] })).text, /needs its number/);
  assert.match((await save({ chat_id: 'made up!', turns: [{ number: 1, asked: 'a', answer: 'b' }] })).text, /not a chat_id/);
  assert.match((await save({ turns: [{ number: 1, asked: 'a', answer: 'x'.repeat(MAX_SAVE_CHARS) }] })).text, /Send fewer turns per call/);
  assert.match((await save({ turns: Array.from({ length: 41 }, (_, i) => ({ number: i + 1, asked: 'a', answer: 'b' })) })).text, /at most 40 turns/);
  box.savers.get(STUDENT).saves = 120;
  assert.match((await save({ turns: [{ number: 1, asked: 'a', answer: 'b' }] })).text, /too many saves in the last hour/);
  box.savers.get(STUDENT).saves = 0;
  [...box.boxes.values()][0].notes = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, sealed: 'x' }));
  assert.match((await save({ turns: [{ number: 1, asked: 'a', answer: 'b' }] })).text, /too much is waiting/);
  assert.equal(waitingCaptures(db).length, 0);
  db.close();
});

test('the largest save, of the widest characters, still fits the drop box once sealed', async (t) => {
  const { db, box, save, collects } = await student(t);
  await collects();
  const answer = '語'.repeat(MAX_SAVE_CHARS - 1);
  assert.match((await save({ turns: [{ number: 1, asked: '?', answer }] })).text, /^Saved/);
  assert.ok([...box.boxes.values()][0].notes[0].sealed.length <= 170000);
  await collects();
  assert.ok(waitingCaptures(db)[0].body.endsWith(answer));
  db.close();
});

test('only the library’s tool can add to a chat; the phone’s link cannot, and the phone still works', async (t) => {
  const { db, box, link, collects } = await student(t);
  await box.phoneDrops(link, { kind: 'chat', chat_id: 'abcdefghij12', turns: [{ n: 1, asked: 'Not from the tool', answer: 'x' }] });
  await box.phoneDrops(link, { body: 'A thought from the phone', world: 'inner' });
  assert.equal(await collects(), 1);
  assert.deepEqual(waitingCaptures(db).map((c) => [c.body, c.chat]), [['A thought from the phone', null]]);
  db.close();
});

test('a key the library does not know, or an older drop box: nothing breaks, and it is asked again only after an hour', async (t) => {
  for (const options of [{ known: false }, { registers: false }]) {
    const { db, box, link, collects } = await student(t, options);
    await box.phoneDrops(link, { body: 'Still collected', world: 'inner' });
    assert.equal(await collects(), 1);
    await collects();
    assert.equal(box.calls.filter((c) => c.action === 'register').length, 1);
    // An hour on, it asks again; and once the library knows the key, it registers.
    const row = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'phone.drop'").get().value);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'phone.drop'").run(JSON.stringify({ ...row, saver_asked_at: new Date(Date.now() - 3601_000).toISOString() }));
    await collects();
    assert.equal(box.calls.filter((c) => c.action === 'register').length, 2);
    assert.equal(box.savers.size, 0);
    db.close();
  }
});

test('a new phone link, or another library key, registers again; without a library key nothing is registered', async (t) => {
  const { db, box, collects } = await student(t);
  await collects();
  const before = box.savers.get(STUDENT);
  await linkPhone(db, { fetcher: box.fetcher, fresh: true });
  assert.equal(box.savers.size, 0, 'the old box is gone, and its registration with it');
  await collects();
  const after = box.savers.get(STUDENT);
  assert.notEqual(after.box, before.box);
  assert.equal(after.public, before.public, 'the same pair of keys');
  box.students.set(box.sha('sovran_anotherkeyanotherkeyanother'), 'client-other');
  setLibraryKey(db, 'sovran_anotherkeyanotherkeyanother');
  await collects();
  assert.deepEqual([...box.savers.keys()], ['client-other'], 'one student per box');
  setLibraryKey(db, '');
  const calls = box.calls.length;
  await collects();
  assert.equal(box.calls.slice(calls).filter((c) => c.action === 'register').length, 0);
  db.close();
});

test('schema 77 adds the table for saved chats to an older database and keeps everything else', async (t) => {
  const dir = temp(t);
  let db = openDatabase(dir);
  db.exec('DROP INDEX chat_saves_by_chat; DROP TABLE chat_saves; PRAGMA user_version = 76;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM chat_saves').get().n, 0);
  db.close();
});

test('the Inbox is told which item is a saved chat', async (t) => {
  const box = fakeBox();
  box.students.set(box.sha(KEY), STUDENT);
  const app = await startServer({ dataDir: temp(t), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0, phoneDropFetch: box.fetcher });
  t.after(() => app.close());
  const api = (method, p, body) => fetch(app.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  await api('PUT', '/api/library', { key: KEY });
  await api('PATCH', '/api/modules', { id: 'phone-drop', on: true });
  await api('POST', '/api/phone-drop/link', {});
  await api('POST', '/api/phone-drop/check', {});
  await saveToAdvisor(box.libraryTx(STUDENT), { id: STUDENT }, { title: 'Shown in the Inbox', assistant: 'Claude', turns: [{ number: 1, asked: 'Q', answer: 'A' }] });
  assert.equal((await (await api('POST', '/api/phone-drop/check', {})).json()).collected, 1);
  const waiting = await (await api('GET', '/api/captures')).json();
  assert.equal(JSON.parse(waiting[0].chat).assistant, 'Claude');
  assert.equal(renderChat('T', [{ n: 1, asked: '', answer: 'Only an answer' }]), 'T\n\n---\n\nOnly an answer');
});
