// Group Circle (module group, group-feed.js; on in a new install, 2026-11-19): asks the Sovran cloud with the library key
// (a stand-in cloud here, tests/fake-group-cloud.js), counts what's new per tab, keeps each picture once, never sends the
// key to a page. The cloud's own rules (groups kept apart, announcements from Daniel only) are in cloud/group-feed.test.sql.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { setModule, moduleOn } from '../../modules.js';
import { setLibraryKey } from '../../sovran-library.js';
import { useGroup, groupState, readTab, setName, addPost, addComment, likePost, markDone, addPicture, pictureBytes, removePost } from '../../group-feed.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const OTHER = 'sovran_someoneelsesomeoneelse0';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

function setup({ key = KEY, name = 'Maya' } = {}) {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  if (key) setLibraryKey(db, key);
  const cloud = fakeGroupCloud({
    students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name } },
    posts: [
      { id: 1, tab: 'news', kind: 'homework', body: 'Week 2: meet your Tyrant', due_on: '2026-11-22', created_at: ago(60) },
      { id: 2, tab: 'feed', kind: 'post', student: 'client-bbbbbbbbbbbb', body: 'Took my Tyrant for a walk', created_at: ago(30) },
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-'));
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', dir });
  return { db, cloud, dir };
}

test('Group Circle is on in a new install', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  assert.equal(moduleOn(db, 'group'), true);
  setModule(db, 'group', false);
  assert.equal(moduleOn(db, 'group'), false);
});

test('without a library key it says so, and asks nothing', async () => {
  const { db, cloud } = setup({ key: null });
  const state = await groupState(db);
  assert.equal(state.ready, false);
  assert.equal(state.why, 'nolibrary');
  assert.equal(cloud.state.asked.length, 0);
});

test('a key the cloud doesn’t know: not in a group yet', async () => {
  const { db } = setup({ key: OTHER });
  assert.equal((await groupState(db)).why, 'nogroup');
});

test('the key goes to the cloud and never into an answer; counts drop once a tab is shown', async () => {
  const { db, cloud } = setup();
  const seen = [];
  useGroup({ fetch: (url, init) => { seen.push(init?.headers?.authorization); return cloud.fetcher(url, init); } });
  const state = await groupState(db);
  assert.equal(state.ready, true);
  assert.deepEqual(state.counts, { news: 1, feed: 1 });
  assert.equal(state.me.group, 'SQ01');
  assert.ok(seen.every((a) => a === `Bearer ${KEY}`));
  assert.ok(!JSON.stringify(state).includes(KEY));
  const news = await readTab(db, 'news');
  assert.equal(news.posts[0].kind, 'homework');
  assert.deepEqual((await groupState(db)).counts, { news: 0, feed: 1 });
  await readTab(db, 'feed');
  assert.deepEqual((await groupState(db)).counts, { news: 0, feed: 0 });
});

test('posting, commenting, liking and ticking homework pass through', async () => {
  const { db } = setup();
  const { id } = await addPost(db, { body: '  Sat by the lake  ' });
  const feed = await readTab(db, 'feed');
  assert.equal(feed.posts[0].id, id);
  assert.equal(feed.posts[0].body, 'Sat by the lake');
  assert.equal(feed.posts[0].mine, true);
  await addComment(db, 2, { body: 'Love this' });
  assert.equal((await likePost(db, 2, { on: true })).likes, 1);
  assert.equal((await markDone(db, 1, { on: true })).done, true);
  assert.equal((await readTab(db, 'news')).posts[0].done, true);
  await removePost(db, id);
  assert.equal((await readTab(db, 'feed')).posts.length, 1);
});

test('the app checks words and pictures before asking the cloud', async () => {
  const { db } = setup();
  await assert.rejects(addPost(db, { body: '   ' }), /Write something or add a picture/);
  await assert.rejects(addPost(db, { body: 'x'.repeat(5001) }), /at most 5,000/);
  await assert.rejects(addPost(db, { body: 'hi', pictures: ['../../etc/passwd'] }), /pictures aren’t right/);
  await assert.rejects(addPost(db, { body: 'hi', pictures: Array(5).fill('SQ01/aaaaaaaaaaaaaaaaaaaaaa.jpg') }), /at most 4/);
  await assert.rejects(addComment(db, 2, { body: '' }), /Write your comment/);
  await assert.rejects(setName(db, { name: '' }), /Write the name/);
});

test('a student must pick a name before posting (the cloud says so)', async () => {
  const { db } = setup({ name: null });
  await assert.rejects(addPost(db, { body: 'hello' }), (err) => err.status === 409 && err.code === 'noname');
  await setName(db, { name: 'Maya' });
  assert.ok((await addPost(db, { body: 'hello' })).id);
});

test('a picture: only a JPEG, kept on this computer, and fetched from the cloud only once', async () => {
  const { db, cloud, dir } = setup();
  await assert.rejects(addPicture(db, Buffer.from('not a picture at all, just words, long enough to pass the size check '.repeat(3))), /isn’t a picture/);
  await assert.rejects(addPicture(db, Buffer.concat([JPEG, Buffer.alloc(460_000)])), /too big/);
  const { path: name } = await addPicture(db, JPEG);
  assert.match(name, /^SQ01\/[A-Za-z0-9_-]{22}\.jpg$/);
  assert.ok(fs.existsSync(path.join(dir, ...name.split('/'))), 'kept here as it was sent');
  // Someone else's picture: fetched once, then from this computer.
  const theirs = 'SQ01/zzzzzzzzzzzzzzzzzzzzzz.jpg';
  cloud.state.pictures.set(theirs, JPEG);
  let asks = 0;
  useGroup({ fetch: (url, init) => { if (String(url).includes('/picture/')) asks += 1; return cloud.fetcher(url, init); } });
  assert.deepEqual(await pictureBytes(db, theirs), JPEG);
  assert.deepEqual(await pictureBytes(db, theirs), JPEG);
  assert.equal(asks, 1);
  await assert.rejects(pictureBytes(db, '../secret.jpg'), /no such picture/);
});

test('the cloud can’t be reached: a plain message, not a crash', async () => {
  const { db } = setup();
  useGroup({ fetch: async () => { throw new Error('offline'); } });
  const state = await groupState(db);
  assert.equal(state.why, 'offline');
  await assert.rejects(readTab(db, 'feed'), /can’t be reached/);
});
