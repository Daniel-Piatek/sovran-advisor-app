// The Calendar (time/1): what is fixed in your days, and nothing else. Tasks never come
// here, not even the ones with a date: that is the planner's job (next lesson).
//   /calendar              this week (on a phone: today)
//   /calendar/YYYY-MM-DD   the week (or ?view=day, the day; ?view=3, that day and the next two) with that day
// An event is a block whose height is its length, with a line on its left in its
// calendar's colour (your own events: the text colour). A thin line marks now.
// New event (or a click in an empty hour) opens the event dialog; a click on an event
// opens it to change or delete (with Undo). Drag a block to move it, or select it and
// use the arrow keys: ↑↓ a quarter of an hour, ←→ a day; Enter opens it.
// Your other calendars (by iCal link, under the week) show beside your own, read-only,
// each in its colour; their whole-day events sit in a row above the hours.

import {
  el, icon, undoBar, request, dayOf, today, dateOf, addDays, weekStart, weekdayName, dayNumber, isDay, timeAgo, linkedFromSection,
} from './ui.js';
import { moduleOn } from './modules.js';
import { readEvent } from './event-words.js';
import { startTiming } from './timings.js';
import { app, screen, onLeave, setFooterLink, recentlyDeletedLink, navigate } from './shell.js';

const HOUR_PX = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')) || 48;
const STEP = 15; // minutes: what a move snaps to
const pad = (n) => String(n).padStart(2, '0');

// The G mark (Calendar in depth 7, 8): a small G in a square on an event that is in Google Calendar. Dashed while a change of it is
// waiting to go, a ring when it changed in both places, struck when it was not saved. Always a shape and a word in its tooltip.
const SYNC_WORDS = { '': 'In Google Calendar', waiting: 'Waiting to go to Google', clash: 'Changed in both places: decide in Google changes', failed: 'Not saved to Google yet' };
export const gMark = (sync = '') => el('span', { class: `g-mark${sync ? ` is-${sync}` : ''}`, title: SYNC_WORDS[sync] ?? SYNC_WORDS[''], 'aria-label': SYNC_WORDS[sync] ?? SYNC_WORDS[''] }, 'G');
// The Answer bar (Calendar in depth 9): Yes · Maybe · No, your choice raised. Without `onAnswer` it only shows the answer.
export function answerBar(response, { onAnswer = null } = {}) {
  return el('div', { class: 'answer-bar', role: 'group', 'aria-label': 'Your answer' },
    ...[['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']].map(([value, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(response === value), ...(onAnswer ? { onclick: () => onAnswer(value) } : { disabled: true }),
    }, label)));
}
const ANSWERS = { accepted: 'Accepted', declined: 'Declined', tentative: 'Maybe', needsAction: 'No answer yet' };

// What Google knows about an event beyond its time: the Meet link, the guests with their answers, and a link into Google (Calendar in depth 7 and 9).
function googleRows(event) {
  return [
    ...(event.google?.meet_url ? [el('span', { class: 'detail-label' }, 'Video'), el('a', { href: event.google.meet_url, target: '_blank', rel: 'noopener noreferrer' }, 'Join with Google Meet')] : []),
    ...(event.google?.attendees?.length ? [el('span', { class: 'detail-label' }, 'Guests'),
      el('span', { class: 'event-guests' }, ...event.google.attendees.map((a) => el('span', { class: 'event-guest', 'data-response': a.response },
        `${a.name || a.email}${a.self ? ' (you)' : ''}${a.organizer ? ' · organiser' : ''} · `, el('strong', {}, ANSWERS[a.response] ?? a.response))))] : []),
    ...(event.google?.html_link ? [el('span', { class: 'detail-label' }, 'In Google'), el('a', { href: event.google.html_link, target: '_blank', rel: 'noopener noreferrer' }, 'Open it in Google Calendar')] : []),
  ];
}

// The Calendar link row (advanced/calendar/1): a link's dot (its colour, a button), its name, when it was last read
// (or what went wrong), Read now and Remove. It is also drawn on the Library page.
export function calendarLinkRow(calendar, { colour = () => {}, read = () => {}, remove = () => {} } = {}) {
  return el('div', { class: 'cal-calendar', 'data-calendar-link': calendar.name },
    el('button', {
      type: 'button', class: 'cal-dot', style: `background: ${COLOUR[calendar.colour]}`,
      'aria-label': `Change ${calendar.name}’s colour`, title: 'Change its colour', onclick: colour,
    }),
    el('span', { class: 'cal-calendar-name' }, calendar.name),
    el('span', { class: 'cal-calendar-state' }, calendar.problem || (calendar.fetched_at ? `read ${timeAgo(calendar.fetched_at)}` : 'not read yet')),
    el('button', { type: 'button', class: 'button button-quiet', onclick: read }, 'Read now'),
    el('button', { type: 'button', class: 'button button-quiet', onclick: remove }, 'Remove'));
}
const minutesOf = (at) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
const atOf = (day, minutes) => `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
// Moves a moment by some days and minutes. Days move the date and keep the clock time,
// so a day is a day even when the clocks change (a day of 23 or 25 hours).
function shiftAt(at, minutes, days = 0) {
  const date = new Date(`${at}:00`);
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() + minutes);
  return `${dayOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const clock = (at) => new Date(`${at}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const isPhone = () => matchMedia('(max-width: 600px)').matches;

export const calendarsApi = {
  list: () => request('GET', '/api/calendars'),
  add: (calendar) => request('POST', '/api/calendars', calendar),
  update: (id, changes) => request('PATCH', `/api/calendars/${id}`, changes),
  own: () => request('GET', '/api/calendars/own'),
  setOwn: (colour) => request('PATCH', '/api/calendars/own', { colour }),
  read: (id) => request('POST', `/api/calendars/${id}/read`, {}),
  remove: (id) => request('DELETE', `/api/calendars/${id}`),
  restore: (id) => request('POST', `/api/calendars/${id}/restore`, {}),
};
// The six calendar colours (tokens.css), by number.
const COLOUR = { 1: 'var(--cal-1)', 2: 'var(--cal-2)', 3: 'var(--cal-3)', 4: 'var(--cal-4)', 5: 'var(--cal-5)', 6: 'var(--cal-6)' };
// An event's colour: its calendar's, or for your own events, My events' colour.
const colourOf = (event) => event.calendar?.colour ?? event.colour;
const lineOf = (event) => (COLOUR[colourOf(event)] ? `border-left-color: ${COLOUR[colourOf(event)]};` : '');
export const eventLine = lineOf;
// The pale fill behind an event's title, in its calendar's colour.
const FILL = { 1: 'var(--cal-1-fill)', 2: 'var(--cal-2-fill)', 3: 'var(--cal-3-fill)', 4: 'var(--cal-4-fill)', 5: 'var(--cal-5-fill)', 6: 'var(--cal-6-fill)' };
export const eventFill = (event) => (FILL[colourOf(event)] ? `background: ${FILL[colourOf(event)]};` : '');

// The Sentence preview (Calendar in depth): what Enter will make, as chips: the title, the day, the time, the length and who with.
// What it guessed (no time, no length) says so in words, so a wrong chip is fixed before anything exists.
export function sentencePreview(got) {
  const day = dateOf(got.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const at = (hm) => new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const long = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
  const chip = (kind, text, guessed = '') => el('span', { class: `words-chip${guessed ? ' is-guess' : ''}`, 'data-chip': kind }, text, guessed ? el('span', { class: 'words-chip-guess' }, ` · ${guessed}`) : null);
  return el('div', { class: 'words-chips' },
    got.title ? chip('title', got.title) : el('span', { class: 'words-chip is-guess', 'data-chip': 'title' }, 'No name yet'),
    chip('day', day, got.found.day ? '' : 'today'),
    chip('time', `${at(got.start)}–${at(got.end)}`, got.found.time ? '' : 'no time given'),
    chip('length', long(got.minutes), got.found.length ? '' : 'an hour unless you say'),
    ...got.people.map((p) => el('span', { class: 'words-chip', 'data-chip': 'person' }, icon('person'), p.name)));
}

export const eventsApi = {
  list: (from, to) => request('GET', `/api/events?from=${from}&to=${to}`),
  create: (event) => request('POST', '/api/events', event),
  // A Google event (its id starts with google:) is changed through the outbox (Calendar in depth 8): it shows at once and goes to Google.
  update: (id, changes) => request('PATCH', String(id).startsWith('google:') ? `/api/gevents/${id.slice('google:'.length)}` : `/api/events/${id}`, changes),
  remove: (id) => request('DELETE', `/api/events/${id}`),
  restore: (id) => request('POST', `/api/events/${id}/restore`, {}),
  note: (id) => request('POST', '/api/events/note', { id }),
  at: (id) => request('GET', `/api/events/at/${id}`),
};

// A note about an event: the one there is, or a new one that links to it. It opens.
export async function noteAbout(event) {
  const { note } = await eventsApi.note(event.id);
  await navigate(`/notes/${note.id}`);
}

// /calendar/events/:id (where a note's link to an event goes): that day, with the event open.
export async function showCalendarEvent(id) {
  try {
    const event = await eventsApi.at(id);
    await navigate(`/calendar/${event.starts_at.slice(0, 10)}?view=day&open=${id}`, { replace: true });
  } catch {
    screen.replaceChildren(el('p', { class: 'empty' }, "That event isn't in your calendar any more."));
  }
}

// What an event's dialog shows below it: Note (or Open note) and the notes about it.
function notesPart(event, close) {
  const button = el('button', {
    type: 'button', class: 'button',
    onclick: async () => { close(); await noteAbout(event); },
  }, icon('notes'), event.note_id ? 'Open note' : 'Note');
  return [button, ...(event.ref_id ? [linkedFromSection('event', event.ref_id, { title: 'Notes about it', none: 'No notes about it yet.' })] : [])];
}

// The parts of an event that fall on one day, as minutes from midnight.
function partOn(event, day) {
  const start = event.starts_at.slice(0, 10) < day ? 0 : event.starts_at.slice(0, 10) > day ? null : minutesOf(event.starts_at);
  const end = event.ends_at.slice(0, 10) > day ? 24 * 60 : event.ends_at.slice(0, 10) < day ? null : minutesOf(event.ends_at);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

// Events that overlap share the width of the day, side by side.
function layOut(parts) {
  const sorted = [...parts].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const finish = () => {
    const columns = Math.max(1, ...cluster.map((p) => p.column + 1));
    for (const p of cluster) p.columns = columns;
    cluster = [];
  };
  for (const part of sorted) {
    if (part.start >= clusterEnd) { finish(); clusterEnd = -1; }
    const taken = new Set(cluster.filter((p) => p.end > part.start).map((p) => p.column));
    part.column = 0;
    while (taken.has(part.column)) part.column++;
    cluster.push(part);
    placed.push(part);
    clusterEnd = Math.max(clusterEnd, part.end);
  }
  finish();
  return placed;
}

export async function showCalendar(dayParam) {
  const params = new URLSearchParams(location.search);
  let toOpen = params.get('open'); // an event to open once the day is drawn (its id, or its note's link)
  const asked = params.get('view');
  let view = ['day', '3', 'week'].includes(asked) ? asked : (isPhone() ? 'day' : 'week');
  let day = isDay(dayParam) ? dayParam : today();
  let events = [];
  let selectedId = null;
  document.title = 'Calendar';
  app.className = 'page page-wide calendar-page';

  const rangeLabel = el('span', { class: 'cal-range' });
  const viewSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'View' },
    ...[['day', 'Day'], ['3', '3 days'], ['week', 'Week']].map(([name, label]) => el('button', {
      type: 'button', class: 'switch-button switch-button-text', 'data-view': name,
      onclick: () => { view = name; go(); },
    }, label)));
  const grid = el('div', { class: 'cal' });
  const status = el('p', { class: 'journal-tools-message', role: 'status' });
  const undoPlace = el('div', {});
  const extra = el('section', { class: 'cal-calendars', 'aria-label': 'Your calendars' });

  screen.replaceChildren(
    el('header', { class: 'top-bar cal-bar' },
      el('h1', { class: 'top-bar-title' }, 'Calendar'),
      el('button', { type: 'button', class: 'button button-primary page-add', onclick: () => openDialog(null) }, icon('plus'), 'New event'),
      el('div', { class: 'cal-nav' },
        el('button', { type: 'button', class: 'button', 'aria-label': 'Earlier', onclick: () => { day = addDays(day, -step()); go(); } }, icon('left')),
        rangeLabel,
        el('button', { type: 'button', class: 'button', 'aria-label': 'Later', onclick: () => { day = addDays(day, step()); go(); } }, icon('right')),
        el('button', { type: 'button', class: 'button', onclick: () => { day = today(); go(); } }, 'Today')),
      viewSwitch,
      ...(moduleOn('calendar-plus') ? [el('button', { type: 'button', class: 'button', title: 'Type it as you would say it (⌘K)', onclick: () => openWords() }, 'In words')] : [])),
    status,
    grid,
    extra,
    undoPlace,
  );
  setFooterLink(recentlyDeletedLink());

  const days = () => (view === 'day' ? [day]
    : view === '3' ? Array.from({ length: 3 }, (_, i) => addDays(day, i))
    : Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i)));
  const step = () => (view === 'day' ? 1 : view === '3' ? 3 : 7);

  async function go() {
    history.replaceState(null, '', `/calendar/${day}?view=${view}`);
    await load();
    if (toOpen) {
      const event = events.find((e) => e.id === toOpen || e.ref_id === toOpen);
      toOpen = null;
      if (event) openDialog(event);
    }
  }

  async function load() {
    const shown = days();
    try {
      events = await eventsApi.list(shown[0], shown.at(-1));
      drawCalendars();
    } catch {
      status.textContent = "The calendar couldn't be loaded. Is the app still running?";
      return;
    }
    draw();
  }

  let scrolled = false;
  function draw() {
    const shown = days();
    const hour = HOUR_PX();
    const first = dateOf(shown[0]);
    const last = dateOf(shown.at(-1));
    rangeLabel.textContent = view === 'day'
      ? first.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    for (const button of viewSwitch.children) button.setAttribute('aria-pressed', String(button.dataset.view === view));

    const head = el('div', { class: 'cal-head' }, el('span', { class: 'cal-gutter' }),
      ...shown.map((d) => el('button', {
        type: 'button', class: 'cal-day-name', 'aria-current': d === today() ? 'date' : false,
        onclick: () => { day = d; view = 'day'; go(); },
      }, el('span', {}, weekdayName(d, 'short')), el('span', { class: 'cal-day-number' }, String(dayNumber(d))))));

    // Whole days, above the hours.
    const allDay = events.filter((e) => e.all_day);
    const dayRow = allDay.length ? el('div', { class: 'cal-allday', style: '' }, el('span', { class: 'cal-gutter cal-allday-label' }, 'all day'),
      ...shown.map((d) => el('div', { class: 'cal-allday-day' }, ...allDay
        .filter((e) => e.starts_at.slice(0, 10) <= d && e.ends_at.slice(0, 10) > d)
        .map((e) => el('button', { type: 'button', class: 'cal-allday-event', style: `${lineOf(e)} ${eventFill(e)}`, onclick: () => openDialog(e) }, e.source === 'google' ? gMark(e.google?.sync) : null, e.title))))) : null;
    const hourName = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
    const hours = el('div', { class: 'cal-hours' }, ...Array.from({ length: 24 }, (_, h) => el('span', { class: 'cal-hour' }, h ? hourName(h) : '')));
    const columns = shown.map((d) => {
      const column = el('div', { class: 'cal-column', 'data-day': d },
        ...Array.from({ length: 24 }, () => el('div', { class: 'cal-slot', 'aria-hidden': 'true' })));
      const parts = layOut(events.filter((e) => !e.all_day).map((event) => ({ event, ...partOn(event, d) })).filter((p) => p.start !== undefined));
      for (const part of parts) column.append(block(part, d, hour));
      if (d === today()) {
        const now = new Date();
        column.append(el('div', { class: 'cal-now', style: `top: ${((now.getHours() * 60 + now.getMinutes()) / 60) * hour}px`, 'aria-hidden': 'true' }));
      }
      // Draw in empty time (Calendar in depth): press and pull down, in quarters of an hour; a small field asks for the name,
      // Enter makes the event as long as you drew it, Esc lets it go. A plain click still opens the dialog.
      if (moduleOn('calendar-plus')) drawInColumn(column, d, hour);
      // A click in an empty hour: a new event there.
      column.addEventListener('click', (e) => {
        if (e.target !== column || column.dataset.drew === 'true') { column.dataset.drew = ''; return; }
        const minutes = Math.floor(((e.offsetY / hour) * 60) / 30) * 30;
        openDialog(null, { starts_at: atOf(d, Math.min(minutes, 23 * 60)), ends_at: atOf(d, Math.min(minutes + 60, 24 * 60 - 1)) });
      });
      return column;
    });
    const body = el('div', { class: 'cal-body' }, hours, ...columns);
    const template = `var(--entry-when-width) repeat(${shown.length}, minmax(0, 1fr))`;
    head.style.gridTemplateColumns = template;
    body.style.gridTemplateColumns = template;
    if (dayRow) dayRow.style.gridTemplateColumns = template;
    grid.replaceChildren(head, ...(dayRow ? [dayRow] : []), body);
    if (!scrolled) { body.scrollTop = 7.5 * hour; scrolled = true; }
    if (selectedId) grid.querySelector(`[data-event="${selectedId}"]`)?.focus();
  }

  // ---- Draw an event in the hours (Calendar in depth) ----
  let drafting = false; // a draft is open: the grid is not drawn again under it
  function drawInColumn(column, d, hour) {
    column.addEventListener('pointerdown', (down) => {
      if (down.target !== column || down.button !== 0 || down.pointerType === 'touch' || drafting) return;
      const snap = (y) => Math.max(0, Math.min(24 * 60, Math.round(((y / hour) * 60) / 15) * 15));
      const box = column.getBoundingClientRect();
      const from = snap(down.clientY - box.top);
      let to = from;
      let moved = false;
      const draft = el('div', { class: 'cal-draft', 'aria-hidden': 'true' });
      const place = () => {
        const [a, b] = from <= to ? [from, to] : [to, from];
        draft.style.top = `${(a / 60) * hour}px`;
        draft.style.height = `${Math.max(((b - a) / 60) * hour, 2)}px`;
      };
      const move = (e) => {
        const y = snap(e.clientY - column.getBoundingClientRect().top);
        if (!moved && Math.abs(e.clientY - down.clientY) < 6) return;
        if (!moved) { moved = true; column.append(draft); }
        to = y;
        place();
      };
      const up = () => {
        column.removeEventListener('pointermove', move);
        column.removeEventListener('pointerup', up);
        column.removeEventListener('pointercancel', up);
        try { column.releasePointerCapture(down.pointerId); } catch { /* already let go */ }
        if (!moved) return;
        column.dataset.drew = 'true'; // the click that follows is not a click
        let [a, b] = from <= to ? [from, to] : [to, from];
        if (b - a < 15) b = a + 15;
        const stamp = (m) => atOf(d, Math.min(m, 24 * 60 - 1));
        askName(draft, { starts_at: stamp(a), ends_at: stamp(b) });
      };
      column.setPointerCapture(down.pointerId);
      column.addEventListener('pointermove', move);
      column.addEventListener('pointerup', up);
      column.addEventListener('pointercancel', up);
    });
  }
  // The small field on a drawn draft: Enter makes the event, Esc lets it go.
  function askName(draft, times) {
    drafting = true;
    const field = el('input', { class: 'cal-draft-field', 'aria-label': 'Name of the new event', placeholder: 'Name it', maxlength: 300 });
    const close = () => { drafting = false; draft.remove(); };
    field.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!field.value.trim()) return;
      try {
        const made = startTiming('Make an event');
        const saved = await eventsApi.create({ title: field.value, ...times });
        close();
        selectedId = saved.id;
        await go();
        made();
      } catch (err) { field.placeholder = err.message; field.value = ''; }
    });
    field.addEventListener('blur', () => setTimeout(() => { if (drafting && !field.value.trim()) close(); }, 150));
    draft.removeAttribute('aria-hidden');
    draft.setAttribute('aria-label', `New event from ${times.starts_at.slice(11)} to ${times.ends_at.slice(11)}`);
    draft.append(el('span', { class: 'cal-draft-time' }, `${times.starts_at.slice(11)}–${times.ends_at.slice(11)}`), field);
    field.focus();
  }

  function block(part, d, hour) {
    const { event } = part;
    const top = (part.start / 60) * hour;
    const height = Math.max(((part.end - part.start) / 60) * hour, hour * 0.4); // a short one stays readable
    const short = part.end - part.start <= 30;
    const node = el('div', {
      class: `cal-event${short ? ' is-short' : ''}${event.read_only ? ' is-read-only' : ''}${event.google?.invited && event.google.my_response === 'needsAction' ? ' is-invitation' : ''}${event.google?.invited && event.google.my_response === 'declined' ? ' is-declined' : ''}`, tabindex: 0, role: 'button', 'data-event': event.id,
      'aria-label': `${event.title}, ${clock(event.starts_at)} to ${clock(event.ends_at)}${event.calendar ? `, ${event.calendar.name}` : ''}`,
      style: `top: ${top}px; height: ${height}px; left: calc(${(part.column / part.columns) * 100}% + 2px); width: calc(${100 / part.columns}% - 4px); ${lineOf(event)} ${eventFill(event)}`,
    },
    el('span', { class: 'cal-event-title' }, event.source === 'google' ? gMark(event.google?.sync) : null, event.title),
    el('span', { class: 'cal-event-time' }, `${clock(event.starts_at)}–${clock(event.ends_at)}${event.calendar ? ` · ${event.calendar.name}` : ''}`));
    node.addEventListener('focus', () => { selectedId = event.id; });
    if (event.read_only) {
      // Another calendar's: shown, never changed here.
      node.addEventListener('click', () => openDialog(event));
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openDialog(event); } });
      return node;
    }
    node.addEventListener('keydown', (e) => keyOnEvent(e, event));
    dragToMove(node, event, d, hour);
    return node;
  }

  // Moves an event by minutes and days, keeping its length. Moves wait their turn, so
  // quick presses (↓ ↓ ↓) each start from where the last one left the event.
  let moving = Promise.resolve();
  const move = (event, minutes, dayCount = 0) => { moving = moving.then(() => moveNow(event, minutes, dayCount)); return moving; };
  async function moveNow(event, minutes, dayCount) {
    const changes = { starts_at: shiftAt(event.starts_at, minutes, dayCount), ends_at: shiftAt(event.ends_at, minutes, dayCount) };
    try {
      let scope = 'this';
      if (event.source === 'google' && event.google?.recurring) {
        scope = await chooseScope(event);
        if (!scope) { await load(); return; } // let go: it goes back where it was
      }
      const moved = startTiming('Move an event');
      if (scope === 'all') { await eventsApi.update(event.id, { ...changes, scope }); selectedId = event.id; await load(); drawChanges(); moved(); return; }
      Object.assign(event, await eventsApi.update(event.id, changes));
      selectedId = event.id;
      if (!days().includes(event.starts_at.slice(0, 10))) { day = event.starts_at.slice(0, 10); await go(); moved(); return; }
      draw();
      moved();
      if (event.source === 'google') drawChanges(); // the change waits in the Google changes list
    } catch (err) {
      status.textContent = event.source === 'google' && err.status ? err.message : "That couldn't be moved. Is the app still running?";
    }
  }

  function keyOnEvent(e, event) {
    const by = { ArrowUp: [-STEP, 0], ArrowDown: [STEP, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (by) { e.preventDefault(); move(event, ...by); }
    else if (e.key === 'Enter') { e.preventDefault(); openDialog(event); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && event.source !== 'google') { e.preventDefault(); remove(event); }
  }

  // Drag: up and down for the time, across columns for the day. A press without a drag opens it.
  function dragToMove(node, event, d, hour) {
    node.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      const startY = down.clientY;
      const startX = down.clientX;
      let moved = false;
      node.setPointerCapture(down.pointerId);
      const onMove = (e) => {
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dy) < 4 && Math.abs(e.clientX - startX) < 4) return;
        moved = true;
        node.classList.add('is-dragging');
        node.style.transform = `translate(${e.clientX - startX}px, ${Math.round((dy / hour) * 60 / STEP) * STEP / 60 * hour}px)`;
      };
      const onUp = (e) => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.releasePointerCapture(down.pointerId);
        if (!moved) { openDialog(event); return; }
        const minutes = Math.round((((e.clientY - startY) / hour) * 60) / STEP) * STEP;
        node.style.visibility = 'hidden';
        const target = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('cal-column'));
        const dayCount = target ? Math.round((dateOf(target.dataset.day) - dateOf(d)) / 86_400_000) : 0;
        node.style.visibility = '';
        node.style.transform = '';
        node.classList.remove('is-dragging');
        if (minutes || dayCount) move(event, minutes, dayCount);
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
    });
  }

  async function remove(event) {
    try {
      await eventsApi.remove(event.id);
    } catch {
      status.textContent = "That couldn't be deleted. Is the app still running?";
      return;
    }
    events = events.filter((e) => e.id !== event.id);
    selectedId = null;
    draw();
    undoPlace.replaceChildren(undoBar(`“${event.title}” deleted.`, async () => { await eventsApi.restore(event.id); await load(); }));
  }

  // ---- The event dialog: a new event, or one to change ----

  const dialog = el('dialog', { class: 'capture-box event-dialog', 'aria-label': 'Event' });
  const scopeDialog = el('dialog', { class: 'capture-box event-dialog scope-dialog', 'aria-label': 'Which events?' });
  const wordsDialog = el('dialog', { class: 'capture-box event-dialog words-dialog', 'aria-label': 'An event in words' });
  document.body.append(dialog, wordsDialog, scopeDialog);
  onLeave(() => { dialog.remove(); wordsDialog.remove(); scopeDialog.remove(); undoPlace.replaceChildren(); });

  // An event in words (Calendar in depth): ⌘K (Ctrl K) here opens a field; every key shows what Enter will make, and only
  // then does it make it, as any event is made. The people it knows by name come with it.
  let peopleNames = null;
  async function openWords() {
    if (!moduleOn('calendar-plus')) return;
    if (!peopleNames) peopleNames = await request('GET', '/api/people').then((list) => list.map((p) => ({ id: p.id, name: p.name }))).catch(() => []);
    const field = el('input', { class: 'contact-name event-title words-field', 'aria-label': 'The event, in words', placeholder: 'lunch with Lena thu 12:30 1h', maxlength: 300, autocomplete: 'off' });
    const preview = el('div', { class: 'words-preview', role: 'status', 'aria-live': 'polite' });
    const problem = el('p', { class: 'capture-problem', role: 'alert' });
    const read = () => readEvent(field.value, { today: today(), names: peopleNames });
    const show = () => preview.replaceChildren(...sentencePreview(read()).children);
    async function make() {
      const got = read();
      if (!got.title) { problem.textContent = 'An event needs a name.'; return; }
      try {
        const made = startTiming('Make an event');
        const saved = await eventsApi.create({ title: got.title, starts_at: got.starts_at, ends_at: got.ends_at, people: got.people.map((p) => p.id) });
        wordsDialog.close();
        selectedId = saved.id;
        day = saved.starts_at.slice(0, 10);
        await go();
        made();
      } catch (err) { problem.textContent = err.message; }
    }
    field.addEventListener('input', () => { problem.textContent = ''; show(); });
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
    wordsDialog.replaceChildren(
      el('h2', { class: 'event-read-title' }, 'An event, in words'),
      field, preview, problem,
      el('p', { class: 'capture-hint' }, 'Say it as you would: a day (thu, tomorrow, nov 12), a time (12:30, 2pm, 9-10), a length (45m, 1h) and who with. Enter makes what you see above; words it does not know stay in the title.'),
      el('div', { class: 'capture-foot' },
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => wordsDialog.close() }, 'Cancel'),
        el('button', { type: 'button', class: 'button button-primary', onclick: make }, 'Make it')));
    show();
    wordsDialog.showModal();
    field.focus();
  }
  // ⌘K (Ctrl K) means "a new event" in the Calendar only, before the app's own quick capture, which stays the app's everywhere else.
  const onWordsKey = (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && moduleOn('calendar-plus')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openWords();
    }
  };
  window.addEventListener('keydown', onWordsKey, true);
  onLeave(() => { window.removeEventListener('keydown', onWordsKey, true); clearTimeout(watching); });

  // A repeating Google event asks first: this one, or all of them (Calendar in depth 9). The answer holds for a few seconds, so four quick
  // presses of an arrow key ask once.
  let scopeChoice = null;
  function chooseScope(event, { onlyTimes = true } = {}) {
    if (scopeChoice && scopeChoice.id === event.id && scopeChoice.until > Date.now()) { scopeChoice.until = Date.now() + 4000; return Promise.resolve(scopeChoice.scope); }
    return new Promise((resolve) => {
      let settled = false;
      const pick = (scope) => { if (settled) return; settled = true; if (scope) scopeChoice = { id: event.id, scope, until: Date.now() + 4000 }; scopeDialog.close(); resolve(scope); };
      scopeDialog.replaceChildren(
        el('h2', { class: 'event-read-title' }, 'Which events?'),
        el('p', { class: 'capture-hint' }, `“${event.title}” repeats. Change only this one, or every event of the series?`),
        el('div', { class: 'capture-foot' },
          el('button', { type: 'button', class: 'button button-quiet', onclick: () => pick(null) }, 'Cancel'),
          ...(onlyTimes ? [el('button', { type: 'button', class: 'button', onclick: () => pick('all') }, 'All events')] : []),
          el('button', { type: 'button', class: 'button button-primary', onclick: () => pick('this') }, 'This one')));
      scopeDialog.onclose = () => pick(null);
      scopeDialog.showModal();
    });
  }

  // Another calendar's event: what it is, and nothing to change.
  function openReadOnly(event) {
    const when = event.all_day
      ? `${dateOf(event.starts_at.slice(0, 10)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, all day`
      : `${new Date(`${event.starts_at}:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock(event.starts_at)} – ${clock(event.ends_at)}`;
    const [noteButton, ...notesAbout] = notesPart(event, () => dialog.close());
    dialog.replaceChildren(
      el('h2', { class: 'event-read-title' }, event.title),
      el('div', { class: 'contact-details event-fields' },
        el('span', { class: 'detail-label' }, 'When'), el('span', {}, when),
        el('span', { class: 'detail-label' }, 'Calendar'), el('span', {}, el('span', { class: 'cal-dot', style: `background: ${COLOUR[event.calendar.colour]}` }), ` ${event.calendar.name} · read only`, event.source === 'google' ? gMark(event.google?.sync) : null),
        ...(event.location ? [el('span', { class: 'detail-label' }, 'Where'), el('span', {}, event.location)] : []),
        ...(event.google?.meet_url ? [el('span', { class: 'detail-label' }, 'Video'), el('a', { href: event.google.meet_url, target: '_blank', rel: 'noopener noreferrer' }, 'Join with Google Meet')] : []),
        ...(event.google?.attendees?.length ? [el('span', { class: 'detail-label' }, 'Guests'),
          el('span', { class: 'event-guests' }, ...event.google.attendees.map((a) => el('span', { class: 'event-guest', 'data-response': a.response },
            `${a.name || a.email}${a.self ? ' (you)' : ''}${a.organizer ? ' · organiser' : ''} · `, el('strong', {}, ANSWERS[a.response] ?? a.response))))] : []),
        ...(event.google?.invited ? [el('span', { class: 'detail-label' }, 'Your answer'), answerBar(event.google.my_response, event.google.can_answer ? { onAnswer: async (value) => {
          try { await request('POST', `/api/gevents/${event.id.slice('google:'.length)}/answer`, { response: value }); dialog.close(); await load(); } catch (err) { status.textContent = err.message; }
        } } : {}), ...(event.google.can_answer ? [] : [el('span', { class: 'capture-hint' }, 'Switch on “Change your calendar” (Settings › Google) to answer from here.')])] : []),
        ...(event.google?.html_link ? [el('span', { class: 'detail-label' }, 'In Google'), el('a', { href: event.google.html_link, target: '_blank', rel: 'noopener noreferrer' }, 'Open it in Google Calendar')] : []),
        ...(event.note ? [el('span', { class: 'detail-label' }, 'Note'), el('span', { class: 'event-read-note' }, event.note)] : [])),
      el('div', { class: 'capture-foot' }, noteButton,
        el('button', { type: 'button', class: 'button', onclick: () => dialog.close() }, 'Close')),
      ...notesAbout,
    );
    dialog.onkeydown = null;
    dialog.showModal();
  }

  function openDialog(event, start = null) {
    if (event?.read_only) { openReadOnly(event); return; }
    const nextHour = Math.min((new Date().getHours() + 1) * 60, 23 * 60);
    const from = event?.starts_at ?? start?.starts_at ?? atOf(day, nextHour);
    const to = event?.ends_at ?? start?.ends_at ?? shiftAt(from, 60);
    const title = el('input', { class: 'contact-name event-title', 'aria-label': 'Event name', placeholder: 'Event name', maxlength: 300 });
    title.value = event?.title ?? '';
    const date = el('input', { type: 'date', class: 'detail-input', 'aria-label': 'Day' });
    date.value = from.slice(0, 10);
    const startTime = el('input', { type: 'time', class: 'detail-input', 'aria-label': 'Starts', step: 300 });
    startTime.value = from.slice(11);
    const endTime = el('input', { type: 'time', class: 'detail-input', 'aria-label': 'Ends', step: 300 });
    endTime.value = to.slice(11);
    const place = el('input', { class: 'detail-input', 'aria-label': 'Place', maxlength: 300, value: event?.location ?? '' });
    const note = el('textarea', { class: 'detail-input detail-lines', 'aria-label': 'Note', placeholder: 'A few words about it', rows: 2 });
    note.value = event?.note ?? '';
    // A new event can go in a Google calendar (Calendar in depth 9): with guests from People and a Meet link. It shows here at once and goes to Google.
    const where = el('select', { class: 'detail-input', 'aria-label': 'Calendar' }, el('option', { value: '' }, 'My events'));
    const guests = new Map(); // person id → name
    const guestList = el('span', { class: 'event-guests' });
    const guestInput = el('input', { class: 'detail-input', 'aria-label': 'Guests', list: 'guest-names', placeholder: 'Type a name from People', autocomplete: 'off' });
    const guestNames = el('datalist', { id: 'guest-names' });
    const meet = el('input', { type: 'checkbox', 'aria-label': 'Add Meet link' });
    const guestRows = el('div', { class: 'contact-details event-fields', hidden: true },
      el('label', { class: 'detail-label' }, 'Guests'), el('div', {}, guestList, guestInput, guestNames),
      el('label', { class: 'detail-label' }, 'Video'), el('label', { class: 'guard-field' }, meet, 'Add Meet link'));
    let people = [];
    const drawGuests = () => guestList.replaceChildren(...[...guests].map(([id, name]) => el('span', { class: 'words-chip', 'data-guest': name }, icon('person'), name,
      el('button', { type: 'button', class: 'template-chip-remove', 'aria-label': `Remove ${name}`, onclick: () => { guests.delete(id); drawGuests(); } }, icon('close')))));
    const addGuest = () => {
      const found = people.find((p) => p.name.toLowerCase() === guestInput.value.trim().toLowerCase());
      if (found) { guests.set(found.id, found.name); guestInput.value = ''; drawGuests(); } else if (guestInput.value.trim()) guestInput.setCustomValidity('');
    };
    guestInput.addEventListener('change', addGuest);
    guestInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addGuest(); } }); // Enter adds a guest, it does not save the event
    if (!event && moduleOn('calendar-google')) {
      Promise.all([request('GET', '/api/gcal/calendars'), request('GET', '/api/people')]).then(([calendars, list]) => {
        people = list.filter((p) => /\S+@\S+/.test(p.emails ?? ''));
        guestNames.replaceChildren(...people.map((p) => el('option', { value: p.name })));
        where.append(...calendars.map((c) => el('option', { value: `${c.account_id}|${c.calendar_id}` }, `Google · ${c.email}${c.is_primary ? '' : ` · ${c.name}`}`)));
      }).catch(() => {});
      where.addEventListener('change', () => { guestRows.hidden = !where.value; });
    }
    const problem = el('p', { class: 'capture-problem', role: 'alert' });
    // An event that ends on a later day keeps its length when its day or start changes.
    const length = (new Date(`${to}:00`) - new Date(`${from}:00`)) / 60_000;

    async function save() {
      if (!title.value.trim()) { problem.textContent = 'An event needs a name.'; title.focus(); return; }
      const starts = `${date.value}T${startTime.value}`;
      let ends = `${date.value}T${endTime.value}`;
      if (ends <= starts) ends = length > 0 && endTime.value === to.slice(11) ? shiftAt(starts, length) : ends;
      if (ends <= starts) { problem.textContent = 'It ends after it starts.'; return; }
      const fields = { title: title.value, starts_at: starts, ends_at: ends, note: note.value, ...(event?.source === 'google' ? { location: place.value } : {}) };
      if (event?.source === 'google' && event.google?.recurring && (starts !== event.starts_at || ends !== event.ends_at)) {
        const onlyTimes = title.value === event.title && note.value === (event.note ?? '') && place.value === (event.location ?? '');
        const scope = await chooseScope(event, { onlyTimes });
        if (!scope) return;
        if (scope === 'all') fields.scope = 'all';
      }
      try {
        const made = startTiming(event ? 'Change an event' : 'Make an event');
        let saved;
        if (!event && where.value) {
          const [accountId, calendarId] = where.value.split('|');
          saved = await request('POST', '/api/gevents', { account_id: accountId, calendar_id: calendarId, title: title.value, starts_at: starts, ends_at: ends, note: note.value, people: [...guests.keys()], meet: meet.checked });
        } else saved = event ? await eventsApi.update(event.id, fields) : await eventsApi.create(fields);
        dialog.close();
        selectedId = saved.id;
        day = saved.starts_at.slice(0, 10);
        await go();
        made();
      } catch (err) {
        problem.textContent = err.message;
      }
    }

    dialog.replaceChildren(
      title,
      el('div', { class: 'contact-details event-fields' },
        ...(!event && moduleOn('calendar-google') ? [el('label', { class: 'detail-label' }, 'Calendar'), where] : []),
        el('label', { class: 'detail-label' }, 'Day'), date,
        el('label', { class: 'detail-label' }, 'From'), el('div', { class: 'event-times' }, startTime, el('span', {}, '–'), endTime),
        ...(event?.source === 'google' ? [el('label', { class: 'detail-label' }, 'Place'), place] : []),
        el('label', { class: 'detail-label' }, event?.source === 'google' ? 'Description' : 'Note'), note),
      ...(!event ? [guestRows] : []),
      ...(event?.source === 'google' && googleRows(event).length ? [el('div', { class: 'contact-details event-fields' }, ...googleRows(event))] : []),
      ...(event?.source === 'google' ? [el('p', { class: 'capture-hint' }, `In Google Calendar. A change shows here at once and goes to Google; ${SYNC_WORDS[event.google.sync || '']}.`)] : []),
      problem,
      el('div', { class: 'capture-foot' },
        el('span', { class: 'event-actions' },
          ...(event && event.source !== 'google' ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => { dialog.close(); remove(event); } }, icon('trash'), 'Delete')] : []),
          el('button', { type: 'button', class: 'button button-quiet', onclick: () => dialog.close() }, 'Cancel')),
        el('button', { type: 'button', class: 'button button-primary', onclick: save }, event ? 'Save' : 'Add event')),
      ...(event ? [el('div', { class: 'event-notes' }, ...notesPart(event, () => dialog.close()))] : []),
    );
    dialog.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); save(); } };
    dialog.showModal();
    title.focus();
  }

  // ---- Your calendars: your own events, and the ones you added by link ----

  // The list is drawn again with the events; the form to add one is made once, so what
  // you type and what it said stay.
  const calendarRows = el('div', { class: 'cal-calendar-list' });
  const changesPane = el('section', { class: 'google-changes', 'aria-label': 'Google changes', hidden: true });
  let watching = null; // while a change waits to go, the page looks again in a moment
  const link = el('input', { type: 'url', class: 'search-input', placeholder: 'https://… or webcal://… (.ics)', 'aria-label': 'Calendar link', autocomplete: 'off' });
  const linkName = el('input', { class: 'search-input', placeholder: 'Its name (optional)', 'aria-label': 'Calendar name', maxlength: 100 });
  const added = el('p', { class: 'capture-hint', role: 'status' });
  const addForm = el('div', {},
    el('div', { class: 'cal-add' },
      el('label', { class: 'search' }, icon('plus'), link),
      el('label', { class: 'search' }, linkName),
      el('button', { type: 'button', class: 'button', onclick: addCalendar }, 'Add calendar')),
    el('p', { class: 'capture-hint' }, 'Paste a calendar’s private iCal link (Google: Settings › your calendar › Secret address in iCal format; Outlook and iCloud: share or publish it). It is read every ten minutes, shown read only, and never written to.'),
    added);
  async function addCalendar() {
    if (!link.value.trim()) { link.focus(); return; }
    added.textContent = 'Reading it…';
    try {
      const calendar = await calendarsApi.add({ url: link.value, name: linkName.value });
      added.textContent = calendar.problem ? `Added, but: ${calendar.problem}` : `“${calendar.name}” added.`;
      link.value = '';
      linkName.value = '';
      await load();
    } catch (err) {
      added.textContent = err.message;
    }
  }
  for (const input of [link, linkName]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCalendar(); } });
  extra.append(
    el('h2', { class: 'linked-from-title' }, 'Your calendars'),
    calendarRows,
    addForm,
    changesPane,
  );

  // ---- Google changes (Calendar in depth 8): what waits to go to Google, what went, what clashed ----
  const when = (at) => new Date(`${at}:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${clock(at)}`;
  function whatChanged(change) {
    const p = change.patch;
    return [
      ...('title' in p ? [`renamed to “${p.title}”`] : []),
      ...('starts_at' in p || 'ends_at' in p ? [`moved to ${when(p.starts_at ?? change.event_starts)}${p.ends_at ? `–${clock(p.ends_at)}` : ''}`] : []),
      ...('location' in p ? [p.location ? `place: ${p.location}` : 'place cleared'] : []),
      ...('description' in p ? ['description changed'] : []),
    ].join(', ') || 'changed';
  }
  async function drawChanges() {
    let changes = [];
    if (moduleOn('calendar-google')) { try { changes = await request('GET', '/api/gcal/outbox'); } catch { /* the pane waits for the next look */ } }
    changesPane.hidden = !changes.length;
    changesPane.replaceChildren(...(changes.length ? [
      el('h2', { class: 'linked-from-title' }, 'Google changes'),
      ...changes.map((c) => {
        const resolve = async (use) => { await request('POST', `/api/gcal/outbox/${c.id}/resolve`, { use }); await load(); };
        if (c.state === 'clash') {
          return el('div', { class: 'google-change is-clash', 'data-state': 'clash' },
            gMark('clash'),
            el('span', { class: 'google-change-what' }, el('strong', {}, c.event), ` was changed in Google too. Google’s version was kept (${c.theirs.starts_at ? `${when(c.theirs.starts_at)}${c.theirs.ends_at ? `–${clock(c.theirs.ends_at)}` : ''}` : 'as it is now'}). Yours: ${whatChanged(c)}.`),
            el('button', { type: 'button', class: 'button', onclick: () => resolve('mine') }, 'Use mine'),
            el('button', { type: 'button', class: 'button button-quiet', onclick: () => resolve('google') }, 'Keep Google’s'));
        }
        const state = { waiting: 'Waiting to go', sent: 'Sent to Google', failed: c.problem || 'Not saved to Google yet' }[c.state];
        return el('div', { class: 'google-change', 'data-state': c.state },
          gMark(c.state === 'sent' ? '' : c.state),
          el('span', { class: 'google-change-what' }, el('strong', {}, c.event), ` ${whatChanged(c)}`),
          el('span', { class: 'google-change-state', title: 'The version of the event this change was made on' }, `${state} · version ${String(c.etag).replace(/"/g, '')}`),
          ...(c.state === 'failed' ? [el('button', { type: 'button', class: 'button button-quiet', onclick: async () => { await request('POST', `/api/gcal/outbox/${c.id}/retry`, {}); await load(); } }, 'Try again')] : []));
      }),
    ] : []));
    clearTimeout(watching);
    if (changes.some((c) => c.state === 'waiting')) watching = setTimeout(() => load(), 2500);
  }

  async function drawCalendars() {
    let calendars;
    let own;
    try { [calendars, own] = await Promise.all([calendarsApi.list(), calendarsApi.own()]); } catch { return; }
    drawChanges();
    calendarRows.replaceChildren(
      el('div', { class: 'cal-calendar' },
        el('button', {
          type: 'button', class: 'cal-dot', style: `background: ${COLOUR[own.colour]}`,
          'aria-label': 'Change My events’ colour', title: 'Change its colour',
          onclick: async () => { await calendarsApi.setOwn((own.colour % 6) + 1); await load(); },
        }),
        el('span', { class: 'cal-calendar-name' }, 'My events'),
        el('span', { class: 'cal-calendar-state' }, 'made here')),
      ...(moduleOn('calendar-links') ? calendars : []).map((calendar) => calendarLinkRow(calendar, {
        colour: async () => { await calendarsApi.update(calendar.id, { colour: (calendar.colour % 6) + 1 }); await load(); },
        read: async () => { await calendarsApi.read(calendar.id); await load(); },
        remove: async () => {
          await calendarsApi.remove(calendar.id);
          await load();
          undoPlace.replaceChildren(undoBar(`“${calendar.name}” removed.`, async () => { await calendarsApi.restore(calendar.id); await load(); }));
        },
      })),
      ...(moduleOn('calendar-links') ? [] : [el('p', { class: 'capture-hint' }, 'Calendar links are switched off (Settings › Modules): their calendars are kept, but not shown.')]));
    addForm.hidden = !moduleOn('calendar-links');
  }

  // The now line moves on.
  const tick = setInterval(() => { if (!drafting && days().includes(today())) draw(); }, 60_000);
  onLeave(() => clearInterval(tick));
  await go();
}

