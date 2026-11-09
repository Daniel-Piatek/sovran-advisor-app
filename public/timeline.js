// The Timeline (/timeline, advanced/people/2): everything that happened, on one line, newest
// on top, day by day, with a thin line at now: what is still ahead today sits above it,
// what happened sits below. It keeps nothing of its own (the server reads it from the notes,
// the journal, the tasks, the events and the captures). Chips switch each kind on and off,
// the search keeps the rows with every word, and each row opens the thing where it lives.

import { el, icon, request, weekdayName, longDate, today, addDays } from './ui.js';
import { app, screen } from './shell.js';
import { moduleOn } from './modules.js';

// Shape tells the kinds apart, never colour: each kind has its own icon and its own word.
const KINDS = [
  { key: 'note', name: 'Notes', icon: 'notes', word: 'Note' },
  { key: 'entry', name: 'Journal', icon: 'journal', word: 'Journal' },
  { key: 'task', name: 'Tasks', icon: 'task', word: 'Task done' },
  { key: 'event', name: 'Events', icon: 'calendar', word: 'Event' },
  { key: 'capture', name: 'Captures', icon: 'inbox', word: 'Capture' },
  { key: 'interaction', name: 'Logged', icon: 'log', word: 'Logged' },
];
const PAGE = 60;
const pad = (n) => String(n).padStart(2, '0');
const localSecond = (date = new Date()) => `${today()}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;

const dayHeading = (day) => (day === today() ? 'Today' : day === addDays(today(), -1) ? 'Yesterday'
  : `${weekdayName(day, 'short')}, ${longDate(day)}`);

// One row: its shape, its time, its one line and where it lives. The whole row is the link.
// With `who`, a logged line says who it was with (on a person's own tab that is no news).
export function timelineRow(item, { who = true } = {}) {
  const kind = KINDS.find((k) => k.key === item.kind);
  const mark = item.via ? item.via.name : who && item.who?.length ? item.who.join(', ') : '';
  return el('a', { class: 'timeline-row', href: item.href, 'data-kind': item.kind },
    el('span', { class: 'timeline-shape', 'aria-hidden': 'true' }, icon(kind.icon)),
    el('span', { class: 'timeline-time' }, item.at.slice(11, 16)),
    el('span', { class: 'timeline-text' }, item.text, ...(mark ? [el('span', { class: 'timeline-via' }, ` · ${mark}`)] : [])),
    el('span', { class: 'timeline-where' }, item.where ?? kind.word));
}

// The line at now.
export const nowLine = () => el('div', { class: 'timeline-now', role: 'separator', 'aria-label': 'Now' },
  el('span', { class: 'timeline-now-label' }, 'Now'));

// The stream as a piece of a page: kind chips, a search box, the days and rows. On the
// Timeline page it is everything (`about` null); on a person's or company's page it is theirs
// (`about` { kind, id }: notes, entries and tasks that point at them; a company's also its
// people's, each marked with the person). `address` keeps the search and the kinds in the
// page's address (the Timeline page does; a tab on another page does not).
export function createTimeline({ about = null, address = false, kinds: offered = KINDS.map((k) => k.key) } = {}) {
  const shown = KINDS.filter((k) => offered.includes(k.key));
  const params = new URLSearchParams(address ? location.search : '');
  let query = params.get('q') ?? '';
  const chosen = new Set(params.has('kinds') ? params.get('kinds').split(',').filter((k) => shown.some((x) => x.key === k)) : shown.map((k) => k.key));
  let items = [];
  let more = false;
  let loaded = false;
  let run = 0;
  let typing = null;

  const search = el('input', {
    type: 'search', class: 'search-input', placeholder: about ? 'Search this Timeline' : 'Search the Timeline',
    'aria-label': about ? 'Search this Timeline' : 'Search the Timeline', autocomplete: 'off',
    oninput: () => { query = search.value; keepAddress(); clearTimeout(typing); typing = setTimeout(() => load(), 150); },
    onkeydown: (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      search.value = '';
      query = '';
      keepAddress();
      load();
      search.blur();
    },
  });
  search.value = query;
  const chips = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Kinds' });
  const list = el('div', { class: 'timeline-list', 'aria-live': 'polite' });
  const status = el('p', { class: 'journal-tools-message', role: 'status' });

  function keepAddress() {
    if (!address) return;
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (chosen.size !== shown.length) next.set('kinds', [...chosen].join(','));
    history.replaceState(null, '', `/timeline${next.size ? `?${next}` : ''}`);
  }

  function drawChips() {
    chips.replaceChildren(...shown.map((k) => el('button', {
      type: 'button', class: 'tab', 'aria-pressed': String(chosen.has(k.key)), title: `${chosen.has(k.key) ? 'Hide' : 'Show'} ${k.name.toLowerCase()}`,
      onclick: () => { chosen.has(k.key) ? chosen.delete(k.key) : chosen.add(k.key); keepAddress(); drawChips(); load(); },
    }, icon(k.icon), ` ${k.name}`)));
  }

  const ask = (before) => request('GET', `/api/timeline?${new URLSearchParams({
    kinds: [...chosen].join(','), ...(query.trim() ? { q: query.trim() } : {}), ...(before ? { before } : {}), limit: String(PAGE),
    ...(about ? { about: `${about.kind}:${about.id}` } : {}),
  })}`);

  function draw() {
    const now = localSecond();
    const todayKey = today();
    const groups = new Map();
    // On the page of everything, today always has its place on top, with the line at now.
    if (!about) groups.set(todayKey, []);
    for (const item of items) {
      const day = item.at.slice(0, 10);
      groups.set(day, [...groups.get(day) ?? [], item]);
    }
    const parts = [];
    for (const [day, rows] of groups) {
      const section = el('section', { class: 'timeline-day', 'aria-label': dayHeading(day) }, el('h2', { class: 'timeline-day-title' }, dayHeading(day)));
      let lineDrawn = Boolean(about) || day !== todayKey; // a person's has no events ahead: no line at now
      for (const item of rows) {
        if (!lineDrawn && item.at <= now) { section.append(nowLine()); lineDrawn = true; }
        section.append(timelineRow(item, { who: !about }));
      }
      if (!lineDrawn) section.append(nowLine());
      parts.push(section);
    }
    if (loaded && !items.length) {
      parts.push(el('p', { class: 'empty' }, query.trim() || chosen.size !== shown.length ? 'Nothing here matches.'
        : about ? 'Nothing yet. Log what happened above, or link a note, a journal entry or a task to them.'
          : 'Nothing has happened yet. Write a note, add a task or an event, and it shows here.'));
    }
    if (more) parts.push(el('button', { type: 'button', class: 'button button-quiet timeline-earlier', onclick: () => earlier() }, 'Earlier'));
    list.replaceChildren(...parts);
  }

  // Only the latest answer draws: a slow older one never covers a newer one.
  async function load() {
    const mine = ++run;
    status.textContent = '';
    try {
      const answer = await ask();
      if (mine !== run) return;
      items = answer.items;
      more = answer.more;
    } catch {
      if (mine !== run) return;
      status.textContent = "The Timeline couldn't be loaded. Is the app still running?";
    }
    loaded = true;
    draw();
  }

  async function earlier() {
    const mine = ++run;
    try {
      const answer = await ask(items.at(-1)?.at);
      if (mine !== run) return;
      const seen = new Set(items.map((i) => `${i.kind}:${i.id}`));
      items = [...items, ...answer.items.filter((i) => !seen.has(`${i.kind}:${i.id}`))];
      more = answer.more;
    } catch {
      status.textContent = "Earlier couldn't be loaded. Is the app still running?";
    }
    draw();
  }

  drawChips();
  draw();
  return { search, body: el('div', {}, chips, status, list), load };
}

export async function showTimeline() {
  document.title = 'Timeline';
  app.className = 'page timeline-page';
  if (!moduleOn('people-plus')) {
    screen.replaceChildren(
      el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Timeline')),
      el('p', { class: 'empty' }, 'The Timeline comes with People in depth, which is switched off. ', el('a', { href: '/settings' }, 'Switch it on in Settings.')));
    return;
  }
  const view = createTimeline({ address: true });
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Timeline'),
      el('label', { class: 'search' }, icon('search'), view.search)),
    view.body);
  await view.load();
}
