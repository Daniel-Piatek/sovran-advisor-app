// The frame around every screen: the sidebar (Notes, Journal), the bottom bar with the
// Light/Dark switch, and moving between screens without reloading.

import { el, icon, api } from './ui.js';
import { openCapture, whenCaptured } from './capture.js';
import { forgetPageNames } from './editor.js';
import { moduleOn, onModulesChanged } from './modules.js';
import { micPill } from './dictation.js';

export const app = document.getElementById('app');
// Every screen draws into `screen`; the bottom bar sits below it on every screen.
export const screen = el('div');

// ---- The sidebar: on a phone, a bar along the bottom ----
// Capture on top (⌘K), then the sections. The Inbox shows how many captures wait. On a
// phone, the sections marked `more` (People, My Life, Assistant, Settings, Library) sit under a More button instead.

const sections = [
  { name: 'Notes', href: '/', icon: 'notes', owns: (path) => path === '/' || path.startsWith('/notes/') },
  { name: 'Journal', href: '/journal', icon: 'journal', owns: (path) => path === '/journal' || path.startsWith('/journal/') },
  { name: 'Tasks', module: 'tasks', href: '/tasks', icon: 'task', owns: (path) => path === '/tasks' },
  { name: 'Planner', module: 'planner', href: '/planner', icon: 'planner', owns: (path) => /^\/planner(\/|$)/.test(path) },
  { name: 'Calendar', module: 'calendar', href: '/calendar', icon: 'calendar', owns: (path) => /^\/calendar(\/|$)/.test(path) },
  { name: 'Timeline', href: '/timeline', icon: 'timeline', more: true, module: 'people-plus', owns: (path) => path === '/timeline' },
  { name: 'People', href: '/people', icon: 'person', more: true, owns: (path) => /^\/(people|companies)(\/|$)/.test(path) },
  { name: 'My Life', module: 'life', href: '/life', icon: 'key_element', more: true, owns: (path) => /^\/life(\/|$)/.test(path) },
  { name: 'Inbox', href: '/inbox', icon: 'inbox', owns: (path) => path === '/inbox' },
  { name: 'Assistant', href: '/assistant', icon: 'assistant', more: true, owns: (path) => /^\/assistant(\/|$)/.test(path) },
  { name: 'Settings', href: '/settings', icon: 'settings', more: true, owns: (path) => path === '/settings' },
  { name: 'Library', href: '/library', icon: 'grid', more: true, owns: (path) => path === '/library' },
];

const sidebar = document.getElementById('sidebar');
const inboxCount = el('span', { class: 'sidebar-count', hidden: true });
const sectionLinks = sections.map((section) => el('a', { class: section.more ? 'sidebar-link in-more' : 'sidebar-link', href: section.href, 'data-section': section.name },
  icon(section.icon), el('span', {}, section.name), section.name === 'Inbox' ? inboxCount : null));
// More (a phone only): a small menu above the bar with the sections that don't fit.
const moreMenu = el('div', { class: 'more-menu', role: 'menu', 'aria-label': 'More', hidden: true },
  ...sections.filter((s) => s.more).map((section) => el('a', {
    class: 'more-link', href: section.href, role: 'menuitem', 'data-section': section.name, onclick: () => { moreMenu.hidden = true; moreButton.setAttribute('aria-expanded', 'false'); },
  }, icon(section.icon), el('span', {}, section.name))));
// A section that belongs to a module is there while the module is on.
const sectionOf = (name) => sections.find((s) => s.name === name);
function showModuleSections() {
  for (const link of [...sectionLinks, ...moreMenu.querySelectorAll('.more-link')]) {
    const module = sectionOf(link.dataset.section)?.module;
    if (module) link.hidden = !moduleOn(module);
  }
}
onModulesChanged(showModuleSections);
const moreButton = el('button', {
  type: 'button', class: 'sidebar-link sidebar-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
  onclick: () => { moreMenu.hidden = !moreMenu.hidden; moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden)); },
}, icon('more'), el('span', {}, 'More'));
document.addEventListener('pointerdown', (event) => {
  if (!moreMenu.hidden && !moreMenu.contains(event.target) && !moreButton.contains(event.target)) {
    moreMenu.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
  }
});
const captureButton = el('button', {
  type: 'button', class: 'sidebar-capture', title: 'Quick capture (⌘K)', onclick: () => openCapture(),
}, icon('plus'), el('span', {}, 'Capture'), el('kbd', { class: 'sidebar-key' }, '⌘K'));
// Settings and Library are pinned to the foot of the column; the others can be dragged into
// the owner's own order (2026-11-09), remembered in this browser.
const PINNED = ['Settings', 'Library'];
const ORDER_KEY = 'sidebar.order';
const linkOf = (name) => sectionLinks[sections.findIndex((s) => s.name === name)];
const movable = sectionLinks.filter((link) => !PINNED.includes(link.dataset.section));
const pinned = PINNED.map(linkOf);
for (const link of pinned) link.classList.add('sidebar-pinned');
sidebar.replaceChildren(captureButton, ...movable, moreButton, moreMenu, ...pinned);
showModuleSections();

const readOrder = () => { try { const list = JSON.parse(localStorage.getItem(ORDER_KEY)); return Array.isArray(list) ? list : []; } catch { return []; } };
const saveOrder = () => {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(currentMovable().map((link) => link.dataset.section))); } catch { /* the order just isn't kept */ }
};
const currentMovable = () => [...sidebar.querySelectorAll(':scope > .sidebar-link:not(.sidebar-pinned):not(.sidebar-more)')];
function applyOrder() {
  const saved = readOrder();
  const rank = (link) => { const i = saved.indexOf(link.dataset.section); return i === -1 ? Infinity : i; };
  // A section the saved order doesn't know (a new one) stays where it was among the others.
  const known = movable.filter((l) => rank(l) !== Infinity).sort((a, b) => rank(a) - rank(b));
  const result = movable.map((l) => (rank(l) === Infinity ? l : known.shift()));
  for (const link of result) sidebar.insertBefore(link, moreButton);
}
applyOrder();

// Moving a section: drag it (a computer), or Alt+Up / Alt+Down on it (the keyboard).
function moveLink(link, before) {
  sidebar.insertBefore(link, before || moreButton);
  saveOrder();
}
const dragging = { link: null };
const clearMarks = () => { for (const l of movable) l.classList.remove('drop-before', 'drop-after', 'is-dragged'); };
const phone = () => window.matchMedia('(max-width: 600px)').matches;
for (const link of movable) {
  link.draggable = true;
  link.addEventListener('dragstart', (event) => {
    if (phone()) { event.preventDefault(); return; }
    dragging.link = link;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', link.dataset.section);
    link.classList.add('is-dragged');
  });
  link.addEventListener('dragend', () => { dragging.link = null; clearMarks(); });
  link.addEventListener('dragover', (event) => {
    if (!dragging.link || dragging.link === link) return;
    event.preventDefault();
    const box = link.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    for (const l of movable) l.classList.remove('drop-before', 'drop-after');
    link.classList.add(after ? 'drop-after' : 'drop-before');
  });
  link.addEventListener('drop', (event) => {
    if (!dragging.link || dragging.link === link) return;
    event.preventDefault();
    const box = link.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    let target = after ? link.nextElementSibling : link;
    while (target && target.hidden) target = target.nextElementSibling; // a hidden module's link is skipped
    if (target && (target.classList.contains('sidebar-more') || target.classList.contains('sidebar-pinned'))) target = null;
    moveLink(dragging.link, target);
    dragging.link = null;
    clearMarks();
  });
  link.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const visible = currentMovable().filter((l) => !l.hidden);
    const at = visible.indexOf(link);
    if (event.key === 'ArrowUp' && at > 0) moveLink(link, visible[at - 1]);
    if (event.key === 'ArrowDown' && at < visible.length - 1) moveLink(link, visible[at + 1].nextElementSibling);
    link.focus();
  });
}
// Dropped on the empty space under the last section: it goes last.
sidebar.addEventListener('dragover', (event) => { if (dragging.link && event.target === sidebar) event.preventDefault(); });
sidebar.addEventListener('drop', (event) => {
  if (dragging.link && event.target === sidebar) { event.preventDefault(); moveLink(dragging.link, null); dragging.link = null; clearMarks(); }
});

// How many captures wait: in the sidebar, and named for screen readers.
export async function refreshInboxCount() {
  try {
    const { waiting } = await api.captureCount();
    inboxCount.textContent = waiting ? String(waiting) : '';
    inboxCount.hidden = waiting === 0;
    inboxCount.setAttribute('aria-label', `${waiting} waiting`);
  } catch { /* the count waits for the next try */ }
}
let afterCapture = () => {};
export const onCaptured = (callback) => { afterCapture = callback; };
whenCaptured(() => { refreshInboxCount(); afterCapture(); });
setInterval(refreshInboxCount, 60_000); // a snoozed capture comes back by itself

function showSection(path) {
  sections.forEach((section, i) => {
    if (section.owns(path)) sectionLinks[i].setAttribute('aria-current', 'page');
    else sectionLinks[i].removeAttribute('aria-current');
  });
  const inMore = sections.some((section) => section.more && section.owns(path));
  if (inMore) moreButton.setAttribute('aria-current', 'page'); else moreButton.removeAttribute('aria-current');
}

// ---- The bottom bar: a link on the left (if the screen has one), Light/Dark on the right ----

// Light or dark. public/theme.js puts the saved choice on the page before it is drawn;
// this switch changes it and remembers it in this browser. Light is the default.
const THEME_KEY = 'notes.theme';
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

const footerLink = el('div', { class: 'page-footer-link' });

// Ask your notes (assistant/2): a small box at the bottom of every page that asks the
// assistant, with the page you are on. The question is handed to the Assistant screen.
let question = null;
export const takeQuestion = () => { const asked = question; question = null; return asked; };
const askInput = el('input', { class: 'ask-input', 'aria-label': 'Ask your notes', placeholder: 'Ask your notes…', maxlength: 2000 });
const askBox = el('form', {
  class: 'ask-notes',
  onsubmit: (event) => {
    event.preventDefault();
    const text = askInput.value.trim();
    if (!text) return;
    question = { text, context: { path: location.pathname, title: document.title } };
    askInput.value = '';
    navigate('/assistant');
  },
}, icon('assistant'), askInput, el('button', { type: 'submit', class: 'button button-quiet ask-button' }, 'Ask'));
export const recentlyDeletedLink = () => el('a', { class: 'footer-link', href: '/deleted' }, icon('trash'), 'Recently deleted');

export function setFooterLink(link) {
  footerLink.replaceChildren(...(link ? [link] : []));
}

function themeSwitch() {
  const buttons = {};
  const show = () => {
    for (const [name, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(name === currentTheme()));
  };
  const choose = (theme) => {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* not kept: fine */ }
    show();
  };
  const group = el('div', { class: 'switch', role: 'group', 'aria-label': 'Theme' },
    ...['light', 'dark'].map((name) => (buttons[name] = el('button', {
      type: 'button', class: 'switch-button switch-button-text', onclick: () => choose(name),
    }, name === 'light' ? 'Light' : 'Dark'))));
  show();
  return el('footer', { class: 'page-footer' }, footerLink, askBox, micPill(), group);
}

app.append(screen, themeSwitch());

// A file dragged onto a part of the app that doesn't take files is simply ignored: the
// browser must never open it in place of the app.
for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, (event) => {
    if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
  });
}

// ---- Moving between screens ----

// A screen can ask to finish something (like saving) before the next one is drawn.
let leaveScreen = null;
export function onLeave(finish) {
  const before = leaveScreen;
  leaveScreen = before ? async () => { await before(); await finish(); } : finish;
}

// Something for the next screen to show once, such as "… deleted. Undo".
let flash = null;
export const setFlash = (value) => { flash = value; };
export const takeFlash = () => { const value = flash; flash = null; return value; };

let routes = [];

export async function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  await route();
}

async function route() {
  if (leaveScreen) {
    const leave = leaveScreen;
    leaveScreen = null;
    await leave();
  }
  setFooterLink(null);
  afterCapture = () => {};
  forgetPageNames(); // a page may have been renamed meanwhile
  showSection(location.pathname);
  askBox.hidden = /^\/assistant(\/|$)/.test(location.pathname);
  refreshInboxCount();
  for (const { path, show } of routes) {
    const match = location.pathname.match(path);
    if (match) return show(...match.slice(1));
  }
}

export function startRouter(list) {
  routes = list;
  // A link inside text (public/editor.js) asks to open its page.
  document.addEventListener('app-navigate', (event) => navigate(event.detail));
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="/"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    // Links inside text being written belong to the editor, and a kept file opens as itself.
    if (link.closest('[contenteditable="true"]') || link.getAttribute('href').startsWith('/files/')) return;
    event.preventDefault();
    navigate(link.getAttribute('href'));
  });
  window.addEventListener('popstate', () => route());
  route();
}
