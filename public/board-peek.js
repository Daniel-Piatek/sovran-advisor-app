// Beside an endless board (the Boards tab of Notes): what a card points at, opened to read and change without leaving the board.
// A note and a journal entry open in the same editor as their own pages and save as you type; an Inbox item is its words in a box.
// The card on the board shows the new words once the pane is closed (the board reads them live, never a copy).

import { createEditor } from './editor.js';
import { api, el, icon, makeSaver, titleField } from './ui.js';

const KIND_NAMES = { note: 'Note', journal: 'Journal entry', inbox: 'Inbox item', person: 'Person', task: 'Task' };

// Returns { element, open(item), close() }. onClosed runs after the pane is closed (the board draws its cards again).
export function boardPeek({ onClosed = () => {} } = {}) {
  const status = el('span', { class: 'board-peek-status', 'aria-live': 'polite' });
  const kind = el('span', { class: 'board-peek-kind' });
  const openLink = el('a', { class: 'button button-quiet', href: '#' }, icon('open'), 'Open the page');
  const closeButton = el('button', { type: 'button', class: 'button button-quiet board-peek-close', 'aria-label': 'Close', onclick: () => void close() }, icon('close'));
  const body = el('div', { class: 'board-peek-body' });
  const element = el('aside', { class: 'board-peek', 'aria-label': 'Open card', hidden: true },
    el('header', { class: 'board-peek-head' }, kind, status, openLink, closeButton), body);
  let current = null; // { saver, editor }

  openLink.addEventListener('click', async (event) => {
    event.preventDefault();
    const path = openLink.getAttribute('href');
    await close();
    document.dispatchEvent(new CustomEvent('app-navigate', { detail: path }));
  });
  element.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); void close(); } });

  async function close() {
    if (element.hidden) return;
    const was = current;
    current = null;
    if (was) { await was.saver?.close(); was.editor?.destroy(); }
    element.hidden = true;
    body.replaceChildren();
    onClosed();
  }

  async function open(item) {
    await close();
    const live = item.live;
    kind.textContent = KIND_NAMES[live.kind] ?? 'Card';
    openLink.setAttribute('href', live.path);
    status.textContent = '';
    element.hidden = false;
    body.replaceChildren(el('p', { class: 'empty' }, 'Opening…'));
    try {
      if (item.ref_table === 'notes') current = await openWritten(await api.getNote(item.ref_id), (id, changes, options) => api.updateNote(id, changes, options));
      else if (item.ref_table === 'journal_entries') current = await openWritten(await api.getEntry(item.ref_id), (id, changes, options) => api.updateEntry(id, changes, options), live.when);
      else if (item.ref_table === 'captures') current = openCapture(await api.getCapture(item.ref_id));
      else body.replaceChildren(el('p', {}, live.title), el('p', { class: 'empty' }, 'Open the page to change it.'));
    } catch {
      body.replaceChildren(el('p', { class: 'empty' }, "It couldn't be opened. Is the app still running?"));
    }
    element.querySelector('textarea, [contenteditable="true"]')?.focus();
  }

  // A note or a journal entry: its title and its text, in the app's editor.
  async function openWritten(page, save, when = '') {
    const saver = makeSaver((changes, options) => save(page.id, changes, options), { status });
    const title = titleField({ value: page.title ?? '', onInput: (value) => saver.change('title', value), onEnter: () => editor.focus() });
    const place = el('div', { class: 'board-peek-text' });
    body.replaceChildren(...(when ? [el('p', { class: 'board-peek-when' }, when)] : []), title.field, place);
    title.grow();
    const editor = createEditor(place, page.body ?? '', {
      label: 'Text',
      tasks: true,
      onChange: (markdown) => saver.change('body', markdown),
      onFileProblem: (message) => { status.textContent = message; },
    });
    return { saver, editor };
  }

  // An Inbox item: its words, saved as you type.
  function openCapture(capture) {
    const saver = makeSaver((changes, options) => api.updateCapture(capture.id, changes, options), { status });
    const box = el('textarea', { class: 'board-peek-capture', 'aria-label': 'Inbox item', rows: 8 });
    box.value = capture.body;
    box.addEventListener('input', () => { if (box.value.trim()) saver.change('body', box.value); });
    body.replaceChildren(box, el('p', { class: 'empty' }, 'It stays in your Inbox until you sort it there.'));
    return { saver, editor: null };
  }

  return { element, open, close };
}
