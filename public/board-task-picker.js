// The Task button of a board: every open task in a window, in the same look as Plan my day.
// Grouped by when it is due, with its estimate, Must and where it lives; find by words, tick one or several, put them on the board.
// A task that is on the board already says so and can't be ticked again.

import { el, icon, request, today, isDay } from './ui.js';
import { estimateLabel, dueLabel } from './due.js';

// onBoard: a Set of task ids on the board now. onAdd(tasks): puts the ticked ones on the board, in turn.
export async function openTaskPicker({ onBoard = new Set(), onAdd }) {
  document.querySelector('dialog.board-task-picker')?.remove();
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Find a task', 'aria-label': 'Find a task', autocomplete: 'off', spellcheck: 'false' });
  const list = el('div', { class: 'board-task-picker-list' }, el('p', { class: 'empty' }, 'Opening…'));
  const tally = el('p', { class: 'plan-dialog-tally', role: 'status' });
  const putButton = el('button', { type: 'button', class: 'button button-primary', disabled: true }, 'Put them on the board');
  const finish = () => { dialog.close(); dialog.remove(); };
  const dialog = el('dialog', {
    class: 'capture-box event-dialog plan-dialog board-task-picker', 'aria-label': 'Put tasks on the board',
    oncancel: (event) => { event.preventDefault(); finish(); },
    onclick: (event) => { if (event.target === dialog) finish(); },
  },
  el('h2', { class: 'event-read-title' }, 'Tasks'),
  el('p', { class: 'plan-dialog-free' }, 'Tick the ones you want on the board.'),
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

  let tasks = [];
  const picked = new Set();
  const showTally = () => {
    tally.textContent = picked.size ? `${picked.size} picked` : '';
    putButton.disabled = !picked.size;
    putButton.textContent = picked.size === 1 ? 'Put it on the board' : picked.size ? `Put ${picked.size} on the board` : 'Put them on the board';
  };
  const where = (t) => t.home?.title || (t.source.kind !== 'own' ? t.source.title : '');
  const row = (task) => {
    const there = onBoard.has(task.id);
    const tick = el('input', { type: 'checkbox', class: 'plan-dialog-tick', ...(there ? { checked: true, disabled: true } : {}),
      onchange: () => { if (tick.checked) picked.add(task); else picked.delete(task); showTally(); } });
    if (picked.has(task)) tick.checked = true;
    const meta = [isDay(task.due) ? dueLabel(task.due) : '', task.estimate ? estimateLabel(task.estimate) : '', task.flag === 'must' ? 'Must' : '', where(task), there ? 'On the board' : '']
      .filter(Boolean).join(' · ');
    return el('label', { class: `plan-dialog-row${there ? ' is-there' : ''}`, title: task.text }, tick,
      el('span', { class: 'plan-dialog-text' }, task.short_text || task.text, ...(meta ? [el('span', { class: 'plan-dialog-meta' }, meta)] : [])));
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = tasks.filter((t) => !t.done).filter((t) => !q || `${t.text} ${t.short_text ?? ''} ${where(t)}`.toLowerCase().includes(q));
    const now = today();
    const groups = [
      ['Missed', shown.filter((t) => isDay(t.due) && t.due < now)],
      ['Today', shown.filter((t) => t.due === now)],
      ['Upcoming', shown.filter((t) => isDay(t.due) && t.due > now)],
      ['No date', shown.filter((t) => !isDay(t.due) && t.due !== 'someday')],
      ['Someday', shown.filter((t) => t.due === 'someday')],
    ].filter(([, group]) => group.length);
    list.replaceChildren(...(groups.length
      ? groups.flatMap(([name, group]) => [el('h3', { class: 'shutdown-title' }, name, el('span', { class: 'board-task-picker-count' }, ` ${group.length}`)), ...group.map(row)])
      : [el('p', { class: 'empty' }, q ? 'No task with those words.' : 'No open tasks.')]));
  };
  search.addEventListener('input', draw);
  putButton.addEventListener('click', async () => {
    const chosen = tasks.filter((t) => picked.has(t));
    putButton.disabled = true;
    putButton.textContent = 'Putting them on…';
    finish();
    await onAdd(chosen);
  });
  showTally();
  try {
    tasks = await request('GET', '/api/tasks');
    draw();
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Your tasks couldn't be loaded. Is the app still running?"));
  }
  return dialog;
}
