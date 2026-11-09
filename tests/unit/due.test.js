// Due dates typed after @ in a task (public/due.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDue, dueChoices, dueLabel, parseQuickAdd, isSpeedy, taskKind, SPEEDY_MAX } from '../../public/due.js';

const today = '2026-10-25'; // a Sunday

test('words become a day', () => {
  assert.equal(parseDue('today', today), '2026-10-25');
  assert.equal(parseDue('Tomorrow', today), '2026-10-26');
  assert.equal(parseDue('friday', today), '2026-10-30');
  assert.equal(parseDue('fri', today), '2026-10-30');
  assert.equal(parseDue('sunday', today), '2026-10-25', 'today counts');
  assert.equal(parseDue('12 oct', today), '2027-10-12', 'a day that has passed is next year’s');
  assert.equal(parseDue('nov 3', today), '2026-11-03');
  assert.equal(parseDue('3 november 2027', today), '2027-11-03');
  assert.equal(parseDue('2026-12-01', today), '2026-12-01');
  for (const no of ['fr', 'may', 'tom', '31 feb', '2026-02-31', 'lena', '']) assert.equal(parseDue(no, today), null, no);
});

test('while typing, the dates the words could become', () => {
  assert.deepEqual(dueChoices('', today).map((c) => c.label), ['Today', 'Tomorrow', 'Monday']);
  assert.deepEqual(dueChoices('fr', today), [{ day: '2026-10-30', label: 'Friday' }]);
  assert.deepEqual(dueChoices('t', today).map((c) => c.label), ['Today', 'Tomorrow', 'Tuesday']);
  assert.deepEqual(dueChoices('lena', today), []);
});

test('a chip says Today, Tomorrow, Yesterday or the date', () => {
  assert.equal(dueLabel('2026-10-25', today), 'Today');
  assert.equal(dueLabel('2026-10-26', today), 'Tomorrow');
  assert.equal(dueLabel('2026-10-24', today), 'Yesterday');
  assert.match(dueLabel('2026-10-30', today), /Fri.*30/);
  assert.match(dueLabel('2027-01-04', today), /2027/);
});

test('fifteen minutes or less is a Speedy, a longer one a Task, and no estimate is neither', () => {
  assert.equal(SPEEDY_MAX, 15);
  assert.deepEqual([1, 5, 15].map(taskKind), ['speedy', 'speedy', 'speedy']);
  assert.deepEqual([16, 45, 180, 400].map(taskKind), ['task', 'task', 'task', 'task']);
  assert.deepEqual([null, undefined, 0, -5, 7.5].map(taskKind), [null, null, null, null, null]);
  assert.deepEqual([14, 15, 16].map(isSpeedy), [true, true, false]);
});

test('one line: a day and an estimate, only a day, neither; every other word stays in the title', () => {
  assert.deepEqual(parseQuickAdd('call the printer tomorrow ~10m', today), { title: 'call the printer', due: '2026-10-26', time: '', estimate: 10, repeat: '', flag: '', goal: false });
  assert.deepEqual(parseQuickAdd('Book the venue call fri', today), { title: 'Book the venue call', due: '2026-10-30', time: '', estimate: null, repeat: '', flag: '', goal: false });
  assert.deepEqual(parseQuickAdd('sort the attic', today), { title: 'sort the attic', due: '', time: '', estimate: null, repeat: '', flag: '', goal: false });
  assert.equal(parseQuickAdd('read about rates someday ~1h', today).due, 'someday');
  assert.equal(parseQuickAdd('reply to Jonas ~15m', today).estimate, 15);
});
