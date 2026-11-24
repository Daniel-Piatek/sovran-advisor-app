// The Tour (/tour, 2026-11-16, the owner's wish): short films of the app, always one click away in the
// sidebar, just above Settings. First the basics (everything that works straight after you install),
// then one short film for each part you can switch on, each card with its own "Switch it on".
//   /tour               the films, as cards
//   /tour?film=<id>     one video playing, with "All Videos" above it and "Back to All Videos" beside Start Again
//   /tour?film=<id>&back=<page>  the same, opened from a page's "How … works" (page-video.js): a small "← <the page> Module"
//                                above and under it, and no On / Open → (they came from that page)
// The films themselves are pages in public/tour/ (basics.html, extras.html) with the owner's voice as
// mp3 files in public/tour/voice/. They are made from the published films by build-app-films.py in the
// project files (student-guide/tour/); inside the app they hide their own title and follow Light/Dark.

import { el, icon } from './ui.js';
import { app, screen, navigate } from './shell.js';
import { moduleOn, switchModule } from './modules.js';
import { PAGE_FILMS } from './page-video.js';

// The owner's order (2026-11-16): Phone capture, Tasks, Planner; then Calendar, Boards, My Life. Group Circle (2026-11-22) comes
// first: it is on in a new install, and has its own film page (group.html), which Daniel can also share as a web page.
const EXTRAS = [
  // Sovran Quest (2026-11-24, the owner's "go"): on in a new install; its film page is quest.html (build-quest-film.py), the computer and go Sovran.
  { id: 'quest', module: 'quest', title: 'Sovran Quest', kind: 'people', open: '/quest', openLabel: 'Open Sovran Quest', src: '/tour/quest.html',
    text: 'Your Quest group’s weeks: the daily practice, the homework, and the weekly group call, on your computer and your phone.' },
  { id: 'group', module: 'group', title: 'Group Circle', kind: 'people', open: '/group', openLabel: 'Open Group Circle', src: '/tour/group.html',
    text: 'Your Quest group’s own space: announcements from Daniel, and a Circle to share with each other.' },
  // go Sovran (2026-11-22, the owner's choice): the name everywhere, and one film, the go Sovran film of the setup guides
  // (sovran-go.html, made by build-sovran-go-film.py); the old "Phone Capture" film is retired.
  { id: 'phone', module: 'phone-drop', title: 'go Sovran', kind: 'people', open: '/settings', openLabel: 'Open Settings', src: '/tour/sovran-go.html',
    text: 'Sovran Central on your phone. Ask your AI, write in your Journal, keep a thought, read your reports.' },
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
  // Your sidebar (2026-11-23, the owner's wish): not a module, always there; its film page is sidebar.html (build-sidebar-film.py).
  { id: 'sidebar', title: 'Your Sidebar', kind: 'notes', open: '/settings', openLabel: 'Settings › Sidebar', src: '/tour/sidebar.html',
    text: 'Put your sections in your own order, with thin lines between them where you like. Click Arrange, at the foot of the sidebar.' },
];

const filmOf = (id) => (id === 'basics' ? { id, title: 'The Basics', src: '/tour/basics.html' }
  : EXTRAS.find((x) => x.id === id) && { ...EXTRAS.find((x) => x.id === id), src: EXTRAS.find((x) => x.id === id).src ?? `/tour/extras.html#${id}` });

// A still of the app, drawn: the play button sits on it.
const still = (caption) => el('div', { class: 'tour-still', 'aria-hidden': 'true' },
  el('div', { class: 'tour-still-app' }, el('span'), el('b', {}, el('i'), el('i'), el('i'), el('i'))),
  el('span', { class: 'tour-play' }, icon('play')),
  caption ? el('span', { class: 'tour-still-caption' }, caption) : null);

// On, or a button that switches it on (so it is off). Once on, the card offers to open that part.
function stateOf(extra) {
  if (!extra.module) return el('span', { class: 'tour-state' }, el('a', { class: 'tour-open', href: extra.open, title: extra.openLabel }, 'Settings →'));
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
    el('section', { class: 'tour-hero', 'aria-label': 'The Basics' },
      el('a', { class: 'tour-hero-still', href: '/tour?film=basics', 'aria-label': 'Watch The Basics' }, still('10 scenes · about 6 minutes')),
      el('div', { class: 'tour-hero-text' },
        el('span', { class: 'tour-label' }, 'Start here'),
        el('h2', { class: 'tour-hero-title' }, 'The Basics'),
        el('p', {}, 'What each part of Sovran Central is for, how they fit together, and what to try first. Everything in it works straight after you install.'),
        el('a', { class: 'button button-primary', href: '/tour?film=basics' }, icon('play'), 'Watch'))),
    // The Library key first (2026-11-17, the owner's wish): most people will do this before the six below. Gold, a little raised.
    el('p', { class: 'tour-libline' }, el('span', { class: 'tour-label tour-libline-label' }, el('i', { class: 'tour-dot' }), 'Do this first'),
      el('b', {}, 'Your Sovran Library'),
      ' · paste the key you were sent into Settings › Sovran Library, and Sovran Advisor can read the teaching notes. ',
      el('a', { class: 'button tour-libline-go', href: '/settings#sovran-library' }, 'Paste your key →')),
    el('h2', { class: 'tour-label tour-extras-label' }, 'More in your app · one short video each'),
    el('div', { class: 'tour-cards' }, ...EXTRAS.map((extra) => el('article', { class: 'tour-card', 'data-film': extra.id, 'data-kind': extra.kind },
      el('h3', { class: 'tour-card-title' }, extra.title),
      el('p', {}, extra.text),
      el('div', { class: 'tour-card-foot' },
        el('a', { class: 'tour-watch', href: `/tour?film=${extra.id}` }, el('span', { class: 'tour-play-sm' }, icon('play')), 'Watch'),
        stateOf(extra))))),
  );
}

// Where a film opened from a page goes back to (page-video.js): one of this app's own pages, or nothing.
function backOf(param) {
  if (!param || !param.startsWith('/') || param.startsWith('//') || param.startsWith('/tour')) return null;
  const path = param.split(/[?#]/)[0];
  const page = PAGE_FILMS.find((p) => p.path.test(path));
  // The owner's words (2026-11-24): "← Sovran Quest Module", small.
  const label = page ? `${page.module} Module` : path.startsWith('/settings') ? 'Settings' : null;
  return label ? { href: param, label } : null;
}

function showFilm(film, back) {
  const frame = el('iframe', { class: 'tour-frame', src: film.src, title: film.title, allow: 'autoplay' });
  // The film's page is ours: the frame grows to fit it, so there is one scroll bar, the app's.
  frame.addEventListener('load', () => {
    const page = frame.contentDocument?.documentElement;
    if (!page) return;
    const fit = () => { frame.style.height = `${page.scrollHeight}px`; };
    fit();
    new ResizeObserver(fit).observe(page);
    // Opened from a page: the video's own "Back to All Videos" goes back to that page too.
    const all = back && frame.contentDocument.getElementById('back-all');
    if (all) {
      const mine = all.cloneNode(false); // without the film's own click, which goes to /tour
      mine.textContent = `← ${back.label}`;
      mine.href = back.href;
      mine.addEventListener('click', (e) => { e.preventDefault(); navigate(back.href); });
      all.replaceWith(mine);
    }
  });
  const extra = EXTRAS.find((x) => x.id === film.id);
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, back
      ? el('a', { class: 'tour-back-to', href: back.href }, `← ${back.label}`)
      : el('a', { class: 'button tour-back', href: '/tour' }, icon('back'), 'All Videos'),
    back ? el('a', { class: 'tour-all', href: '/tour' }, 'All Videos') : null),
    el('div', { class: 'tour-film-head' },
      el('h1', { class: 'top-bar-title' }, film.title),
      extra && !back ? stateOf(extra) : null), // opened from the page itself: it is on, and they came from it
    frame); // the video's own "Back to All Videos" sits beside its Start Again (build-app-films.py)
}

export function showTour() {
  document.title = 'Tour';
  app.className = 'page';
  const query = new URLSearchParams(location.search);
  const id = query.get('film');
  const film = id && filmOf(id);
  if (id && !film) return navigate('/tour', { replace: true });
  if (film) showFilm(film, backOf(query.get('back'))); else showList();
}
