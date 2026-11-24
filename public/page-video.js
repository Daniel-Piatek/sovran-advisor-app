// The video of the page you are on (2026-11-24, the owner's wish: "links to the individual videos that show up in the
// place where the person might realize the need for them"). Just under the page's top bar, at the right, a play
// button and "How <the page> works"; it opens that page's film in the Tour (/tour?film=<id>&back=<here>), and the film's page
// offers a small "← <the page> Module" instead of All Videos. Settings › Sidebar and Settings › go Sovran carry the same link
// (pageVideo below). The films are the Tour's own (tour.js).

import { el, icon } from './ui.js';

// Which page has which film; name: the page in "How … works"; module: the small button back, "← <module> Module".
export const PAGE_FILMS = [
  { path: /^\/quest(\/|$)/, film: 'quest', name: 'Sovran Quest', module: 'Sovran Quest' },
  { path: /^\/group(\/|$)/, film: 'group', name: 'Group Circle', module: 'Group Circle' },
  { path: /^\/tasks(\/|$)/, film: 'tasks', name: 'Tasks', module: 'Tasks' },
  { path: /^\/planner(\/|$)/, film: 'planner', name: 'the Planner', module: 'Planner' },
  { path: /^\/calendar(\/|$)/, film: 'calendar', name: 'the Calendar', module: 'Calendar' },
  { path: /^\/boards$/, film: 'boards', name: 'Boards', module: 'Boards' },
  { path: /^\/life(\/|$)/, film: 'life', name: 'My Life', module: 'My Life' },
];

// The link itself: a Crimson play circle, then "How <name> works". back: where "Back to …" goes.
export function pageVideo(film, name, back = location.pathname + location.search) {
  const href = `/tour?film=${encodeURIComponent(film)}&back=${encodeURIComponent(back)}`;
  return el('a', { class: 'tour-watch page-video', href, 'data-film': film, title: `A short video: how ${name} works` },
    el('span', { class: 'tour-play-sm' }, icon('play')), `How ${name} works`);
}

// A page's own place for it: a line of its own just under the page's top bar, at the right. The same place on every
// page, whatever its bar holds (Planner, Calendar and My Life fill theirs, and on a phone the bars wrap).
function place() {
  const hit = PAGE_FILMS.find((p) => p.path.test(location.pathname));
  const bar = document.querySelector('#app .top-bar');
  const has = document.querySelector('#app .page-video-line');
  if (!hit || !bar) { has?.remove(); return; }
  if (has && has.previousElementSibling === bar && has.firstElementChild?.dataset.film === hit.film) return;
  has?.remove();
  bar.after(el('div', { class: 'page-video-line' }, pageVideo(hit.film, hit.name)));
}
const app = document.getElementById('app');
if (app) new MutationObserver(place).observe(app, { childList: true, subtree: true });
