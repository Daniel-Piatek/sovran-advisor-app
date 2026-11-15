// A board opened large (/boards/:id): the same canvas as in the note, with its own page and a way back to the note.
// A board of its own (the Boards tab of Notes) fills the page: on its left your notes, journal entries and Inbox items, found by their words,
// to drag onto the board or add with a press; on its right, what a card points at, opened to read and change (public/board-peek.js).

import { el, icon, request, titleField } from './ui.js';
import { app, screen, onLeave } from './shell.js';
import { mountBoard } from './board.js';
import { boardPeek } from './board-peek.js';

const SEARCH_AFTER_MS = 150;
const SOURCES_KEY = 'board.sources';

export async function showBoard(id) {
  app.className = 'page page-wide';
  document.title = 'Board';
  let board;
  try { board = await request('GET', `/api/boards/${id}`); } catch {
    screen.replaceChildren(el('p', { class: 'empty' }, 'This board is not here any more.'));
    return;
  }
  document.title = board.title || 'Board';
  const title = titleField({
    value: board.title,
    onInput: async (value) => { document.title = value || 'Board'; try { await request('PATCH', `/api/boards/${id}`, { title: value }); } catch { /* kept on the page; saved with the next change */ } },
    onEnter: () => {},
  });
  if (board.endless) { await showOwnBoard(id, board, title); return; }
  const host = el('div', { class: 'board-host board-host-large' });
  screen.replaceChildren(
    el('header', { class: 'note-bar' }, board.note_id
      ? el('a', { class: 'back-link', href: `/notes/${board.note_id}`, 'aria-label': `Back to ${board.note_title}` }, icon('back'), board.note_title)
      : el('a', { class: 'back-link', href: '/' }, icon('back'), 'Notes')),
    title.field,
    host,
  );
  title.grow();
  const mounted = await mountBoard(host, id, { large: true });
  onLeave(() => mounted.destroy());
}

// The list beside the board: what can be brought onto it, in three parts. Each one can be dragged onto the board or added with its +.
function sourcesPane({ onAdd }) {
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Find notes, journal, Inbox', 'aria-label': 'Find something to put on the board', autocomplete: 'off', spellcheck: 'false' });
  const results = el('div', { class: 'board-sources-results' });
  const element = el('aside', { class: 'board-sources', 'aria-label': 'Put on the board' },
    el('label', { class: 'search' }, icon('search'), search),
    el('p', { class: 'board-sources-hint' }, 'Drag one onto the board, or press +.'),
    results);
  let onBoard = new Set();
  let found = { notes: [], journal: [], inbox: [] };
  let timer = null;
  let run = 0;

  const row = (f) => {
    const there = onBoard.has(`${f.ref_table}:${f.ref_id}`);
    const node = el('li', { class: `board-source${there ? ' is-there' : ''}`, draggable: 'true', 'data-ref': `${f.ref_table}:${f.ref_id}` },
      el('span', { class: 'board-source-words' },
        el('span', { class: 'board-source-title' }, f.title),
        ...(f.when || f.sub ? [el('span', { class: 'board-source-sub' }, [f.when, f.sub].filter(Boolean).join(' · '))] : []),
        ...(there ? [el('span', { class: 'board-source-there' }, 'On the board')] : [])),
      el('button', { type: 'button', class: 'button button-quiet board-source-add', 'aria-label': `Put “${f.title}” on the board`, onclick: () => onAdd(f) }, icon('plus')));
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-board-ref', JSON.stringify({ ref_table: f.ref_table, ref_id: f.ref_id }));
      event.dataTransfer.setData('text/plain', f.title);
      event.dataTransfer.effectAllowed = 'copy';
    });
    return node;
  };
  const part = (name, kind, list) => el('section', { class: `board-sources-part is-${kind}`, 'aria-label': name },
    el('h2', { class: 'board-sources-title' }, icon(kind), name),
    list.length ? el('ul', { class: 'board-sources-list' }, ...list.map(row)) : el('p', { class: 'empty' }, search.value.trim() ? 'Nothing with those words.' : 'Nothing here yet.'));
  const draw = () => results.replaceChildren(part('Notes', 'notes', found.notes), part('Journal', 'journal', found.journal), part('Inbox', 'inbox', found.inbox));
  const find = async () => {
    const mine = ++run;
    try {
      const next = await request('GET', `/api/board-sources?q=${encodeURIComponent(search.value)}`);
      if (mine !== run) return;
      found = next;
      draw();
    } catch { results.replaceChildren(el('p', { class: 'empty' }, "Your notes couldn't be loaded. Is the app still running?")); }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, SEARCH_AFTER_MS); });
  search.addEventListener('keydown', (event) => { if (event.key === 'Escape' && search.value) { search.value = ''; void find(); } });
  void find();
  return {
    element,
    // Which of them are on the board now: they say so.
    setBoard(board) { onBoard = new Set(board.items.filter((i) => i.ref_table).map((i) => `${i.ref_table}:${i.ref_id}`)); draw(); },
  };
}

async function showOwnBoard(id, board, title) {
  app.className = 'page page-wide page-board';
  const host = el('div', { class: 'board-host board-host-own' });
  let mounted = null;
  const peek = boardPeek({ onClosed: () => mounted?.refresh() });
  const sources = sourcesPane({ onAdd: (f) => mounted?.addAt({ kind: 'card', ref_table: f.ref_table, ref_id: f.ref_id }) });
  // The notes list: open on a large screen and closed on a phone at first; Hide notes / Show notes, remembered in this browser.
  let listOpen = (() => { try { const kept = localStorage.getItem(SOURCES_KEY); return kept ? kept === 'open' : window.matchMedia('(min-width: 900px)').matches; } catch { return true; } })();
  const toggle = el('button', { type: 'button', class: 'button button-quiet board-sources-toggle' });
  const layout = el('div', { class: 'board-layout' }, sources.element, host, peek.element);
  const showList = () => {
    sources.element.hidden = !listOpen;
    layout.classList.toggle('has-sources', listOpen);
    toggle.setAttribute('aria-expanded', String(listOpen));
    toggle.replaceChildren(icon('notes'), listOpen ? 'Hide notes' : 'Show notes');
  };
  toggle.addEventListener('click', () => { listOpen = !listOpen; try { localStorage.setItem(SOURCES_KEY, listOpen ? 'open' : 'closed'); } catch { /* not kept */ } showList(); });
  showList();

  // Full screen: the board (with the notes list and an opened card, if shown) fills the whole screen, over the sidebar and the page.
  // The browser's own full screen where it has one; Esc or Exit full screen goes back.
  const fullButton = el('button', { type: 'button', class: 'button button-quiet board-full-toggle' });
  const isFull = () => layout.classList.contains('is-full');
  const drawFull = () => fullButton.replaceChildren(isFull() ? 'Exit full screen' : 'Full screen');
  const setFull = async (on) => {
    layout.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('board-is-full', on);
    drawFull();
    try {
      if (on && !document.fullscreenElement) await layout.requestFullscreen?.();
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* the browser said no: the board still fills the window */ }
  };
  fullButton.addEventListener('click', () => void setFull(!isFull()));
  const onFullChange = () => { if (!document.fullscreenElement && isFull()) void setFull(false); };
  const onKey = (event) => { if (event.key === 'Escape' && isFull() && !event.defaultPrevented) void setFull(false); };
  document.addEventListener('fullscreenchange', onFullChange);
  document.addEventListener('keydown', onKey);
  drawFull();

  screen.replaceChildren(
    el('header', { class: 'note-bar board-own-bar' }, el('a', { class: 'back-link', href: '/boards' }, icon('back'), 'Boards')),
    title.field,
    layout,
  );
  title.grow();
  if (!board.title.trim()) title.field.placeholder = 'Name this board';
  mounted = await mountBoard(host, id, {
    large: true,
    onPeek: (item) => void peek.open(item),
    onChange: (next) => sources.setBoard(next),
    leadTools: [toggle],
    tools: [el('div', { class: 'board-view-tools', role: 'group', 'aria-label': 'View' }, fullButton)],
  });
  // A new board starts with its name.
  if (!board.title.trim() && !board.items.length) title.field.focus();
  onLeave(async () => {
    document.removeEventListener('fullscreenchange', onFullChange);
    document.removeEventListener('keydown', onKey);
    if (isFull()) await setFull(false);
    await peek.close();
    mounted.destroy();
  });
}
