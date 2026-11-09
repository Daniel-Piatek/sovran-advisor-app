// The order of a day (public/day-order.js): events are anchors, tasks sit in the gaps between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOrder } from '../../public/day-order.js';

const at = (h, m = 0) => h * 60 + m;

test('three tasks after lunch in a gap that is thirty minutes too short: the gap says over by 30', () => {
  const day = dayOrder({
    from: at(9), to: at(15, 30),
    anchors: [{ id: 'call', start: at(10), end: at(10, 30) }, { id: 'lunch', start: at(12), end: at(13) }],
    tasks: [{ id: 'a', start: at(13), minutes: 60 }, { id: 'b', start: at(14), minutes: 60 }, { id: 'c', start: at(15), minutes: 60 }],
  });
  const afternoon = day.gaps.find((g) => g.after?.id === 'lunch');
  assert.equal(afternoon.length, 150);
  assert.equal(afternoon.used, 180);
  assert.equal(afternoon.over, 30);
  assert.equal(afternoon.free, 0);
  assert.deepEqual(afternoon.items.map((i) => i.id), ['a', 'b', 'c']);
  // They share the gap: smaller, together exactly the gap, never past the end of it.
  assert.equal(afternoon.items.reduce((n, i) => n + i.shown, 0), 150);
  assert.ok(afternoon.items.every((i) => i.shown < 60));
  assert.equal(afternoon.items[0].at, at(13));
  assert.ok(afternoon.items[2].at + afternoon.items[2].shown <= at(15, 30));
  assert.equal(day.over, 30);
});

test('a gap with room keeps each task as tall as its estimate, one after the other, and says what is free', () => {
  const day = dayOrder({ from: at(9), to: at(12), anchors: [], tasks: [{ id: 'a', start: at(9), minutes: 45 }, { id: 'b', start: at(9, 30), minutes: 30 }] });
  assert.equal(day.gaps.length, 1);
  const [a, b] = day.gaps[0].items;
  assert.deepEqual([a.at, a.shown, b.at, b.shown], [at(9), 45, at(9, 45), 30]);
  assert.equal(day.gaps[0].free, 105);
  assert.equal(day.over, 0);
});

test('the same words in the same order: the order inside a gap follows where the tasks sit, then how they were given', () => {
  const day = dayOrder({ from: 0, to: 600, anchors: [], tasks: [{ id: 'late', start: 300, minutes: 10 }, { id: 'x', start: 100, minutes: 10 }, { id: 'y', start: 100, minutes: 10 }] });
  assert.deepEqual(day.gaps[0].items.map((i) => i.id), ['x', 'y', 'late']);
});

test('overlapping and touching events are one stretch of fixed time; a task that starts inside one goes to the gap after it', () => {
  const day = dayOrder({
    from: at(8), to: at(18),
    anchors: [{ id: 'a', start: at(9), end: at(10) }, { id: 'b', start: at(9, 30), end: at(11) }, { id: 'c', start: at(11), end: at(12) }],
    tasks: [{ id: 't', start: at(9, 15), minutes: 30 }],
  });
  assert.deepEqual(day.gaps.map((g) => [g.from, g.to]), [[at(8), at(9)], [at(12), at(18)]]);
  assert.deepEqual(day.gaps[1].items.map((i) => i.id), ['t']);
  assert.deepEqual(day.sequence.map((s) => s.type), ['gap', 'anchor', 'anchor', 'anchor', 'gap']);
});

test('a day with nothing in it is one empty gap; anchors outside the day are left out', () => {
  const day = dayOrder({ from: at(9), to: at(17), anchors: [{ id: 'early', start: at(5), end: at(6) }], tasks: [] });
  assert.equal(day.gaps.length, 1);
  assert.equal(day.gaps[0].free, 480);
  assert.equal(day.sequence.length, 1);
});

test('no gap at all: a task has nowhere to sit and nothing breaks', () => {
  const day = dayOrder({ from: at(9), to: at(10), anchors: [{ id: 'all', start: at(9), end: at(10) }], tasks: [{ id: 't', start: at(9), minutes: 30 }] });
  assert.equal(day.gaps.length, 0);
  assert.equal(day.over, 0);
});
