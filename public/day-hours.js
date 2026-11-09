// The Planner's two other pictures of a day (advanced/calendar/2): the Order (events as anchors,
// the tasks in each gap between them, and how much each gap has over) and the Hours grid (one,
// three or seven days side by side, each task as tall as its share of its gap). Both are drawn
// from `dayOrder` (public/day-order.js), so a task right after lunch in the order is the first
// block after lunch in the hours. Nothing is stored for them: they read the Planner's own day.

import { el, icon } from './ui.js';
import { dayOrder } from './day-order.js';
import { eventLine, eventFill, gMark } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const timeLabel = (minutes) => new Date(`2000-01-01T${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const length = (minutes) => (minutes <= 0 ? '0 min' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);
const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// A day of the Planner (its plan and its layout on the hours) as what the pictures draw: the
// anchors, the order of its tasks, and the words of each task.
export function dayColumn(plan, layout, day) {
  const { settings } = plan;
  const anchors = [
    ...layout.spans.map((s) => ({ id: s.event.id, title: s.event.title, start: s.start, end: s.end, line: eventLine(s.event), fill: eventFill(s.event), kind: 'event', google: s.event.source === 'google', sync: s.event.google?.sync ?? '' })),
    ...plan.blocks.map((b) => ({ id: b.id, title: b.title || b.kind, start: minutesOf(b.starts_at), end: minutesOf(b.ends_at), kind: 'block' })),
  ];
  const placed = plan.tasks.filter((t) => !t.block_id && t.plan_part && layout.placed.has(t.id));
  // A pinned task (Calendar in depth) holds its time: it is an anchor, and the others flow around it.
  const pinned = placed.filter((t) => t.pin_at);
  for (const t of pinned) { const at = layout.placed.get(t.id); anchors.push({ id: t.id, title: t.short_text || t.text, start: at.start, end: at.end, kind: 'pin', done: t.done, minutes: t.pin_minutes }); }
  const tasks = placed.filter((t) => !t.pin_at).map((t) => ({ id: t.id, start: layout.placed.get(t.id).start, minutes: t.estimate ?? settings.no_estimate_minutes }));
  // The day runs from its start to its end (the Planner's settings), and further only for an event outside them: a task
  // never makes the day longer, it makes its gap over.
  const hourDown = (m) => Math.max(0, Math.floor(m / 60) * 60);
  const from = hourDown(Math.min(minutesOf(settings.day_start), ...anchors.map((a) => a.start)));
  const to = Math.min(24 * 60, Math.max(minutesOf(settings.day_end), ...anchors.map((a) => a.end)));
  return {
    day, from, to,
    order: dayOrder({ from, to, anchors, tasks }),
    words: new Map(placed.map((t) => [t.id, { text: t.short_text || t.text, done: t.done, routine: Boolean(t.template_id) }])),
  };
}

// A task's box, as everywhere: a checkbox that is ticked in place.
function checkbox(id, text, done, onToggle) {
  const button = el('button', { type: 'button', class: 'task-box', role: 'checkbox', 'aria-checked': String(done), 'aria-label': done ? `Done: ${text}. Untick` : `Tick “${text}” when done`, onclick: () => onToggle(id, !done) });
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  return button;
}

// ---- The Order: the day as one list, anchors and gaps ----

export function orderView(column, { onToggle = null, onPin = null } = {}) {
  const { order, words } = column;
  return el('div', { class: 'order-day', role: 'list', 'aria-label': 'The day in order' },
    ...order.sequence.map((part) => {
      if (part.type === 'anchor') {
        const a = part.anchor;
        if (a.kind === 'pin') {
          return el('div', { class: `order-anchor is-pin${a.done ? ' is-done' : ''}`, role: 'listitem', 'data-task': a.id },
            ...(onToggle ? [checkbox(a.id, a.title, a.done, onToggle)] : []),
            el('span', { class: 'order-time' }, `${timeLabel(a.start)}–${timeLabel(Math.min(a.end, 24 * 60 - 1))}`),
            icon('pin'),
            el('span', { class: 'order-title' }, a.title),
            ...(onPin && !a.done ? [el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Change the pin of ${a.title}`, onclick: () => onPin(a.id) }, 'Change pin')] : []),
            el('span', { class: 'plan-locked' }, 'pinned'));
        }
        return el('div', { class: `order-anchor${a.kind === 'block' ? ' is-block' : ''}`, role: 'listitem', style: `${a.line ?? ''} ${a.fill ?? ''}` },
          el('span', { class: 'order-time' }, `${timeLabel(a.start)}–${timeLabel(Math.min(a.end, 24 * 60 - 1))}`),
          el('span', { class: 'order-title' }, a.google ? gMark(a.sync) : null, a.title),
          el('span', { class: 'plan-locked' }, a.kind === 'block' ? 'time block' : 'locked'));
      }
      const gap = part.gap;
      return el('div', { class: 'order-gap', role: 'listitem', 'data-over': String(gap.over > 0) },
        ...gap.items.map((item) => taskBlock(item, words.get(item.id), { rowed: true, onToggle, onPin })),
        gap.over > 0
          ? el('p', { class: 'order-gap-state plan-warning' }, `Over by ${length(gap.over)}`, el('span', {}, ` · ${length(gap.length)} between ${gap.after ? 'the ' : ''}${timeLabel(gap.from)} and ${timeLabel(gap.to)}`))
          : el('p', { class: 'order-gap-state' }, gap.items.length ? `Free ${length(gap.free)}` : `Free ${length(gap.length)}`, el('span', {}, ` · ${timeLabel(gap.from)}–${timeLabel(gap.to)}`)));
    }));
}

// ---- The Task block: a task as tall as its estimate, dashed because a task can move ----

export function taskBlock(item, info = { text: 'A task', done: false }, { rowed = false, hourPx = 0, from = 0, onToggle = null, onPin = null } = {}) {
  const squeezed = item.shown < item.minutes;
  const node = el('div', {
    class: `task-block${info.done ? ' is-done' : ''}${rowed ? ' is-row' : ''}${squeezed ? ' is-squeezed' : ''}${info.routine ? ' is-routine' : ''}`,
    'data-task': item.id, title: squeezed ? `${info.text}: ${length(item.minutes)}, shown shorter because its gap is over` : `${info.text}: ${length(item.minutes)}`,
  },
    ...(onToggle ? [checkbox(item.id, info.text, info.done, onToggle)] : [icon('task')]),
    el('span', { class: 'task-block-text' }, info.text),
    el('span', { class: 'task-block-minutes' }, length(item.minutes)),
    ...(onPin && !info.done ? [el('button', { type: 'button', class: 'button button-quiet task-block-pin', 'aria-label': `Pin ${info.text} to a time`, onclick: () => onPin(item.id) }, 'Pin to a time')] : []));
  if (hourPx) node.style.cssText = `top: ${((item.at - from) / 60) * hourPx}px; height: ${Math.max(((item.shown) / 60) * hourPx - 2, 14)}px;`;
  return node;
}

// ---- The Hours grid: the hours down the left, a column a day ----

// Things at the same time share the width.
function lanesOf(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let group = [];
  let groupEnd = -1;
  const finish = () => { const count = Math.max(...group.map((i) => i.lane)) + 1; for (const i of group) i.lanes = count; };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) { finish(); group = []; groupEnd = -1; }
    const taken = group.filter((g) => g.end > item.start).map((g) => g.lane);
    item.lane = [0, 1, 2, 3, 4, 5].find((l) => !taken.includes(l)) ?? 0;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) finish();
  return sorted;
}

const gridHourPx = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-hour-height')) || 40;

export function hourGrid(columns, { hourPx = gridHourPx(), label = (c) => c.day, onDrop = null, onPin = null } = {}) {
  const from = Math.min(...columns.map((c) => c.from));
  const to = Math.max(...columns.map((c) => c.to));
  const height = ((to - from) / 60) * hourPx;
  const hours = Array.from({ length: Math.ceil((to - from) / 60) + 1 }, (_, i) => from + i * 60).filter((m) => m <= to);
  return el('div', { class: 'hour-grid', role: 'group', 'aria-label': 'The days in hours', style: `grid-template-columns: var(--grid-gutter) repeat(${columns.length}, minmax(0, 1fr));` },
    el('div', { class: 'hour-grid-corner' }),
    ...columns.map((c) => el('h3', { class: 'hour-grid-head', 'data-day': c.day }, label(c))),
    el('div', { class: 'hour-grid-hours', style: `height: ${height}px` },
      ...hours.map((m) => el('span', { class: 'hour-grid-hour', style: `top: ${((m - from) / 60) * hourPx}px` }, timeLabel(m)))),
    ...columns.map((c) => {
      const anchors = lanesOf(c.order.sequence.filter((s) => s.type === 'anchor').map((s) => ({ ...s.anchor, end: Math.max(s.anchor.end, s.anchor.start + 30) })));
      const lit = el('div', { class: 'grid-gap', hidden: true, 'aria-hidden': 'true' }, el('span', { class: 'grid-gap-label' }));
      const day = el('div', { class: 'hour-grid-day', 'data-day': c.day, style: `height: ${height}px` },
        lit,
        ...hours.map((m) => el('div', { class: 'hour-grid-line', style: `top: ${((m - from) / 60) * hourPx}px` })),
        ...anchors.map((a) => el('div', {
          class: `grid-event${a.kind === 'block' ? ' is-block' : ''}${a.kind === 'pin' ? ' is-pin' : ''}${a.done ? ' is-done' : ''}`, 'data-anchor': a.id, title: `${a.title}, ${timeLabel(a.start)}–${timeLabel(a.end)}${a.kind === 'pin' ? ' (pinned)' : ''}`,
          ...(a.kind === 'pin' && onPin ? { role: 'button', tabindex: '0', onclick: () => onPin(a.id), onkeydown: (e) => { if (e.key === 'Enter') onPin(a.id); } } : {}),
          style: `${a.line ?? ''} ${a.fill ?? ''} top: ${((a.start - from) / 60) * hourPx}px; height: ${Math.max(((a.end - a.start) / 60) * hourPx - 2, 14)}px; left: calc(100% * ${a.lane} / ${a.lanes}); width: calc(100% / ${a.lanes} - var(--space-1));`,
        }, ...(a.kind === 'pin' ? [icon('pin')] : []), el('span', { class: 'grid-event-title' }, a.google ? gMark(a.sync) : null, a.title))),
        ...c.order.gaps.flatMap((gap) => gap.items.map((item) => {
          const block = taskBlock(item, c.words.get(item.id), { hourPx, from });
          if (onDrop) {
            block.draggable = true;
            block.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-task', item.id); e.dataTransfer.effectAllowed = 'move'; block.classList.add('is-dragging'); });
            block.addEventListener('dragend', () => block.classList.remove('is-dragging'));
          }
          return block;
        })));
      if (onDrop) {
        // Over the hours the gap under the pointer lights up and says which event it would follow; the drop writes the
        // task's place there (its day, and a time inside the gap that is where the pointer was), never its estimate.
        const gapAt = (e) => {
          const box = day.getBoundingClientRect();
          const minutes = Math.min(c.to - 15, Math.max(c.from, from + Math.round((((e.clientY - box.top) / hourPx) * 60) / 15) * 15));
          const gap = c.order.gaps.find((g) => minutes >= g.from && minutes < g.to) ?? c.order.gaps.find((g) => g.from >= minutes) ?? c.order.gaps[c.order.gaps.length - 1];
          return gap ? { gap, minutes: Math.min(gap.to - 5, Math.max(gap.from, minutes)) } : null;
        };
        const unlight = () => { lit.hidden = true; };
        day.addEventListener('dragover', (e) => {
          if (![...e.dataTransfer.types].includes('text/x-task')) return;
          const spot = gapAt(e);
          if (!spot) return;
          e.preventDefault();
          lit.hidden = false;
          lit.style.cssText = `top: ${((spot.gap.from - from) / 60) * hourPx}px; height: ${((spot.gap.to - spot.gap.from) / 60) * hourPx}px;`;
          lit.firstChild.textContent = spot.gap.after ? `After ${spot.gap.after.title}` : 'First thing in the day';
        });
        day.addEventListener('dragleave', (e) => { if (!day.contains(e.relatedTarget)) unlight(); });
        day.addEventListener('drop', (e) => {
          const id = e.dataTransfer.getData('text/x-task');
          unlight();
          const spot = id ? gapAt(e) : null;
          if (!spot) return;
          e.preventDefault();
          onDrop(id, c.day, spot.minutes, spot.gap);
        });
      }
      return day;
    }));
}

// ---- The Lens switch: the order or the hours, and in the hours how many days (V switches the lens) ----
// Both rows are Switches; the page marks the pressed ones with `show`.

export function lensControls({ onLens = () => {}, onRange = () => {} } = {}) {
  const lensSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'Lens' },
    ...[['order', 'Order'], ['hours', 'Hours']].map(([name, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'data-lens': name, title: 'V switches between them', 'aria-keyshortcuts': 'V', onclick: () => onLens(name),
    }, label)));
  const rangeSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'Days in hours' },
    ...[['day', 'Day'], ['3', '3 days'], ['7', 'Week']].map(([name, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'data-range': name, onclick: () => onRange(name),
    }, label)));
  const bar = el('div', { class: 'lens-bar' }, lensSwitch, rangeSwitch);
  const show = ({ lens, range }) => {
    for (const button of lensSwitch.children) button.setAttribute('aria-pressed', String(button.dataset.lens === lens));
    for (const button of rangeSwitch.children) button.setAttribute('aria-pressed', String(button.dataset.range === range));
    rangeSwitch.hidden = lens !== 'hours';
  };
  return { bar, show };
}

// ---- A routine's Template chip: a title and a length you set up once; drag it into a day of the Planner ----

export function templateChip(template, { onRemove = null } = {}) {
  const chip = el('span', { class: 'template-chip', draggable: 'true', 'data-template': template.id, title: 'Drag it into a day: it becomes a task there, never an event' },
    icon('task'), el('span', { class: 'template-chip-title' }, template.title), el('span', { class: 'template-chip-minutes' }, length(template.minutes)),
    ...(onRemove ? [el('button', { type: 'button', class: 'template-chip-remove', 'aria-label': `Remove the routine ${template.title}`, onclick: onRemove }, icon('close'))] : []));
  chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-task', `template:${template.id}`); e.dataTransfer.effectAllowed = 'copy'; });
  return chip;
}
