// The Boards tab of Notes (/boards, 2026-11-15, the owner's wish): boards of their own, each an endless whiteboard to bring notes, journal
// entries and Inbox items onto and work through ideas. Newest change first; New board makes one and opens it. Under them, the boards
// that sit inside a note (they stay where they are). Deleting a board only marks it, with Undo.

import { el, icon, request, timeAgo, undoBar } from './ui.js';
import { app, screen, navigate, setFooterLink, recentlyDeletedLink } from './shell.js';
import { notesTabs } from './notes-screens.js';

export async function showBoards() {
  document.title = 'Boards';
  app.className = 'page page-wide notes-page';
  const content = el('div', { class: 'boards-list' });
  const undoPlace = el('div', {});
  const newBoard = el('button', {
    type: 'button',
    class: 'button button-primary page-add',
    onclick: async () => {
      newBoard.disabled = true;
      try {
        const board = await request('POST', '/api/boards', { endless: true, title: '' });
        await navigate(`/boards/${board.id}`);
      } catch {
        newBoard.disabled = false;
        content.prepend(el('p', { class: 'empty' }, "The board couldn't be made. Is the app still running?"));
      }
    },
  }, icon('plus'), 'New board');
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Notes'), newBoard),
    notesTabs('boards'),
    undoPlace,
    content,
  );
  setFooterLink(recentlyDeletedLink());

  async function load() {
    let lists;
    try { lists = await request('GET', '/api/boards'); } catch {
      content.replaceChildren(el('p', { class: 'empty' }, "Your boards couldn't be loaded. Is the app still running?"));
      return;
    }
    const card = (b) => el('div', { class: 'board-tile' },
      el('a', { class: 'board-tile-link', href: `/boards/${b.id}`, 'data-board-id': b.id },
        el('h2', { class: b.title.trim() ? 'note-card-title' : 'note-card-title untitled' }, b.title.trim() || 'Untitled board'),
        b.names.length ? el('ul', { class: 'board-tile-names' }, ...b.names.map((n) => el('li', {}, n))) : el('p', { class: 'board-tile-empty' }, 'Empty'),
        el('p', { class: 'board-tile-meta' }, `${b.cards} ${b.cards === 1 ? 'card' : 'cards'} · ${timeAgo(b.updated_at)}`)),
      el('button', { type: 'button', class: 'button button-quiet board-tile-delete', 'aria-label': `Delete ${b.title.trim() || 'Untitled board'}`, onclick: async () => {
        try {
          await request('DELETE', `/api/boards/${b.id}`);
          undoPlace.replaceChildren(undoBar(`“${b.title.trim() || 'Untitled board'}” deleted.`, async () => { await request('POST', `/api/boards/${b.id}/restore`, {}); undoPlace.replaceChildren(); await load(); }));
          await load();
        } catch { content.prepend(el('p', { class: 'empty' }, "The board couldn't be deleted. Is the app still running?")); }
      } }, icon('trash')));
    content.replaceChildren(
      lists.own.length
        ? el('div', { class: 'notes note-grid boards-grid' }, ...lists.own.map(card))
        : el('div', { class: 'boards-empty' },
          el('p', {}, 'A board is an endless whiteboard. Bring your notes, journal entries and Inbox items onto it, add quick cards, join them with arrows, draw, and put them in coloured groups.'),
          el('p', { class: 'empty' }, 'No boards yet. Press New board to start one.')),
      ...(lists.in_notes.length ? [
        el('h2', { class: 'earlier-title' }, 'Boards inside notes'),
        el('ul', { class: 'boards-in-notes' }, ...lists.in_notes.map((b) => el('li', {},
          el('a', { href: `/boards/${b.id}` }, icon('board'), b.title.trim() || 'Board'), el('span', { class: 'board-tile-meta' }, ` in “${b.note_title}”`)))),
      ] : []),
    );
  }
  await load();
}
