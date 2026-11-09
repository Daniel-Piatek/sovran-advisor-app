// Closing the day (time/4), on the Planner: ⇧X (or Close the day under the day) opens a
// short dialog. It says whether the Highlight was done, not done or moved, lists what got
// done, lets you choose for each task left whether it stays in Missed, moves to tomorrow
// or loses its day (by default as the Missed setting says), and takes the day in one line.
// The line goes in the journal too. A closed day says so at its top, with Reopen.
// No score, no streak.

import { el, icon, request, today, addDays, dateOf } from './ui.js';

export const shutdownApi = {
  close: (day, input) => request('PUT', `/api/shutdown/${day}`, input),
  reopen: (day) => request('DELETE', `/api/shutdown/${day}`),
};

const LEAVE = { missed: 'Missed', tomorrow: 'Tomorrow', no_day: 'No day' };
const OUTCOMES = { done: 'Done', not_done: 'Not done', moved: 'Moved' };

// A row of choices, one pressed (the Day/Week switch's look).
export function choices(options, chosen, label, onChange) {
  let value = chosen;
  const group = el('div', { class: 'switch shutdown-choice', role: 'group', 'aria-label': label });
  const draw = () => { for (const b of group.children) b.setAttribute('aria-pressed', String(b.dataset.value === value)); };
  group.append(...Object.entries(options).map(([key, name]) => el('button', {
    type: 'button', class: 'switch-button switch-button-text', 'data-value': key,
    onclick: () => { value = key; draw(); onChange?.(key); },
  }, name)));
  draw();
  return { group, get value() { return value; }, set value(v) { value = v; draw(); } };
}

// The dialog. plan is the Planner's day; closed() runs once the day is closed.
export function openShutdown(dialog, plan, { closed }) {
  const { day } = plan;
  const target = addDays(day, 1) < today() ? today() : addDays(day, 1);
  const leaveNames = { ...LEAVE, tomorrow: target === today() ? 'Today' : 'Tomorrow' };
  const fallback = plan.settings.missed === 'carry' ? 'tomorrow' : 'missed';
  const highlight = plan.tasks.find((t) => t.id === plan.highlight_id);
  const done = plan.tasks.filter((t) => t.done);
  const left = plan.tasks.filter((t) => !t.done && t !== highlight);
  const outcome = highlight && !highlight.done ? choices(OUTCOMES, 'not_done', 'What became of the Highlight') : null;
  const rows = left.map((task) => ({ task, choice: choices(leaveNames, fallback, `Where “${task.text}” goes`) }));
  const line = el('input', {
    class: 'detail-input shutdown-line', 'aria-label': 'The day in one line', placeholder: 'The day in one line',
    maxlength: 300, value: plan.closed?.line ?? '',
  });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const planned = plan.tasks.length;

  async function save() {
    try {
      await shutdownApi.close(day, {
        line: line.value,
        highlight: highlight ? (highlight.done ? 'done' : outcome.value) : '',
        leave: Object.fromEntries(rows.map(({ task, choice }) => [task.id, choice.value])),
      });
      dialog.close();
      await closed();
    } catch (err) {
      problem.textContent = err.message;
    }
  }

  dialog.replaceChildren(
    el('h2', { class: 'event-read-title' }, `Close the day · ${dateOf(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`),
    ...(highlight ? [el('div', { class: 'shutdown-row shutdown-highlight' },
      el('span', { class: 'shutdown-label' }, 'Highlight'),
      el('span', { class: 'shutdown-text' }, `★ ${highlight.text}`),
      highlight.done ? el('span', { class: 'plan-free' }, 'Done') : outcome.group)] : []),
    el('h3', { class: 'shutdown-title' }, planned ? `Done today · ${done.length} of ${planned} planned` : 'Nothing was planned today'),
    ...done.map((t) => el('div', { class: 'shutdown-row', 'data-checked': 'true' },
      el('span', { class: 'task-box', 'aria-hidden': 'true' }, '✓'), el('span', { class: 'shutdown-text' }, t.text))),
    ...(rows.length ? [
      el('h3', { class: 'shutdown-title' }, `Left · ${rows.length}`,
        el('button', {
          type: 'button', class: 'button button-quiet shutdown-all',
          onclick: () => { for (const r of rows) r.choice.value = 'tomorrow'; },
        }, `All to ${leaveNames.tomorrow.toLowerCase()}`)),
      ...rows.map(({ task, choice }) => el('div', { class: 'shutdown-row' },
        el('span', { class: 'task-box', 'aria-hidden': 'true' }), el('span', { class: 'shutdown-text' }, task.text), choice.group)),
    ] : []),
    line,
    problem,
    el('div', { class: 'capture-foot' },
      el('span', { class: 'event-actions' }, el('button', { type: 'button', class: 'button button-quiet', onclick: () => dialog.close() }, 'Cancel')),
      el('button', { type: 'button', class: 'button button-primary', onclick: save }, 'Close the day')),
  );
  dialog.onkeydown = (e) => { if (e.key === 'Enter' && e.target === line) { e.preventDefault(); save(); } };
  dialog.showModal();
  line.focus();
}

// At the top of a closed day: Day closed, the counts, the line, and Reopen.
export function closedBar(close, day, { reopen }) {
  return el('section', { class: 'day-closed', 'aria-label': 'Day closed' },
    el('div', { class: 'day-closed-head' },
      el('span', { class: 'day-closed-chip' }, icon('moon'), 'Day closed'),
      el('span', { class: 'plan-free' }, close.counts_line),
      el('button', { type: 'button', class: 'button button-quiet day-closed-reopen', onclick: reopen }, 'Reopen')),
    ...(close.line ? [el('p', { class: 'day-closed-line' }, `“${close.line}”`)] : []),
    el('a', { class: 'day-closed-journal', href: `/journal/${day}` }, 'In your journal', icon('right')));
}
