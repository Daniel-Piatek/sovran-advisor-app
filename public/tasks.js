// The Tasks app (tasks/1, tasks/2): every task from every note, journal entry, person and
// company, and the tasks of their own, seen through a few views (tabs, each on a number
// key, kept in the address as ?view=):
//   Today         Missed (a past day, not done: it keeps its old date and never moves by
//                 itself), then today's, Must first, then Like
//   Upcoming      the next seven days, one group per day, then Later
//   Speedies      the short ones (under fifteen minutes) without a day
//   Reminders     the tasks with a reminder waiting, soonest first
//   Someday       the ones put off on purpose
//   Needs a date  the ones with no day yet
//   All           everything open
//   Done          the most recently done first
// A task in a page is a line there; ticking or moving it here changes that line, because
// it is one task shown in two places. Each row ends with three columns: its Schedule, its home in My Life, and the page it is written in.
// Keys: ↑↓ or j k move, Space or e ticks, Shift-↑↓ selects several and x adds a row to
// the selection, ⌘Enter ticks the selection, t moves it to today and m to tomorrow,
// f flags it (none, Must, Like: never a priority), Escape selects just the one. Every open
// task has a Schedule: Today, Other day (a date to pick) and Someday, the one it is at shown
// as chosen. A click on a task's words (or Enter) opens it: a task of its own can be renamed,
// given a home or deleted (with Undo); a task in a page can get a home of its own (its words
// are changed in its page). Enter, Escape, Close or a click outside close it, keeping what
// was typed.

import { api, el, icon, undoBar, wantsCursor, giveCursorBack } from './ui.js';
import { app, screen, setFooterLink, onLeave } from './shell.js';
import { dueLabel, todayDay, addDays, estimateLabel, timeLabel, isSpeedy } from './due.js';
import { linkShape } from './editor.js';
import { addBar, flagChip, starButton, kindMark, repeatChip } from './quick-add.js';
import { moduleOn } from './modules.js';
import { homeChip } from './home.js';
import { mentionField, wordsWithMentions } from './mentions.js';

const isDay = (due) => /^\d{4}-\d{2}-\d{2}$/.test(due);
const FLAG_ORDER = { must: 0, like: 1, '': 2 };
const byFlag = (a, b) => FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag];

// Each view: its name, the key that opens it, and the groups it shows (a view of Tasks in depth, `plus`, is there while that module is on).
const VIEWS = [
  {
    key: 'today', name: 'Today',
    groups: (tasks, today) => [
      { name: 'Missed', tasks: tasks.filter((t) => isDay(t.due) && t.due < today) },
      { name: 'Today', tasks: tasks.filter((t) => t.due === today).sort(byFlag) },
    ],
  },
  {
    key: 'upcoming', name: 'Upcoming',
    groups: (tasks, today) => [
      ...Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).map((day) => ({
        name: dueLabel(day, today), day, tasks: tasks.filter((t) => t.due === day),
      })),
      { name: 'Later', tasks: tasks.filter((t) => isDay(t.due) && t.due > addDays(today, 7)) },
    ],
  },
  { key: 'speedies', plus: true, name: 'Speedies', groups: (tasks) => [{ name: 'Speedies', tasks: tasks.filter((t) => t.due === '' && isSpeedy(t.estimate)) }] },
  {
    key: 'reminders', plus: true, name: 'Reminders',
    groups: (tasks) => [{ name: 'Reminders', tasks: tasks.filter((t) => t.reminder).sort((a, b) => a.reminder.at.localeCompare(b.reminder.at)) }],
  },
  { key: 'someday', plus: true, name: 'Someday', groups: (tasks) => [{ name: 'Someday', tasks: tasks.filter((t) => t.due === 'someday') }] },
  { key: 'needs-a-date', plus: true, name: 'Needs a date', groups: (tasks) => [{ name: 'Needs a date', tasks: tasks.filter((t) => t.due === '') }] },
  {
    key: 'all', name: 'All',
    groups: (tasks, today) => [
      { name: 'Missed', tasks: tasks.filter((t) => isDay(t.due) && t.due < today) },
      { name: 'Today', tasks: tasks.filter((t) => t.due === today).sort(byFlag) },
      { name: 'Upcoming', tasks: tasks.filter((t) => isDay(t.due) && t.due > today) },
      { name: 'Someday', tasks: tasks.filter((t) => t.due === 'someday') },
      { name: 'No due date', tasks: tasks.filter((t) => t.due === '') },
    ],
  },
  { key: 'done', name: 'Done', groups: (tasks, today, done) => [{ name: 'Done', tasks: done }] },
  {
    // Tasks in depth 5: what was planned for an earlier day and not done, with that day, oldest first. It never moves by itself.
    key: 'missed', plus: true, name: 'Missed',
    groups: (tasks, today) => [{ name: 'Missed', tasks: tasks.filter((t) => isDay(t.due) && t.due < today).sort((a, b) => a.due.localeCompare(b.due)) }],
  },
];

// The task's home in My Life (its own, else its note's), as a link that opens it.
function homeLink(task) {
  const { home } = task;
  return home ? el('a', { class: 'task-home', href: `/life/${home.id}`, title: `Open ${home.title}` }, icon(home.kind), el('span', {}, home.title)) : null;
}

// The page a task is a line in, as a link that opens that page at the task; a task of its own
// is written in no page.
function sourceLink(task) {
  const { source } = task;
  if (source.kind === 'own') return null;
  const name = source.kind === 'entry' ? (source.title || `Journal · ${dueLabel(source.day)}`) : source.title || 'Untitled';
  return el('a', { class: 'task-source', href: `${source.path}?task=${task.position}`, title: `Open ${name}` },
    linkShape(source.kind, source.title), el('span', {}, name));
}

// The right of a row: three columns, Schedule, Home, then Written in, the same width on every
// row so they line up down the page (empty where there is nothing). In a narrower window the
// same sit as one small line under the words, Schedule first. schedule is the buttons of an
// open task (a list of buttons), or null.
function places(task, schedule) {
  const home = homeLink(task);
  const source = sourceLink(task);
  if (!schedule && !home && !source) return null;
  return el('span', { class: 'task-places' },
    el('span', { class: 'task-place task-schedule' }, ...(schedule ?? [])),
    el('span', { class: 'task-place' }, home),
    el('span', { class: 'task-place' }, source));
}

// The views to show: the core ones always, the others with Tasks in depth. A number key opens the nth of these.
const shownViews = () => VIEWS.filter((v) => !v.plus || moduleOn('tasks-plus'));

export async function showTasks() {
  document.title = 'Tasks';
  app.className = 'page tasks-page';
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' });
  const list = el('div', { class: 'task-groups' });
  const status = el('p', { class: 'journal-tools-message', role: 'status' });
  const selection = el('p', { class: 'task-selection', role: 'status' }); // how many are picked, and what the keys do to them
  const undoPlace = el('div', {});
  const bar = addBar({ onAdded: () => load(), accent: true });
  // The search looks through every task, open and done, whatever the view: its words, its
  // short title, its home and the page it lives in. / goes to it; Escape empties it.
  let query = new URLSearchParams(location.search).get('q') ?? '';
  const search = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Search tasks', 'aria-label': 'Search tasks', autocomplete: 'off',
    oninput: () => { query = search.value; cursor = null; keepAddress(); draw(); },
    onkeydown: (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      search.value = '';
      query = '';
      keepAddress();
      draw();
      search.blur();
    },
  });
  search.value = query;
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Tasks'),
      el('label', { class: 'search' }, icon('search'), search, el('kbd', { class: 'sidebar-key' }, '/'))),
    tabs,
    bar.element,
    el('p', { class: 'task-keys capture-hint' }, '↑↓ or j k move · Space or e ticks · Shift-↑↓ or x selects · t today · m tomorrow · d another day · l let go · f flag · number keys open the views'),
    selection,
    status,
    list,
    undoPlace,
  );
  setFooterLink(null);

  let view = shownViews().find((v) => v.key === new URLSearchParams(location.search).get('view')) ?? VIEWS[0];
  let tasks = [];
  let done = [];
  let alarms = [];            // the alarms already ended (Reminders view): struck through under the waiting ones
  const ticked = new Set();   // ticked (or unticked, in Done) here: shown so until you leave
  let order = [];             // the shown tasks' ids
  let cursor = null;          // the row the keyboard is on
  let anchor = null;          // where a Shift selection started
  let selected = new Set();
  let picking = false;        // rows picked one by one with x: moving keeps them
  let editing = null;         // the task opened for changing, if any
  let editClose = () => {};
  let stripClose = null;      // closes the open strip, keeping its words
  let draft = null;           // the words typed in the open strip, kept through a redraw
  let openedFor = null;       // the task whose strip has had the cursor already
  let focusWords = false;     // a strip was just opened: its words get the cursor
  let hadCursor = false;      // the words had the cursor when the page was redrawn
  const taskOf = (id) => tasks.find((t) => t.id === id) ?? done.find((t) => t.id === id);
  const isDone = (task) => (task.done ? !ticked.has(task.id) : ticked.has(task.id));

  async function load() {
    try {
      [tasks, done, alarms] = await Promise.all([api.openTasks(), api.doneTasks(), api.reminders('done').catch(() => [])]);
    } catch {
      list.replaceChildren(el('p', { class: 'empty' }, "Tasks couldn't be loaded. Is the app still running?"));
      return;
    }
    ticked.clear();
    draw();
  }

  const failed = (err) => {
    status.textContent = err.status === 409 ? 'That task changed in its page. Reload to see it as it is now.' : "Couldn't save. Is the app still running?";
  };

  // Ticks (or unticks) several tasks, one after another: each may change a line in a page.
  async function setDone(some, doneNow) {
    status.textContent = '';
    const changed = [];
    for (const task of some) {
      try {
        await api.changeTask(task.id, { done: doneNow });
      } catch (err) {
        failed(err);
        break;
      }
      if (doneNow !== task.done) ticked.add(task.id); else ticked.delete(task.id);
      changed.push(task);
    }
    let nextLine = '';
    if (doneNow && changed.some((t) => t.repeat)) { // the next one of a repeating task
      const fresh = await api.openTasks();
      tasks = [...tasks, ...fresh.filter((t) => !tasks.some((known) => known.id === t.id))];
      const next = changed.length === 1 ? fresh.find((t) => t.repeat_from === changed[0].id) : null;
      if (next) nextLine = ` Next: ${dueLabel(next.due)}.`;
    }
    if (!doneNow && changed.some((t) => t.repeat)) { // unticked: the next one it made went again
      tasks = tasks.filter((t) => !(t.repeat_from && changed.some((c) => c.id === t.repeat_from)));
    }
    draw();
    if (!changed.length) return;
    undoPlace.replaceChildren(undoBar(
      `${changed.length === 1 ? `“${changed[0].text}”` : `${changed.length} tasks`} ${doneNow ? 'done' : 'back to do'}.${nextLine}`,
      () => setDone(changed, !doneNow)));
  }

  // Lets tasks go: each of its own is deleted (marked, never removed) with Undo. A task in a page is let go in its page.
  async function letGo(some) {
    status.textContent = '';
    const gone = [];
    for (const task of some) {
      if (task.source.kind !== 'own') { status.textContent = 'A task in a page is let go in its page.'; continue; }
      try { await api.deleteTask(task.id); gone.push(task); } catch (err) { failed(err); break; }
    }
    if (!gone.length) return;
    tasks = tasks.filter((t) => !gone.some((g) => g.id === t.id));
    selected = new Set();
    picking = false;
    draw();
    undoPlace.replaceChildren(undoBar(`${gone.length === 1 ? `“${gone[0].text}”` : `${gone.length} tasks`} let go.`,
      async () => { for (const task of gone) await api.restoreTask(task.id); await load(); }));
  }

  // Moves tasks to a day by changing their date (in a page: the @date in its line).
  async function moveTo(some, day) {
    status.textContent = '';
    const before = some.map((t) => [t, t.source.kind === 'entry' && t.due === t.source.day ? '' : t.due]);
    for (const task of some) {
      try {
        Object.assign(task, await api.changeTask(task.id, { due: day }));
      } catch (err) {
        failed(err);
        break;
      }
    }
    draw();
    undoPlace.replaceChildren(undoBar(`${some.length === 1 ? `“${some[0].text}”` : `${some.length} tasks`} moved to ${dueLabel(day)}.`, async () => {
      for (const [task, due] of before) Object.assign(task, await api.changeTask(task.id, { due }));
      draw();
    }));
  }

  // The flag: none → Must → Like → none, for one task or several.
  const NEXT_FLAG = { '': 'must', must: 'like', like: '' };
  async function setFlag(some, flag) {
    status.textContent = '';
    for (const task of some) {
      try {
        Object.assign(task, await api.changeTask(task.id, { flag: flag ?? NEXT_FLAG[task.flag] }));
      } catch (err) {
        failed(err);
        break;
      }
    }
    draw();
  }

  function moveCursor(id, extend) {
    cursor = id;
    if (extend && anchor) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
      selected = new Set(order.slice(a, b + 1));
      picking = false;
    } else if (picking) {
      anchor = id;
    } else {
      anchor = id;
      selected = new Set([id]);
    }
    draw();
    list.querySelector(`.task-row[data-id="${id}"]`)?.focus();
  }

  // Schedule: three quiet buttons on an open task. The one where the task already is is
  // chosen; Other day turns into the date to pick.
  const scheduleButtons = (task) => {
    const chip = (name, onclick, pressed = false) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(pressed), title: `${name}: “${task.text}”`, onclick,
    }, name);
    const other = chip('Other day', () => {
      const pick = el('input', {
        type: 'date', class: 'detail-input', 'aria-label': `New day for “${task.text}”`, value: todayDay(),
        onchange: () => { if (pick.value) moveTo([task], pick.value); },
        onkeydown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); draw(); } },
      });
      other.replaceWith(pick);
      pick.focus();
    });
    return [
      chip('Today', () => task.due !== todayDay() && moveTo([task], todayDay()), task.due === todayDay()),
      other,
      chip('Someday', () => task.due !== 'someday' && moveTo([task], 'someday'), task.due === 'someday'),
    ];
  };

  // The strip under an opened task. It closes with Close, Enter, Escape or a click outside
  // it, and every way of closing keeps the words typed: a save under way finishes first, and
  // a save that fails keeps the strip open with what was typed.
  function editStrip(task) {
    const own = task.source.kind === 'own';
    const draftHere = () => (draft?.id === task.id ? draft.value : task.text);
    let closing = null;
    const close = ({ refocus = true } = {}) => {
      closing ??= (async () => {
        const typed = words.value?.trim();
        if (own && typed && typed !== task.text) {
          try { Object.assign(task, await api.changeTask(task.id, { text: typed, mentions: mention.mentions() })); } catch (err) { failed(err); closing = null; return; }
        }
        editClose();
        editing = null;
        draft = null;
        openedFor = null;
        stripClose = null;
        draw();
        const now = document.activeElement;
        if (refocus && (!now || now === document.body)) list.querySelector(`.task-row[data-id="${task.id}"]`)?.focus();
      })();
      return closing;
    };
    stripClose = close;
    const home = homeChip(task.home, async (picked) => {
      try { Object.assign(task, await api.changeTask(task.id, { home_id: picked?.id ?? null })); } catch (err) { failed(err); }
      draw();
    }, { compact: true });
    editClose = () => { home.close(); mention?.close(); };
    const words = own ? el('input', {
      class: 'detail-input task-edit-words', 'aria-label': 'The task’s words', value: draftHere(), maxlength: 1000,
      oninput: () => { draft = { id: task.id, value: words.value }; },
    }) : el('span', { class: 'capture-hint' }, 'Its words are changed in its page.');
    // @ and a few letters: a person, @@ a company (People in depth).
    const mention = own ? mentionField(words) : null;
    mention?.set(task.mentions ?? []);
    if (own && hadCursor) wantsCursor(words);
    const remove = own ? el('button', {
      type: 'button', class: 'button button-quiet',
      onclick: async () => {
        try { await api.deleteTask(task.id); } catch (err) { failed(err); return; }
        tasks = tasks.filter((t) => t.id !== task.id);
        editing = null;
        draft = null;
        openedFor = null;
        stripClose = null;
        draw();
        undoPlace.replaceChildren(undoBar(`“${task.text}” deleted.`, async () => { await api.restoreTask(task.id); await load(); }));
      },
    }, icon('trash'), 'Delete') : null;
    const strip = el('div', {
      class: 'task-edit',
      // Enter and Escape in the strip close it, but not inside the home picker, which keeps them.
      onkeydown: (event) => {
        if (event.target.closest('.home-picker, button, a')) return;
        if (event.key === 'Escape' || (event.key === 'Enter' && (!own || words.value.trim()))) { event.preventDefault(); close(); }
      },
    }, words, home.element, remove,
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => close() }, 'Close'),
      // Where it came from, when it was made from a capture in the Inbox.
      task.capture ? el('p', { class: 'task-capture' },
        el('span', { class: 'task-capture-when' }, `From the Inbox, captured ${new Date(task.capture.captured_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
        el('span', {}, task.capture.body)) : null);
    if (openedFor !== task.id) { // newly opened: the cursor goes to its words (once the page is drawn)
      openedFor = task.id;
      focusWords = own;
    }
    return strip;
  }

  const row = (task, { showDue }) => {
    const checked = isDone(task);
    const box = el('button', {
      type: 'button', class: 'task-box', role: 'checkbox', 'aria-checked': String(checked), tabindex: -1,
      'aria-label': checked ? `Done: ${task.text}. Untick` : `Tick “${task.text}” when done`,
      onclick: () => setDone([task], !checked),
    });
    box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    const at = task.reminder?.at;
    return el('div', {
      class: 'task-row task-line', 'data-checked': String(checked), 'data-id': task.id,
      'data-selected': String(selected.has(task.id)), tabindex: task.id === cursor ? 0 : -1,
      onclick: (event) => { if (!event.target.closest('button, a, input')) moveCursor(task.id, event.shiftKey); },
    },
    box,
    starButton(task, (changed) => { Object.assign(task, changed); draw(); }),
    el('button', {
      type: 'button', class: `task-flag${task.flag ? '' : ' task-flag-none'}`, tabindex: -1,
      'aria-label': `Flag: ${{ must: 'Must', like: 'Like', '': 'none' }[task.flag]}. Change it`,
      title: 'Must, Like or none (f)', onclick: () => setFlag([task]),
    }, task.flag ? flagChip(task.flag) : icon('project')),
    el('span', {
      class: 'task-words',
      onclick: async (event) => {
        if (event.target.closest('button, a, input')) return;
        if (editing && editing !== task.id && stripClose) await stripClose(); // another one was open: its words are kept first
        if (editing && editing !== task.id) return; // that save failed: it stays open
        editing = task.id;
        cursor = task.id;
        draw();
      },
    },
      ...(task.text ? wordsWithMentions(task.text, task.mentions) : ['Untitled task']),
      showDue && task.due && task.due !== todayDay() ? el('span', { class: 'due-chip' }, dueLabel(task.due)) : null,
      at ? el('span', { class: 'due-chip' }, icon('bell'), ` ${at.slice(0, 10) === todayDay() ? '' : `${dueLabel(at.slice(0, 10))} `}${timeLabel(at.slice(11))}`) : null,
      task.estimate ? (moduleOn('tasks-plus') ? kindMark(task.estimate) : el('span', { class: 'due-chip' }, estimateLabel(task.estimate))) : null,
      task.repeat ? repeatChip(task.repeat) : null),
    places(task, checked ? null : scheduleButtons(task)),
    selected.has(task.id) && (picking || selected.size > 1) ? el('span', { class: 'task-selected-word' }, icon('task'), ' Selected') : null);
  };

  function drawTabs(today) {
    tabs.replaceChildren(...shownViews().map((v, i) => {
      const count = v.key === 'done' ? 0 : v.groups(tasks, today, done).reduce((n, g) => n + g.tasks.length, 0);
      return el('button', {
        type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(v === view && !words().length), title: `${v.name} (${i + 1})`,
        onclick: () => showView(v),
      }, v.name, count ? el('span', { class: 'tab-count' }, String(count)) : null);
    }));
  }

  // The address keeps the view and what is searched for.
  function keepAddress() {
    const params = new URLSearchParams();
    if (view !== VIEWS[0]) params.set('view', view.key);
    if (query.trim()) params.set('q', query.trim());
    history.replaceState(null, '', `/tasks${params.size ? `?${params}` : ''}`);
  }

  // Every word searched for is somewhere in the task, its home or its page.
  const words = () => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (task, wanted) => {
    const text = [task.text, task.short_text, task.home?.title, task.source?.title].filter(Boolean).join(' ').toLowerCase();
    return wanted.every((w) => text.includes(w));
  };

  function showView(next) {
    view = next;
    query = ''; // a view chosen shows the view, not what was searched for
    search.value = '';
    selected = new Set();
    picking = false;
    cursor = null;
    keepAddress();
    draw();
    load(); // fresh: what was ticked elsewhere shows where it now belongs
  }

  function draw() {
    const today = todayDay();
    drawTabs(today);
    const wanted = words();
    const found = wanted.length
      ? [{ name: 'Found', tasks: tasks.filter((t) => matches(t, wanted)) }, { name: 'Done', tasks: done.filter((t) => matches(t, wanted)) }]
      : null;
    const shown = (found ?? view.groups(tasks, today, done)).filter((g) => g.tasks.length);
    order = shown.flatMap((g) => g.tasks.map((t) => t.id));
    const picked = order.filter((id) => selected.has(id)).length;
    selection.textContent = picked > 1 ? `${picked} tasks selected · e done · t today · m tomorrow · Esc clears` : '';
    if (!order.includes(cursor)) cursor = order[0] ?? null;
    const focused = list.contains(document.activeElement) && document.activeElement.classList.contains('task-row');
    hadCursor = document.activeElement?.classList.contains('task-edit-words') ?? false;
    const single = !found && shown.length === 1 && shown[0].name === view.name; // a view of one group needs no heading
    list.replaceChildren(...(shown.length ? [el('div', { class: 'task-columns-head' },
      el('span', { class: 'task-places' }, el('span', { class: 'task-place task-schedule' }, 'Schedule'), el('span', { class: 'task-place' }, 'Home'), el('span', { class: 'task-place' }, 'Written in'))),
      ...shown.map((group) => el('section', { class: 'task-group', 'aria-label': group.name },
      single ? null : el('h2', { class: 'task-group-title' }, `${group.name} · ${(group.name === 'Done' ? group.tasks : group.tasks.filter((t) => !isDone(t))).length}`),
      el('div', { class: 'task-rows' }, ...group.tasks.flatMap((task) => [row(task, {
        showDue: !group.day && group.name !== 'Today',
      }), task.id === editing ? editStrip(task) : null].filter(Boolean)))))]
      : [el('p', { class: 'empty' }, found ? `No task matches “${query.trim()}”.` : {
        today: 'Nothing for today. Add a task above, or start a line with [] in any note.',
        done: 'Nothing done yet.',
        missed: 'Nothing missed. What you plan for a day and do not finish waits here, with its old day, until you decide.',
      }[view.key] ?? `Nothing in ${view.name}.`)]));
    // The Reminders view also lists the alarms already ended, struck through (a done alarm is not a done task).
    if (view.key === 'reminders' && !found && alarms.length) {
      list.append(el('section', { class: 'task-group', 'aria-label': 'Alarms ended' },
        el('h2', { class: 'task-group-title' }, `Alarms ended · ${alarms.length}`),
        el('div', { class: 'task-rows' }, ...alarms.map((a) => el('div', { class: 'alarm-row', 'data-reminder': a.id },
          el('span', { class: 'alarm-time' }, icon('bell'), ` ${a.at.slice(0, 10) === todayDay() ? '' : `${dueLabel(a.at.slice(0, 10))} `}${timeLabel(a.at.slice(11))}`),
          el('s', { class: 'alarm-words' }, a.text))))));
    }
    if (focused) list.querySelector(`.task-row[data-id="${cursor}"]`)?.focus();
    giveCursorBack(list);
    if (focusWords) { // after any other redraw this click causes
      focusWords = false;
      setTimeout(() => list.querySelector('.task-edit-words')?.focus());
    }
  }

  // What a key acts on: the selected rows still shown, or else the row the keyboard is on.
  // After it acts, the selection is just that row again.
  const targets = () => {
    const some = order.filter((id) => selected.has(id));
    picking = false;
    return (some.length ? some : [cursor]).map(taskOf);
  };
  const tickTargets = () => {
    const some = targets();
    const allDone = some.every(isDone);
    setDone(some.filter((t) => isDone(t) === allDone), !allDone);
  };

  const onKey = (event) => {
    if (event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (event.key === '/' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); search.focus(); search.select(); return; }
    if (!event.metaKey && !event.ctrlKey && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const picked = shownViews()[Number(event.key) - 1];
      if (picked) showView(picked);
      return;
    }
    if (!order.length) return;
    const inList = list.contains(event.target);
    const step = { ArrowDown: 1, j: 1, J: 1, ArrowUp: -1, k: -1, K: -1 }[event.key];
    if (step && !event.metaKey && !event.ctrlKey) {
      if (!inList && event.target !== document.body) return;
      event.preventDefault();
      const at = order.indexOf(cursor);
      const next = !inList ? cursor : order[Math.max(0, Math.min(order.length - 1, at + step))];
      moveCursor(next, event.shiftKey);
      return;
    }
    if (!inList || !event.target.classList.contains('task-row')) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key === 'Enter') { event.preventDefault(); tickTargets(); }
      return;
    }
    if (event.key === ' ') { event.preventDefault(); setDone([taskOf(cursor)], !isDone(taskOf(cursor))); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (editing === cursor && stripClose) stripClose(); // Enter on the open task shuts it
      else { editing = cursor; draw(); }
    }
    else if (event.key === 'e') { event.preventDefault(); tickTargets(); }
    else if (event.key === 'f') {
      event.preventDefault();
      const some = targets();
      setFlag(some, NEXT_FLAG[some[0].flag]); // all the same: the first one's next
    }
    else if (event.key === 'd') { // pick a day for this one: the Other day control of its row
      event.preventDefault();
      list.querySelector(`.task-row[data-id="${cursor}"] .task-schedule .chip:nth-child(2)`)?.click();
    } else if (event.key === 'l') { // let it go: deleted the way the core does, with Undo
      event.preventDefault();
      letGo(targets().filter((t) => !isDone(t)));
    } else if (event.key === 't' || event.key === 'm') {
      event.preventDefault();
      moveTo(targets().filter((t) => !isDone(t)), event.key === 't' ? todayDay() : addDays(todayDay(), 1));
    } else if (event.key === 'x') {
      event.preventDefault();
      if (!picking) { selected = new Set(); picking = true; }
      if (selected.has(cursor)) selected.delete(cursor); else selected.add(cursor);
      anchor = cursor;
      draw();
    } else if (event.key === 'Escape') {
      if (editing && stripClose) stripClose(); // an open task shuts too
      picking = false;
      moveCursor(cursor, false);
    }
  };
  document.addEventListener('keydown', onKey);
  // A click outside the open strip closes it, keeping its words. Not a click in the strip
  // (the home picker is part of it), on a task's words (which open that task instead), or on
  // another control (which does its own thing).
  const onOutside = (event) => {
    if (!editing || !stripClose) return;
    if (event.target.closest?.('.task-edit, .task-words, button, a, input, select, textarea, label, dialog, .undo-bar')) return;
    stripClose();
  };
  document.addEventListener('click', onOutside, true);
  const onChanged = () => load(); // a task added with q while here
  document.addEventListener('tasks-changed', onChanged);
  onLeave(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('tasks-changed', onChanged);
    undoPlace.replaceChildren();
    bar.close();
    editClose();
  });
  await load();
}
