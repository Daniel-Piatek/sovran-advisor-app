// Help pages (module help, myICOR advanced/last/2 and 3; off in a new install): a "?" after the
// title of every view (the Help button, in the Library) opens that view's help page in a pane
// beside it; Esc or × closes it. The pages live in docs/ (docs.js) and come from GET /api/docs.
//   /help        every help page, in a list
//   /help/:id    one page, on its own (the assistant links here when it cites one)
// A page has two layers: what it is and how you use it, then "How it works", shown folded.

import markdownit from '/vendor/markdown-it/index.mjs';
import { el, icon, request } from './ui.js';
import { app, screen } from './shell.js';
import { moduleOn, onModulesChanged } from './modules.js';

const markdown = markdownit({ html: false, linkify: true });
const HOW = '## How it works';
let docs = [];

export const helpReady = loadDocs();
async function loadDocs() {
  try { docs = moduleOn('help') ? await request('GET', '/api/docs') : []; } catch { docs = []; }
  placeButtons();
}
onModulesChanged(() => { closePane(); loadDocs(); });

const docForPath = (pathname) => docs.find((d) => { try { return d.paths && new RegExp(d.paths).test(pathname); } catch { return false; } });

// A page drawn in two layers, the second folded.
export function docBody(doc, { open = false } = {}) {
  const at = doc.markdown.indexOf(HOW);
  const first = el('div', { class: 'help-text' });
  first.innerHTML = markdown.render(at === -1 ? doc.markdown : doc.markdown.slice(0, at));
  if (at === -1) return el('div', {}, first);
  const second = el('div', { class: 'help-text' });
  second.innerHTML = markdown.render(doc.markdown.slice(at + HOW.length));
  const fold = el('details', { class: 'help-how' }, el('summary', {}, 'How it works'), second);
  fold.open = open;
  return el('div', {}, first, fold);
}

// ---- The pane beside the page ----
const pane = el('aside', { class: 'help-pane', 'aria-label': 'Help', hidden: true });
document.body.append(pane);
let opener = null;
export function closePane() {
  if (pane.hidden) return;
  pane.hidden = true;
  pane.replaceChildren();
  opener?.setAttribute('aria-expanded', 'false');
  opener?.focus();
  opener = null;
}
async function openPane(doc, button) {
  if (opener === button && !pane.hidden) { closePane(); return; }
  closePane();
  opener = button;
  button.setAttribute('aria-expanded', 'true');
  let full;
  try { full = await request('GET', `/api/docs/${doc.id}`); } catch { full = { ...doc, markdown: 'This help page could not be read just now.' }; }
  const close = el('button', { type: 'button', class: 'button button-quiet help-close', 'aria-label': 'Close help', onclick: closePane }, icon('close'));
  pane.replaceChildren(
    el('header', { class: 'help-pane-top' }, el('h2', { class: 'help-pane-title' }, full.title), close),
    docBody(full),
    el('a', { class: 'help-all', href: '/help', onclick: () => closePane() }, 'All help pages'));
  pane.hidden = false;
  close.focus();
}
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !pane.hidden) { event.preventDefault(); closePane(); } });
window.addEventListener('popstate', () => closePane());
document.addEventListener('click', (event) => { if (!pane.hidden && event.target.closest?.('a[href^="/"]') && !pane.contains(event.target)) closePane(); });

// ---- The "?" after every title ----
const TITLES = 'h1.top-bar-title';
function placeButtons() {
  const doc = docForPath(location.pathname);
  // The "?" sits inside the title, after its words, so the page's header keeps its own layout (2026-11-12, the
  // owner's report: beside the title it took a column of its own on My Life, Mail and the Assistant).
  for (const title of document.querySelectorAll(`#app ${TITLES}`)) {
    const has = title.querySelector(':scope > .help-button');
    if (!doc) { has?.remove(); continue; }
    if (has?.dataset.doc === doc.id) continue;
    has?.remove();
    const button = el('button', {
      type: 'button', class: 'help-button', 'data-doc': doc.id, 'aria-label': `Help: ${doc.title}`, title: `Help: ${doc.title}`, 'aria-expanded': 'false',
    }, '?');
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openPane(doc, button); });
    title.append(button);
  }
}
new MutationObserver(() => { if (docs.length || document.querySelector('#app .help-button')) placeButtons(); })
  .observe(document.getElementById('app'), { childList: true, subtree: true });

// ---- /help and /help/:id ----
export async function showHelp(id) {
  document.title = 'Help';
  app.className = 'page';
  closePane();
  await helpReady;
  if (!docs.length) {
    screen.replaceChildren(el('header', { class: 'top-bar' }, el('h1', {}, 'Help')),
      el('p', { class: 'empty' }, 'Help pages are switched off. Switch them on in Settings › Modules.'));
    return;
  }
  if (!id) {
    screen.replaceChildren(el('header', { class: 'top-bar' }, el('h1', {}, 'Help')),
      el('p', { class: 'empty' }, 'A short page for each part of the app. The “?” after a page’s title opens its page beside it.'),
      el('ul', { class: 'help-list' }, ...docs.map((d) => el('li', {}, el('a', { class: 'help-list-link', href: `/help/${d.id}` }, d.title)))));
    return;
  }
  let doc;
  try { doc = await request('GET', `/api/docs/${id}`); } catch { doc = null; }
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('a', { class: 'back-link', href: '/help' }, icon('back'), ' Help')),
    ...(doc ? [el('h1', { class: 'help-page-title' }, doc.title), docBody(doc, { open: true })] : [el('p', { class: 'empty' }, 'There is no such help page.')]));
}
