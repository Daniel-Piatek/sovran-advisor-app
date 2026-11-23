// Sovran Quest on go Sovran (phone/quest.js, 2026-11-23): the phone reads the weeks itself, and the student's own Done
// and journal entries go both ways through the drop box: the computer leaves them on the phone's shelf (quest.js
// questShelf), and a Done or an entry made on the phone comes back as a sealed note (phone-drop.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../db.js';
import { readLinkPart } from '../../phone/seal.js';
import { linkPhone, collect } from '../../phone-drop.js';
import { entriesOfDay, getEntry, localDay } from '../../entries.js';
import { waitingCaptures } from '../../captures.js';
import { questShelf, takePhoneDone, takePhoneEntry, transcriptLines as computerLines } from '../../quest.js';
import { standing, transcriptLines as phoneLines, weekKey, labelOf } from '../../phone/quest.js';
import { fakeBox } from '../fake-drop-box.js';

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-phone-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const HOMEWORK = 'Write in your Journal about one moment\nthe Tyrant showed up this week.';

test('Done from the phone is the same private tick as on the Quest page, and can be taken back', (t) => {
  const db = openDatabase(temp(t));
  assert.equal(takePhoneDone(db, { group: 'SQ01', number: 2, piece: 1, on: true }), true);
  assert.equal(takePhoneDone(db, { group: 'SQ01', number: 2, piece: 1, on: true }), true, 'twice is still one tick');
  assert.deepEqual(questShelf(db).marks, [{ week: 'SQ01-2', piece: 1, done: true, entries: 0, last: '' }]);
  takePhoneDone(db, { group: 'SQ01', number: 2, piece: 1, on: false });
  assert.deepEqual(questShelf(db).marks, []);
  for (const bad of [{ group: 'SQ 01', number: 2, piece: 1 }, { group: 'SQ01', number: -1, piece: 1 }, { group: 'SQ01', number: 2, piece: 0 }, { group: 'SQ01', number: '2', piece: 1 }]) {
    assert.equal(takePhoneDone(db, { ...bad, on: true }), false, JSON.stringify(bad));
  }
  assert.equal(db.prepare('SELECT count(*) n FROM quest_marks').get().n, 1, 'nothing else was written');
  db.close();
});

test('an entry written on the phone for a piece is named for it, starts with the homework, and shows under it', (t) => {
  const db = openDatabase(temp(t));
  const entry = takePhoneEntry(db, { group: 'SQ01', number: 2, piece: 1, text: HOMEWORK }, { day: '2026-11-24', body: 'At work on Tuesday…' });
  const kept = getEntry(db, entry.id);
  assert.equal(kept.title, 'Sovran Quest · Week 2 · Homework 1');
  assert.equal(kept.body, '> Write in your Journal about one moment\n> the Tyrant showed up this week.\n\nAt work on Tuesday…');
  assert.equal(kept.day, '2026-11-24');
  assert.deepEqual(questShelf(db).marks, [{ week: 'SQ01-2', piece: 1, done: false, entries: 1, last: '2026-11-24' }]);
  assert.equal(takePhoneEntry(db, { group: 'SQ01', number: 2 }, { body: 'no piece' }), null);
  db.close();
});

test('through the drop box: a Done and a Quest entry from the phone land on the computer, a plain entry as before', async (t) => {
  const db = openDatabase(temp(t));
  const box = fakeBox();
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  const at = new Date(Date.now() - 60_000);
  await box.phoneDrops(link, { kind: 'quest_done', group: 'SQ01', number: 2, piece: 3, on: true, at: at.toISOString() });
  await box.phoneDrops(link, { kind: 'journal', body: 'The old voice again.', at: at.toISOString(), day: localDay(at), quest: { group: 'SQ01', number: 2, piece: 1, text: HOMEWORK } });
  await box.phoneDrops(link, { kind: 'journal', body: 'Just a day', at: at.toISOString(), day: localDay(at) });
  assert.equal(await collect(db, { fetcher: box.fetcher }), 2, 'the two entries count; the Done is not an Inbox thing');
  assert.deepEqual(entriesOfDay(db, localDay(at)).map((e) => e.title).sort(), ['', 'Sovran Quest · Week 2 · Homework 1']);
  assert.deepEqual(waitingCaptures(db), []);
  assert.deepEqual(questShelf(db).marks.map((m) => [m.week, m.piece, m.done, m.entries]), [['SQ01-2', 1, false, 1], ['SQ01-2', 3, true, 0]]);
  assert.equal(box.boxes.get(link.box).notes.length, 0);
  db.close();
});

test('on the phone: a Done or an entry sent from there shows at once, and gives way once the computer has it', () => {
  const week = weekKey('SQ01', 2);
  const shelf = { at: '2026-11-24T10:00:00.000Z', marks: [{ week, piece: 1, done: false, entries: 1, last: '2026-11-23' }] };
  assert.deepEqual(standing(shelf, [], week, 1), { done: false, entries: 1, last: '2026-11-23', waiting: 0 });
  const pending = [{ week, piece: 1, done: true, at: '2026-11-24T11:00:00.000Z' }, { week, piece: 1, entry: true, at: '2026-11-24T11:05:00.000Z' }];
  assert.deepEqual(standing(shelf, pending, week, 1), { done: true, entries: 2, last: '2026-11-24T11:05:00.000Z', waiting: 1 });
  const later = { at: '2026-11-24T12:00:00.000Z', marks: [{ week, piece: 1, done: true, entries: 2, last: '2026-11-24' }] };
  assert.deepEqual(standing(later, pending, week, 1), { done: true, entries: 2, last: '2026-11-24', waiting: 0 }, 'not counted twice');
  assert.deepEqual(standing(null, [], week, 2), { done: false, entries: 0, last: '', waiting: 0 });
  assert.equal(labelOf(2, 1), 'Sovran Quest · Week 2 · Homework 1');
});

test('the phone reads a transcript exactly as the computer does', () => {
  const text = '### **00:41:05**\n**Daniel Piatek:** So this week I want you to notice the Tyrant.\nNot to fight it.\n### **00:41:22**\n**Ana Silva:** Mine came out at work.';
  assert.deepEqual(phoneLines(text), computerLines(text));
  assert.deepEqual(phoneLines(text)[0], { at: '00:41:05', who: 'Daniel Piatek', text: 'So this week I want you to notice the Tyrant. Not to fight it.' });
});
