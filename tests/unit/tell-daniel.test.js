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
import { tellDaniel, listTells, markTell, appVersion } from '../../tell-daniel.js';
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
  assert.match(appVersion(), /^\d+\.\d+\.\d+/);
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
