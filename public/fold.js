// Settings: a list that keeps growing (the activity log, the releases, every use of Google…) folded behind one row:
// an arrow, how many there are, and a short line (the latest, or the release in use). Click the row and every line
// is there, as before. Closed at first; open or closed is remembered in this browser, list by list.

import { el, icon } from './ui.js';

const key = (id) => `settings-fold:${id}`;
function remembered(id) {
  try { return localStorage.getItem(key(id)) === 'open'; } catch { return false; }
}
function remember(id, open) {
  try { if (open) localStorage.setItem(key(id), 'open'); else localStorage.removeItem(key(id)); } catch { /* not kept: it opens closed next time */ }
}

// fold('activity', 'Activity', list) → a <details> with .say(count, words, note) to write its row.
export function fold(id, name, ...content) {
  const label = el('span', { class: 'fold-label' }, name);
  const note = el('span', { class: 'fold-note' });
  const box = el('details', { class: 'settings-fold', 'data-fold': id },
    el('summary', { class: 'fold-head' }, icon('chevron'), label, note),
    el('div', { class: 'fold-body' }, ...content));
  box.open = remembered(id);
  box.addEventListener('toggle', () => remember(id, box.open));
  // count: how many; words: [one, many], e.g. ['step', 'steps']; extra: the latest, or what is in use.
  box.say = (count, [one, many], extra = '') => {
    const what = count === 0 ? 'Nothing yet' : `${count} ${count === 1 ? one : many}`;
    note.textContent = extra ? `${what} · ${extra}` : what;
    box.setAttribute('data-count', String(count));
  };
  return box;
}
