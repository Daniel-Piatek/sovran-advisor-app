// The Tour (/tour, 2026-11-16, the owner's wish): short films of the app, always one click away in the
// sidebar, just above Settings. First the basics (everything that works straight after you install),
// then one short film for each part you can switch on, each card with its own "Switch it on".
//   /tour               the films, as cards
//   /tour?film=<id>     one video playing, with "All videos" above it and "Back to all videos" beside Start again
// The films themselves are pages in public/tour/ (basics.html, extras.html) with the owner's voice as
// mp3 files in public/tour/voice/. They are made from the published films by build-app-films.py in the
// project files (student-guide/tour/); inside the app they hide their own title and follow Light/Dark.

import { el, icon } from './ui.js';
import { app, screen, navigate } from './shell.js';
import { moduleOn, switchModule } from './modules.js';

// The owner's order (2026-11-16): Phone capture, Tasks, Planner; then Calendar, Boards, My Life.
const EXTRAS = [
  { id: 'phone', module: 'phone-drop', title: 'Phone capture', kind: 'people', open: '/settings', openLabel: 'Open Settings',
    text: 'A Capture app on your phone. Speak or type, and it lands in your Inbox.' },
  { id: 'tasks', module: 'tasks', title: 'Tasks', kind: 'tasks', open: '/tasks', openLabel: 'Open Tasks',
    text: 'Today, Upcoming and Someday. Press q anywhere to add one in a line.' },
  { id: 'planner', module: 'planner', title: 'Planner', kind: 'planner', open: '/planner', openLabel: 'Open Planner',
    text: 'Plan your day and week, pick a highlight, close the day.' },
  { id: 'calendar', module: 'calendar', title: 'Calendar', kind: 'time', open: '/calendar', openLabel: 'Open Calendar',
    text: 'Your events by day, week and month, with your Google Calendar beside them.' },
  { id: 'boards', module: 'boards', title: 'Boards', kind: 'notes', open: '/boards', openLabel: 'Open Boards',
    text: 'Endless whiteboards for your notes, entries and Inbox items.' },
  { id: 'life', module: 'life', title: 'My Life', kind: 'life', open: '/life', openLabel: 'Open My Life',
    text: 'Your Key Elements, Goals, Projects and Topics.' },
];

const filmOf = (id) => (id === 'basics' ? { id, title: 'The basics', src: '/tour/basics.html' }
  : EXTRAS.find((x) => x.id === id) && { ...EXTRAS.find((x) => x.id === id), src: `/tour/extras.html#${id}` });

// A still of the app, drawn: the play button sits on it.
const still = (caption) => el('div', { class: 'tour-still', 'aria-hidden': 'true' },
  el('div', { class: 'tour-still-app' }, el('span'), el('b', {}, el('i'), el('i'), el('i'), el('i'))),
  el('span', { class: 'tour-play' }, icon('play')),
  caption ? el('span', { class: 'tour-still-caption' }, caption) : null);

// On, or a button that switches it on (so it is off). Once on, the card offers to open that part.
function stateOf(extra) {
  if (moduleOn(extra.module)) {
    return el('span', { class: 'tour-state' }, el('span', { class: 'tour-on' }, 'On'),
      el('a', { class: 'tour-open', href: extra.open, title: extra.openLabel }, 'Open →'));
  }
  const button = el('button', {
    type: 'button', class: 'button tour-switch',
    onclick: async () => {
      button.disabled = true;
      button.textContent = 'Switching on…';
      try { await switchModule(extra.module, true); } catch { button.textContent = 'Could not switch on: try Settings › Modules'; return; }
      node.replaceWith(stateOf(extra)); // the card (or the film above it) stays as it is
    },
  }, 'Switch it on');
  const node = el('span', { class: 'tour-state' }, button);
  return node;
}

function showList() {
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Tour')),
    el('section', { class: 'tour-hero', 'aria-label': 'The basics' },
      el('a', { class: 'tour-hero-still', href: '/tour?film=basics', 'aria-label': 'Watch The basics' }, still('10 scenes · about 6 minutes')),
      el('div', { class: 'tour-hero-text' },
        el('span', { class: 'tour-label' }, 'Start here'),
        el('h2', { class: 'tour-hero-title' }, 'The basics'),
        el('p', {}, 'What each part of Sovran Advisor is for, how they fit together, and what to try first. Everything in it works straight after you install.'),
        el('a', { class: 'button button-primary', href: '/tour?film=basics' }, icon('play'), 'Watch'))),
    el('h2', { class: 'tour-label tour-extras-label' }, 'More you can switch on · one short video each'),
    el('div', { class: 'tour-cards' }, ...EXTRAS.map((extra) => el('article', { class: 'tour-card', 'data-film': extra.id, style: `--tour-kind: var(--kind-${extra.kind})` },
      el('h3', { class: 'tour-card-title' }, extra.title),
      el('p', {}, extra.text),
      el('div', { class: 'tour-card-foot' },
        el('a', { class: 'tour-watch', href: `/tour?film=${extra.id}` }, el('span', { class: 'tour-play-sm' }, icon('play')), 'Watch'),
        stateOf(extra))))),
    el('p', { class: 'tour-libline' }, el('i', { class: 'tour-dot' }), el('b', {}, 'Your Sovran Library'),
      ' · paste the key you were sent into Settings › Sovran Library, and your assistant can read the teaching notes. ',
      el('a', { class: 'tour-open', href: '/settings#sovran-library' }, 'Paste your key →')),
  );
}

function showFilm(film) {
  const frame = el('iframe', { class: 'tour-frame', src: film.src, title: film.title, allow: 'autoplay' });
  // The film's page is ours: the frame grows to fit it, so there is one scroll bar, the app's.
  frame.addEventListener('load', () => {
    const page = frame.contentDocument?.documentElement;
    if (!page) return;
    const fit = () => { frame.style.height = `${page.scrollHeight}px`; };
    fit();
    new ResizeObserver(fit).observe(page);
  });
  const extra = EXTRAS.find((x) => x.id === film.id);
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('a', { class: 'button tour-back', href: '/tour' }, icon('back'), 'All videos')),
    el('div', { class: 'tour-film-head' },
      el('h1', { class: 'top-bar-title' }, film.title),
      extra ? stateOf(extra) : null),
    frame); // the video's own "Back to all videos" sits beside its Start again (build-app-films.py)
}

export function showTour() {
  document.title = 'Tour';
  app.className = 'page';
  const id = new URLSearchParams(location.search).get('film');
  const film = id && filmOf(id);
  if (id && !film) return navigate('/tour', { replace: true });
  if (film) showFilm(film); else showList();
}
