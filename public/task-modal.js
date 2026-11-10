// A task in a pop-up: the one place a task is opened, made or changed, wherever it shows (the Tasks page, the
// Planner). Title, Details (its own words, apart from the title), a date, a flag, its home, Delete and Close.
// Opened on a task it saves what changed when it closes (Close, Escape, Enter in the title, a click beside it);
// opened on nothing it makes a new task with Add task, and Escape or a click beside it makes nothing.
import { api, el, undoBar } from './ui.js';
import { todayDay, parseQuickAdd, weekOf } from './due.js';
import { homeChip } from './home.js';
import { mentionField } from './mentions.js';

const isDay = (due) => /^\d{4}-\d{2}-\d{2}$/.test(due ?? '');

// task: the task to open, or null for a new one. defaults: for a new one ({ due, home_id }).
// onChanged(task): it was saved or made. onDeleted(task): it was deleted (the caller shows Undo through undoPlace).
export function openTaskModal({ task = null, defaults = {}, onChanged = () => {}, onDeleted = () => {}, undoPlace = null } = {}) {
  const making = !task;
  const own = making || task.source?.kind === 'own';
  let home = making ? (defaults.home ?? null) : task.home;
  let due = making ? (defaults.due ?? '') : task.due;
  let closing = false;
  let dueByHand = false; // a date chosen here wins over one said in the title; the Tasks page's own default does not

  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const words = own ? el('input', {
    class: 'detail-input task-edit-words', 'aria-label': 'The task’s words', maxlength: 1000, value: making ? '' : task.text,
    placeholder: making ? 'What needs doing? e.g. call Lena fri 10am !must' : '',
  }) : el('span', { class: 'capture-hint' }, 'Its words are changed in its page.');
  const mention = own ? mentionField(words) : null;
  if (!making) mention?.set(task.mentions ?? []);
  const detailsBox = el('textarea', {
    class: 'detail-input task-edit-details', 'aria-label': 'Details', rows: 7, maxlength: 20000, placeholder: 'Details, if the title needs more words.',
  }, making ? '' : (task.details ?? ''));
  const dateBox = el('input', {
    type: 'date', class: 'detail-input task-edit-date', 'aria-label': 'Date', value: isDay(due) ? due : '',
    onchange: () => { dueByHand = true; due = dateBox.value || (due === 'someday' ? 'someday' : ''); drawSomeday(); },
  });
  const somedayButton = el('button', {
    type: 'button', class: 'chip', onclick: () => {
      dueByHand = true;
      due = due === 'someday' ? '' : 'someday';
      if (due === 'someday') dateBox.value = '';
      drawSomeday();
    },
  }, 'Someday');
  const todayButton = el('button', { type: 'button', class: 'chip', onclick: () => { dueByHand = true; due = todayDay(); dateBox.value = due; drawSomeday(); } }, 'Today');
  function drawSomeday() {
    somedayButton.setAttribute('aria-pressed', String(due === 'someday'));
    todayButton.setAttribute('aria-pressed', String(due === todayDay()));
  }
  drawSomeday();
  const flagBox = el('select', { class: 'detail-input task-edit-flag', 'aria-label': 'Flag' },
    el('option', { value: '' }, 'No flag'), el('option', { value: 'like' }, 'Like'), el('option', { value: 'must' }, 'Must'));
  flagBox.value = making ? (defaults.flag ?? '') : (task.flag ?? '');
  const homePick = homeChip(home, (picked) => { home = picked ?? null; }, { compact: true });

  const finish = () => { homePick.close(); mention?.close(); dialog.close(); dialog.remove(); };

  // What changed since it was opened.
  const changes = () => {
    const found = {};
    const typed = words.value?.trim();
    if (own && typed && typed !== task.text) { found.text = typed; found.mentions = mention.mentions(); }
    if (detailsBox.value !== (task.details ?? '')) found.details = detailsBox.value;
    if (due !== task.due) found.due = due;
    if (flagBox.value !== (task.flag ?? '')) found.flag = flagBox.value;
    if ((home?.id ?? null) !== (task.home?.id ?? null)) found.home_id = home?.id ?? null;
    return found;
  };

  async function close({ save = true } = {}) {
    if (closing) return;
    closing = true;
    try {
      if (making) {
        if (save) {
          const typed = words.value.trim();
          if (!typed) { problem.textContent = 'A task needs words.'; closing = false; words.focus(); return; }
          // The title may be said the way you would say it ("call Lena fri 10am !must"): what it names fills what the boxes left empty.
          const read = parseQuickAdd(typed);
          const title = read.title.trim() || typed;
          const said = /^\d{4}-/.test(read.due) || read.due === 'someday' ? read.due : '';
          const when = dueByHand ? due : (said || due);
          const flag = flagBox.value || read.flag || '';
          const made = await api.createTask({
            text: title, ...(detailsBox.value ? { details: detailsBox.value } : {}), ...(when ? { due: when } : {}),
            ...(flag ? { flag } : {}), ...(home ? { home_id: home.id } : {}), mentions: mention.mentions(),
            ...(read.estimate ? { estimate: read.estimate } : {}), ...(read.repeat ? { repeat: read.repeat } : {}),
            ...(read.time ? { remind_time: read.time } : {}),
            ...(read.goal ? { goal_week: weekOf(/^\d{4}-/.test(when) ? when : todayDay()) } : {}),
          });
          finish();
          onChanged(made);
          return;
        }
      } else if (save) {
        const found = changes();
        if (Object.keys(found).length) {
          const saved = await api.changeTask(task.id, found);
          Object.assign(task, saved);
          finish();
          onChanged(task);
          return;
        }
      }
    } catch (err) {
      problem.textContent = err.status === 409 ? 'That task changed in its page. Close this and open it again.' : "Couldn't save. Is the app still running?";
      closing = false;
      return;
    }
    finish();
    if (!making) onChanged(task);
  }

  const remove = !making && own ? el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      try { await api.deleteTask(task.id); } catch { problem.textContent = "Couldn't delete. Is the app still running?"; return; }
      closing = true;
      finish();
      undoPlace?.replaceChildren(undoBar(`“${task.text}” deleted.`, async () => { await api.restoreTask(task.id); onChanged(task); }));
      onDeleted(task);
    },
  }, 'Delete') : null;

  const dialog = el('dialog', {
    class: 'task-edit task-modal', 'aria-label': making ? 'New task' : 'Task',
    // Escape closes it (keeping what changed, or making nothing for a new one); Enter in the title closes or adds; Enter in the details is a new line.
    onkeydown: (event) => {
      if (event.target.closest('.home-picker')) return;
      if (event.key === 'Escape') { event.preventDefault(); close({ save: !making }); return; }
      if (event.key === 'Enter' && event.target === words && words.value.trim()) { event.preventDefault(); close(); }
    },
    oncancel: (event) => { event.preventDefault(); close({ save: !making }); },
    onclick: (event) => { // a click on the dimmed page around it, not on the pop-up itself
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close({ save: !making });
    },
  },
  el('label', { class: 'task-modal-label' }, 'Title', words),
  el('label', { class: 'task-modal-label' }, 'Details', detailsBox),
  el('div', { class: 'task-modal-row' },
    el('label', { class: 'task-modal-label' }, 'Date', el('span', { class: 'task-modal-date' }, dateBox, todayButton, somedayButton)),
    el('label', { class: 'task-modal-label' }, 'Flag', flagBox)),
  el('div', { class: 'task-modal-foot' }, homePick.element, remove,
    making ? el('button', { type: 'button', class: 'button', onclick: () => close({ save: false }) }, 'Cancel') : null,
    el('button', { type: 'button', class: 'button', onclick: () => close() }, making ? 'Add task' : 'Close')),
  problem,
  !making && task.capture ? el('p', { class: 'task-capture' },
    el('span', { class: 'task-capture-when' }, `From the Inbox, captured ${new Date(task.capture.captured_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)) : null);
  document.body.append(dialog);
  dialog.showModal();
  if (own) { words.focus(); words.setSelectionRange(words.value.length, words.value.length); } else detailsBox.focus();
  return dialog;
}
