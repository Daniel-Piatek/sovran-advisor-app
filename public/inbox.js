// The Inbox (/inbox), built like a list and its page (2026-10-27, after the owner's
// reference): the captures that wait, oldest first, in a panel on the left (+ Capture is the
// screen's one accent); the one being sorted in a panel on the right: a top bar (its Home,
// an arrow that opens it, when it was captured; Add file, Edit, Delete), the words large,
// your assistant's suggestion as one bar with Accept, and the line "Or make it" under it. On a
// phone the list comes first and a capture opens full width, with a back arrow.
// Each decision has one key (and a button):
//   J  make it a journal entry: a line with its words, a day (today) and Add, like T's;
//                                       N  make it a note, or add it to a note
//   T  make it a task: the Tasks add bar, filled with its words, so its day (and flag,
//      estimate, time…) is read and shown; Enter makes the task, Esc goes back
//   D  done                             Backspace  delete it
// The next capture opens at once, and "… Undo" takes the decision back.
// Your assistant reads each capture in the background (assistant/3) and suggests where it
// goes: one bar on the capture ("Your assistant suggests a task, “…”, at home in …", Accept at
// its right; the reason is its tooltip), then the line "Or make it" with the same choices.
// Enter accepts it; nothing moves until you do, and the keys above still decide by hand.

import { createEditor, plainText, addFiles, catchPageDrops, focusAtEnd } from './editor.js';
import { api, el, icon, makeSaver, undoBar, clockTime, weekdayName, dayOf, titleOf } from './ui.js';
import { app, screen, onLeave, setFooterLink, recentlyDeletedLink, refreshInboxCount, onCaptured } from './shell.js';
import { isCaptureOpen, openCapture } from './capture.js';
import { addBar } from './quick-add.js';
import { dueLabel } from './due.js';
import { homeChip } from './home.js';
import { moduleOn } from './modules.js';

const firstLine = (capture) => plainText(capture.body).split('\n').map((line) => line.trim()).find(Boolean) ?? '';

// "Mon 26 Oct", under a capture in the list; with the time, in the top bar.
function dayName(iso) {
  const date = new Date(iso);
  return `${weekdayName(dayOf(date), 'short')} ${date.getDate()} ${date.toLocaleDateString(undefined, { month: 'short' })}`;
}
const toLocalInput = (d) => `${dayOf(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const capturedLong = (iso) => `Captured ${dayName(iso)}, ${clockTime(iso)}`;

// The decisions, in the order of the buttons (the reference's "Or make it" line): the three
// things it can become, then Done and Delete at the right end. `later` ones show but
// can't be chosen yet.
const INNER_NEWEST_FIRST = false;

// The World tag: a circle for the Inner World, a square for the Outer, and the word where there is room.
export function worldTag(world, { word = false } = {}) {
  return el('span', { class: 'world-tag', 'data-world': world, title: world === 'inner' ? 'Inner World: your own thought' : 'Outer World: something someone else made' },
    icon(`world_${world}`), ...(word ? [world === 'inner' ? ' Inner' : ' Outer'] : []));
}

const decisions = [
  { key: 'n', label: 'N', name: 'A note', to: 'note' },
  { key: 'j', label: 'J', name: 'A journal entry', to: 'journal' },
  { key: 't', label: 'T', name: 'A task', to: 'task' },
  { key: 'h', alt: 's', label: 'H', name: 'Snooze', to: 'snooze' },
  { key: 'd', label: 'D', name: 'Done', to: 'done', done: 'Marked done.' },
  { key: 'Backspace', alt: 'l', label: '⌫', name: 'Delete', to: 'let-go', done: 'Deleted.' },
];
const deleteDecision = decisions.find((d) => d.to === 'let-go');

export async function showInbox() {
  document.title = 'Inbox';
  let captures = [];
  let currentId = new URLSearchParams(location.search).get('c');
  let editor = null;
  let stopDrops = null;
  let saver = null;
  let busy = false;
  let left = false;
  let editing = false;
  let watching = null; // the capture whose suggestion is being waited for

  const heading = el('h1', { class: 'top-bar-title' }, 'Inbox');
  const captureButton = el('button', { type: 'button', class: 'button button-primary page-add', onclick: () => openCapture() },
    icon('plus'), 'Capture');
  const list = el('nav', { class: 'inbox-list', 'aria-label': 'Waiting' });
  // Two chips show one world at a time; pressing the chosen one again shows both.
  let worldFilter = null;
  const filterButtons = ['inner', 'outer'].map((name) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': 'false',
    onclick: () => { worldFilter = worldFilter === name ? null : name; draw(); },
  }, icon(`world_${name}`), name === 'inner' ? 'Inner' : 'Outer'));
  const filters = el('div', { class: 'inbox-worlds', role: 'group', 'aria-label': 'Show one world' }, ...filterButtons);
  // Tasks in depth 8: four views of the Inbox, each with its count (Sort, Snoozed, Done, Trash).
  let shownView = 'sort';
  let counts = { waiting: 0, snoozed: 0, done: 0, trash: 0 };
  // Sort and Snoozed are words; Done is a check mark and Trash a bin (the name stays as its label), so all four sit on one line.
  const VIEWS = [['sort', 'Sort', 'waiting'], ['snoozed', 'Snoozed', 'snoozed'], ['done', 'Done', 'done', 'check'], ['trash', 'Trash', 'trash', 'trash']];
  const viewTabs = el('div', { class: 'tabs inbox-views', role: 'tablist', 'aria-label': 'Inbox views' });
  const drawViewTabs = () => {
    viewTabs.hidden = !moduleOn('tasks-plus');
    viewTabs.replaceChildren(...VIEWS.map(([key, name, count, symbol]) => el('button', {
      type: 'button', class: symbol ? 'tab tab-symbol' : 'tab', role: 'tab', 'aria-selected': String(shownView === key),
      ...(symbol ? { 'aria-label': name, title: name } : {}),
      onclick: () => { shownView = key; draw(); },
    }, symbol ? icon(symbol) : name, counts[count] ? el('span', { class: 'tab-count' }, String(counts[count])) : null)));
  };
  const listPanel = el('aside', { class: 'inbox-list-panel' },
    viewTabs, filters, list);
  const current = el('section', { class: 'inbox-current', 'aria-label': 'Sorting' });
  const status = el('span', { class: 'save-status', role: 'status' });
  const undoPlace = el('div', { class: 'inbox-undo' });
  const layout = el('div', { class: 'inbox-layout' }, listPanel, current);
  // On a phone the list comes first; a capture opened from it fills the screen.
  let opened = Boolean(currentId);

  app.className = 'page page-wide planner-page inbox-page';
  screen.replaceChildren(el('header', { class: 'top-bar' }, heading, captureButton), layout, undoPlace);
  setFooterLink(recentlyDeletedLink());

  async function closeEditor() {
    if (saver) await saver.close();
    stopDrops?.();
    stopDrops = null;
    editor?.destroy();
    editor = null;
    saver = null;
    editing = false;
  }
  onLeave(async () => {
    left = true;
    clearInterval(waking);
    document.removeEventListener('keydown', onKey);
    await closeEditor();
  });

  async function load() {
    try {
      captures = await api.waitingCaptures();
    } catch {
      current.replaceChildren(el('p', { class: 'empty' }, "The Inbox couldn't be loaded. Is the app still running?"));
      return;
    }
    captures = inTwoPiles(captures);
    if (!captures.some((c) => c.id === currentId)) currentId = captures[0]?.id ?? null;
    await draw();
  }

  // Tasks in depth 7: two piles, Inner World above Outer World. Each pile is oldest first, as the Inbox always was.
  // (The lesson has the Inner pile newest first, for speed; that changes the order you chose, so it waits for your word:
  // set INNER_NEWEST_FIRST to true.) With the module off it is one list, oldest first, as before.
  function inTwoPiles(all) {
    if (!moduleOn('tasks-plus')) return all;
    const inner = all.filter((c) => c.world === 'inner');
    return [...(INNER_NEWEST_FIRST ? inner.reverse() : inner), ...all.filter((c) => c.world === 'outer')];
  }

  // The list, with a heading above each pile when both are there (and not narrowed to one world).
  function listRows(shown) {
    const piled = moduleOn('tasks-plus') && !worldFilter && shown.some((c) => c.world === 'inner') && shown.some((c) => c.world === 'outer');
    const rows = [];
    let last = null;
    for (const capture of shown) {
      if (piled && capture.world !== last) {
        last = capture.world;
        const count = shown.filter((c) => c.world === capture.world).length;
        rows.push(el('h2', { class: 'inbox-pile', 'data-world': capture.world }, worldTag(capture.world), ` ${capture.world === 'inner' ? 'Inner World' : 'Outer World'} · ${count}`));
      }
      rows.push(el('button', {
        type: 'button', class: 'inbox-item', 'aria-current': capture.id === currentId ? 'true' : false,
        onclick: async () => { currentId = capture.id; opened = true; await draw(); },
      }, el('span', { class: 'inbox-item-line' }, worldTag(capture.world, { word: false }), firstLine(capture) || 'Empty capture'),
      el('span', { class: 'inbox-item-when' }, dayName(capture.captured_at))));
    }
    return rows;
  }

  // A capture's world, changed: it moves to the other pile, in its place by time.
  async function switchWorld(capture, name) {
    if (capture.world === name) return;
    capture.world = name;
    try { await api.updateCapture(capture.id, { world: name }); } catch { status.textContent = "That didn't work. Is the app still running?"; }
    captures = inTwoPiles([...captures].sort((a, b) => a.captured_at.localeCompare(b.captured_at)));
    await draw();
  }

  // The other three views: what waits for its day, what needed nothing, and what was let go. One button brings a capture back.
  const OTHER = {
    snoozed: { word: 'Wake now', when: (c) => `Back ${dayName(c.snoozed_until)}`, empty: 'Nothing is snoozed. A capture you snooze waits here until its day, then comes back by itself.', note: 'Waiting for their day. They come back to the Inbox by themselves.' },
    done: { word: 'Back to the Inbox', when: (c) => `Done ${dayName(c.sorted_at ?? c.captured_at)}`, empty: 'Nothing marked done. A capture that needed nothing is kept here, out of the Inbox.', note: 'Marked done: they needed nothing. Kept, and out of your way.' },
    trash: { word: 'Restore', when: (c) => `Let go ${dayName(c.deleted_at)}`, empty: 'The Trash is empty. A capture you let go is kept here, and Restore brings it back.', note: 'Let go, and kept. Restore brings one back where it was.' },
  };
  async function drawOther() {
    await closeEditor();
    layout.classList.remove('is-open');
    layout.classList.add('is-empty');
    const spec = OTHER[shownView];
    let rows = [];
    try { rows = await api.capturesIn(shownView); } catch { list.replaceChildren(el('p', { class: 'empty' }, "This view couldn't be loaded. Is the app still running?")); return; }
    list.replaceChildren(...(rows.length ? rows.map((c) => el('div', { class: 'inbox-other-row', 'data-capture': c.id },
      el('span', { class: 'inbox-item-line' }, worldTag(c.world), firstLine(c) || 'Empty capture'),
      el('span', { class: 'inbox-item-when' }, spec.when(c)),
      el('button', {
        type: 'button', class: 'button button-quiet',
        onclick: async () => { try { await api.undoCapture(c.id); } catch { status.textContent = "That didn't work. Is the app still running?"; } await load(); },
      }, spec.word))) : [el('p', { class: 'empty' }, spec.empty)]));
    current.replaceChildren(el('p', { class: 'empty' }, spec.note));
  }

  async function refreshCounts() {
    try { counts = await api.captureCount(); } catch { /* the next draw */ }
    drawViewTabs();
  }

  async function draw() {
    if (moduleOn('tasks-plus') && shownView !== 'sort') { await refreshCounts(); await drawOther(); return; }
    shownView = 'sort';
    refreshCounts();
    heading.textContent = captures.length ? `Inbox · ${captures.length}` : 'Inbox';
    history.replaceState(null, '', currentId ? `/inbox?c=${currentId}` : '/inbox');
    filterButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(worldFilter === ['inner', 'outer'][i])));
    list.replaceChildren(...listRows(captures.filter((c) => !worldFilter || c.world === worldFilter)));

    await closeEditor();
    const capture = captures.find((c) => c.id === currentId);
    layout.classList.toggle('is-open', Boolean(capture) && opened);
    layout.classList.toggle('is-empty', !capture);
    if (!capture) {
      current.replaceChildren(
        el('p', { class: 'inbox-zero' }, 'Nothing waits.'),
        el('p', { class: 'empty' }, 'Press ⌘K anywhere to capture a thought; it waits here until you sort it.'));
      return;
    }

    // The words: shown large, and corrected with Edit; they save as you type.
    const place = el('div', { class: 'inbox-words-place' });
    saver = makeSaver((changes, options) => api.updateCapture(capture.id, changes, options), { status });
    editor = createEditor(place, capture.body, {
      onChange: (markdown) => { capture.body = markdown; saver.change('body', markdown); },
      onFileProblem: (message) => { status.textContent = message; },
      label: 'Capture text',
      className: 'note-body inbox-words',
    });
    editor.setProps({ editable: () => editing });
    stopDrops = catchPageDrops(editor);

    const editButton = el('button', {
      type: 'button', class: 'button button-quiet inbox-edit', 'aria-pressed': 'false',
      onclick: () => (editing ? stopEditing() : startEditing()),
    }, icon('edit'), el('span', {}, 'Edit'));
    function setEditing(on) {
      editing = on;
      editor.setProps({ editable: () => editing });
      editButton.setAttribute('aria-pressed', String(on));
      editButton.lastChild.textContent = on ? 'Done' : 'Edit';
      current.classList.toggle('is-editing', on);
    }
    function startEditing() { setEditing(true); focusAtEnd(editor); }
    function stopEditing() { setEditing(false); editor.dom.blur(); }
    editor.dom.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && editing) { event.preventDefault(); stopEditing(); }
    });

    arrow = el('a', { class: 'inbox-home-open', 'aria-label': 'Open the home' }, icon('right'));
    homeControl = homeChip(capture.home, (chosen) => chooseHome(capture, chosen, 'top'), { compact: true, dropdown: true });
    showArrow(capture.home);

    const filePicker = el('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Add file' });
    filePicker.addEventListener('change', () => {
      if (filePicker.files.length) addFiles(editor, [...filePicker.files]);
      filePicker.value = '';
    });
    const suggestionPlace = el('div', { class: 'suggestion-place' });
    drawSuggestion(capture, suggestionPlace);

    current.replaceChildren(
      el('header', { class: 'inbox-bar' },
        el('button', { type: 'button', class: 'inbox-back', 'aria-label': 'Back to the list', onclick: () => { opened = false; layout.classList.remove('is-open'); } }, icon('back')),
        homeControl.element, arrow,
        el('span', { class: 'inbox-when' }, capturedLong(capture.captured_at)), status,
        el('span', { class: 'inbox-bar-actions' },
          el('button', { type: 'button', class: 'button button-quiet', onclick: () => filePicker.click() }, icon('attach'), el('span', {}, 'Add file')),
          filePicker,
          editButton,
          el('button', { type: 'button', class: 'button button-quiet inbox-delete', 'aria-label': 'Delete', title: 'Delete', onclick: () => decide(deleteDecision) }, icon('trash')))),
      el('div', { class: 'inbox-detail' },
        el('p', { class: 'inbox-kind' }, icon('inbox'), 'Capture'),
        el('div', { class: 'inbox-worlds', role: 'group', 'aria-label': 'World of this capture' }, ...['inner', 'outer'].map((name) => {
          const button = el('button', {
            type: 'button', class: 'chip', 'aria-pressed': String(capture.world === name),
            onclick: () => switchWorld(capture, name),
          }, icon(`world_${name}`), name === 'inner' ? 'Inner' : 'Outer');
          return button;
        })),
        place,
        ...(capture.shared_from ? [el('p', { class: 'capture-hint inbox-shared' }, icon('link'), ` Shared from ${capture.shared_from}`)] : []),
        ...(capture.link_title ? [el('div', { class: 'citations' }, el('a', {
          class: 'citation', href: capture.link_url, target: '_blank', rel: 'noopener noreferrer',
        }, icon('link'), el('span', { class: 'citation-title' }, capture.link_title), el('span', { class: 'citation-kind' }, new URL(capture.link_url).hostname)))] : []),
        suggestionPlace,
        el('div', { class: 'inbox-choices', role: 'group', 'aria-label': 'Or make it' },
          el('span', { class: 'inbox-choices-label' }, 'Or make it'),
          ...decisions.slice(0, 3).map(choiceButton),
          el('span', { class: 'inbox-choices-end' }, ...decisions.slice(3).map(choiceButton))),
        el('div', { class: 'inbox-picker-place' })),
    );
  }
  let homeControl = null; // the Home in the top bar
  let barHome = null;     // the same value, in the suggestion bar
  let arrow = null;       // the top bar's → that opens it

  function showArrow(home) {
    if (!arrow) return;
    arrow.hidden = !home;
    if (home) arrow.href = `/life/${home.id}`;
  }

  // One value in two places: the top bar's Home and the suggestion bar's. Choosing in
  // either changes both, and is saved (captures.home_id).
  function chooseHome(capture, chosen, from) {
    capture.home = chosen;
    saver?.change('home_id', chosen?.id ?? null);
    if (from !== 'top') homeControl?.set(chosen);
    if (from !== 'bar') barHome?.set(chosen);
    showArrow(chosen);
  }

  // One of the quiet buttons under the suggestion, with its key.
  const choiceButton = (decision) => el('button', {
    type: 'button',
    class: `inbox-decision${decision.to === 'done' || decision.to === 'let-go' || decision.to === 'snooze' ? ' is-plain' : ''}${decision.later ? ' is-later' : ''}`,
    'aria-disabled': decision.later ? 'true' : false,
    'aria-keyshortcuts': decision.key === 'Backspace' ? 'Backspace' : decision.label,
    onclick: () => decide(decision),
  }, el('kbd', { class: 'key-hint' }, decision.label), el('span', {}, decision.later ? `${decision.name} · later` : decision.name));

  // ---- Your assistant's suggestion ----

  // One bar (the reference's): what your assistant suggests, with Accept inside it at the
  // right. The sentence says what Accept will do; its home is the Home box, the same value as the top bar's. The
  // reason is the bar's tooltip and its accessible description.
  function sentence(capture, s) {
    // A task or a note has a home: the same Home dropdown as the top bar's, here in the bar.
    barHome = homeChip(capture.home, (chosen) => chooseHome(capture, chosen, 'bar'), { compact: true, dropdown: true });
    const atHome = [', at home in ', barHome.element];
    if (s.kind === 'task') {
      return [el('b', {}, 'a task', ...(s.day ? [` for ${dueLabel(s.day)}`] : []), ...(s.title ? [', ', el('span', { class: 'suggestion-title' }, `“${s.title}”`)] : [])), ...atHome];
    }
    if (s.kind === 'note') return [el('b', {}, 'a note'), ...atHome];
    if (s.kind === 'journal') return [el('b', {}, 'a journal entry')];
    return [el('b', {}, 'deleting it')];
  }

  function drawSuggestion(capture, place) {
    const s = capture.suggestion;
    if (!s || s.state === 'reading' || s.state === 'failed') {
      const reading = !s || s.state === 'reading';
      place.replaceChildren(el('p', { class: 'suggestion suggestion-bar is-reading', role: 'status', 'aria-label': 'Assistant suggestion' }, icon('assistant'),
        reading ? 'Your assistant is reading it…' : 'Your assistant couldn’t read it yet; it tries again later. Sort it by hand meanwhile.'));
      if (reading) watch(capture, place);
      return;
    }
    const why = el('span', { class: 'suggestion-why', id: 'suggestion-why', hidden: true }, s.why);
    place.replaceChildren(el('section', {
      class: 'suggestion suggestion-bar', 'data-kind': s.kind, 'aria-label': 'Assistant suggestion',
      ...(s.why ? { title: s.why, 'aria-describedby': 'suggestion-why' } : {}),
    },
    icon('assistant'),
    el('span', { class: 'suggestion-text' }, 'Your assistant suggests ', ...sentence(capture, s)),
    ...(s.why ? [why] : []),
    el('button', { type: 'button', class: 'suggestion-accept', 'aria-keyshortcuts': 'Enter', title: 'Accept (Enter)', onclick: () => accept() },
      icon('check'), 'Accept')));
  }

  // While it is being read: look again every two seconds, redrawing only the suggestion.
  // The capture may be drawn again meanwhile (a phone's list, then the capture), so the
  // place to redraw is always the latest one.
  let watchPlace = null;
  async function watch(capture, place) {
    watchPlace = place;
    if (watching === capture.id) return;
    watching = capture.id;
    while (!left && watching === capture.id && currentId === capture.id) {
      await new Promise((done) => setTimeout(done, 2000));
      if (left || currentId !== capture.id || !watchPlace?.isConnected) break;
      const fresh = await api.getCapture(capture.id).catch(() => null);
      if (fresh?.suggestion && fresh.suggestion.state !== 'reading') {
        capture.suggestion = fresh.suggestion;
        // Its home starts at the suggested one, unless one was chosen meanwhile.
        if (!capture.home && fresh.home) {
          capture.home = fresh.home;
          homeControl?.set(fresh.home);
          showArrow(fresh.home);
        }
        watching = null;
        drawSuggestion(capture, watchPlace);
        return;
      }
    }
    if (watching === capture.id) watching = null;
  }

  const ACCEPTED = { task: (made) => `Made a task${made?.due ? ` for ${dueLabel(made.due)}` : ''}.`, note: () => 'Made a new note.', journal: () => 'Added to today’s journal.', let_go: () => 'Deleted.' };

  async function accept() {
    const capture = captures.find((c) => c.id === currentId);
    if (!capture || busy || capture.suggestion?.state !== 'ready') return;
    // A journal entry asks for its day first (today, unless you change it).
    if (capture.suggestion.kind === 'journal') { openJournalBar(); return; }
    busy = true;
    try {
      if (!(await saver.settled())) throw new Error('not saved');
      const { made, kind } = await api.acceptCapture(capture.id);
      afterDecision(capture, ACCEPTED[kind](made));
    } catch {
      status.textContent = "That didn't work. Is the app still running?";
    } finally {
      busy = false;
    }
  }

  async function decide(decision) {
    if (decision.later || busy) return;
    if (decision.to === 'note') { openNotePicker(); return; }
    if (decision.to === 'task') { openTaskBar(); return; }
    if (decision.to === 'journal') { openJournalBar(); return; }
    if (decision.to === 'snooze') { openSnoozePicker(); return; }
    const capture = captures.find((c) => c.id === currentId);
    if (!capture) return;
    busy = true;
    try {
      if (!(await saver.settled())) throw new Error('not saved');
      if (decision.to === 'let-go') await api.letGoCapture(capture.id);
      else await api.sortCapture(capture.id, decision.to);
      afterDecision(capture, decision.done);
    } catch {
      status.textContent = "That didn't work. Is the app still running?";
    } finally {
      busy = false;
    }
  }

  // The next capture opens at once; "… Undo" puts this one back.
  async function afterDecision(capture, message) {
    const index = captures.findIndex((c) => c.id === capture.id);
    captures = captures.filter((c) => c.id !== capture.id);
    currentId = (captures[index] ?? captures[index - 1])?.id ?? null;
    undoPlace.replaceChildren(undoBar(message, async () => {
      await api.undoCapture(capture.id);
      currentId = capture.id;
      await load();
      refreshInboxCount();
    }));
    refreshInboxCount();
    await draw();
  }

  // H: when should it come back? Later today, tomorrow, the weekend, next week, or a time
  // you pick. It leaves the Inbox and returns by itself; "… Undo" wakes it now.
  function openSnoozePicker() {
    const capture = captures.find((c) => c.id === currentId);
    if (!capture) return;
    const place = current.querySelector('.inbox-picker-place');
    const at = (date, hour) => { const d = new Date(date); d.setHours(hour, 0, 0, 0); return d; };
    const nowDate = new Date();
    const later = new Date(nowDate.getTime() + 3 * 3600_000);
    const tomorrow = at(new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1), 9);
    const toDay = (target) => { const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()); d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7 || 7)); return at(d, 9); };
    const options = [
      ['Later today', later.getHours() < 23 ? later : tomorrow], ['Tomorrow', tomorrow],
      ['The weekend', toDay(6)], ['Next week', toDay(1)],
    ];
    const when = el('input', { type: 'datetime-local', class: 'search-input', 'aria-label': 'Pick a date and time', min: toLocalInput(nowDate) });
    const choose = async (date) => {
      if (busy || Number.isNaN(date.getTime())) return;
      busy = true;
      try {
        await api.updateCapture(capture.id, { snooze_until: date.toISOString() });
        afterDecision(capture, `Snoozed until ${dayName(date.toISOString())}, ${clockTime(date.toISOString())}.`);
      } catch {
        status.textContent = "That didn't work. Is the app still running?";
      } finally {
        busy = false;
      }
    };
    place.replaceChildren(el('div', { class: 'snooze-picker', role: 'group', 'aria-label': 'Snooze until' },
      ...options.map(([name, date]) => el('button', { type: 'button', class: 'chip', onclick: () => choose(date) }, name)),
      el('label', { class: 'snooze-pick' }, when),
      el('button', { type: 'button', class: 'button', onclick: () => choose(new Date(when.value)) }, 'Snooze')));
    place.querySelector('button')?.focus();
    place.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); place.replaceChildren(); } });
  }

  // T: the add bar with the capture's words (on one line). What it reads (the day above
  // all) shows as chips; Enter makes the task and takes the capture out of the Inbox.
  function openTaskBar() {
    const capture = captures.find((c) => c.id === currentId);
    if (!capture) return;
    const place = current.querySelector('.inbox-picker-place');
    const words = plainText(capture.body).split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    const bar = addBar({
      value: words,
      home: capture.home,
      placeholder: 'The task',
      submit: async (fields) => {
        if (busy) throw new Error('Busy');
        busy = true;
        try {
          if (!(await saver.settled())) throw new Error('not saved');
          const { made } = await api.sortCapture(capture.id, 'task', undefined, fields);
          return made;
        } finally {
          busy = false;
        }
      },
      onAdded: (task) => afterDecision(capture, `Made a task${task.due ? ` for ${dueLabel(task.due)}` : ''}.`),
      onEscape: () => { bar.close(); place.replaceChildren(); },
    });
    place.replaceChildren(bar.element, el('p', { class: 'capture-hint' }, 'Enter makes the task · Esc goes back'));
    bar.focus();
  }

  // J (or Accept on a journal entry): a line like the task's, with the capture's words, the
  // day (today) and Add. Enter or Add makes the entry on that day, in General; Esc goes back.
  // If the words are not changed here, the entry is the capture exactly as it is (files,
  // formatting and all).
  function openJournalBar() {
    const capture = captures.find((c) => c.id === currentId);
    if (!capture) return;
    const place = current.querySelector('.inbox-picker-place');
    const words = plainText(capture.body).split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    const today = dayOf(new Date());
    const input = el('input', {
      class: 'search-input', 'aria-label': 'The journal entry', placeholder: 'The entry', autocomplete: 'off', maxlength: 5000,
      onkeydown: (event) => {
        if (event.key === 'Enter') { event.preventDefault(); add(); }
        if (event.key === 'Escape') { event.preventDefault(); place.replaceChildren(); }
      },
    });
    input.value = words;
    const dayBox = el('input', { type: 'date', class: 'detail-input quick-day', 'aria-label': 'Day', value: today });
    dayBox.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); place.replaceChildren(); }
      if (event.key === 'Enter') { event.preventDefault(); add(); }
    });
    const message = el('p', { class: 'capture-hint quick-message', role: 'status' });
    async function add() {
      if (busy) return;
      const text = input.value.trim();
      if (!text) { message.textContent = 'An entry needs some words.'; return; }
      const day = dayBox.value || today;
      busy = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        await api.sortCapture(capture.id, 'journal', undefined, undefined, { day, ...(text === words ? {} : { body: text }) });
        afterDecision(capture, day === today ? 'Added to today’s journal.' : `Added to the journal on ${dayName(`${day}T12:00:00`)}.`);
      } catch (err) {
        message.textContent = `That couldn't be added: ${err.message}`;
      } finally {
        busy = false;
      }
    }
    place.replaceChildren(
      el('div', { class: 'quick-add' }, el('div', { class: 'quick-row' },
        el('label', { class: 'quick-words' }, icon('journal'), input), dayBox,
        el('button', { type: 'button', class: 'button', onclick: () => add() }, icon('plus'), 'Add'))),
      message,
      el('p', { class: 'capture-hint' }, 'Enter makes the entry · Esc goes back'));
    input.focus();
  }

  // N: Enter on an empty search makes a new note; type to find a note to add it to.
  function openNotePicker() {
    const capture = captures.find((c) => c.id === currentId);
    if (!capture) return;
    const place = current.querySelector('.inbox-picker-place');
    const results = el('div', { class: 'inbox-picker-results', role: 'listbox', 'aria-label': 'Notes to add it to' });
    let found = [];
    let index = -1;
    const search = el('input', {
      type: 'search', class: 'search-input', placeholder: 'Find a note to add it to, or press Enter for a new note',
      'aria-label': 'Find a note', autocomplete: 'off',
    });
    const paint = () => {
      results.replaceChildren(
        el('div', { class: 'inbox-picker-item', role: 'option', 'aria-selected': String(index === -1), onclick: () => choose(-1) },
          icon('plus'), 'New note'),
        ...found.map((note, i) => el('div', {
          class: 'inbox-picker-item', role: 'option', 'aria-selected': String(index === i), onclick: () => choose(i),
        }, icon('notes'), titleOf(note))));
    };
    let run = 0;
    search.addEventListener('input', async () => {
      const mine = ++run;
      const text = search.value.trim();
      const notes = text ? await api.searchNotes(text).catch(() => []) : [];
      if (mine !== run) return;
      found = notes.slice(0, 8);
      index = found.length ? 0 : -1;
      paint();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(index + 1, found.length - 1); paint(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(index - 1, -1); paint(); }
      if (event.key === 'Enter') { event.preventDefault(); choose(index); }
      if (event.key === 'Escape') { event.preventDefault(); place.replaceChildren(); }
    });
    async function choose(i) {
      if (busy) return;
      busy = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        const note = found[i];
        await api.sortCapture(capture.id, 'note', note?.id);
        afterDecision(capture, note ? `Added to “${titleOf(note)}”.` : 'Made a new note.');
      } catch {
        status.textContent = "That didn't work. Is the app still running?";
      } finally {
        busy = false;
      }
    }
    place.replaceChildren(el('label', { class: 'search' }, icon('search'), search), results);
    paint();
    search.focus();
  }

  // One key per decision, while not typing in the capture, a search or the capture box.
  function onKey(event) {
    if (isCaptureOpen() || event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = event.target.closest?.('input, textarea, [contenteditable="true"]');
    if (typing) return;
    if (event.key === 'Enter') {
      if (event.target.closest?.('button, a')) return; // Enter on a button presses that button
      if (captures.find((c) => c.id === currentId)?.suggestion?.state === 'ready') { event.preventDefault(); accept(); }
      return;
    }
    if ((event.key === 'w' || event.key === 'W') && currentId && moduleOn('tasks-plus')) { // switch the world of this capture
      event.preventDefault();
      const capture = captures.find((c) => c.id === currentId);
      if (capture) switchWorld(capture, capture.world === 'inner' ? 'outer' : 'inner');
      return;
    }
    const decision = decisions.find((d) => d.key === event.key || d.key === event.key.toLowerCase() || (moduleOn('tasks-plus') && d.alt === event.key.toLowerCase()));
    if (!decision || !currentId) return;
    event.preventDefault();
    decide(decision);
  }
  document.addEventListener('keydown', onKey);
  // A snoozed capture comes back by itself: look again every half minute.
  // Only when the count differs and nothing is open (a picker, an edit), so no redraw takes your place.
  const waking = setInterval(async () => {
    if (left || busy || editing || current.querySelector('.inbox-picker-place')?.childElementCount) return;
    try { if ((await api.captureCount()).waiting !== captures.length) load(); } catch { /* the next try */ }
  }, 30_000);
  // A thought captured while here joins the list.
  onCaptured(() => load());

  await load();
}
