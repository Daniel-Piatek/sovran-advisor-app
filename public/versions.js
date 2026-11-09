// Versions of a note (advanced/writing/4): the clock in a note's header opens them, newest first, each with its author, time and what
// changed. Pick two to see the words that changed (added marked, removed struck through); pick one to read it and Restore it: the old text
// comes back as the next version, never over one.

import { el, icon, request, timeAgo } from './ui.js';

export const AUTHOR_WORDS = { me: 'You', assistant: 'Your assistant' };

// The Version list: a row each, newest first. selected: ids picked (at most two).
export function versionList(versions, { selected = [], onPick = () => {} } = {}) {
  return el('ol', { class: 'version-list', 'aria-label': 'Versions' }, ...versions.map((v) => el('li', {},
    el('button', { type: 'button', class: 'version-row', 'aria-pressed': String(selected.includes(v.id)), 'data-seq': String(v.seq), onclick: () => onPick(v.id) },
      el('span', { class: 'version-seq' }, `Version ${v.seq}`),
      el('span', { class: 'version-what' }, v.label ? `${v.label} · ${v.summary}` : v.summary),
      el('span', { class: 'version-who' }, `${AUTHOR_WORDS[v.author]} · ${timeAgo(v.created_at)}`)))));
}

// Words that changed: added marked, removed struck through.
export function diffView(parts) {
  return el('p', { class: 'version-diff', 'aria-label': 'What changed' }, ...parts.map((p) => (p.t === 'same' ? p.text : el(p.t === 'add' ? 'ins' : 'del', { class: `diff-${p.t}` }, p.text))));
}

// The dialog. onRestored(note) runs after a restore.
export async function openVersions(noteId, { onRestored = () => {} } = {}) {
  const dialog = el('dialog', { class: 'capture-box versions-box', 'aria-label': 'Versions' });
  const list = el('div', { class: 'versions-list-place' });
  const view = el('div', { class: 'versions-view', 'aria-live': 'polite' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  dialog.append(el('h2', { class: 'settings-title' }, 'Versions'),
    el('p', { class: 'capture-hint' }, 'Every save is kept. Pick two to see what changed; pick one to read it or bring it back. Restoring never writes over a version: it becomes the next one.'),
    el('div', { class: 'versions-grid' }, list, view), problem,
    el('button', { type: 'button', class: 'button button-quiet', onclick: () => { dialog.close(); dialog.remove(); } }, 'Close'));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  let versions = [];
  let selected = [];
  const draw = async () => {
    list.replaceChildren(versionList(versions, { selected, onPick: pick }));
    problem.textContent = '';
    try {
      if (selected.length === 2) {
        const diff = await request('GET', `/api/note-versions/compare?a=${selected[0]}&b=${selected[1]}`);
        view.replaceChildren(el('h3', { class: 'versions-heading' }, `Version ${diff.from.seq} to version ${diff.to.seq}`), diffView(diff.parts));
      } else if (selected.length === 1) {
        const v = await request('GET', `/api/note-versions/${selected[0]}`);
        view.replaceChildren(el('h3', { class: 'versions-heading' }, `Version ${v.seq}`), el('pre', { class: 'version-text' }, v.body || '(empty)'),
          el('button', { type: 'button', class: 'button', onclick: async () => {
            try { const note = await request('POST', `/api/note-versions/${v.id}/restore`, {}); dialog.close(); onRestored(note); } catch (err) { problem.textContent = err.message; }
          } }, 'Restore this version'));
      } else view.replaceChildren(el('p', { class: 'empty' }, 'Pick a version.'));
    } catch (err) { problem.textContent = err.message; }
  };
  function pick(id) {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id].slice(-2);
    void draw();
  }
  try { versions = await request('GET', `/api/notes/${noteId}/versions`); } catch { problem.textContent = "The versions couldn't be loaded."; return dialog; }
  selected = versions.length >= 2 ? [versions[1].id, versions[0].id] : versions.length ? [versions[0].id] : [];
  await draw();
  return dialog;
}

// The clock in a note's header, with how many versions there are.
export function clockButton(count, onOpen) {
  return el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Versions: ${count}`, title: 'Versions of this note', onclick: onOpen }, icon('clock'), el('span', { class: 'version-count' }, String(count)));
}
