// The Sovran Quest page in Sovran Central (quest.js, 2026-11-23): the weeks come from the group's Quest shelf in the
// Sovran cloud (a stand-in here), kept for when this computer is offline, and never with a transcript: a transcript is
// asked for only when it is read or searched. The cloud's own rules are in cloud/quest.test.sql.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { setLibraryKey } from '../../sovran-library.js';
import { useGroup, questWeeks, questTranscript } from '../../group-feed.js';
import { useQuest, cloudWeeks, questPage, readTranscript, questText } from '../../quest.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const T1 = '### **00:00:05**\n**Daniel Piatek:** Welcome back to the Quest.\n### **00:02:10**\n**Ana Silva:** My Tyrant came out at work.';
const SHELF = [
  { group: 'SQ01', number: 1, title: 'Meeting the Tyrant', call_on: '2026-11-16', practice_url: 'https://practice.example.com/sq01', replay_url: '',
    homework: [{ text: 'Write about one moment.', where: 'journal' }], has_transcript: true, updated_at: '2026-11-23T10:00:00Z' },
  { group: 'SQ01', number: 0, title: '', call_on: '2026-11-09', homework: [], has_transcript: false, updated_at: '2026-11-23T10:00:00Z' },
];

function setup({ known = true, down = false } = {}) {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  setLibraryKey(db, KEY);
  const asked = [];
  const cloud = { known, down };
  useGroup({ url: 'https://cloud.test/group-feed', fetch: async (url, init) => {
    if (cloud.down) throw new Error('offline');
    const body = JSON.parse(init.body);
    asked.push(body);
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (!cloud.known) return reply(400, { error: 'Unknown action' });
    if (body.action === 'quest_weeks') return reply(200, { weeks: SHELF });
    if (body.action === 'quest_transcript') return body.number === 1 ? reply(200, { transcript: T1 }) : reply(404, { error: 'gone', code: 'gone' });
    return reply(400, { error: 'Unknown action' });
  } });
  useQuest({ weeks: (d) => cloudWeeks(d, (x) => questWeeks(x), { everyMs: 60_000 }), transcript: (d, w) => questTranscript(d, w.number), guide: false });
  return { db, asked, cloud };
}
const kept = (db) => db.prepare("SELECT value FROM settings WHERE key = 'quest.weeks'").get()?.value ?? '';

test('before the shelf is in the cloud: no weeks yet, and nothing breaks', async () => {
  const { db } = setup({ known: false });
  assert.deepEqual(await questWeeks(db), { shelf: false, weeks: [] });
  assert.deepEqual((await questPage(db)).weeks, []);
  assert.equal(await questText(db), 'No Quest weeks are here yet.');
});

test('the weeks come from the shelf, are asked for once a minute, and are kept for offline', async () => {
  const { db, asked, cloud } = setup();
  const page = await questPage(db);
  assert.deepEqual(page.weeks.map((w) => [w.number, w.has_transcript]), [[1, true], [0, false]]);
  await questPage(db);
  assert.equal(asked.filter((a) => a.action === 'quest_weeks').length, 1);
  cloud.down = true;
  db.prepare("UPDATE settings SET updated_at = '2000-01-01T00:00:00Z' WHERE key = 'quest.weeks'").run();
  assert.equal((await questPage(db)).weeks.length, 2);
});

test('a transcript is never kept here, even if the cloud sends one; it is asked for when read or searched', async () => {
  const { db } = setup();
  const sent = await cloudWeeks(db, async () => ({ weeks: [{ ...SHELF[0], transcript: T1 }] }));
  assert.equal(sent[0].transcript, undefined);
  assert.equal(sent[0].has_transcript, true);
  assert.ok(!kept(db).includes('Tyrant came out'));

  const { db: db2, asked: asked2 } = setup();
  const read = await readTranscript(db2, 1, { words: 'tyrant' });
  assert.equal(read.lines.length, 2);
  assert.deepEqual(read.found, [1]);
  assert.deepEqual(asked2.filter((a) => a.action === 'quest_transcript').map((a) => a.number), [1]);
  assert.ok(!kept(db2).includes('Tyrant came out'));

  // Sovran Advisor: a search asks only for weeks that have a transcript; a week reads in full.
  const hits = await questText(db2, { words: 'tyrant' });
  assert.match(hits, /Week 1 00:02:10 Ana Silva: My Tyrant came out at work\./);
  assert.ok(!asked2.some((a) => a.action === 'quest_transcript' && a.number === 0));
  assert.match(await questText(db2, { week: 1 }), /Daniel Piatek: Welcome back/);
  assert.match(await questText(db2, { week: 0 }), /\(none yet\)/);
});

test('offline, a transcript reads as empty rather than failing', async () => {
  const { db, cloud } = setup();
  await questPage(db);
  cloud.down = true;
  assert.deepEqual((await readTranscript(db, 1)).lines, []);
});

test('a student’s own practice link, when Daniel added one, opens instead of the week’s (2026-11-24)', async () => {
  const { db } = setup();
  const weeks = await cloudWeeks(db, async () => ({ weeks: SHELF, practice_url: 'https://live.xperiencify.io/m/abc123' }));
  assert.deepEqual(weeks.map((w) => w.practice_url), ['https://live.xperiencify.io/m/abc123', 'https://live.xperiencify.io/m/abc123']);
  assert.equal((await questPage(db)).weeks[0].practice_url, 'https://live.xperiencify.io/m/abc123'); // kept for offline too
  // With none (or anything that isn't an https address), the week's own link stays.
  const { db: db2 } = setup();
  assert.equal((await cloudWeeks(db2, async () => ({ weeks: SHELF, practice_url: 'javascript:alert(1)' })))[0].practice_url, 'https://practice.example.com/sq01');
  assert.equal((await cloudWeeks(db2, async () => ({ weeks: SHELF })))[0].practice_url, 'https://practice.example.com/sq01');
});
