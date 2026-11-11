// My Life (pkm/3): Key Elements, Goals, Projects and Topics, and (advanced/mylife/1, while My Life in depth is on) Habits.
//   /life       the list on the left, and a Life card for every Key Element: its name
//               (the whole row opens it), its description, then Goals, Projects and Topics
//               under small headings, each item with how many notes are at home there
//   /life/:id   one item, with the list still on the left (on a phone, under it); every
//               page reads top to bottom (2026-10-27, from the owner's reference): a top line
//               (its shape, its kind and Key Element), its name and line, the notes and open
//               tasks at home in it (a Key Element's: and under it, after its Goals, Projects
//               and Topics), then Details (the kind's fields, thinking space, Linked from)
// The list reads through the Key Elements (2026-10-27, from the owner's reference): each
// with its Goals, then Projects, then Topics under it, each with its kind's shape (no word: the owner's
// choice, so names have room). Then
// + Key Element, what is not under a Key Element yet, and Archived at the end (both
// foldable). n adds a Key Element, / filters the list by name; a Goal, Project or Topic is
// added on its Key Element's page. Each kind has its own shape: a pillar with a keyhole, a target, a
// flag, a #. Every item has a thinking space: free text with links, like a note, that never
// asks for action; and lists the notes at home in it (a note's Home chip, public/home.js).

import { createEditor, catchPageDrops, linkShape } from './editor.js';
import { api, el, icon, makeSaver, undoBar, linkedFromSection, dayOf, today, addDays } from './ui.js';
import { app, screen, navigate, onLeave, setFlash, takeFlash, setFooterLink, recentlyDeletedLink } from './shell.js';
import { addBar, flagChip } from './quick-add.js';
import { dueLabel } from './due.js';
import { moduleOn } from './modules.js';

export const KINDS = [
  { kind: 'key_element', one: 'Key Element', many: 'Key Elements' },
  { kind: 'goal', one: 'Goal', many: 'Goals' },
  { kind: 'project', one: 'Project', many: 'Projects' },
  { kind: 'topic', one: 'Topic', many: 'Topics' },
  { kind: 'habit', one: 'Habit', many: 'Habits' }, // a rhythm you keep; only while My Life in depth is on
];
// The kinds on offer: Habits go with the module.
const activeKinds = () => KINDS.filter((k) => k.kind !== 'habit' || moduleOn('mylife-plus'));
const cadenceWords = (i) => `${i.cadence_times}× a ${i.cadence_per}`;

// What shows under a Key Element: what stands on it, and a Habit that carries one of its Goals.
// Also what is not under any: those are listed apart.
function arrange(items) {
  const active = items.filter((item) => item.state === 'active');
  const keyElements = active.filter((item) => item.kind === 'key_element');
  const homeOfGoal = (goalId) => items.find((g) => g.id === goalId)?.home_id;
  const underOf = (keyElement) => active.filter((item) => item.home_id === keyElement.id
    || (item.kind === 'habit' && item.serves.some((goalId) => homeOfGoal(goalId) === keyElement.id)));
  const placed = new Set(keyElements.flatMap((k) => underOf(k).map((item) => item.id)));
  const homeless = active.filter((item) => item.kind !== 'key_element' && !placed.has(item.id));
  return { active, keyElements, underOf, homeless };
}
export const kindName = (kind) => KINDS.find((k) => k.kind === kind)?.one ?? 'Item';

// Goals, then Projects, then Topics; by name within a kind (as the server sends them).
const byKind = (a, b) => KINDS.findIndex((k) => k.kind === a.kind) - KINDS.findIndex((k) => k.kind === b.kind);

// Which groups are folded, remembered in this browser.
const FOLDED_KEY = 'life-folded';
const folded = new Set((() => {
  try { return JSON.parse(localStorage.getItem(FOLDED_KEY)) ?? ['archived']; } catch { return ['archived']; }
})());
const keepFolded = () => {
  try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded])); } catch { /* not kept: fine */ }
};

const fits = (title, filter) => filter.toLowerCase().split(/\s+/).filter(Boolean)
  .every((word) => title.toLowerCase().includes(word));

export async function showLife(id) {
  app.className = 'page page-wide planner-page life-page';
  document.title = 'My Life';
  let items;
  try {
    items = await api.listLife();
  } catch {
    screen.replaceChildren(el('p', { class: 'empty' }, "My Life couldn't be loaded. Is the app still running?"));
    return;
  }
  let filter = '';
  let open = null; // the item on show, if any

  // ---- The list on the left ----

  const filterInput = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Filter', 'aria-label': 'Filter My Life by name', autocomplete: 'off',
    oninput: () => { filter = filterInput.value; drawList(); },
    onkeydown: (event) => { if (event.key === 'Escape') { filterInput.value = ''; filter = ''; drawList(); filterInput.blur(); } },
  });

  const row = (item, { child = false, count = false } = {}) => el('a', {
    class: `life-row${child ? ' life-row-child' : ''}`, href: `/life/${item.id}`, 'aria-current': item.id === open?.id ? 'page' : false,
  }, icon(item.kind), el('span', { class: 'life-row-title' }, item.title),
  ...(count && item.notes_count ? [el('span', { class: 'life-row-count', title: `${item.notes_count} ${item.notes_count === 1 ? 'note' : 'notes'} at home here` }, String(item.notes_count))] : []));

  // The Key Elements, each with what sits under it.
  const tree = el('div', { class: 'life-rows life-tree' });

  // + Key Element: a name, then Enter makes it and opens its page.
  const adding = el('div', { class: 'life-adding' });
  const addKey = el('button', { type: 'button', class: 'life-row life-add', onclick: () => startAdding() },
    icon('plus'), el('span', {}, 'Key Element'));

  // Not under a Key Element yet, and Archived: foldable groups below.
  const groups = [
    { kind: 'homeless', many: 'Not under a Key Element' },
    { kind: 'archived', many: 'Archived' },
  ].map((group) => {
    const rows = el('div', { class: 'life-rows' });
    const count = el('span', { class: 'life-group-count' });
    const header = el('button', {
      type: 'button', class: 'life-group-header', 'aria-expanded': 'true',
      onclick: () => {
        if (folded.has(group.kind)) folded.delete(group.kind); else folded.add(group.kind);
        keepFolded();
        drawList();
      },
    }, icon('down'), el('span', {}, group.many), count);
    const section = el('section', { class: 'life-group', 'aria-label': group.many }, header, rows);
    return { ...group, rows, count, header, section };
  });

  function drawList() {
    const { keyElements, underOf, homeless } = arrange(items);
    const searching = Boolean(filter.trim());
    // A Key Element whose name fits shows all it holds; otherwise only what fits, under it.
    tree.replaceChildren(...keyElements.flatMap((keyElement) => {
      const under = underOf(keyElement).sort(byKind);
      const shown = fits(keyElement.title, filter) ? under : under.filter((item) => fits(item.title, filter));
      if (searching && !shown.length && !fits(keyElement.title, filter)) return [];
      return [el('div', { class: 'life-branch' }, row(keyElement), ...shown.map((item) => row(item, { child: true })))];
    }));
    homeless.sort(byKind);
    const archived = items.filter((item) => item.state === 'archived').sort(byKind);
    for (const [group, mine] of [[groups[0], homeless], [groups[1], archived]]) {
      const shown = mine.filter((item) => fits(item.title, filter));
      const isFolded = folded.has(group.kind) && !searching;
      group.count.textContent = String(mine.length);
      group.header.setAttribute('aria-expanded', String(!isFolded));
      group.section.hidden = group.kind === 'homeless' ? !shown.length : searching && !shown.length;
      group.rows.replaceChildren(...(isFolded ? [] : shown.map((item) => row(item, { child: true }))));
    }
    addKey.hidden = searching;
  }

  function startAdding() {
    const message = el('span', { class: 'journal-tools-message', role: 'alert' });
    const name = el('input', {
      class: 'search-input', placeholder: 'Name of the new Key Element', maxlength: 200,
      'aria-label': 'New Key Element’s name',
      onkeydown: async (event) => {
        if (event.key === 'Escape') { adding.replaceChildren(); addKey.hidden = false; return; }
        if (event.key !== 'Enter' || !name.value.trim()) return;
        event.preventDefault();
        try {
          const made = await api.createLifeItem({ kind: 'key_element', title: name.value });
          await navigate(`/life/${made.id}`);
        } catch (err) {
          message.textContent = err.message;
        }
      },
    });
    addKey.hidden = true;
    adding.replaceChildren(el('label', { class: 'search' }, icon('key_element'), name),
      el('span', { class: 'capture-hint' }, 'Enter adds it · Esc stops'), message);
    name.focus();
  }

  // On /life the Overview button shows as current; on an item's page it opens the overview.
  const overview = el('a', { class: 'button button-quiet life-overview', href: '/life', 'aria-current': id ? false : 'page' }, 'Overview');
  const list = el('nav', { class: 'life-list', 'aria-label': 'My Life' },
    el('div', { class: 'life-list-top' }, overview),
    el('label', { class: 'search' }, icon('search'), filterInput, el('kbd', { class: 'sidebar-key' }, '/')),
    tree, addKey, adding, ...groups.map((g) => g.section));

  // n adds a Key Element, / filters, while not typing somewhere.
  const onKey = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    if (event.key === 'n') { event.preventDefault(); startAdding(); }
    if (event.key === '/') { event.preventDefault(); filterInput.focus(); }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  // ---- The right side: the Life cards, or one item ----

  const main = el('div', { class: 'life-main' });
  const newButton = el('button', { type: 'button', class: 'button button-primary page-add', onclick: () => startAdding() },
    icon('plus'), 'New Key Element');
  // The overview's top line: the title, what the page holds, and the page's one accent.
  const overviewTop = el('header', { class: 'top-bar life-overview-top' },
    el('h1', { class: 'top-bar-title life-overview-title' }, 'My Life'),
    newButton,
    el('span', { class: 'life-overview-line' }, 'Key Elements with their Goals, Projects and Topics'));

  function drawMain() {
    if (open) return;
    const { keyElements, underOf, homeless } = arrange(items);
    main.replaceChildren(
      ...(!items.length ? [el('p', { class: 'empty' }, 'Start with what is permanent: your health, your work, your family.')] : []),
      ...(keyElements.length ? [el('div', { class: 'life-cards' }, ...keyElements.map((keyElement) => {
        const under = underOf(keyElement).sort(byKind);
        return el('article', { class: 'life-card' },
          el('a', { class: 'life-card-title', href: `/life/${keyElement.id}` },
            icon('key_element'), el('span', { class: 'life-card-name' }, keyElement.title), icon('right')),
          ...(keyElement.description ? [el('p', { class: 'life-card-description' }, keyElement.description)] : []),
          ...activeKinds().slice(1).flatMap(({ kind, many }) => {
            const mine = under.filter((item) => item.kind === kind);
            return mine.length ? [el('h3', { class: 'life-card-heading' }, many),
              el('div', { class: 'life-card-rows' }, ...mine.map((item) => row(item, { count: true })))] : [];
          }),
          ...(under.length ? [] : [el('p', { class: 'life-card-none' }, 'Nothing under it yet.')]));
      }))] : []),
      ...(homeless.length ? [
        el('h2', { class: 'contact-heading' }, 'Not under a Key Element yet'),
        el('div', { class: 'life-card-rows' }, ...homeless.sort(byKind).map((item) => row(item))),
      ] : []),
    );
  }

  if (id) {
    try {
      open = await api.getLifeItem(id);
    } catch (err) {
      main.replaceChildren(el('p', { class: 'empty' }, err.status === 404
        ? "This item doesn't exist, or was deleted. Recently deleted can bring it back."
        : "This page couldn't be loaded. Is the app still running?"));
    }
  }

  const deleted = takeFlash();
  const layout = el('div', { class: `life-layout${id ? ' life-layout-item' : ''}` }, list, main);
  screen.replaceChildren(overviewTop, layout);
  if (deleted?.kind === 'life') {
    layout.after(undoBar(`“${deleted.title}” deleted.`, async () => {
      await api.restoreLifeItem(deleted.id);
      items = await api.listLife();
      drawList();
      drawMain();
    }));
  }
  setFooterLink(recentlyDeletedLink());
  drawList();
  if (open) showItem(open, main, items, {
    changed: (fields) => {
      const listed = items.find((item) => item.id === open.id);
      if (listed) Object.assign(listed, fields);
      drawList();
    },
    added: async () => {
      items = await api.listLife();
      drawList();
    },
  });
  else drawMain();
}

// ---- One item ----

// The tasks at home in an item (tasks/2): its own, and those in notes at home here. Tick
// them here, or add one, which is at home here from the start.
function openTasksSection(item) {
  const title = 'Open tasks';
  const heading = el('h2', { class: 'life-section-title' }, title);
  const rows = el('div', { class: 'task-rows' });
  const ticked = new Set();
  let tasks = [];
  const row = (task) => {
    const done = ticked.has(task.id) ? !task.done : task.done;
    const box = el('button', {
      type: 'button', class: 'task-box', role: 'checkbox', 'aria-checked': String(done),
      'aria-label': done ? `Done: ${task.text}. Untick` : `Tick “${task.text}” when done`,
      onclick: async () => {
        try {
          await api.changeTask(task.id, { done: !done });
          if (ticked.has(task.id)) ticked.delete(task.id); else ticked.add(task.id);
          draw();
        } catch { /* stays as it was */ }
      },
    });
    box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    const source = task.source.kind === 'own' ? null
      : el('a', { class: 'task-source', href: `${task.source.path}?task=${task.position}` },
        linkShape(task.source.kind, task.source.title), el('span', {}, task.source.title || 'Untitled'));
    // On a Key Element's page, a task at home in an item under it says which.
    const home = task.home && task.home.id !== item.id
      ? el('a', { class: 'task-source', href: `/life/${task.home.id}`, title: `Open ${task.home.title}` },
        icon(task.home.kind), el('span', {}, task.home.title))
      : null;
    return el('div', { class: 'task-row task-line', 'data-checked': String(done) }, box,
      el('span', { class: 'task-words' }, task.flag ? flagChip(task.flag) : null, task.text,
        task.due ? el('span', { class: 'due-chip' }, dueLabel(task.due)) : null),
      source, home);
  };
  function draw() {
    const open = tasks.filter((t) => !t.done || ticked.has(t.id));
    const doneCount = tasks.filter((t) => (ticked.has(t.id) ? !t.done : t.done)).length;
    heading.textContent = `${title} · ${open.filter((t) => !ticked.has(t.id)).length}${doneCount ? ` · ${doneCount} done` : ''}`;
    rows.replaceChildren(...open.map(row));
  }
  async function load() {
    try { tasks = await api.tasksAtHome(item.id); } catch { return; }
    ticked.clear();
    draw();
  }
  const bar = addBar({ home: { id: item.id, title: item.title, kind: item.kind }, placeholder: 'Add a task here', onAdded: load });
  onLeave(() => bar.close());
  load();
  return el('section', { class: 'life-section life-tasks', 'aria-label': title }, heading, rows, bar.element);
}

// A note's day in words: Today, Yesterday, or the date.
function dayWords(iso) {
  const day = dayOf(new Date(iso));
  if (day === today()) return 'Today';
  if (day === addDays(today(), -1)) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(day.slice(0, 4) === today().slice(0, 4) ? {} : { year: 'numeric' }) });
}

// The notes at home in an item, newest first: the first twenty, then Show more. Framed
// rows (note shape, title, then its home and day; on a Key Element's page they include the
// notes at home in the items under it, so the home is said; elsewhere only the day).
function notesAtHomeSection(id, { sayHome = false } = {}) {
  const title = 'Notes at home here';
  const heading = el('h2', { class: 'life-section-title' }, title);
  const list = el('div', { class: 'life-frame' });
  const more = el('div', { class: 'life-more' });
  let shown = 0;
  const row = (note) => el('a', { class: 'life-item-row', href: `/notes/${note.id}` }, icon('notes'),
    el('span', { class: 'life-item-text' }, el('span', { class: 'life-item-title' }, note.title.trim() || 'Untitled'),
      el('span', { class: 'life-item-sub' }, `${sayHome ? `${note.home.title} · ` : ''}${dayWords(note.updated_at)}`)));
  async function load() {
    try {
      const { total, notes } = await api.notesAtHome(id, shown);
      heading.textContent = total ? `${title} · ${total}` : title;
      if (!shown) list.replaceChildren();
      list.append(...notes.map(row));
      shown += notes.length;
      if (!total) list.replaceChildren(el('p', { class: 'life-frame-none' }, 'No notes here yet. A note’s Home chip, under its title, can put it here.'));
      more.replaceChildren(...(shown < total ? [el('button', { type: 'button', class: 'button', onclick: load }, `Show more (${total - shown})`)] : []));
    } catch {
      list.replaceChildren(el('p', { class: 'life-frame-none' }, "The notes here couldn't be loaded."));
    }
  }
  load();
  return el('section', { class: 'life-section', 'aria-label': title }, heading, list, more);
}

// A row of the framed lists: the item's shape, its name (and "archived"), its line under it.
const itemRow = (i) => el('a', { class: 'life-item-row', href: `/life/${i.id}` }, icon(i.kind),
  el('span', { class: 'life-item-text' },
    el('span', { class: 'life-item-title' }, i.title, i.state === 'archived' ? el('span', { class: 'tag' }, 'archived') : null),
    i.kind === 'habit' || i.description
      ? el('span', { class: 'life-item-sub' }, [i.kind === 'habit' ? cadenceWords(i) : '', i.description].filter(Boolean).join(' · ')) : null));

const HORIZONS = [['', 'No horizon'], ['quarter', 'This quarter'], ['year', 'This year'], ['three_years', 'Three years'], ['someday', 'Someday']];

// A labelled field, saved as you type: a line, a few lines, a date or a choice.
function field(label, value, onInput, { type = 'line', placeholder = '', choices = [] } = {}) {
  const input = type === 'choice'
    ? el('select', { class: 'detail-input', 'aria-label': label, onchange: () => onInput(input.value) },
      ...choices.map(([v, text]) => el('option', { value: v, selected: v === value }, text)))
    : el(type === 'lines' ? 'textarea' : 'input', {
      class: type === 'lines' ? 'detail-input detail-lines' : 'detail-input', 'aria-label': label, placeholder,
      type: type === 'date' ? 'date' : false, rows: type === 'lines' ? 2 : false, maxlength: 10000,
      oninput: () => onInput(input.value),
    });
  input.value = value;
  return [el('label', { class: 'detail-label' }, label), input];
}

const step = (target) => el('a', { class: 'life-step', href: `/life/${target.id}` }, icon(target.kind), target.title);

function showItem(item, main, items, { changed, added }) {
  document.title = item.title;
  const status = el('span', { class: 'save-status', role: 'status' });
  const saver = makeSaver((changes, options) => api.updateLifeItem(item.id, changes, options), { status });
  const keyElements = items.filter((i) => i.kind === 'key_element' && i.id !== item.id);
  const goals = items.filter((i) => i.kind === 'goal');
  const set = (name, value) => {
    item[name] = value;
    saver.change(name, value);
    changed({ [name]: value });
  };

  const deleteButton = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      deleteButton.disabled = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        setFlash({ ...(await api.deleteLifeItem(item.id)), kind: 'life' });
        await navigate('/life');
      } catch {
        deleteButton.disabled = false;
        status.textContent = "Couldn't delete. Is the app still running?";
      }
    },
  }, icon('trash'), 'Delete');
  const archiveButton = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: () => { set('state', item.state === 'active' ? 'archived' : 'active'); drawState(); },
  });
  const isKey = item.kind === 'key_element';

  // The top line: its shape and kind, and the Key Element it is in, which opens; "archived"
  // after it once archived.
  const kindLine = el('span', { class: 'life-top-kind' });
  const drawTop = () => {
    const home = isKey ? null : keyElements.find((k) => k.id === item.home_id);
    kindLine.replaceChildren(icon(item.kind),
      isKey ? 'Key Element'
        : home ? el('span', {}, `${kindName(item.kind)} in `, el('a', { class: 'life-top-home', href: `/life/${home.id}` }, home.title))
          : `${kindName(item.kind)} · not under a Key Element`,
      ...(item.state === 'archived' ? [el('span', { class: 'tag' }, 'archived')] : []));
  };
  const drawState = () => {
    archiveButton.replaceChildren(icon('archive'), item.state === 'active' ? 'Archive' : 'Bring back');
    drawTop();
  };
  drawState();

  const title = el('input', {
    class: 'contact-name', 'aria-label': 'Name', maxlength: 200,
    oninput: () => {
      if (!title.value.trim()) return; // a name is needed: an empty one is not saved
      document.title = title.value;
      item.title = title.value.trim();
      saver.change('title', title.value);
      changed({ title: item.title });
    },
  });
  title.value = item.title;

  // One line about it, shown on its Key Element's card.
  const description = el('input', {
    class: 'life-description', 'aria-label': 'Description', placeholder: 'One line about it', maxlength: 200,
    oninput: () => set('description', description.value),
  });
  description.value = item.description;

  // The fields the ICOR Methodology asks of each kind.
  const details = el('div', { class: 'contact-details' });
  if (item.kind !== 'key_element') {
    details.append(...field('Key Element', item.home_id ?? '', (v) => { set('home_id', v || null); drawTop(); }, {
      type: 'choice', choices: [['', 'None yet'], ...keyElements.map((k) => [k.id, k.title])],
    }));
  }
  if (item.kind === 'project') details.append(el('label', { class: 'detail-label' }, 'Serves'), servesPicker());
  const text = (label, name, options) => field(label, item[name], (v) => set(name, v), options);
  if (item.kind === 'key_element') details.append(...text('Not this', 'not_this', { placeholder: 'What this is not' }));
  if (item.kind === 'goal') {
    details.append(
      ...text('The goal', 'statement', { type: 'lines', placeholder: 'In one sentence' }),
      ...text('Horizon', 'horizon', { type: 'choice', choices: HORIZONS }),
      ...text('Shipped means', 'shipped_means', { type: 'lines', placeholder: 'How you will know it is reached' }),
      ...text('Why', 'why', { type: 'lines', placeholder: 'Why this goal exists' }),
    );
  }
  if (item.kind === 'project') {
    details.append(
      ...text('Outcome', 'outcome', { type: 'lines', placeholder: 'What it leaves behind' }),
      ...text('Done means', 'done_means', { type: 'lines', placeholder: 'When it is finished' }),
      ...text('Start', 'starts_on', { type: 'date' }),
      ...text('End', 'ends_on', { type: 'date' }),
    );
  }
  if (item.kind === 'topic') {
    details.append(
      ...text('Pulse', 'pulse', { type: 'lines', placeholder: 'Where it stands now' }),
      ...text('Depth', 'depth', { type: 'choice', choices: [['deep', 'Deep'], ['secondary', 'Secondary']] }),
    );
  }
  if (item.kind === 'habit') {
    details.append(el('label', { class: 'detail-label' }, 'Carries'), servesPicker(),
      el('label', { class: 'detail-label' }, 'How often'), cadencePicker(),
      ...text('Counts as done when', 'done_when', { type: 'lines', placeholder: 'What makes it count: twenty minutes or more, outside' }));
  }

  // The Goals a Project serves: each with a way to take it off, and a choice to add one.
  function servesPicker() {
    const place = el('div', { class: 'life-serves' });
    const draw = () => {
      const left = goals.filter((g) => !item.serves.some((s) => s.id === g.id));
      const add = el('select', {
        class: 'detail-input', 'aria-label': 'Add a Goal it serves',
        onchange: () => {
          const goal = goals.find((g) => g.id === add.value);
          if (!goal) return;
          setServes([...item.serves, goal]);
        },
      }, el('option', { value: '' }, left.length ? 'Add a Goal…' : goals.length ? 'Serves every Goal' : 'No Goals yet'),
      ...left.map((g) => el('option', { value: g.id }, g.title)));
      place.replaceChildren(
        ...item.serves.map((goal) => el('span', { class: 'life-serves-goal' }, step(goal),
          el('button', {
            type: 'button', class: 'life-group-add', 'aria-label': `Take ${goal.title} off`, title: 'Take off',
            onclick: () => setServes(item.serves.filter((s) => s.id !== goal.id)),
          }, '×'))),
        add);
    };
    const setServes = (serves) => {
      item.serves = serves.map(({ id, title: t, kind }) => ({ id, title: t, kind }));
      saver.change('serves', item.serves.map((g) => g.id));
      changed({ serves: item.serves.map((g) => g.id) });
      draw();
    };
    draw();
    return place;
  }

  // How often a Habit comes round: a number and week or month. More than seven a week is not a rhythm, so a week
  // brings the number down to seven.
  function cadencePicker() {
    const times = el('input', {
      class: 'detail-input life-times', type: 'number', min: 1, max: item.cadence_per === 'week' ? 7 : 31, inputmode: 'numeric',
      'aria-label': 'How many times',
      oninput: () => {
        const n = Number.parseInt(times.value, 10);
        if (!Number.isInteger(n) || n < 1 || n > (per.value === 'week' ? 7 : 31)) return; // not a rhythm: not saved
        set('cadence_times', n);
      },
    });
    const per = el('select', {
      class: 'detail-input', 'aria-label': 'Per week or per month',
      onchange: () => {
        times.max = per.value === 'week' ? 7 : 31;
        if (per.value === 'week' && Number(times.value) > 7) { times.value = '7'; set('cadence_times', 7); }
        set('cadence_per', per.value);
      },
    }, el('option', { value: 'week' }, 'week'), el('option', { value: 'month' }, 'month'));
    times.value = String(item.cadence_times);
    per.value = item.cadence_per;
    return el('div', { class: 'life-cadence' }, times, el('span', {}, 'times a'), per);
  }

  // What a Goal is carried by: the Projects and Habits that serve it.
  const carriedBy = item.kind === 'goal' ? [
    el('h3', { class: 'life-subheading' }, 'Carried by'),
    el('div', { class: 'life-frame life-under' }, ...(item.under.length
      ? [...item.under].sort(byKind).map(itemRow)
      : [el('p', { class: 'life-frame-none' }, 'No Project serves it yet. A Project’s page can add it.')])),
  ] : [];

  // The thinking space: what you think about it, with [[ links like in a note.
  const thinkingPlace = el('div', { class: 'note-body-place' });
  const editor = createEditor(thinkingPlace, item.body, {
    onChange: (markdown) => saver.change('body', markdown),
    onFileProblem: (message) => { status.textContent = message; },
    label: 'Thinking space',
    placeholderText: 'What you think about it',
    tasks: false, // a thinking space never asks for action
  });
  const stopDrops = catchPageDrops(editor);
  onLeave(async () => { await saver.close(); stopDrops(); editor.destroy(); });

  main.replaceChildren(
    el('header', { class: 'note-bar life-top' },
      el('div', { class: 'life-top-start' },
        el('a', { class: 'back-link', href: '/life', 'aria-label': 'Back to My Life' }, icon('back'), 'My Life'),
        kindLine),
      el('div', { class: 'note-bar-actions' }, status, archiveButton, deleteButton)),
    el('div', { class: 'life-title' }, title),
    description,
    ...(isKey ? keyElementSections() : [notesAtHomeSection(item.id), openTasksSection(item)]),
    el('section', { class: 'life-section life-details', 'aria-label': 'Details' },
      el('h2', { class: 'life-section-title' }, 'Details'),
      details,
      ...carriedBy,
      el('h3', { class: 'life-subheading' }, 'Thinking space'),
      thinkingPlace,
      linkedFromSection('life', item.id, { none: 'Nothing links here yet. Type [[ and its name in a note or journal entry.' })),
  );

  // A Key Element's Goals, Projects and Topics: a section each, with its count and its own
  // add button (a name, Enter adds it into this Key Element, the field stays for the next,
  // Esc stops); then the notes and open tasks at home here or under it.
  function keyElementSections() {
    const sections = activeKinds().slice(1).map(({ kind, one, many }) => {
      const heading = el('h2', { class: 'life-section-title' });
      const frame = el('div', { class: 'life-frame' });
      const adding = el('div', { class: 'life-adding' });
      const draw = () => {
        const mine = item.under.filter((i) => i.kind === kind);
        heading.textContent = `${many} · ${mine.length}`;
        frame.replaceChildren(...(mine.length ? mine.map(itemRow) : [el('p', { class: 'life-frame-none' }, `No ${many} here yet.`)]));
      };
      const start = () => {
        const message = el('span', { class: 'journal-tools-message', role: 'alert' });
        const name = el('input', {
          class: 'search-input', placeholder: `Name of the new ${one}`, maxlength: 200,
          'aria-label': `New ${one}’s name`,
          onkeydown: async (event) => {
            if (event.key === 'Escape') { adding.replaceChildren(); return; }
            if (event.key !== 'Enter' || !name.value.trim()) return;
            event.preventDefault();
            try {
              const made = await api.createLifeItem({ kind, title: name.value, home_id: item.id });
              item.under = [...item.under, { id: made.id, title: made.title, description: made.description, kind: made.kind, state: made.state, cadence_times: made.cadence_times, cadence_per: made.cadence_per }]
                .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
              name.value = '';
              message.textContent = `“${made.title}” added.`;
              draw();
              await added();
            } catch (err) {
              message.textContent = err.message;
            }
          },
        });
        adding.replaceChildren(el('label', { class: 'search' }, icon(kind), name),
          el('span', { class: 'capture-hint' }, `Enter adds to ${item.title} · Esc stops`), message);
        name.focus();
      };
      draw();
      return el('section', { class: 'life-section', 'aria-label': many },
        el('div', { class: 'life-section-top' }, heading,
          el('button', { type: 'button', class: 'button button-quiet', onclick: start }, icon('plus'), icon(kind), one)),
        adding, frame);
    });
    return [...sections, notesAtHomeSection(item.id, { sayHome: true }), openTasksSection(item)];
  }
}
