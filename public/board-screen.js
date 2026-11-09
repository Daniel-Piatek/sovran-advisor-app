// A board opened large (/boards/:id): the same canvas as in the note, with its own page and a way back to the note.

import { el, icon, request, titleField } from './ui.js';
import { app, screen, onLeave } from './shell.js';
import { mountBoard } from './board.js';

export async function showBoard(id) {
  app.className = 'page page-wide';
  document.title = 'Board';
  let board;
  try { board = await request('GET', `/api/boards/${id}`); } catch {
    screen.replaceChildren(el('p', { class: 'empty' }, 'This board is not here any more.'));
    return;
  }
  document.title = board.title || 'Board';
  const host = el('div', { class: 'board-host board-host-large' });
  const title = titleField({
    value: board.title,
    onInput: async (value) => { document.title = value || 'Board'; try { await request('PATCH', `/api/boards/${id}`, { title: value }); } catch { /* kept on the page; saved with the next change */ } },
    onEnter: () => {},
  });
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
