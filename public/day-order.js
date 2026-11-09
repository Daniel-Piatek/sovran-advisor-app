// The order of a day (advanced/calendar/2): one pure function, no page and no clock in it.
// The events (and time blocks) of a day are its anchors: they have a time and the day works
// around them. Between two anchors lies a gap, and the tasks placed in it keep their order
// there. A task has a place, not a time: how tall it is drawn is its estimate, one after the
// other from the start of its gap, and when a gap holds more than it has room for the tasks in
// it share the gap (each smaller, never over the next anchor) and the gap says by how much it
// is over. The hours and the order are two pictures of this one result, so they cannot disagree.
//
//   dayOrder({ from, to, anchors: [{ id, start, end }], tasks: [{ id, start, minutes }] })
//   → { sequence: [{ type: 'anchor', anchor } | { type: 'gap', gap }], gaps, over }
// Minutes of the day. `start` of a task is only where it sits now: it decides the gap and the
// order within it. A gap: { from, to, length, after, before, items: [{ id, minutes, shown, at }], used, free, over }.

export function dayOrder({ from, to, anchors = [], tasks = [] }) {
  // Anchors that touch or overlap are one stretch of fixed time; a gap lies between stretches.
  const stretches = [];
  for (const anchor of [...anchors].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const start = Math.max(from, anchor.start);
    const end = Math.min(to, anchor.end);
    if (end <= start) continue;
    const last = stretches[stretches.length - 1];
    if (last && start <= last.end) { last.end = Math.max(last.end, end); last.anchors.push(anchor); } else stretches.push({ start, end, anchors: [anchor] });
  }
  const gaps = [];
  let cursor = from;
  let after = null;
  for (const stretch of stretches) {
    if (stretch.start > cursor) gaps.push({ from: cursor, to: stretch.start, after, before: stretch.anchors[0] });
    cursor = stretch.end;
    after = stretch.anchors[stretch.anchors.length - 1];
  }
  if (to > cursor) gaps.push({ from: cursor, to, after, before: null });
  for (const gap of gaps) { gap.length = gap.to - gap.from; gap.items = []; }

  // A task goes to the gap its start lies in; one that starts inside an anchor goes to the next gap
  // (or the last one); one before everything to the first. With no room anywhere it has no gap.
  const ordered = tasks.map((task, i) => ({ ...task, i })).sort((a, b) => a.start - b.start || a.i - b.i);
  for (const task of ordered) {
    if (!gaps.length) break;
    const gap = gaps.find((g) => task.start >= g.from && task.start < g.to) ?? gaps.find((g) => g.from >= task.start) ?? gaps[gaps.length - 1];
    gap.items.push({ id: task.id, minutes: task.minutes, shown: task.minutes });
  }
  let over = 0;
  for (const gap of gaps) {
    gap.used = gap.items.reduce((n, item) => n + item.minutes, 0);
    gap.free = Math.max(0, gap.length - gap.used);
    gap.over = Math.max(0, gap.used - gap.length);
    over += gap.over;
    // Over: they share the gap, each as tall as its share of it, whole minutes, the last one takes the rest.
    if (gap.over > 0) {
      let left = gap.length;
      gap.items.forEach((item, i) => {
        item.shown = i === gap.items.length - 1 ? left : Math.min(left, Math.round((item.minutes * gap.length) / gap.used));
        left -= item.shown;
      });
    }
    let at = gap.from;
    for (const item of gap.items) { item.at = at; at += item.shown; }
  }

  // The day as a sequence: gaps and the stretches between them, in time order.
  const sequence = [];
  let nextGap = 0;
  let spot = from;
  for (const stretch of stretches) {
    while (nextGap < gaps.length && gaps[nextGap].to <= stretch.start) sequence.push({ type: 'gap', gap: gaps[nextGap++] });
    for (const anchor of stretch.anchors) sequence.push({ type: 'anchor', anchor });
    spot = stretch.end;
  }
  while (nextGap < gaps.length) sequence.push({ type: 'gap', gap: gaps[nextGap++] });
  return { sequence, gaps, over, from: Math.min(from, spot), to };
}
