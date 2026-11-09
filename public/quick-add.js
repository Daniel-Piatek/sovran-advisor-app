// The Tasks app's add bar (tasks/2): one line the way you would say it.
//   call the dentist tomorrow ~10m !must 9am every monday
// What it understood shows as chips while you type: the day (today, fri, 14 oct,
// someday), a time (a reminder), an estimate (15 minutes or less is a Speedy, a longer
// one a Task; over three hours it suggests splitting, but never stops you), a repeat and the Must or Like flag.
// Every other word stays in the title. On the same line, boxes for the day, the flag and
// the home (a Home… chip), and Add: the words fill the day and flag boxes as you type,
// and a box changed by hand keeps what was chosen.
// It sits at the top of the Tasks page, and q opens it in a box from anywhere.

import { api, el, icon } from './ui.js';
import { homeChip } from './home.js';
import { mentionField, mentionChip } from './mentions.js';
import { moduleOn } from './modules.js';
import {
  parseQuickAdd, dueLabel, estimateLabel, timeLabel, taskKind, repeatLabel, SPLIT_OVER, weekOf, todayDay,
} from './due.js';

const chip = (shape, text) => el('span', { class: 'due-chip' }, ...(shape ? [icon(shape), ' '] : []), text);
// ★ a Weekly Goal (time/3), ☆ not one: a task you want done this week because it moves
// something that matters. A click marks it for the week of its day (or this week).
export function starButton(task, changed) {
  const goal = Boolean(task.goal_week);
  return el('button', {
    type: 'button', class: 'task-star', 'aria-pressed': String(goal), tabindex: -1,
    'aria-label': goal ? `“${task.text}” is a Weekly Goal. Unmark it` : `Make “${task.text}” a Weekly Goal`,
    title: goal ? 'A Weekly Goal' : 'Make it a Weekly Goal',
    onclick: async () => {
      const week = goal ? '' : weekOf(/^\d{4}-/.test(task.due) ? task.due : todayDay());
      try { changed(await api.changeTask(task.id, { goal_week: week })); } catch { /* stays as it was */ }
    },
  }, goal ? '★' : '☆');
}

// The Speedy mark and its Task twin (Tasks in depth, advanced/tasks/1): what an estimate makes a task, in
// a shape and in words, never in colour alone: a bolt for a Speedy, a box for a Task, then the minutes.
export function kindMark(minutes) {
  const kind = taskKind(minutes);
  if (!kind) return null;
  return el('span', { class: 'due-chip kind-mark', 'data-kind': kind, title: kind === 'speedy' ? 'A Speedy: 15 minutes or less. Run them together in a batch.' : 'A Task: it gets its own time in your plan.' },
    icon(kind === 'speedy' ? 'speedy' : 'task'), ` ${kind === 'speedy' ? 'Speedy' : 'Task'} · ${estimateLabel(minutes)}`);
}

// The Repeat chip: the rule in words on a task row ("Every Monday"), with the repeat shape.
export const repeatChip = (rule) => el('span', { class: 'due-chip repeat-chip', title: `Repeats: ${rule}` }, icon('repeat'), ` ${repeatLabel(rule)}`);

export const flagChip = (flag) => el('span', { class: `flag-chip flag-${flag}` }, flag === 'must' ? 'Must' : 'Like');

// What a line was read as, as chips: what the day and flag boxes can't show.
function chipsFor(read) {
  return [
    read.due === 'someday' ? chip(null, dueLabel(read.due)) : null,
    read.time ? chip('bell', timeLabel(read.time)) : null,
    read.estimate ? chip(null, `${estimateLabel(read.estimate)}${moduleOn('tasks-plus') ? ` · ${taskKind(read.estimate) === 'speedy' ? 'Speedy' : 'Task'}` : ''}`) : null,
    read.repeat ? chip('repeat', repeatLabel(read.repeat)) : null,
    read.goal ? chip(null, '★ Weekly Goal') : null,
  ].filter(Boolean);
}

// The bar. onAdded(task) runs after a task is added; `home` starts it at a home; `value`
// fills it (a capture's words, in the Inbox). `submit(fields)` adds the task another way
// (the Inbox sorts its capture into it); onEscape runs on Escape. `accent` makes Add the
// screen's one accent (on the Tasks page).
export function addBar({
  onAdded = () => {}, home = null, value = '', placeholder = 'Add a task',
  submit = (fields) => api.createTask(fields), onEscape = null, accent = false,
} = {}) {
  let chosenHome = home;
  const input = el('input', {
    class: 'search-input', 'aria-label': 'Add a task', placeholder, autocomplete: 'off', maxlength: 1000,
    oninput: () => draw(),
    onkeydown: (event) => {
      if (event.key === 'Enter') { event.preventDefault(); add(); }
      if (event.key === 'Escape' && onEscape) { event.preventDefault(); onEscape(); }
    },
  });
  input.value = value;
  // @ and a few letters: people, @@ companies (People in depth). Who was picked shows as chips.
  const mention = mentionField(input, { onChange: () => draw() });
  const chips = el('span', { class: 'quick-chips', 'aria-live': 'polite' });
  const homePicker = homeChip(chosenHome, (picked) => { chosenHome = picked; input.focus(); }, { compact: true });
  // Set by hand, a box keeps its choice; until then it follows the words.
  let dayByHand = false;
  let flagByHand = false;
  const dayBox = el('input', {
    type: 'date', class: 'detail-input quick-day', 'aria-label': 'Day',
    onchange: () => { dayByHand = true; },
  });
  const flagBox = el('select', {
    class: 'detail-input quick-flag', 'aria-label': 'Flag',
    onchange: () => { flagByHand = true; },
  }, el('option', { value: '' }, 'No flag'), el('option', { value: 'must' }, 'Must'), el('option', { value: 'like' }, 'Like'));
  const addButton = el('button', { type: 'button', class: accent ? 'button button-primary' : 'button', onclick: () => add() },
    icon('plus'), 'Add');
  const hint = el('p', { class: 'capture-hint quick-hint' });
  const message = el('p', { class: 'capture-hint quick-message', role: 'status' });

  function draw() {
    const read = parseQuickAdd(input.value);
    chips.replaceChildren(...chipsFor(read), ...(moduleOn('people-plus') ? mention.chosen().map((m) => mentionChip(m, { link: false })) : []));
    if (!dayByHand) dayBox.value = /^\d{4}-/.test(read.due) ? read.due : '';
    if (!flagByHand) flagBox.value = read.flag || '';
    hint.textContent = read.estimate > SPLIT_OVER ? 'Over three hours: it may be worth splitting into smaller tasks.' : '';
    if (input.value) message.textContent = '';
  }

  async function add() {
    const read = parseQuickAdd(input.value);
    if (!read.title.trim()) { message.textContent = input.value.trim() ? 'A task needs words besides its day and time.' : ''; return; }
    try {
      // The boxes say the day and flag; someday has no date, so it comes from the words.
      const due = dayBox.value || (!dayByHand && read.due === 'someday' ? 'someday' : '');
      const task = await submit({
        text: read.title, due, flag: flagBox.value, estimate: read.estimate, repeat: read.repeat,
        home_id: chosenHome?.id ?? null, ...(read.time ? { remind_time: read.time } : {}),
        ...(mention.mentions().length ? { mentions: mention.mentions() } : {}),
        // * : a Weekly Goal for the week of its day (or this week).
        ...(read.goal ? { goal_week: weekOf(/^\d{4}-/.test(due) ? due : todayDay()) } : {}),
      });
      input.value = '';
      mention.clear();
      dayByHand = false;
      flagByHand = false;
      chosenHome = home;
      homePicker.set(home);
      draw();
      message.textContent = `Added “${task.text}”${task.due ? ` to ${dueLabel(task.due)}` : ''}.`;
      onAdded(task);
    } catch (err) {
      message.textContent = `That couldn't be added: ${err.message}`;
    }
  }

  // One line: the words, then the day, the flag, the home and Add; under it, what else
  // it understood.
  const element = el('div', { class: 'quick-add' },
    el('div', { class: 'quick-row' },
      el('label', { class: 'quick-words' }, icon('plus'), input),
      dayBox, flagBox, homePicker.element, addButton),
    el('div', { class: 'quick-line' }, chips),
    hint, message);
  draw();
  return { element, focus: () => input.focus(), close: () => { homePicker.close(); mention.close(); } };
}

// ---- q from anywhere: the bar in a box ----

let dialog = null;
let bar = null;
let cameFrom = null;

function closeBox() {
  bar?.close();
  if (dialog?.open) dialog.close();
  cameFrom?.focus?.({ preventScroll: true });
  cameFrom = null;
}

export function openQuickAdd() {
  if (!dialog) {
    bar = addBar({
      onAdded: (task) => {
        document.dispatchEvent(new CustomEvent('tasks-changed', { detail: task }));
        closeBox();
      },
    });
    dialog = el('dialog', { class: 'capture-box quick-box', 'aria-label': 'Add a task' },
      bar.element,
      el('div', { class: 'capture-foot' }, el('span', { class: 'capture-hint' }, 'Enter adds · Esc closes')));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeBox(); });
    dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) closeBox(); });
    document.body.append(dialog);
  }
  if (dialog.open) { bar.focus(); return; }
  cameFrom = document.activeElement;
  dialog.showModal();
  bar.focus();
}

// q, while not typing somewhere: the Tasks page's own bar if it is open, else the box.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'q' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!moduleOn('tasks-plus')) return; // q belongs to Tasks in depth: off, the key does nothing
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
  event.preventDefault();
  const own = document.querySelector('.tasks-page .quick-add input');
  if (own) own.focus(); else openQuickAdd();
});
