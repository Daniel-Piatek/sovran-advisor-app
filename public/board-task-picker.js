// The Task and Inbox buttons of a board: every open task, or every Inbox item, in a window in the same look as Plan my day.
// Grouped (tasks by when they are due, with time, Must and where they live; Inbox items as waiting or snoozed);
// find by words, tick one or several, put them on the board. One that is on the board already says so and can't be ticked again.

import { el, icon, request, today, isDay, timeAgo } from './ui.js';
import { estimateLabel, dueLabel } from './due.js';

// The window itself. load(): the things; groupsOf(shown): [name, things][]; textOf / metaOf / wordsOf: what a row shows and is found by.
async function openPicker({ name, heading, hint, find, none, load, groupsOf, textOf, metaOf, wordsOf, onBoard, onAdd }) {
  document.querySelector('dialog.board-task-picker')?.remove();
  const search = el('input', { type: 'search', class: 'search-input', placeholder: find, 'aria-label': find, autocomplete: 'off', spellcheck: 'false' });
  const list = el('div', { class: 'board-task-picker-list' }, el('p', { class: 'empty' }, 'Opening…'));
  const tally = el('p', { class: 'plan-dialog-tally', role: 'status' });
  const putButton = el('button', { type: 'button', class: 'button button-primary', disabled: true }, 'Put them on the board');
  const finish = () => { dialog.close(); dialog.remove(); };
  const dialog = el('dialog', {
    class: 'capture-box event-dialog plan-dialog board-task-picker', 'aria-label': name,
    oncancel: (event) => { event.preventDefault(); finish(); },
    onclick: (event) => { if (event.target === dialog) finish(); },
  },
  el('h2', { class: 'event-read-title' }, heading),
  el('p', { class: 'plan-dialog-free' }, hint),
  el('label', { class: 'search' }, icon('search'), search),
  list, tally,
  el('div', { class: 'capture-foot' },
    el('span'),
    el('span', { class: 'event-actions' },
      el('button', { type: 'button', class: 'button button-quiet', onclick: finish }, 'Cancel'),
      putButton)));
  // Esc in the search box empties it first; a second Esc closes the window.
  search.addEventListener('keydown', (event) => { if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); search.value = ''; draw(); } });
  document.body.append(dialog);
  dialog.showModal();
  search.focus();

  let things = [];
  const picked = new Set();
  const showTally = () => {
    tally.textContent = picked.size ? `${picked.size} picked` : '';
    putButton.disabled = !picked.size;
    putButton.textContent = picked.size === 1 ? 'Put it on the board' : picked.size ? `Put ${picked.size} on the board` : 'Put them on the board';
  };
  const row = (thing) => {
    const there = onBoard.has(thing.id);
    const tick = el('input', { type: 'checkbox', class: 'plan-dialog-tick', ...(there ? { checked: true, disabled: true } : {}),
      onchange: () => { if (tick.checked) picked.add(thing); else picked.delete(thing); showTally(); } });
    if (picked.has(thing)) tick.checked = true;
    const meta = [...metaOf(thing), there ? 'On the board' : ''].filter(Boolean).join(' · ');
    return el('label', { class: `plan-dialog-row${there ? ' is-there' : ''}`, title: textOf(thing) }, tick,
      el('span', { class: 'plan-dialog-text' }, textOf(thing), ...(meta ? [el('span', { class: 'plan-dialog-meta' }, meta)] : [])));
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = things.filter((t) => !q || wordsOf(t).toLowerCase().includes(q));
    const groups = groupsOf(shown).filter(([, group]) => group.length);
    list.replaceChildren(...(groups.length
      ? groups.flatMap(([title, group]) => [el('h3', { class: 'shutdown-title' }, title, el('span', { class: 'board-task-picker-count' }, ` ${group.length}`)), ...group.map(row)])
      : [el('p', { class: 'empty' }, q ? 'Nothing with those words.' : none)]));
  };
  search.addEventListener('input', draw);
  putButton.addEventListener('click', async () => {
    const chosen = things.filter((t) => picked.has(t));
    finish();
    await onAdd(chosen);
  });
  showTally();
  try {
    things = await load();
    draw();
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "It couldn't be loaded. Is the app still running?"));
  }
  return dialog;
}

// onBoard: a Set of task ids on the board now. onAdd(tasks): puts the ticked ones on the board, in turn.
export function openTaskPicker({ onBoard = new Set(), onAdd }) {
  const where = (t) => t.home?.title || (t.source.kind !== 'own' ? t.source.title : '');
  return openPicker({
    name: 'Put tasks on the board', heading: 'Tasks', hint: 'Tick the ones you want on the board.', find: 'Find a task', none: 'No open tasks.',
    load: async () => (await request('GET', '/api/tasks')).filter((t) => !t.done),
    groupsOf: (shown) => {
      const now = today();
      return [
        ['Missed', shown.filter((t) => isDay(t.due) && t.due < now)],
        ['Today', shown.filter((t) => t.due === now)],
        ['Upcoming', shown.filter((t) => isDay(t.due) && t.due > now)],
        ['No date', shown.filter((t) => !isDay(t.due) && t.due !== 'someday')],
        ['Someday', shown.filter((t) => t.due === 'someday')],
      ];
    },
    textOf: (t) => t.short_text || t.text,
    metaOf: (t) => [isDay(t.due) ? dueLabel(t.due) : '', t.estimate ? estimateLabel(t.estimate) : '', t.flag === 'must' ? 'Must' : '', where(t)],
    wordsOf: (t) => `${t.text} ${t.short_text ?? ''} ${where(t)}`,
    onBoard, onAdd,
  });
}

// onBoard: a Set of Inbox item ids on the board now. onAdd(items): puts the ticked ones on the board, in turn.
export function openInboxPicker({ onBoard = new Set(), onAdd }) {
  const firstLine = (c) => (c.body.split('\n').find((l) => l.trim()) ?? 'Inbox item').trim();
  const rest = (c) => c.body.split('\n').filter((l) => l.trim()).slice(1).join(' ').slice(0, 120);
  return openPicker({
    name: 'Put Inbox items on the board', heading: 'Inbox', hint: 'Tick the ones you want on the board. They stay in your Inbox.', find: 'Find in the Inbox', none: 'Your Inbox is empty.',
    load: async () => {
      const [waiting, snoozed] = await Promise.all([request('GET', '/api/captures'), request('GET', '/api/captures?view=snoozed')]);
      return [...waiting.map((c) => ({ ...c, snoozed: false })), ...snoozed.map((c) => ({ ...c, snoozed: true }))];
    },
    groupsOf: (shown) => [['Waiting', shown.filter((c) => !c.snoozed)], ['Snoozed', shown.filter((c) => c.snoozed)]],
    textOf: firstLine,
    metaOf: (c) => [c.captured_at ? timeAgo(c.captured_at) : '', rest(c)],
    wordsOf: (c) => c.body,
    onBoard, onAdd,
  });
}
