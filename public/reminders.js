// Reminder notices (tasks/2, and Tasks in depth, advanced/tasks/2): when a reminder's time comes, a
// notice shows over whatever you are doing, in the Undo bar's look: Snooze (10 min, 1 h, tomorrow)
// and Done. Done ends the alarm; the task it is on stays open, because a reminder is never a task
// of its own (tick the task where you keep it). The app asks the server every half minute, and at
// once when it starts, so after sleep or a restart what is due shows once, never once per missed
// minute. With Tasks in depth switched off no notice shows; the reminders stay.

import { api, el, icon } from './ui.js';
import { timeLabel } from './due.js';
import { moduleOn, onModulesChanged } from './modules.js';

const ASK_EVERY_MS = 30_000;
const SNOOZES = [['10 min', 10, 'Snooze 10 min'], ['1 h', 60, 'Snooze 1 h'], ['Tomorrow', 'tomorrow', 'Snooze until tomorrow']];
const stack = el('div', { class: 'notices', 'aria-live': 'assertive' });
const shown = new Map(); // reminder id → its notice

// The Notice. `example` draws it for the Library: the same pieces, and nothing it does touches a task.
export function notice(reminder, { example = false } = {}) {
  const box = el('div', { class: 'undo-bar notice', role: example ? 'group' : 'alert', 'data-reminder': reminder.id });
  const settle = example ? async () => {} : async (work) => {
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await work();
      box.remove();
      shown.delete(reminder.id);
      document.dispatchEvent(new CustomEvent('tasks-changed'));
    } catch {
      box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };
  box.append(
    el('span', { class: 'notice-text' }, icon('bell'), ` ${reminder.text} · ${timeLabel(reminder.at.slice(11))}`),
    el('span', { class: 'notice-actions' },
      el('span', { class: 'notice-snooze', role: 'group', 'aria-label': 'Snooze' }, el('span', { class: 'notice-snooze-word' }, 'Snooze'),
        ...SNOOZES.map(([label, value, name]) => el('button', {
          type: 'button', class: 'button', 'aria-label': name, onclick: () => settle(() => api.changeReminder(reminder.id, { snooze: value })),
        }, label))),
      el('button', { type: 'button', class: 'button', title: 'Ends the alarm. The task stays open.', onclick: () => settle(() => api.changeReminder(reminder.id, { done: true })) }, 'Done')),
  );
  return box;
}

export async function askForReminders() {
  let due = [];
  if (moduleOn('tasks-plus')) {
    try {
      due = await api.dueReminders();
    } catch {
      return; // the app is not running: ask again later
    }
    if (!moduleOn('tasks-plus')) due = []; // the module list arrived while the server was answering
  }
  for (const reminder of due) {
    if (shown.has(reminder.id)) continue;
    const box = notice(reminder);
    shown.set(reminder.id, box);
    stack.append(box);
  }
  // One dealt with elsewhere (its task ticked in a note) goes away.
  for (const [id, box] of shown) {
    if (!due.some((r) => r.id === id)) { box.remove(); shown.delete(id); }
  }
}

document.body.append(stack);
askForReminders();
setInterval(askForReminders, ASK_EVERY_MS);
document.addEventListener('tasks-changed', () => askForReminders());
onModulesChanged(() => askForReminders());
