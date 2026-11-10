// The notes screens:
//   /            the notes list, as a grid of cards or as rows, with search
//   /notes/:id   one note, to read and write in; it saves by itself as you type
//   /deleted     Recently deleted

import { createEditor, plainText, catchPageDrops, showTaskAt, markdownOf, setMarkdown } from './editor.js';
import { clashPane } from './clash.js';
import { applyFolds, zoomTo, setUsage, showBullet } from './outline.js';
import { moduleOn } from './modules.js';
import { commentsPane } from './comments.js';
import { openVersions, clockButton } from './versions.js';
import { setComments } from './comment-marks.js';
import { api, request, el, icon, titleOf, wordsLabel, shortDate, timeAgo, makeSaver, undoBar, titleField, dateOf, linkedFromSection } from './ui.js';

const shortDay = (day) => dateOf(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
import { app, screen, setFooterLink, navigate, onLeave, setFlash, takeFlash, recentlyDeletedLink } from './shell.js';
import { entryRow } from './journal.js';
import { homeChip } from './home.js';

// The grid/rows choice is remembered in this browser only. If the browser won't
// keep it (a private window), the list simply starts as a grid.
const VIEW_KEY = 'notes.view';
function savedView() {
  try { return localStorage.getItem(VIEW_KEY) === 'rows' ? 'rows' : 'grid'; } catch { return 'grid'; }
}
function rememberView(view) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* not kept: fine */ }
}

// ---- The notes list ----

const SEARCH_AFTER_MS = 120;

export async function showList() {
  document.title = 'Notes';
  let view = savedView();
  let notes = [];
  // What is being searched for is part of the address (/?q=harb), so it is still there
  // when you come back from a note.
  let query = new URLSearchParams(location.search).get('q') ?? '';

  const content = el('div', { class: 'notes' });
  // While searching, journal entries with the words are listed under the notes.
  const journalResults = el('section', { class: 'search-journal', 'aria-label': 'Journal results' });
  let foundEntries = [];

  let searchTimer = null;
  let searchRun = 0;
  const search = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Search notes', 'aria-label': 'Search notes',
    autocomplete: 'off', spellcheck: 'false',
    oninput: () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(search.value), SEARCH_AFTER_MS);
    },
    onkeydown: (event) => {
      if (event.key === 'Escape' && search.value) { search.value = ''; runSearch(''); }
    },
  });
  search.value = query;

  async function runSearch(text) {
    query = text;
    history.replaceState(null, '', query.trim() ? `/?q=${encodeURIComponent(query)}` : '/');
    const run = ++searchRun;
    try {
      const [found, entries] = await Promise.all(query.trim()
        ? [api.searchNotes(query), api.searchEntries(query)]
        : [api.listNotes(), []]);
      if (run !== searchRun) return; // a newer search has started: show that one
      notes = found;
      foundEntries = entries;
      draw();
    } catch {
      content.replaceChildren(el('p', { class: 'empty' }, "Your notes couldn't be loaded. Is the app still running?"));
    }
  }

  const switchButtons = {};
  const viewSwitch = el('div', { class: 'switch', role: 'group', 'aria-label': 'Show notes as' },
    ...['grid', 'rows'].map((name) => (switchButtons[name] = el('button', {
      type: 'button',
      class: 'switch-button',
      'aria-label': name === 'grid' ? 'Grid' : 'Rows',
      title: name === 'grid' ? 'Grid' : 'Rows',
      onclick: () => { view = name; rememberView(name); draw(); },
    }, icon(name)))));

  const newNote = el('button', {
    type: 'button',
    class: 'button button-primary page-add',
    onclick: async () => {
      newNote.disabled = true;
      try {
        const note = await api.createNote();
        await navigate(`/notes/${note.id}`);
      } catch {
        newNote.disabled = false;
        content.prepend(el('p', { class: 'empty' }, "The note couldn't be made. Is the app still running?"));
      }
    },
  }, icon('plus'), 'New note');

  // After a delete: "… deleted. Undo" brings the note straight back into the list.
  const deleted = takeFlash();
  app.className = 'page page-wide notes-page';
  screen.replaceChildren(
    el('header', { class: 'top-bar' },
      el('h1', { class: 'top-bar-title' }, 'Notes'),
      newNote,
      el('label', { class: 'search' }, icon('search'), search),
      viewSwitch),
    content,
    journalResults,
    ...(deleted?.kind === 'note'
      ? [undoBar(`“${titleOf(deleted)}” deleted.`, async () => { await api.restoreNote(deleted.id); await runSearch(query); })]
      : []),
  );
  setFooterLink(recentlyDeletedLink());

  function draw() {
    for (const [name, button] of Object.entries(switchButtons)) button.setAttribute('aria-pressed', String(name === view));
    // Each entry found opens the journal at its day.
    journalResults.replaceChildren(...(foundEntries.length ? [
      el('h2', { class: 'earlier-title' }, 'Journal'),
      el('div', { class: 'entry-list' }, ...foundEntries.map((entry) => entryRow(entry, {
        when: shortDay(entry.day), href: `/journal/${entry.day}`,
      }))),
    ] : []));
    if (notes.length === 0) {
      content.className = 'notes';
      content.replaceChildren(el('p', { class: 'empty' }, query.trim() ? `No notes with “${query.trim()}”.` : 'No notes yet.'));
      return;
    }
    content.className = view === 'rows' ? 'notes note-rows' : 'notes note-grid';
    content.replaceChildren(...notes.map(view === 'rows' ? noteRow : noteCard));
  }

  draw();
  await runSearch(query);
}

function noteCard(note) {
  return el('a', { class: 'note-card', href: `/notes/${note.id}`, 'data-note-id': note.id },
    el('h2', { class: note.title.trim() ? 'note-card-title' : 'note-card-title untitled' }, titleOf(note)),
    plainText(note.preview).trim() ? el('p', { class: 'note-card-preview' }, plainText(note.preview)) : null,
  );
}

function noteRow(note) {
  return el('a', { class: 'note-row', href: `/notes/${note.id}`, 'data-note-id': note.id },
    el('span', { class: note.title.trim() ? 'note-row-title' : 'note-row-title untitled' }, titleOf(note)),
    el('span', { class: 'note-row-preview' }, plainText(note.preview).replace(/\s+/g, ' ').trim()),
  );
}

// ---- One note ----

export async function showNote(id) {
  const status = el('span', { class: 'save-status', role: 'status' });
  const actions = el('div', { class: 'note-bar-actions' }, status);
  app.className = 'page';
  screen.replaceChildren(
    el('header', { class: 'note-bar' }, el('a', { class: 'back-link', href: '/', 'aria-label': 'Back to Notes' }, icon('back'), 'Notes'), actions),
  );

  let note;
  try {
    note = await request('GET', `/api/notes/${id}${moduleOn('writing') ? '?version=1' : ''}`); // with the version its text starts from, for a save that may have to merge
  } catch (err) {
    document.title = 'Notes';
    screen.append(err.status === 404
      ? el('p', { class: 'empty' }, "This note doesn't exist, or it was deleted. A deleted note can be brought back in ",
        el('a', { href: '/deleted' }, 'Recently deleted'), '.')
      : el('p', { class: 'empty' }, "This note couldn't be loaded. Is the app still running?"));
    return;
  }

  const words = el('dd', {}, wordsLabel(plainText(note.body)));
  const edited = el('dd', {}, timeAgo(note.updated_at));
  let sentBody = null;
  const saver = makeSaver((changes, options) => {
    if ('body' in changes) sentBody = changes.body;
    // A save says which version its text started from; if your assistant changed the note since, the two are merged line by line.
    return api.updateNote(id, outlineOn && 'body' in changes ? { ...changes, base_version: note.version ?? null } : changes, options);
  }, {
    status,
    onSaved: (saved) => {
      const stays = { ...saved, version: saved.version ?? note.version };
      if (saved.merged && saved.version !== undefined) {
        // What came back holds the other side's lines too: show it, unless more was typed meanwhile (the next save merges again).
        if (sentBody !== null && markdownOf(editor) === sentBody) { if (saved.body !== sentBody) setMarkdown(editor, saved.body); } else stays.version = note.version;
      }
      note = stays;
      edited.textContent = timeAgo(note.updated_at);
      refreshClock();
      if (saved.clashes) clashes?.refresh();
    },
  });
  let refreshClock = () => {};
  const clock = setInterval(() => { edited.textContent = timeAgo(note.updated_at); }, 30_000);

  // Delete: saves what was typed first, then marks the note deleted and goes back to
  // the list, which offers Undo.
  const deleteButton = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      deleteButton.disabled = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        setFlash({ kind: 'note', ...(await api.deleteNote(id)) });
        await navigate('/');
      } catch {
        deleteButton.disabled = false;
        status.textContent = "Couldn't delete. Is the app still running?";
      }
    },
  }, icon('trash'), 'Delete');
  actions.append(deleteButton);
  // Versions (Writing and thinking): the clock opens them, with how many there are.
  if (moduleOn('writing')) {
    const showCount = async () => {
      try {
        const versions = await request('GET', `/api/notes/${id}/versions`);
        const next = clockButton(versions.length, () => openVersions(id, { onRestored: () => navigate(`/notes/${id}?v=${Date.now()}`) }));
        actions.querySelector('[aria-label^="Versions:"]')?.remove();
        actions.prepend(next);
        status.dataset.versions = String(versions.length);
      } catch { /* no clock */ }
    };
    void showCount();
    refreshClock = showCount;
  }

  const title = titleField({
    value: note.title,
    onInput: (value) => { document.title = titleOf({ title: value }); saver.change('title', value); },
    onEnter: () => editor.focus(),
  });

  // The text, with formatting as you type (public/editor.js). It is saved as Markdown.
  const bodyPlace = el('div', { class: 'note-body-place' });
  // Writing and thinking (advanced/writing/1): the text is an outline. A path leads back out of a zoom.
  const outlineOn = moduleOn('writing');
  const zoomPath = el('nav', { class: 'zoom-path', 'aria-label': 'Zoom path', hidden: true });
  const drawPath = (chain) => {
    zoomPath.hidden = chain.length === 0;
    zoomPath.replaceChildren(...(chain.length ? [
      el('button', { type: 'button', class: 'button button-quiet', onclick: () => zoomTo(editor, null) }, titleOf(note)),
      ...chain.flatMap((c, i) => [el('span', { class: 'zoom-sep', 'aria-hidden': 'true' }, '›'),
        el('button', { type: 'button', class: 'button button-quiet', 'aria-current': String(i === chain.length - 1), onclick: () => zoomTo(editor, c.pos) }, c.text)]),
    ] : []));
  };
  let bullets = [];
  // "Used in N places": the pages that link to or show this bullet.
  const showUsed = async (ord, button) => {
    document.querySelector('.used-in-pop')?.remove();
    const bullet = bullets[ord];
    if (!bullet) return;
    let pages = [];
    try { pages = await request('GET', `/api/bullets/${bullet.id}/used`); } catch { return; }
    const pop = el('ul', { class: 'used-in-pop', 'aria-label': 'Used in' }, ...(pages.length ? pages.map((p) => el('li', {}, el('a', { href: p.path }, p.title), el('span', { class: 'used-in-kind' }, p.kind === 'note' ? ' · note' : ' · journal entry'))) : [el('li', {}, 'Nowhere now.')]));
    const at = button.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(at.left, document.documentElement.clientWidth - 260))}px`;
    pop.style.top = `${at.bottom + window.scrollY + 4}px`;
    document.body.append(pop);
    const close = (event) => { if (!pop.contains(event.target)) { pop.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };
  const clashes = outlineOn ? clashPane({ noteId: id, onResolved: () => navigate(`/notes/${id}?c=${Date.now()}`) }) : null;
  const pane = outlineOn ? commentsPane({ noteId: id, setThreads: (threads) => setComments(editor, threads) }) : null;
  const editor = createEditor(bodyPlace, note.body, {
    boards: outlineOn ? { create: () => request('POST', '/api/boards', { note_id: id, title: 'Board' }) } : null,
    comments: pane ? { onSelect: (info) => pane.select(info), onClick: (commentId) => pane.show(commentId) } : null,
    outline: outlineOn ? {
      onZoom: drawPath,
      onUsed: (ord, button) => showUsed(ord, button),
      // Folding is kept on the bullet's row, found by its place in the saved text: what is typed is saved first.
      onFold: async (index, folded) => {
        try {
          await saver.settled();
          const { blocks } = await request('GET', `/api/notes/${id}/bullets`);
          if (blocks[index]) await request('PATCH', `/api/bullets/${blocks[index].id}`, { folded });
        } catch { /* the fold stays on the page; it is not kept */ }
      },
    } : null,
    onChange: (markdown, text) => { words.textContent = wordsLabel(text); saver.change('body', markdown); },
    onFileProblem: (message) => { status.textContent = message; },
  });
  // A file let go anywhere on the page goes into the text.
  const stopDrops = catchPageDrops(editor);
  // Its one home in My Life (public/home.js).
  const home = homeChip(note.home, (chosen) => saver.change('home_id', chosen?.id ?? null));
  onLeave(async () => { pane?.destroy(); home.close(); await saver.close(); clearInterval(clock); stopDrops(); editor.destroy(); });

  document.title = titleOf(note);
  screen.append(
    title.field,
    home.element,
    zoomPath,
    bodyPlace,
    ...(clashes ? [clashes.element] : []),
    ...(pane ? [pane.element] : []),
    el('section', { class: 'note-info', 'aria-label': 'Info' },
      el('dl', {},
        el('dt', {}, 'Count'), words,
        el('dt', {}, 'Created'), el('dd', {}, shortDate(note.created_at)),
        el('dt', {}, 'Edited'), edited,
        ...(note.source_key ? [el('dt', {}, 'Imported from'), el('dd', {}, note.source_key.replace(/^obsidian:/, ''))] : []),
      )),
    linkedFromSection('note', note.id),
  );
  title.grow();
  showTaskAt(editor);
  if (pane) pane.refresh();
  clashes?.refresh();
  if (outlineOn) {
    request('GET', `/api/notes/${id}/bullets`).then(({ blocks }) => {
      bullets = blocks;
      if (blocks.some((b) => b.folded)) applyFolds(editor, blocks.map((b) => b.folded));
      if (blocks.some((b) => b.used_in)) setUsage(editor, blocks.map((b) => b.used_in));
      const wanted = new URLSearchParams(location.search).get('bullet');
      const at = wanted ? blocks.findIndex((b) => b.id === wanted) : -1;
      if (at >= 0) { if (blocks[at].parent_id) applyFolds(editor, blocks.map((b) => b.folded && b.id !== blocks[at].parent_id)); showBullet(editor, at); }
    }).catch(() => {});
  }

  // A new, empty note starts with the title ready to type in.
  if (!note.title && !note.body) {
    title.field.focus();
    // The New note button may still hold the focus as the page changes: take it back once the page has settled.
    requestAnimationFrame(() => { if (!document.activeElement || ['BODY', 'BUTTON', 'A'].includes(document.activeElement.tagName)) title.field.focus(); });
    setTimeout(() => { if (!document.activeElement || ['BODY', 'BUTTON', 'A'].includes(document.activeElement.tagName)) title.field.focus(); }, 150);
  }
}

// ---- Recently deleted ----

// Deleted notes and journal entries, most recently deleted first, each marked with what
// it is. Restore brings one back exactly as it was.
export async function showDeleted() {
  document.title = 'Recently deleted';
  const list = el('div', { class: 'deleted-list' });
  app.className = 'page';
  screen.replaceChildren(
    el('header', { class: 'note-bar' }, el('a', { class: 'back-link', href: '/', 'aria-label': 'Back to Notes' }, icon('back'), 'Notes')),
    el('h1', {}, 'Recently deleted'),
    el('p', { class: 'empty' }, 'Deleted notes, journal entries, captures let go, people and companies wait here until you bring them back. Nothing is cleared on its own.'),
    list,
  );

  let items;
  const LIFE_NAMES = { key_element: 'Key Element', goal: 'Goal', project: 'Project', topic: 'Topic' };
  try {
    const [notes, entries, captures, contacts, life, ownTasks, events] = await Promise.all([
      api.deletedNotes(), api.deletedEntries(), api.deletedCaptures(), api.deletedContacts(), api.deletedLife(), api.deletedTasks(),
      api.deletedEvents()]);
    items = [
      ...notes.map((note) => ({
        kind: 'Note', item: note, title: titleOf(note), restore: () => api.restoreNote(note.id),
        href: `/notes/${note.id}`, home: 'back in your notes',
      })),
      ...entries.map((entry) => ({
        kind: 'Journal', item: entry,
        title: entry.title.trim() || plainText(entry.preview).split('\n').find((line) => line.trim())?.trim() || 'Untitled',
        restore: () => api.restoreEntry(entry.id), href: `/journal/entries/${entry.id}`, home: `back on ${shortDay(entry.day)}`,
      })),
      ...captures.map((capture) => ({
        kind: 'Capture', item: capture,
        title: plainText(capture.body).split('\n').find((line) => line.trim())?.trim() || 'Untitled',
        restore: () => api.undoCapture(capture.id), href: `/inbox?c=${capture.id}`, home: 'back in the Inbox',
      })),
      ...contacts.map((contact) => ({
        kind: contact.kind === 'person' ? 'Person' : 'Company', item: contact,
        title: contact.merged_into_name ? `${contact.name} (merged into ${contact.merged_into_name})` : contact.name,
        restore: () => (contact.kind === 'person' ? api.restorePerson(contact.id) : api.restoreCompany(contact.id)),
        href: contact.kind === 'person' ? `/people/${contact.id}` : `/companies/${contact.id}`,
        home: contact.merged_into_name ? 'back in People, and the merge undone' : contact.kind === 'person' ? 'back in People' : 'back in Companies',
      })),
      ...life.map((item) => ({
        kind: LIFE_NAMES[item.kind], item, title: item.title,
        restore: () => api.restoreLifeItem(item.id), href: `/life/${item.id}`, home: 'back in My Life',
      })),
      ...ownTasks.map((task) => ({
        kind: 'Task', item: task, title: task.text,
        restore: () => api.restoreTask(task.id), href: '/tasks?view=all', home: 'back in Tasks',
      })),
      ...events.map((event) => ({
        kind: 'Event', item: event, title: event.title,
        restore: () => api.restoreEvent(event.id), href: `/calendar/${event.starts_at.slice(0, 10)}`, home: 'back in the Calendar',
      })),
    ].sort((a, b) => b.item.deleted_at.localeCompare(a.item.deleted_at));
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Deleted items couldn't be loaded. Is the app still running?"));
    return;
  }
  if (items.length === 0) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Nothing here.'));
    return;
  }
  list.replaceChildren(...items.map(({ kind, item, title, restore, href, home }) => {
    const restoreButton = el('button', {
      type: 'button', class: 'button',
      onclick: async () => {
        restoreButton.disabled = true;
        try {
          await restore();
          row.replaceChildren(
            el('span', { class: 'deleted-row-title' }, el('span', { class: 'tag' }, kind), ' ', title,
              el('span', { class: 'deleted-row-when' }, ` · ${home}`)),
            el('a', { class: 'button', href }, 'Open'),
          );
        } catch {
          restoreButton.disabled = false;
        }
      },
    }, 'Restore');
    const row = el('div', { class: 'deleted-row', 'data-id': item.id },
      el('span', { class: title === 'Untitled' ? 'deleted-row-title untitled' : 'deleted-row-title' },
        el('span', { class: 'tag' }, kind), ' ', title,
        el('span', { class: 'deleted-row-when' }, ` · deleted ${timeAgo(item.deleted_at)}`)),
      restoreButton);
    return row;
  }));
}
