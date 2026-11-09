// The Planner (time/2): one day where your fixed events and the tasks you choose meet.
//   /planner              today
//   /planner/YYYY-MM-DD   another day
// Events come from the calendar as solid blocks, locked here. Tasks you plan sit in
// dashed slots, because a task can move. The day splits into Morning and Afternoon (at
// 14:00 by default), each with its free minutes. The Tray on the left holds what waits:
// Missed (planned for an earlier day, not done, with that day), No day, Speedies. Drag a
// task onto a part of the day, or press Place (it goes where there is room); × takes it
// back to Tasks to place. Planning a task gives it the day, so it shows there in Tasks too; it
// never goes on the Calendar. Titles and notes are still changed on the Tasks page.
// The budget line counts the day honestly: its meetings and its tasks' estimates (a task
// without one counts as the setting says) against planned work plus buffer. When the day
// holds more, it says so in plain words, in amber, and suggests what to move out; from the
// ninth thing it says that is a lot. It never stops you. Settings changes all of these.
// Time blocks are containers of time on the day with a kind (Deep Work, Shallow, Routine,
// Batch, Buffer) that hold tasks: b makes one, a click on its name changes it. A strip of
// the hours from 6 to 22 shows the day at a glance, with a mark for now. A block under 45
// minutes, or a day of more than ten blocks, gets a word of warning.
// Nothing rolls over by itself: a task planned for an earlier day and not done waits in
// Missed, with its day; Today (or t on it) brings it back. The setting can instead carry
// them to the next day by themselves, or ask each day.
// Weekly Goals (★, time/3) are the tasks you want done this week; this week's show above
// the day (five is plenty: the sixth gets a word, never a stop). Each day has one
// Highlight, at the top: choosing another replaces it, and z takes that back.
// ⇧X closes the day (time/4, public/shutdown.js); a closed day says so at its top.
// The day is drawn in hours: Morning and Afternoon are its two bands, with events as
// filled blocks at their times (locked), time blocks dashed at theirs, and each placed
// task at its time with its length. A task placed in a part without a time yet shows in
// the first free time of its part, and keeps a time once moved. Place puts a task in the
// first free gap; dragging it onto the hours puts it at that time; ↑ and ↓ move a task
// 15 minutes. Things at the same time share the width.
// Above the day, the week strip: the seven days of its week, each with its events and
// tasks counted and how full it is; a click opens that day. On the left, Tasks to place:
// Due (missed on an earlier day, with that day), Upcoming (a later day: pull it in early)
// and No date. Plan my day (p) is a short dialog: what is still free, tick what belongs,
// Put them in the day; the five planning steps are behind Step by step instead.
// What your assistant proposes when it plans with you (a task to another day, a Highlight,
// a block) shows as cards above the board: Apply or Dismiss, then Undo. Nothing moves
// until you apply it.

import { api, el, icon, request, today, addDays, dateOf, isDay, undoBar, giveCursorBack, weekStart } from './ui.js';
import { app, screen, onLeave, setFooterLink } from './shell.js';
import { estimateLabel, dueLabel } from './due.js';
import { moduleOn } from './modules.js';
import { startTiming } from './timings.js';
import { flagChip, starButton } from './quick-add.js';
import { eventLine, eventFill, gMark } from './calendar.js';
import { openShutdown, closedBar, shutdownApi } from './shutdown.js';
import { cardNode } from './assistant.js';
import { dayColumn as columnOf, orderView, hourGrid, lensControls, templateChip } from './day-hours.js';
import { weekBoard, planningPanel, reviewPanel } from './planning.js';
import { quarterBoard, quarterApi, quarterOf, quarterLabel } from './quarter.js';

const KINDS = { deep: 'Deep Work', shallow: 'Shallow', routine: 'Routine', batch: 'Batch', buffer: 'Buffer' };
const SHORT_BLOCK = 45; // minutes
const MANY_BLOCKS = 10;
let keptInMissed = null; // the day "Keep them in Missed" was answered, so it asks once a day

const pad = (n) => String(n).padStart(2, '0');
export const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const clock = (time) => new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const duration = (minutes) => (minutes <= 0 ? '0 min' : minutes < 60 ? `${minutes} min`
  : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60}` : ''}`);

export const plannerApi = {
  day: (day) => request('GET', `/api/planner?day=${day}`),
  settings: (changes) => request('PATCH', '/api/settings', changes),
  block: (block) => request('POST', '/api/blocks', block),
  changeBlock: (id, changes) => request('PATCH', `/api/blocks/${id}`, changes),
  removeBlock: (id) => request('DELETE', `/api/blocks/${id}`),
  restoreBlock: (id) => request('POST', `/api/blocks/${id}/restore`, {}),
  highlight: (day, taskId) => request('PUT', `/api/highlights/${day}`, { task_id: taskId }),
  week: (day) => request('GET', `/api/planner/week?day=${day}`),
  flow: (kind, period) => request('GET', `/api/planning/${kind}/${period}`),
  step: (kind, period, step, state) => request('PATCH', `/api/planning/${kind}/${period}`, { step, state }),
};

const round15 = (minutes) => Math.round(minutes / 15) * 15;
// How many minutes of the time from `from` to `to` (minutes of the day) a thing takes up.
const overlap = (start, end, from, to) => Math.max(0, Math.min(end, to) - Math.max(start, from));
// An event's minutes on this day (an event that runs over midnight counts its part).
function eventSpan(event, day) {
  const start = event.starts_at.slice(0, 10) < day ? 0 : minutesOf(event.starts_at.slice(11));
  const end = event.ends_at.slice(0, 10) > day ? 24 * 60 : minutesOf(event.ends_at.slice(11));
  return { start, end };
}
// What a task counts for: its estimate, or the setting for one without.
export const taskMinutes = (task, settings) => (task.pin_at && task.pin_minutes ? task.pin_minutes : task.estimate ?? settings.no_estimate_minutes);
// Where a task sits on the hours: a pinned one at its pin, else at its time (HH:MM), or ''.
export const taskStart = (task) => task.pin_at || task.plan_at;

// What a day holds: its meetings, its tasks, and the empty part of its blocks, against
// planned work plus buffer. The same count for the day and for each day of the week.
export function dayLoad({ events, tasks, blocks }, day, settings) {
  const timed = events.filter((e) => !e.all_day);
  const meetings = timed.reduce((n, e) => { const s = eventSpan(e, day); return n + (s.end - s.start); }, 0);
  const work = tasks.reduce((n, t) => n + taskMinutes(t, settings), 0);
  const blockSlack = blocks.reduce((n, b) => {
    const inside = tasks.filter((t) => t.block_id === b.id).reduce((m, t) => m + taskMinutes(t, settings), 0);
    return n + Math.max(0, minutesOf(b.ends_at) - minutesOf(b.starts_at) - inside);
  }, 0);
  const planned = meetings + work + blockSlack;
  const budget = settings.work_minutes + settings.buffer_minutes;
  return { planned, budget, over: planned - budget, items: tasks.length + timed.length, blocks: blocks.length };
}

// Where everything of a day sits on the hours (the day view, and the hour grid of advanced/calendar/2): per part, its
// range on the grid, and each event, block and task with its start and end in minutes. A task without a time takes
// the first free time of its part.
export function layoutOfPlan(plan, day) {
  const { settings } = plan;
  const split = minutesOf(settings.split);
  const highlight = plan.tasks.find((t) => t.id === plan.highlight_id);
  const spans = plan.events.filter((e) => !e.all_day).map((e) => ({ event: e, ...eventSpan(e, day) }));
  const timed = plan.tasks.filter((t) => !t.block_id && t.plan_part && taskStart(t));
  const starts = [...spans.map((s) => s.start), ...plan.blocks.map((b) => minutesOf(b.starts_at)), ...timed.map((t) => minutesOf(taskStart(t)))];
  const ends = [...spans.map((s) => s.end), ...plan.blocks.map((b) => minutesOf(b.ends_at)), ...timed.map((t) => minutesOf(taskStart(t)) + taskMinutes(t, settings))];
  const from = Math.max(0, Math.floor(Math.min(minutesOf(settings.day_start), ...starts) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil(Math.max(minutesOf(settings.day_end), ...ends) / 60) * 60);
  const busy = [
    ...spans.map((s) => ({ start: s.start, end: s.end })),
    ...plan.blocks.map((b) => ({ start: minutesOf(b.starts_at), end: minutesOf(b.ends_at) })),
    ...timed.map((t) => ({ start: minutesOf(taskStart(t)), end: minutesOf(taskStart(t)) + taskMinutes(t, settings) })),
  ];
  const bands = [
    { key: 'morning', name: 'Morning', from, to: Math.max(from, split) },
    { key: 'afternoon', name: 'Afternoon', from: Math.min(split, to), to },
  ];
  const placed = new Map(); // task id → { start, end }
  for (const t of timed) placed.set(t.id, { start: minutesOf(taskStart(t)), end: minutesOf(taskStart(t)) + taskMinutes(t, settings) });
  for (const band of bands) {
    for (const t of plan.tasks.filter((x) => !x.block_id && x.plan_part === band.key && !taskStart(x))) {
      const need = taskMinutes(t, settings);
      const at = firstGap(busy, band.from, band.to, need) ?? Math.max(band.from, ...busy.map((b) => b.end).filter((e) => e <= band.to));
      placed.set(t.id, { start: at, end: at + need });
      busy.push({ start: at, end: at + need });
    }
  }
  return { bands, spans, placed, busy, highlight, split };
}
// The first time from `from` (in 15-minute steps) where `need` minutes fit before `to`.
function firstGap(busy, from, to, need) {
  for (let at = round15(from); at + need <= to; at += 15) {
    if (!busy.some((b) => overlap(b.start, b.end, at, at + need) > 0)) return at;
  }
  return null;
}

export async function showPlanner(dayParam) {
  let day = isDay(dayParam) ? dayParam : today();
  const asked = new URLSearchParams(location.search).get('view');
  let view = ['week', 'quarter'].includes(asked) ? asked : 'day';
  // Calendar in depth (advanced/calendar/2): the day as its order or in hours, one, three or seven days.
  const asks = new URLSearchParams(location.search);
  let lens = asks.get('lens') === 'order' ? 'order' : 'hours';
  let range = ['3', '7'].includes(asks.get('range')) ? asks.get('range') : 'day';
  let plan = null;   // the day, in the day view
  let week = null;   // the week, in the week view
  let quarter = null; // the quarterly review, in the quarter view
  let panelOpen = false;
  let panelKind = 'plan'; // or 'review': the Weekly Review (⇧R)
  document.title = 'Planner';
  app.className = 'page page-wide planner-page';

  const dayLabel = el('span', { class: 'cal-range' });
  const budgetPlace = el('div', { class: 'budget', role: 'status', 'aria-live': 'polite' });
  const askPlace = el('div', {});
  const goalsPlace = el('section', { class: 'week-goals', 'aria-label': 'This week’s goals' });
  const highlightUndo = []; // what each Highlight replaced, for z
  const undoPlace = el('div', {});
  const settingsPlace = el('section', { class: 'planner-settings', 'aria-label': 'Planner settings', hidden: true });
  const status = el('p', { class: 'journal-tools-message', role: 'status' });
  const suggestPlace = el('section', { class: 'plan-suggestions', 'aria-label': 'Your assistant suggests', hidden: true });
  let plans = [];
  const tray = el('aside', { class: 'tray', 'aria-label': 'Tasks to place' });
  const dayStrip = el('nav', { class: 'day-strip', 'aria-label': 'This week' });
  const planDialog = el('dialog', { class: 'capture-box event-dialog plan-dialog', 'aria-label': 'Plan the day' });
  const pinDialog = el('dialog', { class: 'capture-box event-dialog pin-dialog', 'aria-label': 'Pin to a time' });
  let stripWeek = null; // the week of the day shown, for the strip
  const dayPlace = el('section', { class: 'plan-day', 'aria-label': 'The day' });
  const weekPlace = el('section', { class: 'plan-week', 'aria-label': 'The week' });
  const quarterPlace = el('section', { class: 'plan-quarter', 'aria-label': 'The quarter' });
  const panelPlace = el('aside', { class: 'planning-panel', 'aria-label': 'Planning', hidden: true });
  const lensBar = el('div', { class: 'lens-bar' });
  const routinePlace = el('section', { class: 'routine-strip', 'aria-label': 'Routines', hidden: true });
  let templates = [];
  const dayColumn = el('div', { class: 'plan-column' }, dayStrip, el('div', { class: 'plan-tools' }, lensBar, routinePlace), goalsPlace, budgetPlace, dayPlace);
  // The address of what is shown: the day, the view, the lens and how many days in hours.
  const addressNow = () => {
    const query = new URLSearchParams();
    if (view !== 'day') query.set('view', view);
    if (view === 'day' && lens === 'order') query.set('lens', 'order');
    if (view === 'day' && lens === 'hours' && range !== 'day') query.set('range', range);
    return `${day === today() ? '/planner' : `/planner/${day}`}${query.size ? `?${query}` : ''}`;
  };
  // Switching the lens or the days in hours draws what is already loaded (the Order and the Day need no new answer): fast, and measured.
  async function switchLens(nextLens, nextRange = range) {
    const done = startTiming('Switch lens');
    lens = nextLens;
    range = nextRange;
    history.replaceState(null, '', addressNow());
    if (view === 'day' && plan) await draw(); else await load();
    done();
  }
  const go = async (next, nextView = view) => {
    day = next;
    view = nextView;
    const query = new URLSearchParams();
    if (view !== 'day') query.set('view', view);
    if (view === 'day' && lens === 'order') query.set('lens', 'order');
    if (view === 'day' && lens === 'hours' && range !== 'day') query.set('range', range);
    const address = `${day === today() ? '/planner' : `/planner/${day}`}${query.size ? `?${query}` : ''}`;
    history.replaceState(null, '', address);
    await load();
  };
  const daysShown = () => (view === 'day' && lens === 'hours' && range !== 'day' ? Number(range) : 1);
  const step = (n) => go(view === 'quarter' ? quarterOf(day, n) : addDays(day, view === 'week' ? 7 * n : daysShown() * n));
  // The Lens switch (Order · Hours) and, in Hours, how many days: only with Calendar in depth on.
  const lensControl = lensControls({ onLens: (name) => switchLens(name), onRange: (name) => switchLens(lens, name) });
  lensBar.append(...lensControl.bar.children);
  const viewSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'View' },
    ...[['day', 'Day'], ['week', 'Week'], ['quarter', 'Quarter']].map(([name, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'data-view': name, onclick: () => go(day, name),
    }, label)));
  const planButton = el('button', { type: 'button', class: 'button button-primary', onclick: () => (view === 'week' ? togglePanel() : openPlanDay()) }, 'Plan my day');
  async function togglePanel(open = !(panelOpen && panelKind === 'plan')) {
    panelOpen = open;
    panelKind = 'plan';
    await load();
  }

  const earlier = el('button', { type: 'button', class: 'button', 'aria-label': 'The day before', onclick: () => step(-1) }, icon('left'));
  const later = el('button', { type: 'button', class: 'button', 'aria-label': 'The day after', onclick: () => step(1) }, icon('right'));

  const layout = el('div', { class: 'planner-layout' }, tray, el('div', { class: 'plan-board' }, panelPlace, dayColumn, weekPlace, quarterPlace));

  screen.replaceChildren(
    el('header', { class: 'top-bar cal-bar' },
      el('h1', { class: 'top-bar-title' }, 'Planner'),
      el('div', { class: 'cal-nav' },
        earlier,
        dayLabel,
        later,
        el('button', { type: 'button', class: 'button', onclick: () => go(today()) }, 'Today')),
      viewSwitch,
      planButton,
      el('button', {
        type: 'button', class: 'button button-quiet', 'aria-expanded': 'false',
        onclick: (e) => { settingsPlace.hidden = !settingsPlace.hidden; e.currentTarget.setAttribute('aria-expanded', String(!settingsPlace.hidden)); drawSettings(); },
      }, 'Settings')),
    settingsPlace,
    askPlace,
    suggestPlace,
    status,
    layout,
    undoPlace,
  );
  setFooterLink(null);

  // Only the latest load is drawn: an older answer that comes back later would draw a page
  // that is already out of date over the newer one.
  let loads = 0;
  let grids = 0; // the same for the days of an hour grid
  let panels = 0; // the same for the planning panel beside the board
  async function load() {
    const mine = ++loads;
    try {
      plans = view === 'quarter' ? [] : await request('GET', '/api/assistant-actions/plans').catch(() => []);
      if (view === 'week') {
        week = await plannerApi.week(day);
      } else if (view === 'quarter') {
        quarter = await quarterApi.get(day);
      } else {
        [plan, stripWeek, templates] = await Promise.all([plannerApi.day(day), plannerApi.week(day), request('GET', '/api/templates').catch(() => [])]);
        if (plan.carried) status.textContent = `${plan.carried === 1 ? '1 task' : `${plan.carried} tasks`} from earlier days carried to today.`;
      }
    } catch {
      if (mine === loads) status.textContent = "The Planner couldn't be loaded. Is the app still running?";
      return;
    }
    if (mine === loads) await draw();
  }

  // ---- Changing tasks ----

  async function change(task, changes, message = '') {
    status.textContent = message;
    try {
      await api.changeTask(task.id, changes);
    } catch (err) {
      status.textContent = err.status === 409 ? 'That task changed in its page. Reload to see it as it is now.' : err.message;
    }
    await load();
  }
  const unplan = (task) => change(task, { due: '', plan_part: '', block_id: null });

  // Place: into the first free gap of the first part with room for it (else the end of
  // the afternoon), at that time.
  function place(task) {
    if (view === 'week') { change(task, { due: day, plan_part: '', block_id: null }); return; }
    const done = startTiming('Place a task');
    const spot = freeSpot(layoutDay(), task);
    change(task, { due: day, plan_part: spot.part, plan_at: timeOf(spot.at), block_id: null }).then(done);
  }
  // Put at a time (a drop on the hours, an arrow key): its part is the one the time is in.
  const partAt = (minutes) => (minutes < minutesOf(plan.settings.split) ? 'morning' : 'afternoon');
  const planAt = (task, minutes) => { const done = startTiming('Drop a task'); return change(task, { due: day, plan_part: partAt(minutes), plan_at: timeOf(minutes), block_id: null, ...(task.pin_at ? { pin_at: timeOf(minutes) } : {}) }).then(done); };

  // ---- The day in hours ----

  const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--plan-hour-height')) || 64;
  const SHOWN_AT_LEAST = 30; // minutes a short thing takes on the grid, so its words fit

  // Where everything of the day sits: per part, its range on the grid, and each event,
  // block and task with its start and end in minutes. A task without a time takes the
  // first free time of its part.
  const layoutDay = () => layoutOfPlan(plan, day);
  // Where Place puts a task: the first part with a free gap long enough.
  function freeSpot(layout, task) {
    const need = taskMinutes(task, plan.settings);
    for (const band of layout.bands) {
      const at = firstGap(layout.busy, band.from, band.to, need);
      if (at !== null) { layout.busy.push({ start: at, end: at + need }); return { part: band.key, at }; }
    }
    const at = Math.min(24 * 60 - need, Math.max(...layout.busy.map((b) => b.end), minutesOf(plan.settings.day_start)));
    layout.busy.push({ start: at, end: at + need });
    return { part: partAt(at), at };
  }

  // Things at the same time share the width: each gets a lane, and as many lanes as its
  // busiest moment needs.
  function lanes(items) {
    const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [];
    let groupEnd = -1;
    const finish = () => { const count = Math.max(...group.map((i) => i.lane)) + 1; for (const i of group) i.lanes = count; };
    for (const item of sorted) {
      const shownEnd = Math.max(item.end, item.start + SHOWN_AT_LEAST);
      if (group.length && item.start >= groupEnd) { finish(); group = []; groupEnd = -1; }
      const taken = group.filter((g) => Math.max(g.end, g.start + SHOWN_AT_LEAST) > item.start).map((g) => g.lane);
      item.lane = [0, 1, 2, 3, 4, 5].find((l) => !taken.includes(l)) ?? 0;
      group.push(item);
      groupEnd = Math.max(groupEnd, shownEnd);
    }
    if (group.length) finish();
    return sorted;
  }
  const placeStyle = (item, band) => {
    const h = hourPx();
    const top = ((item.start - band.from) / 60) * h;
    const height = Math.max(((item.end - item.start) / 60) * h, (SHOWN_AT_LEAST / 60) * h) - 2;
    return `top: ${top}px; height: ${height}px; left: calc(var(--plan-gutter) + (100% - var(--plan-gutter)) * ${item.lane} / ${item.lanes}); width: calc((100% - var(--plan-gutter)) / ${item.lanes} - var(--space-1));`;
  };

  // One part of the day as its hours, with everything at its time.
  function bandNode(band, layout, part) {
    const h = hourPx();
    const { highlight } = layout;
    const items = [];
    for (const s of layout.spans) {
      const start = Math.max(s.start, band.from);
      const end = Math.min(s.end, band.to);
      if (end <= start || (band.key === 'afternoon' && s.end <= band.from)) continue;
      const continued = s.start < band.from;
      items.push({ start, end, node: () => eventBlock(s.event, s, continued) });
    }
    for (const b of plan.blocks.filter((x) => partAt(minutesOf(x.starts_at)) === band.key)) {
      items.push({ start: minutesOf(b.starts_at), end: minutesOf(b.ends_at), node: () => blockNode(b, band.key) });
    }
    for (const t of plan.tasks.filter((x) => !x.block_id && x.plan_part === band.key)) {
      const at = layout.placed.get(t.id);
      if (!at) continue;
      items.push({ start: at.start, end: at.end, node: () => (t === highlight ? highlightMark(t, at) : timedSlot(t, at)) });
    }
    const hours = el('div', { class: 'plan-hours', style: `height: ${((band.to - band.from) / 60) * h}px` },
      ...Array.from({ length: Math.ceil((band.to - band.from) / 60) }, (_, i) => band.from + i * 60).map((m) => el('div', {
        class: 'plan-hour-line', style: `top: ${((m - band.from) / 60) * h}px`,
      }, el('span', { class: 'plan-hour-label' }, clock(timeOf(m))))),
      ...lanes(items).map((item) => { const node = item.node(); node.classList.add('on-grid'); node.style.cssText += placeStyle(item, band); return node; }),
      ...(items.length ? [] : [el('p', { class: 'plan-empty plan-hours-empty' }, 'Free. Drop a task here.')]),
      ...nowLine(band, h));
    const section = el('section', { class: 'plan-part', 'aria-label': band.name, 'data-part': band.key },
      el('h3', { class: 'plan-part-title' }, band.name,
        el('span', { class: 'plan-free' }, `${clock(timeOf(part.from))}–${clock(timeOf(part.to))} · ${part.free < 0 ? `${duration(-part.free)} too much` : `${duration(part.free)} free`}`),
        el('button', { type: 'button', class: 'button button-quiet plan-add-block', onclick: () => openBlock() }, icon('plus'), 'Time block (b)')),
      hours);
    // Let go on the hours: at that time (its top where the pointer is).
    dropTarget(section, (task, e) => {
      const box = hours.getBoundingClientRect();
      const minutes = e && box.height ? band.from + round15(((e.clientY - box.top) / h) * 60) : band.from;
      planAt(task, Math.min(Math.max(minutes, band.from), Math.max(band.from, band.to - 15)));
    });
    return section;
  }

  const nowLine = (band, h) => {
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    return day === today() && now >= band.from && now < band.to ? [el('div', { class: 'plan-now', style: `top: ${((now - band.from) / 60) * h}px`, 'aria-hidden': 'true' })] : [];
  };

  // An event: a filled block in its calendar's colour (your own in the surface colour),
  // with its time, locked.
  function eventBlock(event, span, continued) {
    // Under 45 minutes there is room for one line: the name, then the time beside it.
    const short = span.end - span.start < 45 ? ' is-short' : '';
    return el('div', { class: `${continued ? 'plan-event plan-event-more' : 'plan-event'}${short}`, style: `${eventLine(event)} ${eventFill(event)}` },
      el('span', { class: 'plan-event-title' }, event.source === 'google' ? gMark(event.google?.sync) : null, event.title, event.calendar ? el('span', { class: 'day-event-calendar' }, ` · ${event.calendar.name}`) : null),
      el('span', { class: 'plan-time' }, `${clock(timeOf(span.start))}–${clock(timeOf(Math.min(span.end, 24 * 60 - 1)))}${continued ? ' (continued)' : ''}`),
      el('span', { class: 'plan-locked' }, 'locked'));
  }

  // A task at its time: its slot, with the time; ↑ and ↓ move it 15 minutes.
  function timedSlot(task, at) {
    const node = slot(task);
    node.dataset.at = String(at.start);
    node.querySelector('.plan-slot-text').after(el('span', { class: 'plan-slot-time' }, clock(timeOf(at.start))));
    node.addEventListener('keydown', (e) => {
      if (e.target !== node || !['ArrowUp', 'ArrowDown'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      nudge(task, at.start, e.key === 'ArrowUp' ? -15 : 15);
    });
    return node;
  }
  // The Highlight's time on the grid (the task itself sits at the top of the day).
  const highlightMark = (task, at) => el('div', { class: 'plan-highlight-mark' }, el('span', { class: 'highlight-label' }, 'Highlight'), ` ${task.text} · ${clock(timeOf(at.start))}`);

  // Arrow keys: each press moves it 15 minutes at once on screen, and the saves follow in
  // turn (quick presses queue, they never start from an old time).
  let nudging = Promise.resolve();
  let nudged = null;
  function nudge(task, from, by) {
    const start = Math.min(Math.max((nudged?.id === task.id ? nudged.at : from) + by, 0), 24 * 60 - 15);
    nudged = { id: task.id, at: start };
    task.plan_at = timeOf(start);
    task.plan_part = partAt(start);
    draw().then(() => dayPlace.querySelector(`.plan-slot[data-task="${task.id}"]`)?.focus());
    nudging = nudging.then(() => api.changeTask(task.id, { plan_part: partAt(start), plan_at: timeOf(start), ...(task.pin_at ? { pin_at: timeOf(start) } : {}) })).catch((err) => { status.textContent = err.message; });
    const mine = nudging;
    mine.then(() => { if (nudging === mine) { nudged = null; load().then(() => dayPlace.querySelector(`.plan-slot[data-task="${task.id}"]`)?.focus()); } });
  }

  // ---- The day's parts and their free minutes ----

  function partsOf() {
    const { settings } = plan;
    const spans = [
      { key: 'morning', name: 'Morning', from: minutesOf(settings.day_start), to: minutesOf(settings.split) },
      { key: 'afternoon', name: 'Afternoon', from: minutesOf(settings.split), to: minutesOf(settings.day_end) },
    ];
    return spans.map((part) => {
      const events = plan.events.filter((e) => !e.all_day)
        .filter((e) => { const s = eventSpan(e, day); return overlap(s.start, s.end, part.from, part.to) > 0; });
      const blocks = plan.blocks.filter((b) => overlap(minutesOf(b.starts_at), minutesOf(b.ends_at), part.from, part.to) > 0);
      const loose = plan.tasks.filter((t) => !t.block_id && t.plan_part === part.key);
      const blocksHere = plan.blocks.filter((b) => minutesOf(b.starts_at) >= part.from && minutesOf(b.starts_at) < part.to);
      const taken = events.reduce((n, e) => { const s = eventSpan(e, day); return n + overlap(s.start, s.end, part.from, part.to); }, 0)
        + blocks.reduce((n, b) => n + overlap(minutesOf(b.starts_at), minutesOf(b.ends_at), part.from, part.to), 0)
        + loose.reduce((n, t) => n + taskMinutes(t, settings), 0);
      return { ...part, events, blocks, blocksHere, loose, free: part.to - part.from - taken };
    });
  }

  // ---- The budget ----

  // What the day holds: its meetings, its tasks, and the empty part of its blocks.
  const budgetOf = () => dayLoad(plan, day, plan.settings);

  // What could move out: open tasks that aren't a Must (no flag before Like, the longest
  // first), enough to cover the excess, two at most.
  function suggestions(over) {
    const order = { '': 0, like: 1 };
    const candidates = plan.tasks.filter((t) => !t.done && t.flag !== 'must' && !(t.source.kind === 'entry' && t.source.day === day))
      .sort((a, b) => order[a.flag] - order[b.flag] || taskMinutes(b, plan.settings) - taskMinutes(a, plan.settings));
    const picked = [];
    let covered = 0;
    for (const task of candidates) {
      if (covered >= over || picked.length === 2) break;
      picked.push(task);
      covered += taskMinutes(task, plan.settings);
    }
    return picked;
  }

  function drawBudget() {
    const { planned, budget, over, items, blocks } = budgetOf();
    const tooMany = items >= 9;
    const tooManyBlocks = blocks > MANY_BLOCKS;
    budgetPlace.classList.toggle('is-over', over > 0 || tooMany || tooManyBlocks);
    const tomorrow = addDays(day, 1);
    budgetPlace.replaceChildren(
      el('span', { class: 'budget-words' },
        over > 0 ? el('strong', {}, `Over by ${duration(over)}`) : null,
        `${over > 0 ? ' · ' : ''}${duration(planned)} planned of ${duration(budget)}`,
        tooMany ? ` · ${items} things: that is a lot for one day` : '',
        tooManyBlocks ? ` · ${blocks} blocks: more than ${MANY_BLOCKS} cuts the day into crumbs` : ''),
      ...(over > 0 ? suggestions(over).map((task) => el('button', {
        type: 'button', class: 'button budget-move',
        onclick: () => change(task, { due: tomorrow, plan_part: '', block_id: null }, `“${task.text}” moved to tomorrow.`),
      }, `Move “${task.text}” to tomorrow`)) : []),
    );
  }

  // ---- Time blocks ----

  const dialog = el('dialog', { class: 'capture-box event-dialog', 'aria-label': 'Time block' });
  const shutdownDialog = el('dialog', { class: 'capture-box event-dialog shutdown-dialog', 'aria-label': 'Close the day' });
  document.body.append(dialog, shutdownDialog, planDialog, pinDialog);
  onLeave(() => { dialog.remove(); shutdownDialog.remove(); planDialog.remove(); pinDialog.remove(); undoPlace.replaceChildren(); });
  const canClose = () => view === 'day' && day <= today() && !plan?.closed?.closed;
  const closeTheDay = () => openShutdown(shutdownDialog, plan, { closed: load });
  async function reopenTheDay() {
    await shutdownApi.reopen(day);
    await load();
  }

  // The next free half hour from now (or the day's start), for a new block.
  function nextFree(length) {
    const busy = [
      ...plan.events.filter((e) => !e.all_day).map((e) => eventSpan(e, day)),
      ...plan.blocks.map((b) => ({ start: minutesOf(b.starts_at), end: minutesOf(b.ends_at) })),
    ];
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    let start = Math.max(minutesOf(plan.settings.day_start), day === today() ? Math.ceil(nowMinutes / 30) * 30 : 0);
    for (let i = 0; i < 48 && busy.some((b) => overlap(b.start, b.end, start, start + length) > 0); i++) start += 30;
    return Math.min(start, 24 * 60 - length);
  }

  function openBlock(block = null) {
    const startMinutes = block ? minutesOf(block.starts_at) : nextFree(90);
    const kind = el('select', { class: 'detail-input', 'aria-label': 'Kind' },
      ...Object.entries(KINDS).map(([value, name]) => el('option', { value, selected: (block?.kind ?? 'deep') === value }, name)));
    const from = el('input', { type: 'time', class: 'detail-input', 'aria-label': 'From', step: 300, value: block?.starts_at ?? timeOf(startMinutes) });
    const to = el('input', { type: 'time', class: 'detail-input', 'aria-label': 'To', step: 300, value: block?.ends_at ?? timeOf(Math.min(startMinutes + 90, 24 * 60 - 1)) });
    const title = el('input', { class: 'detail-input', 'aria-label': 'Name (optional)', placeholder: 'What it is for (optional)', maxlength: 200, value: block?.title ?? '' });
    const problem = el('p', { class: 'capture-problem', role: 'alert' });
    async function save() {
      if (!from.value || !to.value || to.value <= from.value) { problem.textContent = 'A block ends after it starts.'; return; }
      const fields = { kind: kind.value, starts_at: from.value, ends_at: to.value, title: title.value };
      try {
        if (block) await plannerApi.changeBlock(block.id, fields); else await plannerApi.block({ day, ...fields });
        dialog.close();
        await load();
      } catch (err) {
        problem.textContent = err.message;
      }
    }
    dialog.replaceChildren(
      el('h2', { class: 'event-read-title' }, block ? 'Time block' : 'New time block'),
      el('div', { class: 'contact-details event-fields' },
        el('label', { class: 'detail-label' }, 'Kind'), kind,
        el('label', { class: 'detail-label' }, 'From'), el('div', { class: 'event-times' }, from, el('span', {}, '–'), to),
        el('label', { class: 'detail-label' }, 'For'), title),
      problem,
      el('div', { class: 'capture-foot' },
        el('span', { class: 'event-actions' },
          ...(block ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => { dialog.close(); removeBlock(block); } }, icon('trash'), 'Delete')] : []),
          el('button', { type: 'button', class: 'button button-quiet', onclick: () => dialog.close() }, 'Cancel')),
        el('button', { type: 'button', class: 'button button-primary', onclick: save }, block ? 'Save' : 'Add block')),
    );
    dialog.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); save(); } };
    dialog.showModal();
    kind.focus();
  }

  async function removeBlock(block) {
    await plannerApi.removeBlock(block.id);
    await load();
    undoPlace.replaceChildren(undoBar(`${KINDS[block.kind]} block deleted.`, async () => { await plannerApi.restoreBlock(block.id); await load(); }));
  }

  // A block: its kind and time, the minutes it has left, and its tasks.
  function blockNode(block, partKey) {
    const inside = plan.tasks.filter((t) => t.block_id === block.id);
    const length = minutesOf(block.ends_at) - minutesOf(block.starts_at);
    const left = length - inside.reduce((n, t) => n + taskMinutes(t, plan.settings), 0);
    const node = el('div', { class: 'plan-block', 'aria-label': `${KINDS[block.kind]} block`, role: 'group', 'data-block': block.id },
      el('div', { class: 'plan-block-head' },
        el('button', { type: 'button', class: 'plan-block-name', onclick: () => openBlock(block) }, KINDS[block.kind], block.title ? ` · ${block.title}` : ''),
        el('span', { class: 'plan-free' }, `${clock(block.starts_at)}–${clock(block.ends_at)} · ${left < 0 ? `${duration(-left)} over` : `${duration(left)} left`}`),
        length < SHORT_BLOCK ? el('span', { class: 'plan-warning' }, `under ${SHORT_BLOCK} min: little room to settle in`) : null),
      ...inside.filter((t) => t.id !== plan.highlight_id).map((t) => slot(t)),
      ...(inside.length ? [] : [el('p', { class: 'plan-empty' }, 'Drop a task in this block.')]));
    dropTarget(node, (task) => change(task, { due: day, block_id: block.id, plan_part: partKey }));
    return node;
  }

  // While not typing somewhere: b a new block; z the Highlight before; p plan the day
  // (or the week); ⇧X close the day; ⇧R the Weekly Review of the week on screen.
  const onKey = (e) => {
    if (!['b', 'z', 'p', 'X', 'R', 'v'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (e.key === 'v') {
      // V switches the lens: the order and the hours, on the same days (Calendar in depth).
      if (view !== 'day' || !moduleOn('calendar-plus')) return;
      e.preventDefault();
      switchLens(lens === 'order' ? 'hours' : 'order');
      return;
    }
    e.preventDefault();
    if (e.key === 'p') { if (view === 'week') togglePanel(); else if (view === 'day') openPlanDay(); }
    else if (e.key === 'R') { panelOpen = !(panelOpen && panelKind === 'review' && view === 'week'); panelKind = 'review'; go(day, 'week'); }
    else if (e.key === 'X') { if (canClose()) closeTheDay(); }
    else if (view !== 'day') return;
    else if (e.key === 'b') openBlock(); else undoHighlight();
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  // ---- Missed: ask, when the setting says so ----

  function drawAsk() {
    const missed = plan.tray.missed;
    // With Tasks in depth: when something is missed, one quiet line above today, with its count and the way to the Missed view.
    const line = () => (moduleOn('tasks-plus') && day === today() && missed.length
      ? el('p', { class: 'planner-missed-line', role: 'status' }, icon('task'), ` ${missed.length} missed · `, el('a', { href: '/tasks?view=missed' }, 'Open')) : null);
    if (plan.settings.missed !== 'ask' || day !== today() || !missed.length || keptInMissed === today()) { askPlace.replaceChildren(...[line()].filter(Boolean)); return; }
    const count = missed.length === 1 ? '1 task from an earlier day is' : `${missed.length} tasks from earlier days are`;
    askPlace.replaceChildren(el('div', { class: 'undo-bar planner-ask', role: 'status' },
      el('span', {}, `${count} not done.`),
      el('span', { class: 'notice-actions' },
        el('button', {
          type: 'button', class: 'button',
          onclick: async () => {
            for (const task of missed) { try { await api.changeTask(task.id, { due: today(), plan_part: '', block_id: null }); } catch { /* stays in Missed */ } }
            keptInMissed = today();
            await load();
          },
        }, 'Move them to today'),
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => { keptInMissed = today(); drawAsk(); } }, 'Keep them in Missed'))));
  }

  // ---- Settings ----

  function drawSettings() {
    if (settingsPlace.hidden || !plan) return;
    const { settings } = plan;
    const save = async (changes) => {
      try {
        plan.settings = await plannerApi.settings(changes);
        draw();
      } catch (err) {
        status.textContent = err.message;
      }
    };
    const hours = (label, key) => {
      const input = el('input', { type: 'number', class: 'detail-input', min: 0, max: 24, step: 0.25, 'aria-label': label, value: String(settings[key] / 60) });
      input.addEventListener('change', () => { const v = Math.round(Number(input.value) * 60); if (Number.isFinite(v) && v >= 0) save({ [key]: v }); });
      return [el('label', { class: 'detail-label' }, label), el('span', { class: 'settings-unit' }, input, ' h')];
    };
    const time = (label, key) => {
      const input = el('input', { type: 'time', class: 'detail-input', 'aria-label': label, value: settings[key] });
      input.addEventListener('change', () => { if (input.value) save({ [key]: input.value }); });
      return [el('label', { class: 'detail-label' }, label), input];
    };
    const minutes = el('input', { type: 'number', class: 'detail-input', min: 0, max: 480, step: 5, 'aria-label': 'A task without an estimate counts', value: String(settings.no_estimate_minutes) });
    minutes.addEventListener('change', () => { const v = Math.round(Number(minutes.value)); if (Number.isFinite(v) && v >= 0) save({ no_estimate_minutes: v }); });
    const missed = el('select', { class: 'detail-input', 'aria-label': 'A missed task' },
      ...[['keep', 'waits in Missed'], ['carry', 'moves to the next day by itself'], ['ask', 'asks me']].map(([v, text]) => el('option', { value: v, selected: settings.missed === v }, text)));
    missed.addEventListener('change', () => save({ missed: missed.value }));
    settingsPlace.replaceChildren(
      el('h2', { class: 'linked-from-title' }, 'Planner settings'),
      el('div', { class: 'contact-details' },
        ...hours('Planned work', 'work_minutes'), ...hours('Buffer', 'buffer_minutes'),
        ...time('The day starts', 'day_start'), ...time('Afternoon from', 'split'), ...time('The day ends', 'day_end'),
        el('label', { class: 'detail-label' }, 'No estimate counts'), el('span', { class: 'settings-unit' }, minutes, ' min'),
        el('label', { class: 'detail-label' }, 'A missed task'), missed),
    );
  }

  // ---- Drawing ----

  const box = (task) => {
    const button = el('button', {
      type: 'button', class: 'task-box', role: 'checkbox', 'aria-checked': String(task.done),
      'aria-label': task.done ? `Done: ${task.text}. Untick` : `Tick “${task.text}” when done`,
      onclick: () => change(task, { done: !task.done }),
    });
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    return button;
  };
  const minutesChip = (task) => el('span', { class: 'due-chip' }, task.estimate ? estimateLabel(task.estimate) : `${((view === 'week' ? week : plan) ?? plan ?? week).settings.no_estimate_minutes} min?`);

  // A task you can drag: from the Tray, or from one part of the day to another.
  function draggable(node, task) {
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-task', task.id);
      e.dataTransfer.effectAllowed = 'move';
      node.classList.add('is-dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('is-dragging'));
  }
  // A place a task can be let go on.
  function dropTarget(node, onDrop) {
    node.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('text/x-task')) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.add('is-drop-target');
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('is-drop-target'); });
    node.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-task');
      node.classList.remove('is-drop-target');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      if (id.startsWith('template:')) {
        // A routine: its task is made on this day first, then put where it was let go.
        if (view === 'week') return;
        fromTemplate(id, { due: day, plan_part: 'morning' }).then((task) => { plan.tasks.push(task); onDrop(task, e); }).catch((err) => { status.textContent = err.message; });
        return;
      }
      const shown = view === 'week' ? week : plan;
      const tasks = view === 'week' ? week.days.flatMap((d) => d.tasks) : plan.tasks;
      const task = [...tasks, ...shown.tray.missed, ...(shown.tray.upcoming ?? []), ...shown.tray.no_day, ...shown.tray.speedies].find((t) => t.id === id);
      if (task) onDrop(task, e);
    });
  }

  // Routines (Calendar in depth): the templates of what you repeat for yourself, as chips above the day. A chip dragged into the
  // day makes a task there (dotted: it came from a routine), placed like any task, never an event.
  function drawRoutines() {
    routinePlace.hidden = !moduleOn('calendar-plus') || view !== 'day';
    if (routinePlace.hidden) return;
    const name = el('input', { class: 'detail-input routine-name', 'aria-label': 'Routine name', placeholder: 'New routine, e.g. Run', maxlength: 100 });
    const minutes = el('input', { type: 'number', class: 'detail-input routine-minutes', 'aria-label': 'Routine length in minutes', min: 5, max: 1440, step: 5, value: '45' });
    const problem = el('span', { class: 'capture-hint', role: 'alert' });
    const add = async () => {
      try { await request('POST', '/api/templates', { title: name.value, minutes: Number(minutes.value) }); await load(); } catch (err) { problem.textContent = err.message; }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    routinePlace.replaceChildren(
      el('h2', { class: 'routine-title', title: 'A routine is a name and a length you drag into a day, like a run or a morning of deep work. It becomes a task there, never an event.' }, 'Routines'),
      ...templates.map((t) => templateChip(t, { onRemove: async () => {
        await request('DELETE', `/api/templates/${t.id}`);
        await load();
        undoPlace.replaceChildren(undoBar(`The routine “${t.title}” was removed.`, async () => { await request('POST', `/api/templates/${t.id}/restore`, {}); await load(); }));
      } })),
      el('span', { class: 'routine-add' }, name, minutes, el('button', { type: 'button', class: 'button button-quiet', onclick: add }, 'Add routine')),
      problem);
  }
  // A routine dropped on the day: the task it makes, placed (one write).
  const fromTemplate = (id, changes) => request('POST', `/api/templates/${id.slice('template:'.length)}/place`, changes);

  // Pin to a time (Calendar in depth): a placed task keeps its place and takes a time and a length of its own. It is a
  // task still (its box, its home) and it is on the Planner only, never the Calendar; the budget counts the pinned length.
  function openPin(task) {
    const dayBox = el('input', { type: 'date', class: 'search-input', 'aria-label': 'Day', value: isDay(task.due) ? task.due : day, required: true });
    const startBox = el('input', { type: 'time', class: 'search-input', 'aria-label': 'Start', value: task.pin_at || task.plan_at || '09:00', required: true });
    const lengthBox = el('input', { type: 'number', class: 'search-input', 'aria-label': 'Length in minutes', min: 5, max: 1440, step: 5, value: String(task.pin_minutes || task.estimate || 30), required: true });
    const problem = el('p', { class: 'capture-problem', role: 'alert' });
    const save = async (changes) => {
      try { await api.changeTask(task.id, changes); pinDialog.close(); await load(); } catch (err) { problem.textContent = err.message; }
    };
    pinDialog.replaceChildren(
      el('h2', { class: 'event-read-title' }, task.pin_at ? 'Change the pin' : 'Pin to a time'),
      el('p', { class: 'capture-hint' }, `“${task.text}” keeps its place and holds this time. It stays a task, and it never goes on your Calendar.`),
      el('div', { class: 'pin-fields' },
        el('label', { class: 'pin-field' }, 'Day', dayBox),
        el('label', { class: 'pin-field' }, 'Start', startBox),
        el('label', { class: 'pin-field' }, 'Length (minutes)', lengthBox)),
      problem,
      el('div', { class: 'capture-foot' },
        ...(task.pin_at ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => save({ pin_at: '' }) }, 'Unpin')] : []),
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => pinDialog.close() }, 'Cancel'),
        el('button', {
          type: 'button', class: 'button button-primary',
          onclick: () => {
            const minutes = Number(lengthBox.value);
            if (!isDay(dayBox.value) || !/^\d\d:\d\d$/.test(startBox.value) || !(minutes >= 5)) { problem.textContent = 'Choose a day, a start and a length of 5 minutes or more.'; return; }
            save({ due: dayBox.value, plan_part: partAt(minutesOf(startBox.value)), plan_at: startBox.value, pin_at: startBox.value, pin_minutes: minutes, block_id: null });
          },
        }, 'Pin')));
    pinDialog.showModal();
    startBox.focus();
  }

  // Makes a task the day's Highlight; z (or Undo) gives the one it replaced back.
  async function makeHighlight(task) {
    try {
      const { previous } = await plannerApi.highlight(day, task.id);
      highlightUndo.push({ day, previous });
      undoPlace.replaceChildren(undoBar(`“${task.text}” is the Highlight.`, () => undoHighlight()));
    } catch (err) {
      status.textContent = err.message;
    }
    await load();
  }
  async function undoHighlight() {
    const last = highlightUndo.pop();
    if (!last) return;
    await plannerApi.highlight(last.day, last.previous);
    undoPlace.replaceChildren();
    await load();
  }

  // A task placed in the day: a dashed slot, because it can move.
  function slot(task, { highlight = false } = {}) {
    // A task in a journal entry belongs to that entry's day: it can't be taken out of it.
    const fixed = task.source.kind === 'entry' && task.source.day === day;
    const node = el('div', { class: `${highlight ? 'plan-slot is-highlight' : 'plan-slot'}${task.pin_at ? ' is-pinned' : ''}${task.template_id ? ' is-routine' : ''}`, 'data-task': task.id, 'data-checked': String(task.done), tabindex: 0 },
      box(task),
      highlight ? el('span', { class: 'highlight-label' }, 'Highlight') : null,
      starButton(task, () => load()),
      task.flag ? flagChip(task.flag) : null,
      taskWords(task, 'plan-slot-text'),
      task.pin_at ? el('span', { class: 'pin-mark', title: 'Pinned to a time' }, icon('pin'), 'Pinned') : null,
      minutesChip(task),
      moduleOn('calendar-plus') && !task.done && task.plan_part ? el('button', {
        type: 'button', class: 'button button-quiet plan-pin', 'aria-label': `Pin “${task.text}” to a time`, onclick: () => openPin(task),
      }, task.pin_at ? 'Change pin' : 'Pin to a time') : null,
      highlight || task.done ? null : el('button', {
        type: 'button', class: 'button button-quiet plan-make-highlight', title: 'Make it the day’s Highlight',
        'aria-label': `Make “${task.text}” the Highlight`, onclick: () => makeHighlight(task),
      }, 'Highlight'),
      fixed ? null : el('button', {
        type: 'button', class: 'plan-out', 'aria-label': `Take “${task.text}” out of the day`, title: 'Back to Tasks to place',
        onclick: () => unplan(task),
      }, icon('close')));
    draggable(node, task);
    return node;
  }

  // A task's words: a long one shows its few words (by the assistant); a click on them opens
  // the whole text, and another click folds it again.
  function taskWords(task, className) {
    if (!task.short_text) return el('span', { class: className }, task.text);
    const words = el('button', {
      type: 'button', class: `${className} task-short`, 'aria-expanded': 'false', title: task.text,
      onclick: (e) => {
        e.stopPropagation();
        const open = words.getAttribute('aria-expanded') !== 'true';
        words.setAttribute('aria-expanded', String(open));
        words.textContent = open ? task.text : task.short_text;
      },
    }, task.short_text);
    return words;
  }

  // A task waiting to be placed. A missed one on today's Planner comes back with Today;
  // anything else is placed in the day shown.
  function trayRow(task, { missed = false, upcoming = false, onDay = false } = {}) {
    const backToday = missed && (view === 'week' || day === today());
    // Under its words, one quiet line: how long, which day (missed or coming), Must.
    const meta = [
      minutesChip(task).textContent,
      ...(missed ? [`${dueLabel(task.due)} · missed`] : upcoming ? [dueLabel(task.due)] : []),
      ...(task.flag === 'must' ? ['Must'] : []),
    ].join(' · ');
    const node = el('div', { class: 'tray-row', 'data-task': task.id, 'data-checked': String(task.done), tabindex: 0 },
      box(task),
      el('span', { class: 'tray-text' }, taskWords(task, 'tray-words'), el('span', { class: 'tray-meta' }, meta)),
      onDay && task.done ? null : el('button', {
        type: 'button', class: 'button tray-place',
        onclick: () => (backToday ? change(task, { due: today(), plan_part: '', block_id: null }, `“${task.text}” is back on today.`) : place(task)),
      }, backToday ? 'Today' : 'Place'));
    node.addEventListener('keydown', (e) => {
      if (e.target !== node) return;
      if (missed && e.key === 't') { e.preventDefault(); change(task, { due: today(), plan_part: '', block_id: null }, `“${task.text}” is back on today.`); }
      if (!missed && (e.key === 'Enter' || e.key === 'p')) { e.preventDefault(); place(task); }
    });
    draggable(node, task);
    return node;
  }

  // The day's tasks without a place on its hours yet (done ones too, ticked).
  const unplaced = () => (plan ? plan.tasks.filter((t) => !t.block_id && !t.plan_part) : []);

  // Tasks to place: Today (the day's own tasks without a place yet), Missed (an earlier
  // day's, not done), Upcoming (a later day's, to pull in early), No date (the shortest,
  // the Speedies, last).
  function drawTray(waiting) {
    const group = (name, tasks, options) => (tasks.length ? [
      el('h3', { class: 'tray-group' }, `${name} · ${tasks.length}`),
      el('div', { class: options?.onDay ? 'tray-rows is-day' : 'tray-rows', role: 'list', 'aria-label': name }, ...tasks.map((t) => trayRow(t, options))),
    ] : []);
    const upcoming = view === 'week' ? [] : waiting.upcoming ?? [];
    const noDate = [...waiting.no_day, ...waiting.speedies];
    const onDay = view === 'week' ? [] : unplaced();
    tray.replaceChildren(
      el('h2', { class: 'tray-title' }, 'Tasks to place'),
      ...group(day === today() ? 'Today' : dateOf(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }), onDay, { onDay: true }),
      ...group('Missed', waiting.missed, { missed: true }),
      ...group('Upcoming', upcoming, { upcoming: true }),
      ...group('No date', noDate),
      ...(onDay.length + waiting.missed.length + upcoming.length + noDate.length ? []
        : [el('p', { class: 'empty' }, 'Nothing waits to be placed.')]),
      el('p', { class: 'capture-hint' }, view === 'week' ? 'Drag a task onto a day.' : 'Drag a task onto the day, or press Place.'),
    );
  }

  // ---- The week strip: the days of this week, a click opens one ----

  function drawDayStrip() {
    if (!stripWeek) { dayStrip.replaceChildren(); return; }
    const count = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : '');
    dayStrip.replaceChildren(...stripWeek.days.map((d) => {
      const load = dayLoad(d, d.day, stripWeek.settings);
      const timed = d.events.filter((e) => !e.all_day).length;
      const what = [count(timed, 'event', 'events'), count(d.tasks.length, 'task', 'tasks')].filter(Boolean).join(' · ') || 'Free';
      const date = dateOf(d.day);
      return el('button', {
        type: 'button', class: `day-strip-day${d.day === stripWeek.today ? ' is-today' : ''}`, 'data-day': d.day,
        'aria-pressed': String(d.day === day), 'aria-label': `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${what}${load.over > 0 ? `, over by ${duration(load.over)}` : ''}`,
        onclick: () => go(d.day),
      },
      el('span', { class: 'day-strip-name' }, el('b', {}, date.toLocaleDateString(undefined, { weekday: 'short' })), ` ${date.getDate()}`),
      el('span', { class: 'day-strip-what' }, what),
      el('span', { class: `load-bar${load.over > 0 ? ' is-over' : ''}` },
        el('span', { class: 'load-fill', style: `width: ${Math.min(100, (load.planned / load.budget) * 100)}%` })));
    }));
  }

  // ---- Plan my day: what is still free, tick what belongs ----

  function openPlanDay() {
    const free = Math.max(0, budgetOf().budget - budgetOf().planned);
    const waiting = plan.tray;
    const groups = [
      [day === today() ? 'Today' : 'This day', unplaced().filter((t) => !t.done)],
      ['Missed', waiting.missed],
      ['Upcoming', waiting.upcoming ?? []],
      ['No date', [...waiting.no_day, ...waiting.speedies]],
    ].filter(([, tasks]) => tasks.length);
    const picked = new Set();
    const tally = el('p', { class: 'plan-dialog-tally', role: 'status' });
    const showTally = () => {
      const minutes = [...picked].reduce((n, t) => n + taskMinutes(t, plan.settings), 0);
      tally.textContent = picked.size ? `Picked ${duration(minutes)} · ${minutes > free ? `${duration(minutes - free)} more than is free` : `${duration(free - minutes)} still free`}` : '';
    };
    const row = (task) => {
      const tick = el('input', { type: 'checkbox', class: 'plan-dialog-tick', onchange: () => { if (tick.checked) picked.add(task); else picked.delete(task); showTally(); } });
      const meta = [taskMinutes(task, plan.settings) && (task.estimate ? estimateLabel(task.estimate) : `${plan.settings.no_estimate_minutes} min?`),
        isDay(task.due) ? dueLabel(task.due) : '', task.flag === 'must' ? 'Must' : ''].filter(Boolean).join(' · ');
      return el('label', { class: 'plan-dialog-row', title: task.text }, tick, el('span', { class: 'plan-dialog-text' }, task.short_text || task.text, el('span', { class: 'plan-dialog-meta' }, meta)));
    };
    const title = day === today() ? 'Plan my day' : `Plan ${dateOf(day).toLocaleDateString(undefined, { weekday: 'long' })}`;
    planDialog.replaceChildren(
      el('h2', { class: 'event-read-title' }, title),
      el('p', { class: 'plan-dialog-free' }, free > 0 ? `${duration(free)} of the day ${free === 1 ? 'is' : 'are'} still free. Pick what belongs in it.` : 'The day is full already. Pick only what must be in it.'),
      ...(groups.length ? groups.flatMap(([name, tasks]) => [el('h3', { class: 'shutdown-title' }, name), ...tasks.map(row)])
        : [el('p', { class: 'empty' }, 'Nothing is waiting.')]),
      tally,
      el('div', { class: 'capture-foot' },
        el('button', { type: 'button', class: 'button button-quiet plan-dialog-steps', onclick: () => { planDialog.close(); togglePanel(true); } }, 'Step by step instead'),
        el('span', { class: 'event-actions' },
          el('button', { type: 'button', class: 'button button-quiet', onclick: () => planDialog.close() }, 'Cancel'),
          el('button', { type: 'button', class: 'button button-primary', onclick: () => putInTheDay([...picked]) }, 'Put them in the day'))),
    );
    planDialog.showModal();
    planDialog.querySelector('.plan-dialog-tick')?.focus();
  }

  // Each picked task goes into the first free gap with room for it, in turn.
  async function putInTheDay(tasks) {
    const layout = layoutDay();
    try {
      for (const task of tasks) {
        const spot = freeSpot(layout, task);
        await api.changeTask(task.id, { due: day, plan_part: spot.part, plan_at: timeOf(spot.at), block_id: null });
      }
      planDialog.close();
      status.textContent = tasks.length ? `${tasks.length === 1 ? '1 task' : `${tasks.length} tasks`} put in the day.` : '';
    } catch (err) {
      status.textContent = err.message;
    }
    await load();
  }

  // The shared pieces the week and the planning panel use.
  const ctx = () => ({
    week, plan, day, view, box, minutesChip, draggable, dropTarget, change,
    openDay: (d) => go(d, 'day'),
    openWeek: (monday) => go(monday, 'week'),
    openReview: () => { panelOpen = true; panelKind = 'review'; return load(); },
    planNext: () => { panelOpen = true; panelKind = 'plan'; return go(addDays(week.week, 7), 'week'); },
    close: () => togglePanel(false),
    reload: load,
    makeHighlight,
  });

  async function draw() {
    for (const button of viewSwitch.children) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    planButton.textContent = view === 'week' ? 'Plan my week' : day === today() ? 'Plan my day' : 'Plan this day';
    earlier.setAttribute('aria-label', `The ${view} before`);
    later.setAttribute('aria-label', `The ${view} after`);
    planButton.setAttribute('aria-expanded', String(panelOpen && panelKind === 'plan'));
    const inQuarter = view === 'quarter';
    suggestPlace.hidden = !plans.length;
    suggestPlace.replaceChildren(...(plans.length ? [
      el('h2', { class: 'plan-suggestions-title' }, icon('assistant'), 'Your assistant suggests'),
      ...plans.map((card) => cardNode(card, () => load())),
    ] : []));
    layout.classList.toggle('is-quarter', inQuarter);
    tray.hidden = inQuarter;
    planButton.hidden = inQuarter;
    dayColumn.hidden = view !== 'day';
    weekPlace.hidden = view !== 'week';
    quarterPlace.hidden = !inQuarter;
    panelPlace.hidden = !panelOpen || inQuarter;
    if (inQuarter) {
      dayLabel.textContent = quarterLabel(quarter.look_back);
      document.title = `Planner · ${quarter.look_back.name}`;
      quarterPlace.replaceChildren(...quarterBoard(quarter, ctx()));
      giveCursorBack(quarterPlace);
      settingsPlace.hidden = true;
      askPlace.replaceChildren();
      return;
    }
    if (panelOpen) {
      // Only the latest panel goes on the page: an older one that answers late would put
      // back what it read then (and what was typed then).
      const mine = ++panels;
      const parts = await (view === 'week' && panelKind === 'review' ? reviewPanel(ctx()) : planningPanel(view === 'week' ? 'weekly' : 'daily', ctx()));
      if (mine === panels) { panelPlace.replaceChildren(...parts); giveCursorBack(panelPlace); }
    }
    if (view === 'week') {
      const first = new Date(`${week.week}T12:00`);
      const last = new Date(`${addDays(week.week, 6)}T12:00`);
      dayLabel.textContent = `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      document.title = 'Planner · Week';
      drawTray(week.tray);
      weekPlace.replaceChildren(...weekBoard(week, ctx()));
      settingsPlace.hidden = true;
      askPlace.replaceChildren();
      return;
    }
    const { tray: waiting } = plan;
    drawDayStrip();
    drawBudget();
    drawSettings();
    drawAsk();
    dayLabel.textContent = `${day === today() ? 'Today, ' : ''}${dateOf(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
    document.title = `Planner · ${dueLabel(day)}`;
    drawTray(waiting);

    // This week's goals, above the day.
    const goals = plan.week_goals;
    goalsPlace.replaceChildren(...(goals.length ? [
      el('h2', { class: 'week-goals-title' }, `This week’s goals · ${goals.length} of ${plan.weekly_goals_max}`),
      ...goals.map((t) => el('span', { class: t.done ? 'week-goal is-done' : 'week-goal' }, `★ ${t.text}`,
        el('span', { class: 'week-goal-day' }, ` · ${/^\d{4}-/.test(t.due) ? dueLabel(t.due) : 'no day'}`))),
      ...(goals.length > plan.weekly_goals_max ? [el('span', { class: 'plan-warning' }, `${goals.length} Weekly Goals: five keep a week clear`)] : []),
    ] : []));

    const parts = partsOf();
    const hours = layoutDay();
    const highlight = plan.tasks.find((t) => t.id === plan.highlight_id);
    // Calendar in depth: the day as its order, or several days in hours, drawn from the same plan.
    const lensOn = moduleOn('calendar-plus');
    lensBar.hidden = !lensOn;
    drawRoutines();
    lensControl.show({ lens, range });
    let other = null;
    if (lensOn && lens === 'order') {
      other = orderView(columnOf(plan, hours, day), {
        onToggle: (id, done) => change({ id }, { done }),
        onPin: (id) => { const t = plan.tasks.find((x) => x.id === id); if (t) openPin(t); },
      });
    } else if (lensOn && lens === 'hours' && range !== 'day') {
      const first = range === '7' ? weekStart(day) : day;
      const days = Array.from({ length: Number(range) }, (_, i) => addDays(first, i));
      const mine = ++grids;
      const plansOf = await Promise.all(days.map((d) => (d === day ? plan : plannerApi.day(d))));
      if (mine !== grids) return;
      other = hourGrid(plansOf.map((p, i) => columnOf(p, layoutOfPlan(p, days[i]), days[i])), {
        onPin: (id) => { const t = plansOf.flatMap((p) => p.tasks).find((x) => x.id === id); if (t) openPin(t); },
        // A task let go in a gap of a day takes that place: its day, and a time inside the gap that puts it where the pointer was.
        onDrop: async (id, d, minutes) => {
          const done = startTiming('Drop a task');
          status.textContent = '';
          if (id.startsWith('template:')) {
            try { await fromTemplate(id, { due: d, plan_part: minutes < minutesOf(plan.settings.split) ? 'morning' : 'afternoon', plan_at: timeOf(minutes) }); } catch (err) { status.textContent = err.message; }
            await load();
            done();
            return;
          }
          try { await api.changeTask(id, { due: d, plan_part: minutes < minutesOf(plan.settings.split) ? 'morning' : 'afternoon', plan_at: timeOf(minutes), block_id: null }); } catch (err) { status.textContent = err.message; }
          await load();
          done();
        },
        label: (c) => el('span', {}, dateOf(c.day).toLocaleDateString(undefined, { weekday: 'short' }), el('span', { class: 'hour-grid-date' }, ` ${dateOf(c.day).getDate()}`)),
      });
      dayLabel.textContent = `${dateOf(days[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${dateOf(days[days.length - 1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    dayPlace.replaceChildren(
      ...(plan.closed?.closed ? [closedBar(plan.closed, day, { reopen: reopenTheDay })] : []),
      // The Highlight, always at the top of the day.
      ...(highlight ? [el('section', { class: 'plan-highlight', 'aria-label': 'Highlight' }, slot(highlight, { highlight: true }))] : []),
      ...(other ? [other] : hours.bands.map((band) => bandNode(band, hours, parts.find((p) => p.key === band.key)))),
      ...(canClose() ? [el('button', { type: 'button', class: 'button button-quiet plan-close-day', onclick: closeTheDay }, icon('moon'), 'Close the day (⇧X)')] : []),
    );
  }

  // Let go on the Tray: back to waiting for a day.
  dropTarget(tray, (task) => (task.due === day ? unplan(task) : null));
  await load();
}
