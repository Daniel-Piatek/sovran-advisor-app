// Tell Daniel (module tell, tell-daniel.js; on in a new install, 2026-11-19): checks what a student sends, adds the app's
// version, sends it with the library key (a stand-in cloud here, tests/fake-group-cloud.js), and lets the guide list and
// mark them. The cloud's own rules are in cloud/tell-daniel.test.sql.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { moduleOn } from '../../modules.js';
import { setLibraryKey, libraryKey } from '../../sovran-library.js';
import { useGroup } from '../../group-feed.js';
import { tellDaniel, listTells, markTell, appVersion, noteNewTells, replyOnTell, myTells, unreadTells, seenTell, askClaude } from '../../tell-daniel.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const GUIDE = 'guide_madeupmadeupmadeupmadeupmadeup';

function setup({ key = KEY } = {}) {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  if (key) setLibraryKey(db, key);
  const cloud = fakeGroupCloud({ students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name: 'Maya' } }, guides: { [GUIDE]: 'Daniel' } });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', keyOf: libraryKey, guideApp: false });
  return { db, cloud };
}

test('Tell Daniel is on in a new install', () => {
  assert.equal(moduleOn(prepareDatabase(new DatabaseSync(':memory:')), 'tell'), true);
});

test('a report goes with the key, the place, what it was about and the app’s version', async () => {
  const { db, cloud } = setup();
  const seen = [];
  useGroup({ fetch: (url, init) => { seen.push(init.headers.authorization); return cloud.fetcher(url, init); } });
  const { id } = await tellDaniel(db, { kind: 'off', why: '  This doesn’t sound like me  ', place: 'assistant',
    context: { question: 'What is my Tyrant?', answer: 'It is…', used: ['Search teaching: tyrant'], extra: { deep: { deeper: { deepest: { gone: 1 } } } } } });
  assert.ok(id);
  const sent = cloud.state.asked.at(-1);
  assert.equal(seen.at(-1), `Bearer ${KEY}`);
  assert.equal(sent.why, 'This doesn’t sound like me');
  assert.equal(sent.place, 'assistant');
  assert.equal(sent.context.question, 'What is my Tyrant?');
  assert.equal(sent.context.extra.deep.deeper.deepest, null, 'only a few levels deep');
  assert.equal(sent.version, appVersion());
  assert.match(appVersion(), / · (Mac|Windows|Linux|\w+)$/);
});

test('the app checks before it asks the cloud', async () => {
  const { db, cloud } = setup();
  await assert.rejects(tellDaniel(db, { kind: 'rant', why: 'x' }), /Pick what kind/);
  await assert.rejects(tellDaniel(db, { kind: 'other', why: '  ' }), /Tell Daniel what it’s about/);
  await assert.rejects(tellDaniel(db, { kind: 'off', why: 'x'.repeat(4001) }), /4,000/);
  await assert.rejects(tellDaniel(db, { kind: 'off', context: { a: 'x'.repeat(20_000), b: 'x'.repeat(20_000), c: 'x'.repeat(20_000) } }), /too much/);
  assert.equal(cloud.state.asked.length, 0);
  const odd = await tellDaniel(db, { kind: 'broken', place: 'somewhere', context: ['not', 'an', 'object'] });
  assert.ok(odd.id);
  assert.deepEqual([cloud.state.asked.at(-1).place, cloud.state.asked.at(-1).context], ['app', {}]);
});

test('without a library key it says so', async () => {
  const { db } = setup({ key: null });
  await assert.rejects(tellDaniel(db, { kind: 'broken' }), /needs your Sovran Library key/);
});

test('the guide lists them and marks each one; a student cannot', async () => {
  const { db, cloud } = setup();
  await tellDaniel(db, { kind: 'question', why: 'Why two critics?', place: 'report', context: { quote: 'the Tyrant' } });
  await assert.rejects(listTells(db), (err) => err.code === 'guideonly');
  useGroup({ keyOf: () => GUIDE });
  const { reports, counts } = await listTells(db, { status: 'new' });
  assert.equal(reports.length, 1);
  assert.deepEqual(counts, { new: 1, digging: 0, done: 0 });
  await markTell(db, reports[0].id, { status: 'digging', note: 'Check part 2' });
  assert.equal(cloud.state.tells[0].status, 'digging');
  await assert.rejects(markTell(db, reports[0].id, { status: 'maybe' }), /Pick New/);
  assert.deepEqual((await listTells(db)).counts, { new: 0, digging: 1, done: 0 });
});

test('the guide’s Inbox gets one line a day while new reports wait', async () => {
  const { db } = setup();
  await tellDaniel(db, { kind: 'broken', why: 'Planner is blank' });
  await tellDaniel(db, { kind: 'off', why: 'Not me' });
  useGroup({ keyOf: () => GUIDE });
  const inbox = [];
  const add = (text) => inbox.push(text);
  assert.match(await noteNewTells(db, add, { today: '2026-11-19' }), /^2 new student reports/);
  assert.equal(await noteNewTells(db, add, { today: '2026-11-19' }), null, 'once a day');
  assert.ok(await noteNewTells(db, add, { today: '2026-11-20' }), 'the next day again, while they wait');
  assert.equal(inbox.length, 2);
  useGroup({ keyOf: () => '' });
  assert.equal(await noteNewTells(db, add, { today: '2026-11-21' }), null, 'no guide key: nothing, no error');
});

// Replies and Ask Claude (2026-11-24)
test('Daniel replies, the student reads it and answers; Daniel asks Claude', async () => {
  const { db, cloud } = setup();
  const { id } = await tellDaniel(db, { kind: 'broken', why: 'Tell Daniel didn’t work', place: 'app' });
  const guide = prepareDatabase(new DatabaseSync(':memory:'));
  useGroup({ keyOf: () => GUIDE, guideApp: true });
  try {
    await assert.rejects(replyOnTell(guide, id, { body: '   ' }), /Write something first/);
    await replyOnTell(guide, id, { body: 'Please try again now.' });
    await askClaude(guide, id, { question: '' });
    assert.equal(cloud.state.tells[0].ask_claude, 'Please look into this report.', 'an empty question still asks');
    const { reports } = await listTells(guide);
    assert.equal(reports[0].messages[0].body, 'Please try again now.');
  } finally { useGroup({ keyOf: libraryKey, guideApp: false }); }
  let mine = (await myTells(db)).reports;
  assert.equal(mine[0].messages[0].from_daniel, true);
  assert.deepEqual(await unreadTells(db), { unread: 1 }, 'the red number on Help');
  assert.equal(mine[0].ask_claude, undefined, 'the student never gets Daniel’s question to Claude');
  await seenTell(db, id);
  assert.ok(cloud.state.tells[0].messages[0].read_at);
  assert.deepEqual(await unreadTells(db), { unread: 0 });
  await markTell(prepareDatabase(new DatabaseSync(':memory:')), id, { status: 'done' }).catch(() => {}); // (a student cannot)
  await replyOnTell(db, id, { body: 'It works now, thank you!' });
  mine = (await myTells(db)).reports;
  assert.deepEqual(mine[0].messages.map((m) => m.from_daniel), [true, false]);
  await assert.rejects(replyOnTell(db, 'x', { body: 'hi' }), /no such report/);
});

test('before the cloud has replies, it says so plainly', async () => {
  const { db } = setup();
  useGroup({ fetch: async () => new Response(JSON.stringify({ error: 'Unknown action: tell_mine' }), { status: 400 }) });
  const mine = await myTells(db); // an empty list with the reason, not an error
  assert.deepEqual(mine.reports, []);
  assert.match(mine.note, /aren’t switched on in the Sovran cloud yet/);
  await assert.rejects(replyOnTell(db, 1, { body: 'hi' }), (err) => err.code === 'notyet');
  assert.deepEqual(await unreadTells(db), { unread: 0 }, 'the sidebar asks quietly');
});
