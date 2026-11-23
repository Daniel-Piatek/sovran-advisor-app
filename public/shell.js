// The frame around every screen: the sidebar (Notes, Journal), the bottom bar with the
// Light/Dark switch, and moving between screens without reloading.

import { el, icon, api, request } from './ui.js';
import { openCapture, whenCaptured } from './capture.js';
import { forgetPageNames } from './editor.js';
import { moduleOn, onModulesChanged } from './modules.js';
import { micPill } from './dictation.js';

export const app = document.getElementById('app');
// Every screen draws into `screen`; the bottom bar sits below it on every screen.
export const screen = el('div');

// ---- The sidebar: on a phone, a bar along the bottom ----
// Capture on top (⌘K), then the sections. The Inbox shows how many captures wait. On a
// phone, the sections marked `more` (People, My Life, Assistant, Tour, Settings, Library) sit under a More button instead.

const sections = [
  { name: 'Notes', href: '/', icon: 'notes', owns: (path) => path === '/' || path.startsWith('/notes/') || path.startsWith('/boards') || /^\/tags(\/|$)/.test(path) },
  { name: 'Journal', href: '/journal', icon: 'journal', owns: (path) => path === '/journal' || path.startsWith('/journal/') },
  { name: 'Tasks', module: 'tasks', href: '/tasks', icon: 'task', owns: (path) => path === '/tasks' },
  { name: 'Planner', module: 'planner', href: '/planner', icon: 'planner', owns: (path) => /^\/planner(\/|$)/.test(path) },
  { name: 'Calendar', module: 'calendar', href: '/calendar', icon: 'calendar', owns: (path) => /^\/calendar(\/|$)/.test(path) },
  { name: 'Timeline', href: '/timeline', icon: 'timeline', more: true, module: 'people-plus', owns: (path) => path === '/timeline' },
  { name: 'People', href: '/people', icon: 'person', more: true, owns: (path) => /^\/(people|companies)(\/|$)/.test(path) },
  { name: 'My Life', module: 'life', href: '/life', icon: 'key_element', more: true, owns: (path) => /^\/life(\/|$)/.test(path) },
  { name: 'Reports', href: '/reports', icon: 'report', more: true, module: 'reports', owns: (path) => /^\/reports(\/|$)/.test(path) },
  { name: 'Inbox', href: '/inbox', icon: 'inbox', owns: (path) => path === '/inbox' },
  { name: 'Mail', href: '/mail', icon: 'mail', more: true, module: 'mail', owns: (path) => /^\/mail(\/|$)/.test(path) },
  { name: 'Sovran Advisor', href: '/assistant', icon: 'assistant', more: true, owns: (path) => /^\/assistant(\/|$)/.test(path) },
  // Quest and Group Circle have their own section under the others, with a thin line above (2026-11-23, the owner's wish).
  // The Sovran Quest page (quest.js, public/quest.js; module quest): your group's weeks, there while you are in a Quest group.
  { name: 'Quest', quest: true, href: '/quest', icon: 'quest-expressive', more: true, module: 'quest', owns: (path) => /^\/quest(\/|$)/.test(path) },
  // Group Circle (group-feed.js, public/group.js; module group, on in a new install): your Quest group's Announcements and Circle.
  { name: 'Group Circle', quest: true, href: '/group', icon: 'group-circle', more: true, module: 'group', owns: (path) => /^\/group(\/|$)/.test(path) },
  // The course's own page online (course.js), in a new tab; there while the module is on and an address is known.
  { name: 'Course', module: 'course', external: true, href: '#', icon: 'course', more: true, owns: () => false },
  // The Tour (tour.js): short films of the app, and of the parts you can switch on (2026-11-16, the owner's wish).
  { name: 'Tour', href: '/tour', icon: 'play', more: true, owns: (path) => path === '/tour' },
  { name: 'Settings', href: '/settings', icon: 'settings', more: true, owns: (path) => path === '/settings' },
  { name: 'Library', href: '/library', icon: 'grid', more: true, owns: (path) => path === '/library' },
];

const sidebar = document.getElementById('sidebar');
const inboxCount = el('span', { class: 'sidebar-count', hidden: true });
const groupCount = el('span', { class: 'sidebar-count', hidden: true });
const sectionLinks = sections.map((section) => el('a', { class: section.more ? 'sidebar-link in-more' : 'sidebar-link', href: section.href, 'data-section': section.name },
  icon(section.icon), el('span', {}, section.name), section.name === 'Inbox' ? inboxCount : section.name === 'Group Circle' ? groupCount : null));
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
    if (module) link.hidden = !moduleOn(module) || (sectionOf(link.dataset.section)?.external && !courseUrl) || (module === 'quest' && !inQuestGroup);
  }
  if (layoutReady) tidyLines(); // a line between two hidden sections goes too
}
let layoutReady = false;
// Quest shows only while you are in a Quest group (refreshGroupCount asks; 2026-11-23): so it is there for SQ01 by itself.
let inQuestGroup = false;
// The Course link's address comes from the app (GET /api/course); Settings tells the sidebar when it changes.
let courseUrl = '';
export async function loadCourse() {
  try { courseUrl = (await request('GET', '/api/course')).url || ''; } catch { courseUrl = ''; }
  for (const link of document.querySelectorAll('[data-section="Course"]')) {
    if (courseUrl) Object.assign(link, { href: courseUrl, target: '_blank', rel: 'noopener' });
    else { link.setAttribute('href', '#'); link.removeAttribute('target'); link.removeAttribute('rel'); }
  }
  showModuleSections();
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
// Tour, Settings and Library are pinned to the foot of the column; the others, and the lines between them, are yours to order.
const PINNED = ['Tour', 'Settings', 'Library'];
const ORDER_KEY = 'sidebar.order'; // the order before lines could be moved (2026-11-09): read once, then the layout takes over
const linkOf = (name) => sectionLinks[sections.findIndex((s) => s.name === name)];
const inQuest = (link) => Boolean(sectionOf(link.dataset.section)?.quest);
const movable = sectionLinks.filter((link) => !PINNED.includes(link.dataset.section));
const pinned = PINNED.map(linkOf);
for (const link of pinned) link.classList.add('sidebar-pinned');
const tuckButton = null; // (APP Daniel's More fold; none here)
const tuckBox = null;
// Sovran Central's name at the top of the column (2026-11-22, the owner's pick "D"): the official
// crimson crown, unchanged, beside "Sovran" in the heading face and CENTRAL spaced out under it.
const brand = el('div', { class: 'sidebar-brand', role: 'img', 'aria-label': 'Sovran Central' },
  el('img', { class: 'sidebar-brand-crown', src: '/brand/official-crimson-crown.png', alt: '' }),
  el('span', { class: 'sidebar-brand-words', 'aria-hidden': 'true' },
    el('span', { class: 'sidebar-brand-name' }, 'Sovran'), el('span', { class: 'sidebar-brand-sub' }, 'Central')));
sidebar.replaceChildren(brand, captureButton, ...movable, moreButton, moreMenu, ...pinned);
showModuleSections();

// ---- Your own sidebar (2026-11-23, the owner's wish: "so that they can customize their navigation bar and have it the way
// they want it") ----
// Every section but those pinned to the foot, and the thin lines between them, can be put in your own order, and lines added
// or taken away anywhere. The pinned tags move as one piece. Remembered in this browser. At first there is one
// line, above Quest and Group Circle (2026-11-23, the owner's wish). Arrange mode (a right click on the sidebar, or Settings >
// Sidebar) shows a grip on what moves, a small + between two sections to add a line, an × on each line, Done and Start over.
const LAYOUT_KEY = 'sidebar.layout';
const LINE = '—';
const TAGS = 'Pinned tags';
const pinnedTags = el('nav', { class: 'sidebar-tags is-movable is-block', 'aria-label': 'Pinned tags', 'data-section': TAGS, draggable: 'true', hidden: true });
for (const link of movable) { link.classList.add('is-movable'); link.draggable = true; }
const blocks = { [TAGS]: pinnedTags };
const elementOf = (token) => blocks[token] ?? (movable.includes(linkOf(token)) ? linkOf(token) : null);
const tokenOf = (item) => (item.classList.contains('sidebar-line') ? LINE : item.dataset.section);
const arrangeBar = el('div', { class: 'sidebar-arrange-bar', hidden: true },
  el('p', { class: 'sidebar-arrange-title' }, 'Arrange your sidebar'),
  el('p', { class: 'sidebar-arrange-help' }, 'Drag to move. + adds a line, × takes one away.'),
  el('div', { class: 'sidebar-arrange-buttons' },
    el('button', { type: 'button', class: 'button button-primary sidebar-arrange-done', onclick: () => stopArranging() }, icon('check'), 'Done'),
    el('button', { type: 'button', class: 'button button-quiet sidebar-arrange-reset', onclick: () => resetSidebar() }, 'Start over')));
sidebar.insertBefore(arrangeBar, captureButton);

// A thin line between sections; while you arrange, it has an × that takes it away.
const makeLine = () => el('div', { class: 'sidebar-line', role: 'separator', draggable: 'true' },
  el('button', { type: 'button', class: 'sidebar-line-remove', 'aria-label': 'Take this line away', title: 'Take this line away',
    onclick: (event) => { event.currentTarget.closest('.sidebar-line').remove(); changed(); } }, icon('close')));
const itemsIn = (box) => (box ? [...box.querySelectorAll(':scope > .is-movable, :scope > .sidebar-line')] : []);
const readList = (key) => { try { const list = JSON.parse(localStorage.getItem(key)); return Array.isArray(list) ? list : null; } catch { return null; } };
const saveLayout = () => {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(itemsIn(sidebar).map(tokenOf)));

  } catch { /* the layout just isn't kept */ }
};
// Where everything goes: the saved layout; before there is one, the order kept before lines could be moved (ORDER_KEY);
// before that, as the app comes.
function startLayout() {
  const old = readList(ORDER_KEY);
  const tucked = [];
  const quest = movable.filter(inQuest).map((l) => l.dataset.section);
  const column = (old ?? movable.filter((l) => !inQuest(l)).map((l) => l.dataset.section)).filter((n) => !quest.includes(n) && !tucked.includes(n));
  return { column: [...column, TAGS, LINE, ...quest] };
}
function applyLayout(saved = { column: readList(LAYOUT_KEY) }) {
  const first = startLayout();
  const column = saved.column ?? first.column;

  for (const line of [...itemsIn(sidebar), ...itemsIn(tuckBox)]) if (line.classList.contains('sidebar-line')) line.remove();
  const placed = new Set();
  const build = (tokens, inFold) => {
    const result = [];
    for (const token of tokens) {
      if (token === LINE) { result.push(makeLine()); continue; }
      const item = elementOf(token);
      if (!item || placed.has(item) || (inFold && item.classList.contains('is-block'))) continue;
      placed.add(item);
      result.push(item);
    }
    return result;
  };
  const top = build(column, false);
  const folded = build([], true);
  // A section the saved layout doesn't know (a new one) goes just after the one before it in the app's own order, or first.
  const order = [...first.column];
  for (const token of order) {
    const item = elementOf(token);
    if (!item || placed.has(item)) continue;
    const list = top;
    const before = order.slice(0, order.indexOf(token)).reverse().map(elementOf).find((i) => i && list.includes(i));
    list.splice(before ? list.indexOf(before) + 1 : 0, 0, item);
    placed.add(item);
  }
  for (const item of top) { sidebar.insertBefore(item, moreButton);  }

  tidyLines();
}
// A line shows only between two things you can see: never first, never last, never two together. While you arrange, all show.
function tidyLines() {
  for (const box of [sidebar, tuckBox]) {
    if (!box) continue;
    let seen = false;
    let waiting = null;
    for (const item of itemsIn(box)) {
      if (item.classList.contains('sidebar-line')) {
        item.hidden = !arranging;
        if (!arranging && seen && !waiting) waiting = item;
      } else if (!item.hidden) {
        if (waiting) { waiting.hidden = false; waiting = null; }
        seen = true;
      }
    }
  }
  for (const add of sidebar.querySelectorAll('.sidebar-add-line')) add.remove();
  if (arranging) for (const box of [sidebar, tuckBox]) if (box) drawAddButtons(box);
}
// While you arrange: a small + between two things adds a line there.
const after = (item) => (item === tuckButton ? tuckBox.nextElementSibling : item.nextElementSibling);
function drawAddButtons(box) {
  const visible = itemsIn(box).filter((item) => !item.hidden);
  visible.forEach((item, i) => {
    const next = visible[i + 1];
    if (!next || item.classList.contains('sidebar-line') || next.classList.contains('sidebar-line')) return;
    const name = item.querySelector(':scope > span:not(.icon)')?.textContent ?? item.dataset.section;
    box.insertBefore(el('button', { type: 'button', class: 'sidebar-add-line', 'aria-label': `Add a line below ${name}`, title: 'Add a line here',
      onclick: (event) => { box.insertBefore(makeLine(), event.currentTarget); changed(); } }, icon('plus')), after(item));
  });
}
function changed() { saveLayout(); tidyLines(); }

let arranging = false;
// Arrange the sidebar: from Settings, or a right click on the sidebar (a computer only).
export function arrangeSidebar() {
  if (phone()) return;
  arranging = true;
  sidebar.classList.add('is-arranging');
  arrangeBar.hidden = false;
  captureButton.hidden = true;

  tidyLines();
  sidebar.scrollTop = 0;
  arrangeBar.querySelector('.sidebar-arrange-done').focus();
}
function stopArranging() {
  arranging = false;
  sidebar.classList.remove('is-arranging');
  arrangeBar.hidden = true;
  captureButton.hidden = false;
  tidyLines();
}
// Start over: the order and the line the app came with.
export function resetSidebar() {
  try { for (const key of [LAYOUT_KEY, ORDER_KEY]) localStorage.removeItem(key); } catch { /* nothing kept */ }
  applyLayout({ column: null });
}
sidebar.addEventListener('contextmenu', (event) => {
  if (phone() || arranging) return;
  event.preventDefault();
  arrangeSidebar();
});
// While you arrange, a name doesn't open its page.
sidebar.addEventListener('click', (event) => { if (arranging && event.target.closest('a')) event.preventDefault(); }, true);
document.addEventListener('keydown', (event) => { if (arranging && event.key === 'Escape') stopArranging(); });

// Moving a section or a line: drag it (a computer), or Alt+Up / Alt+Down on it (the keyboard). `into` is the column;
// `before` something in it (or nothing: last).
function moveItem(item, before, into = sidebar) {
  if (into === tuckBox && tuckBox) { if (item.classList.contains('is-block')) return; tuckBox.insertBefore(item, before || null); if (tuckBox.hidden) setTuck(true); }
  else { sidebar.insertBefore(item, before || moreButton); if (item === tuckButton) sidebar.insertBefore(tuckBox, tuckButton.nextElementSibling); }
  changed();
}
const dragging = { item: null };
const clearMarks = () => {
  for (const i of [...itemsIn(sidebar), ...itemsIn(tuckBox)]) i.classList.remove('drop-before', 'drop-after', 'is-dragged');
  tuckButton?.classList.remove('drop-into');
};
const phone = () => window.matchMedia('(max-width: 600px)').matches;
const itemAt = (node) => {
  const item = node?.closest?.('.is-movable, .sidebar-line');
  return item && (item.parentElement === sidebar || (tuckBox && item.parentElement === tuckBox)) ? item : null;
};
const isItem = (node) => Boolean(node && (node.classList.contains('is-movable') || node.classList.contains('sidebar-line')));
const lowerHalf = (event, item) => { const box = item.getBoundingClientRect(); return event.clientY > box.top + box.height / 2; };
// Dropped on More, or on the open fold's empty space: it goes last under More.
const intoFold = (event) => Boolean(tuckBox && dragging.item && !dragging.item.classList.contains('is-block') && dragging.item !== tuckButton
  && (tuckButton.contains(event.target) || event.target === tuckBox));
sidebar.addEventListener('dragstart', (event) => {
  const item = itemAt(event.target);
  if (!item) return;
  if (phone()) { event.preventDefault(); return; }
  dragging.item = item;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', tokenOf(item));
  item.classList.add('is-dragged');
});
sidebar.addEventListener('dragend', () => { dragging.item = null; clearMarks(); });
sidebar.addEventListener('dragover', (event) => {
  if (!dragging.item) return;
  for (const i of [...itemsIn(sidebar), ...itemsIn(tuckBox)]) i.classList.remove('drop-before', 'drop-after');
  tuckButton?.classList.remove('drop-into');
  if (intoFold(event)) { event.preventDefault(); tuckButton.classList.add('drop-into'); return; }
  const item = itemAt(event.target);
  if (!item) { if (event.target === sidebar || event.target.closest('.sidebar-add-line')) event.preventDefault(); return; }
  if (item === dragging.item) return;
  event.preventDefault();
  item.classList.add(lowerHalf(event, item) ? 'drop-after' : 'drop-before');
});
sidebar.addEventListener('drop', (event) => {
  if (!dragging.item) return;
  if (intoFold(event)) { event.preventDefault(); moveItem(dragging.item, null, tuckBox); dragging.item = null; clearMarks(); return; }
  const item = itemAt(event.target) ?? event.target.closest('.sidebar-add-line');
  if (item === dragging.item) return;
  event.preventDefault();
  let target = null; // dropped on the empty space under the last one: it goes last
  const into = item?.parentElement ?? sidebar;
  if (item) {
    target = item.classList.contains('sidebar-add-line') || !lowerHalf(event, item) ? item : after(item);
    while (target && (target.hidden || target.classList.contains('sidebar-add-line') || target === dragging.item)) target = target.nextElementSibling; // skip hidden ones
    if (target && !isItem(target)) target = null;
  }
  moveItem(dragging.item, target, into);
  dragging.item = null;
  clearMarks();
});
sidebar.addEventListener('keydown', (event) => {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  const item = itemAt(event.target);
  if (!item) return;
  event.preventDefault();
  const box = item.parentElement;
  const visible = itemsIn(box).filter((i) => !i.hidden);
  const at = visible.indexOf(item);
  if (event.key === 'ArrowUp') {
    if (at > 0) moveItem(item, visible[at - 1], box);
    else if (box === tuckBox) moveItem(item, tuckButton, sidebar); // up out of the fold: just above More
  } else if (at < visible.length - 1) moveItem(item, after(visible[at + 1]), box);
  else if (box === tuckBox) moveItem(item, after(tuckButton), sidebar); // down out of the fold: just below it
  event.target.focus();
});
applyLayout();
layoutReady = true;

// Pinned tags (module tags, 2026-11-22): the tags pinned on their page (a computer only), each opening its page. Asked when
// the app opens, when a module switches, and by a tag's page when its pin changes.
export async function refreshSidebar() {
  if (!moduleOn('tags')) { pinnedTags.hidden = true; return; }
  let tags = [];
  try { tags = (await request('GET', '/api/tags')).tags.filter((t) => t.pinned).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); } catch { /* none shown */ }
  pinnedTags.replaceChildren(...tags.map((tag) => el('a', { class: 'sidebar-tag', href: `/tags/${tag.id}`, 'data-tag-id': tag.id, title: `Everything tagged ${tag.name}` },
    el('span', { class: 'tag-mark', 'aria-hidden': 'true' }, icon('tag')), el('span', { class: 'sidebar-tag-name' }, tag.name))));
  pinnedTags.hidden = tags.length === 0;
}
void refreshSidebar();
onModulesChanged(refreshSidebar);

// Group Circle: how many new posts wait in Announcements and the Circle together. Asked when the app opens, every two
// minutes while the window is in front, and by the Group Circle page when it has shown something.
export async function refreshGroupCount() {
  // With Group Circle off its count can't be asked: Quest then shows while its own module is on.
  if (!moduleOn('group')) { groupCount.hidden = true; if (!inQuestGroup) { inQuestGroup = true; showModuleSections(); } return; }
  try {
    const { counts, me } = await request('GET', '/api/group');
    const inGroup = Boolean(me?.group);
    if (inGroup !== inQuestGroup) { inQuestGroup = inGroup; showModuleSections(); }
    const waiting = (counts?.news ?? 0) + (counts?.feed ?? 0) + (counts?.flags ?? 0); // flags: the guide's, in APP Daniel
    groupCount.textContent = waiting ? String(waiting) : '';
    groupCount.hidden = waiting === 0;
    groupCount.setAttribute('aria-label', `${waiting} new`);
  } catch { groupCount.hidden = true; }
}
setTimeout(refreshGroupCount, 1500);
setInterval(() => { if (document.visibilityState === 'visible') refreshGroupCount(); }, 120_000);
onModulesChanged(refreshGroupCount);

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
  // The section's kind colour, as a thin line on top of its screen (style.css, Kinds).
  document.documentElement.dataset.section = sections.find((section) => section.owns(path))?.icon ?? '';
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
// Words for the Sovran Advisor box, not yet sent (the Quest page's starts, 2026-11-23): the chat opens with them written in.
let draft = null;
export const takeDraft = () => { const words = draft; draft = null; return words; };
export function openAssistantWith(words, id = null) { draft = String(words ?? ''); navigate(id ? `/assistant/${id}` : '/assistant'); }
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
    // Links inside text being written belong to the editor, a kept file opens as itself, and a download or a link
    // to a new tab (Settings › Phone, backups and moving) does what it says.
    if (link.closest('[contenteditable="true"]') || link.getAttribute('href').startsWith('/files/') || link.hasAttribute('download') || link.target === '_blank') return;
    event.preventDefault();
    navigate(link.getAttribute('href'));
  });
  window.addEventListener('popstate', () => route());
  route();
}
