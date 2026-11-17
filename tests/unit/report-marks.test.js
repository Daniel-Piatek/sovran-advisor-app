// Highlights and comments on reports (report-marks.js): kept only in this app, the report untouched; checked input; removing
// only sets deleted_at and can be undone; the assistant reads them first with the report; schema 74 adds the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { listMarks, addMark, changeMark, removeMark, restoreMark, marksText, listMarksWithAsks, setMarkConversation, askNote } from '../../report-marks.js';
import { createConversation, addAnswered } from '../../assistant.js';
import { reportsText, useReports } from '../../reports.js';
import { setModule } from '../../modules.js';

const emptyDb = () => { const db = prepareDatabase(new DatabaseSync(':memory:')); setModule(db, 'reports', true); return db; };
const SECTIONS = [
  { section_key: 'before-you-begin', title: 'Before You Begin', level: 1, position: 1, body: 'A mirror, not a definition.' },
  { section_key: 'your-gifts', title: 'Your Gifts', level: 1, position: 2, body: 'You notice things others pass by.' },
  { section_key: 'a-part-inside', title: 'A Part Inside', level: 2, position: 3, parent: 'your-gifts', body: 'Quietly so.' },
];

test('a highlight, a comment, a change, a removal and its undo', () => {
  const db = emptyDb();
  const plain = addMark(db, 'pattern', { section_key: 'your-gifts', quote: 'notice things', prefix: 'You ', suffix: ' others', version: 1 });
  assert.equal(plain.comment, '');
  const noted = addMark(db, 'pattern', { section_key: 'before-you-begin', quote: 'A mirror', comment: '  This is true for me.  ' });
  assert.equal(noted.comment, 'This is true for me.');
  assert.deepEqual(listMarks(db, 'pattern').map((m) => m.quote), ['notice things', 'A mirror']);
  assert.deepEqual(listMarks(db, 'other'), [], 'each report has its own');

  assert.equal(changeMark(db, plain.id, { comment: 'Ask about this.' }).comment, 'Ask about this.');
  assert.equal(removeMark(db, noted.id).deleted, true);
  assert.equal(listMarks(db, 'pattern').length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM report_marks').get().n, 2, 'removing only sets deleted_at');
  assert.equal(restoreMark(db, noted.id).quote, 'A mirror');
  assert.throws(() => restoreMark(db, noted.id), /no such removed highlight/);

  assert.throws(() => addMark(db, '../x', { section_key: 'a', quote: 'b' }), /no such report/);
  assert.throws(() => addMark(db, 'pattern', { section_key: 'Bad Key', quote: 'b' }), /section’s key/);
  assert.throws(() => addMark(db, 'pattern', { section_key: 'a', quote: '   ' }), /words you chose/);
  assert.throws(() => addMark(db, 'pattern', { section_key: 'a', quote: 'x'.repeat(2001) }), /at most 2000/);
  assert.throws(() => addMark(db, 'pattern', { section_key: 'a', quote: 'b', prefix: 'x'.repeat(65) }), /prefix is at most/);
  assert.throws(() => changeMark(db, plain.id, { comment: 'x'.repeat(4001) }), /at most 4000/);
  assert.throws(() => changeMark(db, 'nothing', { comment: 'x' }), /no such highlight/);
});

test('the assistant reads the owner’s highlights and comments first, in reading order, also for one section', async () => {
  const db = emptyDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marks-'));
  fs.mkdirSync(path.join(dir, 'pattern'));
  fs.writeFileSync(path.join(dir, 'pattern', 'report.json'), JSON.stringify({ report: 'pattern', title: 'Your Pattern', version: 1, status: 'final', approved_on: '2026-11-16', sections: SECTIONS, files: [] }));
  useReports({ dir, fetch: async () => { throw new Error('no library without a key'); } });

  addMark(db, 'pattern', { section_key: 'a-part-inside', quote: 'Quietly', comment: 'Is this\n\nwhy I hold back?' });
  addMark(db, 'pattern', { section_key: 'before-you-begin', quote: 'A mirror' });
  assert.equal(marksText(db, 'other', SECTIONS), '');
  const text = marksText(db, 'pattern', SECTIONS);
  assert.match(text, /highlights and comments on this report \(2\)/);
  assert.ok(text.indexOf('Before You Begin') < text.indexOf('A Part Inside'), 'in the order of the report');
  assert.match(text, /In “A Part Inside” they highlighted: “Quietly”\n {2}Their comment: Is this why I hold back\?/);

  const whole = await reportsText(db, { report: 'pattern' });
  assert.ok(whole.indexOf('they highlighted') < whole.indexOf('# The report'), 'the marks come before the report, so never cut off');
  assert.match(whole, /## Your Gifts\n\nYou notice things others pass by\./, 'and the report itself, untouched');
  const one = await reportsText(db, { report: 'pattern', section: 'before-you-begin' });
  assert.match(one, /“A mirror”/);
  assert.doesNotMatch(one, /Quietly”/, 'one section: only its own marks');
  assert.match(await reportsText(db), /The owner's highlights: 2 \(1 with a comment\)/);
  useReports({ dir: '' });
});

test('Ask about this: a highlight’s own chat, beside the words and read with the report; the note it carries', () => {
  const db = emptyDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asks-'));
  const mark = addMark(db, 'pattern', { section_key: 'your-gifts', quote: 'notice things' });
  assert.deepEqual(listMarksWithAsks(db, 'pattern')[0].asks, [], 'no chat yet');
  const chat = createConversation(db, dir);
  assert.equal(setMarkConversation(db, mark.id, chat.id).conversation_id, chat.id);
  addAnswered(db, chat.id, 'What does this mean for my work?', 'In your design, noticing comes first.');
  assert.deepEqual(listMarksWithAsks(db, 'pattern')[0].asks.map((a) => [a.role, a.text]),
    [['user', 'What does this mean for my work?'], ['assistant', 'In your design, noticing comes first.']]);
  const text = marksText(db, 'pattern', SECTIONS);
  assert.match(text, /they highlighted: “notice things”\n {2}They asked their assistant: What does this mean for my work\?\n {2}The answer: In your design, noticing comes first\./);

  const first = askNote({ quote: 'notice  things', sectionTitle: 'Your Gifts', report: 'pattern', reportTitle: 'Sovran Pattern Report', first: true });
  assert.match(first, /selected these words in “Your Gifts” in their Sovran Pattern Report and asks about them: “notice things”/);
  assert.match(first, /reports_read \(report: pattern\)/);
  assert.match(first, /search_my_decodes/);
  assert.match(first, /unless they ask where it comes from/, 'D’s rule: no source named unless asked');
  assert.match(askNote({ quote: 'x', sectionTitle: 'S', report: 'pattern', reportTitle: 'R', first: false }), /still asking about the words/);
});

test('schema 75 gives an older report_marks its conversation_id, keeping its rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marks-75-'));
  let db = openDatabase(dir);
  setModule(db, 'reports', true);
  addMark(db, 'pattern', { section_key: 'your-gifts', quote: 'kept' });
  db.exec('ALTER TABLE report_marks DROP COLUMN conversation_id; PRAGMA user_version = 74;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(listMarks(db, 'pattern').map((m) => [m.quote, m.conversation_id]), [['kept', '']]);
  db.close();
});

test('schema 74 adds the table to an older database and keeps everything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marks-74-'));
  let db = openDatabase(dir);
  db.exec('DROP INDEX report_marks_by_report; DROP TABLE report_marks; PRAGMA user_version = 73;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(addMark(db, 'pattern', { section_key: 'your-gifts', quote: 'notice' }).quote, 'notice');
  db.close();
});
