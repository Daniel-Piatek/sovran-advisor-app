// A clash (advanced/writing/5): you and your assistant changed the same line. Your words are in the note; both sides are shown here and
// you choose. The choice is one more version, and your assistant is told which side won in its next turn.

import { el, request } from './ui.js';

// The Clash box: Yours and the Assistant's side by side, and three buttons.
export function clashBox(clash, { onChoose = () => {} } = {}) {
  return el('section', { class: 'clash-box', 'aria-label': 'A line you and your assistant both changed' },
    el('p', { class: 'clash-what' }, 'You and your assistant both changed this line. Yours is in the note for now.'),
    el('div', { class: 'clash-sides' },
      el('div', { class: 'clash-side', 'data-side': 'mine' }, el('h3', { class: 'clash-side-name' }, 'Yours'), el('pre', { class: 'clash-text' }, clash.mine || '(nothing)')),
      el('div', { class: 'clash-side', 'data-side': 'theirs' }, el('h3', { class: 'clash-side-name' }, 'Assistant’s'), el('pre', { class: 'clash-text' }, clash.theirs || '(nothing)'))),
    el('div', { class: 'clash-buttons', role: 'group', 'aria-label': 'Choose' },
      el('button', { type: 'button', class: 'button', onclick: () => onChoose('mine') }, 'Keep yours'),
      el('button', { type: 'button', class: 'button', onclick: () => onChoose('theirs') }, 'Take the assistant’s'),
      el('button', { type: 'button', class: 'button', onclick: () => onChoose('both') }, 'Keep both')));
}

// The open clashes of a note, under its text. onResolved runs after a choice (the note's text changed: show it).
export function clashPane({ noteId, onResolved = () => {} }) {
  const place = el('div', { class: 'clash-pane', role: 'group', 'aria-label': 'Clashes' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  async function refresh() {
    let clashes = [];
    try { clashes = await request('GET', `/api/notes/${noteId}/clashes`); } catch { return; }
    place.replaceChildren(...clashes.map((c) => clashBox(c, {
      onChoose: async (choice) => {
        try { problem.textContent = ''; await request('POST', `/api/clashes/${c.id}/resolve`, { choice }); await refresh(); onResolved(choice); } catch (err) { problem.textContent = err.message; }
      },
    })), problem);
    place.hidden = clashes.length === 0;
  }
  place.hidden = true;
  return { element: place, refresh };
}
