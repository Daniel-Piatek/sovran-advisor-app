// One person, two entries (People in depth, advanced/people/7): Possible duplicates at the top of
// People, and Compare, which opens both entries side by side. Per row you choose what to keep (the
// left, the right, or both for emails, phones, how we met and notes); Keep one entry merges them:
// everything that points at the other moves to the kept one, and the other waits in Recently
// deleted, where Restore undoes the merge. Not the same person hides the pair for good.

import { el, icon, request } from './ui.js';

let dialog = null;
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
const face = (name) => el('span', { class: 'face face-person face-small', 'aria-hidden': 'true' }, initials(name));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ROWS = [
  { key: 'name', label: 'Name', value: (p) => p.name },
  { key: 'role', label: 'Role', value: (p) => p.role },
  { key: 'company_id', label: 'Company', value: (p) => p.company_name ?? '', raw: (p) => p.company_id ?? '' },
  { key: 'emails', label: 'Emails', value: (p) => p.emails, both: true },
  { key: 'phones', label: 'Phones', value: (p) => p.phones, both: true },
  { key: 'how_met', label: 'How we met', value: (p) => p.how_met, both: true },
  { key: 'body', label: 'Notes', value: (p) => plainNotes(p.body), raw: (p) => p.body, both: true },
];
const plainNotes = (markdown) => String(markdown).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>`-]/g, '').trim();
const has = (row, p) => String((row.raw ?? row.value)(p) ?? '').trim() !== '';

// The pair as a row of the list.
function pairRow(pair, onChanged) {
  return el('div', { class: 'duplicate-row' },
    el('span', { class: 'duplicate-people' }, face(pair.a.name), el('span', {}, pair.a.name), el('span', { class: 'duplicate-and', 'aria-hidden': 'true' }, '↔'), face(pair.b.name), el('span', {}, pair.b.name)),
    el('span', { class: 'person-row-sub' }, pair.why),
    el('button', { type: 'button', class: 'button', 'aria-label': `Compare ${pair.a.name} and ${pair.b.name}`, onclick: () => openMerge(pair, { onDone: onChanged }) }, 'Compare'));
}

// The section for People: nothing at all when there are no pairs.
export async function duplicatesSection({ onChanged = () => {} } = {}) {
  const holder = el('div', {});
  async function draw() {
    let pairs = [];
    try { pairs = await request('GET', '/api/people/duplicates'); } catch { holder.replaceChildren(); return; }
    holder.replaceChildren(...(pairs.length ? [el('section', { class: 'duplicates', 'aria-label': 'Possible duplicates' },
      el('h2', { class: 'contact-heading' }, `Possible duplicates · ${pairs.length}`),
      ...pairs.map((pair) => pairRow(pair, async () => { await draw(); onChanged(); })))] : []));
  }
  await draw();
  return holder;
}

// The merge pair: both entries side by side, a choice per row.
export function mergePair(pair, { onChange = () => {} } = {}) {
  const [A, B] = [pair.a, pair.b];
  const state = { keep: 'A', rows: {}, touched: new Set() };
  const root = el('div', { class: 'merge-pair' });
  const side = (s) => (s === 'A' ? A : B);

  function defaults() {
    for (const row of ROWS) {
      if (state.touched.has(row.key)) continue;
      const other = state.keep === 'A' ? 'B' : 'A';
      const [mine, theirs] = [has(row, side(state.keep)), has(row, side(other))];
      const raw = (s) => String((row.raw ?? row.value)(side(s))).trim();
      // Both entries have something different: take both where that is possible, nothing is lost.
      if (row.both && mine && theirs && raw('A') !== raw('B')) state.rows[row.key] = 'both';
      else state.rows[row.key] = mine ? state.keep : theirs ? other : state.keep;
    }
  }

  function draw() {
    defaults();
    const head = (s) => el('label', { class: 'merge-cell merge-head' },
      el('input', { type: 'radio', name: 'merge-keep', checked: state.keep === s, onchange: () => { state.keep = s; draw(); onChange(); } }),
      face(side(s).name),
      el('span', { class: 'merge-head-text' }, el('strong', {}, side(s).name),
        el('span', { class: 'person-row-sub' }, `${plural(side(s).mention_count, 'mention', 'mentions')} · ${side(s).origin === 'imported' ? 'imported' : 'written by you'}`),
        el('span', { class: 'merge-keep-word' }, 'Keep this entry')));
    root.replaceChildren(
      el('div', { class: 'merge-row merge-row-head' }, el('span', {}), head('A'), head('B'), el('span', {})),
      ...ROWS.filter((row) => has(row, A) || has(row, B)).map((row) => {
        const cell = (s) => el('label', { class: 'merge-cell', 'data-chosen': String(state.rows[row.key] === s) },
          el('input', {
            type: 'radio', name: `merge-${row.key}`, 'aria-label': `${row.label}: ${side(s).name}’s`, checked: state.rows[row.key] === s,
            onchange: () => { state.rows[row.key] = s; state.touched.add(row.key); draw(); onChange(); },
          }),
          el('span', { class: 'merge-value' }, row.value(side(s)) || '—'));
        return el('div', { class: 'merge-row', 'data-row': row.key },
          el('span', { class: 'merge-label' }, row.label), cell('A'), cell('B'),
          row.both ? el('label', { class: 'merge-cell merge-both', 'data-chosen': String(state.rows[row.key] === 'both') },
            el('input', {
              type: 'radio', name: `merge-${row.key}`, 'aria-label': `${row.label}: both`, checked: state.rows[row.key] === 'both',
              onchange: () => { state.rows[row.key] = 'both'; state.touched.add(row.key); draw(); onChange(); },
            }), el('span', {}, 'Both')) : el('span', {}));
      }));
  }
  draw();
  // What to send: the entry to keep, the other, and per field keep / drop / both.
  const choice = () => {
    const keepSide = state.keep;
    const fields = Object.fromEntries(Object.entries(state.rows).map(([key, s]) => [key, s === 'both' ? 'both' : s === keepSide ? 'keep' : 'drop']));
    return { keep: side(keepSide).id, drop: side(keepSide === 'A' ? 'B' : 'A').id, fields };
  };
  return { element: root, choice, kept: () => side(state.keep) };
}

export function openMerge(pair, { onDone = () => {} } = {}) {
  dialog?.remove();
  let merged = false;
  const view = mergePair(pair);
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const done = el('p', { class: 'import-report', role: 'status' });
  const close = () => { dialog.close(); if (merged) onDone(); };
  const keepButton = el('button', {
    type: 'button', class: 'button button-primary',
    onclick: async () => {
      keepButton.disabled = true;
      try {
        const kept = await request('POST', '/api/people/merge', view.choice());
        merged = true;
        view.element.hidden = true;
        problem.textContent = '';
        done.replaceChildren(`Merged into ${kept.name}. The other entry waits in Recently deleted: Restore there undoes the merge.`);
        notSame.hidden = true;
      } catch (err) { problem.textContent = err.message; keepButton.disabled = false; }
    },
  }, 'Keep one entry');
  const notSame = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      try { await request('POST', '/api/people/duplicates/dismiss', { a: pair.a.id, b: pair.b.id }); merged = true; close(); } catch (err) { problem.textContent = err.message; }
    },
  }, 'Not the same person');
  dialog = el('dialog', { class: 'capture-box merge-box', 'aria-label': 'Compare two entries' },
    el('h2', { class: 'settings-title' }, 'One person, two entries?'),
    el('p', { class: 'capture-hint' }, `${pair.why[0].toUpperCase()}${pair.why.slice(1)}. Pick what to keep in each row; mentions, log lines and notes move to the entry you keep.`),
    view.element, done, problem,
    el('div', { class: 'capture-foot' }, keepButton, notSame, el('button', { type: 'button', class: 'button button-quiet', onclick: close }, 'Close')));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}
