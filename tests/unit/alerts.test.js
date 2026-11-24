// Alerts (alerts.js, 2026-11-22): what is new in Group Circle, said once each, by kind with its own switch, and the
// homework due tomorrow said once. The cloud's own rules (whose posts, whose replies) are in cloud/group-alerts.test.sql;
// here a stand-in cloud (tests/fake-group-cloud.js) answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { setModule } from '../../modules.js';
import { setLibraryKey, libraryKey } from '../../sovran-library.js';
import { useGroup } from '../../group-feed.js';
import { takeAlerts, alertSwitches, setAlertSwitch, alertWords } from '../../alerts.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const ME = 'client-aaaaaaaaaaaa';
const JON = 'client-bbbbbbbbbbbb';
const at = (min) => new Date(Date.now() + min * 60_000).toISOString();
const tick = () => new Promise((done) => setTimeout(done, 3));
const justNow = () => new Date().toISOString();
const localDay = (days) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function setup() {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  setLibraryKey(db, KEY);
  const cloud = fakeGroupCloud({
    students: { [KEY]: { id: ME, name: 'Maya' }, sovran_jonjonjonjonjonjonjonjon00: { id: JON, name: 'Jon' } },
    posts: [
      { id: 1, tab: 'news', kind: 'homework', body: 'Read chapter 2', due_on: localDay(1), created_at: at(-600) },
      { id: 2, tab: 'feed', kind: 'post', student: ME, body: 'My first drawing', created_at: at(-300) },
    ],
  });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-')), guideApp: false });
  const add = (p) => cloud.state.posts.push({ comments: [], likes: [], done: [], flags: [], pictures: [], comments_on: true, group: p.tab === 'news' ? null : 'SQ01', ...p });
  return { db, cloud, add };
}

test('the first ask only says what homework is due, and says it once', async () => {
  const { db } = setup();
  const first = await takeAlerts(db);
  assert.deepEqual(first.items.map((a) => [a.kind, a.title, a.path]), [['due', 'Homework due tomorrow', '/group/announcements#post-1']]);
  assert.equal((await takeAlerts(db)).items.length, 0, 'not again');
});

test('a new announcement, and a comment on my post, each said once; never my own post', async () => {
  const { db, cloud, add } = setup();
  await takeAlerts(db);
  await tick();
  add({ id: 3, tab: 'news', kind: 'announcement', body: 'Live call on Thursday at 7', created_at: justNow() });
  add({ id: 4, tab: 'feed', kind: 'post', student: ME, body: 'Another drawing', created_at: justNow() });
  cloud.state.posts.find((p) => p.id === 2).comments.push({ id: 50, student: JON, body: 'Lovely colours', created_at: justNow() });
  await tick();
  const { items } = await takeAlerts(db);
  assert.deepEqual(items.map((a) => a.title).sort(), ['Jon commented on your post', 'New from Daniel']);
  assert.equal(items.find((a) => a.kind === 'news').path, '/group/announcements#post-3');
  assert.equal(items.find((a) => a.kind === 'reply').body, 'Lovely colours');
  assert.equal((await takeAlerts(db)).items.length, 0);
});

test('each kind has its own switch; any new Circle post starts off', async () => {
  const { db, add } = setup();
  assert.deepEqual(alertSwitches(db).map((k) => [k.id, k.on]), [['news', true], ['reply', true], ['due', true], ['answer', true], ['update', true], ['feed', false]]);
  await takeAlerts(db);
  await tick();
  add({ id: 5, tab: 'feed', kind: 'post', student: JON, body: 'Took my Tyrant for a walk', created_at: justNow() });
  await tick();
  assert.equal((await takeAlerts(db)).items.length, 0, 'the Circle is quiet by default');
  await tick();
  setAlertSwitch(db, { id: 'feed', on: true });
  setAlertSwitch(db, { id: 'news', on: false });
  add({ id: 6, tab: 'feed', kind: 'post', student: JON, body: '', pictures: ['SQ01/aaaaaaaaaaaaaaaaaaaaaa.jpg'], created_at: justNow() });
  add({ id: 7, tab: 'news', kind: 'reminder', body: 'Bring your chart', created_at: justNow() });
  await tick();
  const { items } = await takeAlerts(db);
  assert.deepEqual(items.map((a) => [a.title, a.body]), [['Jon posted in the Circle', 'A picture']]);
  assert.throws(() => setAlertSwitch(db, { id: 'everything', on: true }), /Pick an alert/);
});

test('Daniel dealing with what you told him is said, without his own note', async () => {
  const { db, cloud } = setup();
  await takeAlerts(db);
  await tick();
  cloud.state.tells.push({ id: 9, student_id: ME, kind: 'question', why: 'What does my Gremlin mean?', place: 'report', status: 'done', note: 'private', status_at: justNow(), created_at: at(-60) });
  await tick();
  const { items } = await takeAlerts(db);
  assert.deepEqual(items.map((a) => [a.title, a.body]), [['Daniel has dealt with what you told him', 'What does my Gremlin mean?']]);
  assert.ok(!JSON.stringify(items).includes('private'));
});

// Replies (2026-11-24): Daniel's reply comes as "Daniel replied" (the "answer" switch), opens that report on What you
// told Daniel, and leaves a line in the Inbox; in Daniel's app the student's answer and Claude's answer come with Reply.
test('Daniel replied: an alert that opens the report, and a line in the Inbox', async () => {
  const { db, cloud } = setup();
  const inbox = [];
  await takeAlerts(db, { addToInbox: (t) => inbox.push(t) });
  await tick();
  cloud.state.tells.push({ id: 9, student_id: ME, kind: 'question', why: 'What does my Gremlin mean?', place: 'report', status: 'digging', created_at: at(-60),
    messages: [{ id: 1, from_daniel: true, body: 'It is the part of you that keeps you safe.', created_at: justNow() }] });
  await tick();
  const { items } = await takeAlerts(db, { addToInbox: (t) => inbox.push(t) });
  assert.deepEqual(items.map((a) => [a.title, a.body, a.path, a.action]), [['Daniel replied', 'It is the part of you that keeps you safe.', '/help#report-9', 'Read and answer']]);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0], /Daniel replied to what you told him: “It is the part of you that keeps you safe\.” .*on Help, in your sidebar/);
  setAlertSwitch(db, { id: 'answer', on: false });
  cloud.state.tells[0].messages.push({ id: 2, from_daniel: true, body: 'And one more thing.', created_at: justNow() });
  await tick();
  assert.deepEqual((await takeAlerts(db, { addToInbox: (t) => inbox.push(t) })).items, []);
  assert.equal(inbox.length, 2, 'the Inbox line comes even with the alert switched off');
});

test('in Daniel’s app: a student answered, and Claude answered, each opening the report', async () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const GUIDE = 'guide_madeupmadeupmadeupmadeup00';
  const cloud = fakeGroupCloud({ students: { [KEY]: { id: ME, name: 'Maya' } }, guides: { [GUIDE]: 'Daniel' } });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', keyOf: () => GUIDE, guideApp: true });
  try {
    const inbox = [];
    await takeAlerts(db, { addToInbox: (t) => inbox.push(t) });
    await tick();
    cloud.state.tells.push({ id: 9, student_id: ME, student: 'Maya', kind: 'broken', why: 'x', place: 'app', status: 'digging', created_at: at(-60),
      messages: [{ id: 1, from_daniel: true, body: 'Try again?', created_at: at(-30) }, { id: 2, from_daniel: false, body: 'It works now!', created_at: justNow() }],
      claude_answer: 'His key went in later.', answered_at: justNow() });
    await tick();
    const { items } = await takeAlerts(db, { addToInbox: (t) => inbox.push(t) });
    assert.deepEqual(items.map((a) => [a.title, a.path, a.action ?? null]).sort(), [
      ['Claude answered about Maya’s report', '/group/reports?status=all#report-9', null],
      ['Maya answered you', '/group/reports?status=all#report-9', 'Reply'],
    ]);
    assert.deepEqual(inbox, [], 'no Inbox line in Daniel’s app');
  } finally { useGroup({ keyOf: libraryKey, guideApp: false }); }
});

test('nothing while Group Circle is off, or the cloud can’t be reached', async () => {
  const { db } = setup();
  setModule(db, 'group', false);
  assert.deepEqual(await takeAlerts(db), { items: [] });
  setModule(db, 'group', true);
  useGroup({ fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual(await takeAlerts(db), { items: [] });
});

test('homework due after tomorrow waits; long words are cut', () => {
  const days = { today: '2026-11-22', tomorrow: '2026-11-23' };
  assert.equal(alertWords({ kind: 'due', post: 1, tab: 'news', due_on: '2026-11-24', text: 'x' }, days), null);
  assert.equal(alertWords({ kind: 'due', post: 1, tab: 'news', due_on: '2026-11-22', text: 'x' }, days).title, 'Homework due today');
  const long = alertWords({ kind: 'news', post: 1, tab: 'news', post_kind: 'homework', author: 'Daniel', text: 'word '.repeat(60) }, days);
  assert.equal(long.title, 'New homework from Daniel');
  assert.ok(long.body.length <= 140 && long.body.endsWith('…'));
});

test('in Daniel’s app: a new report, a flag and a comment on his post', async () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const GUIDE = 'guide_madeupmadeupmadeupmadeup00';
  const cloud = fakeGroupCloud({
    students: { [KEY]: { id: ME, name: 'Maya' } },
    guides: { [GUIDE]: 'Daniel' },
    posts: [{ id: 1, tab: 'news', kind: 'announcement', body: 'Welcome', created_at: at(-600) }, { id: 2, tab: 'feed', kind: 'post', student: ME, body: 'My drawing', created_at: at(-300) }],
  });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', keyOf: () => GUIDE, guideApp: true });
  try {
    assert.deepEqual(alertSwitches(db).map((k) => k.id), ['report', 'claude', 'flag', 'reply']);
    await takeAlerts(db);
    await tick();
    cloud.state.tells.push({ id: 9, student_id: ME, student: 'Maya', kind: 'broken', why: 'The Help page is blank', place: 'app', status: 'new', created_at: justNow() });
    cloud.state.posts.find((p) => p.id === 2).flags.push({ by: 'client-bbbbbbbbbbbb', comment: null, at: justNow() });
    cloud.state.posts.find((p) => p.id === 1).comments.push({ id: 60, student: ME, body: 'Thank you!', created_at: justNow() });
    await tick();
    const { items } = await takeAlerts(db);
    assert.deepEqual(items.map((a) => [a.title, a.path]).sort(), [
      ['Maya commented on your post', '/group/announcements#post-1'],
      ['Maya sent you a report', '/group/reports?status=all#report-9'],
      ['Something Maya wrote was flagged', '/group/circle#post-2'],
    ]);
  } finally { useGroup({ keyOf: libraryKey, guideApp: false }); }
});
