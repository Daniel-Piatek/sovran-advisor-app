// The journal screens:
//   /journal                 today's page
//   /journal/YYYY-MM-DD      any day's page
//   /journal/entries/:id     one entry, on its own page
//   /journal/new?day=…       a new entry, on its own page (made once you write in it)
// A day's page lists its entries with their time; New entry (or n) opens a page like a
// note's to write one. Every entry opens on its own page, to give it a title and write more.

import { createEditor, plainText, catchPageDrops, showTaskAt, addFiles } from './editor.js';
import {
  api, el, icon, titleOf, wordsLabel, timeAgo, clockTime, makeSaver, undoBar, titleField, linkedFromSection,
  today, isDay, weekdayName, longDate, addDays, weekStart, dayNumber, monthName, dateOf, dayOf,
} from './ui.js';
import { app, screen, navigate, onLeave, setFlash, takeFlash, setFooterLink, recentlyDeletedLink } from './shell.js';
import { eventsApi, noteAbout, eventLine } from './calendar.js';

// A just-added entry comes back whole (body); listed ones bring only their start (preview).
const firstLine = (entry) => plainText(entry.preview ?? entry.body).split('\n').map((line) => line.trim()).find(Boolean) ?? '';

// One entry as a line: its time on the left, then its journal (as a labelled tag), its
// title (if it has one) and its first line.
export function entryRow(entry, { when = clockTime(entry.written_at), showJournal = true, href = `/journal/entries/${entry.id}` } = {}) {
  return el('a', { class: 'entry-row', href, 'data-entry-id': entry.id },
    el('span', { class: 'entry-row-when' }, when),
    el('span', { class: 'entry-row-text' },
      showJournal ? el('span', { class: 'tag' }, entry.journal_name) : null,
      entry.title.trim() ? el('span', { class: 'entry-row-title' }, entry.title.trim()) : null,
      el('span', { class: 'entry-row-line' }, firstLine(entry))),
  );
}

// A choice of journal, on the entry page.
function journalPicker(journals, selected, onChange) {
  const select = el('select', { class: 'journal-picker', 'aria-label': 'Journal', onchange: () => onChange?.(select.value) },
    ...journals.map((journal) => el('option', { value: journal.id, selected: journal.id === selected }, journal.name)));
  return select;
}

// The address of a day, keeping the journal filter.
export const dayHref = (day, journalId) => `/journal/${day}${journalId ? `?journal=${journalId}` : ''}`;

// ---- Getting to other days ----

// Heptabase's week strip: the seven days of the week, Monday first, with arrows to the
// week before and after. The day being shown is marked.
function weekStrip(day, filter) {
  const monday = weekStart(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const link = (d) => el('a', {
    class: 'week-day', href: dayHref(d, filter), 'aria-label': `${weekdayName(d)}, ${longDate(d)}`,
    'aria-current': d === day ? 'date' : false, 'data-today': d === today() ? '' : false,
  }, el('span', { class: 'week-day-name' }, weekdayName(d, 'short')), el('span', { class: 'week-day-number' }, String(dayNumber(d))));
  return el('nav', { class: 'week-strip', 'aria-label': 'Week' },
    el('a', { class: 'week-arrow', href: dayHref(addDays(day, -7), filter), 'aria-label': 'Week before' }, icon('left')),
    ...days.map(link),
    el('a', { class: 'week-arrow', href: dayHref(addDays(day, 7), filter), 'aria-label': 'Week after' }, icon('right')));
}

// The small month, like Fantastical's: a dot on every day with entries, the count for
// the day being shown underneath, arrows for the months before and after.
function miniMonth(day, filter) {
  const box = el('nav', { class: 'mini-month', 'aria-label': 'Month' });
  let shown = `${day.slice(0, 7)}-01`; // the first of the month on show

  async function draw() {
    const first = dateOf(shown);
    const start = weekStart(shown);
    const end = addDays(start, 41); // six weeks
    let counts = new Map();
    try {
      counts = new Map((await api.entryDays(start, end, filter)).map((d) => [d.day, d.count]));
    } catch { /* no dots: the days still work */ }
    const monthStep = (n) => dayOf(new Date(first.getFullYear(), first.getMonth() + n, 1));
    const cell = (d) => {
      const count = counts.get(d) ?? 0;
      const outside = dateOf(d).getMonth() !== first.getMonth();
      return el('a', {
        class: `mini-day${outside ? ' is-outside' : ''}${count ? ' has-entries' : ''}`,
        href: dayHref(d, filter),
        'aria-label': `${longDate(d)}${count ? `, ${count} ${count === 1 ? 'entry' : 'entries'}` : ''}`,
        'aria-current': d === day ? 'date' : false,
        'data-today': d === today() ? '' : false,
      }, String(dayNumber(d)), count ? el('span', { class: 'mini-dot', 'aria-hidden': 'true' }) : null);
    };
    const count = counts.get(day) ?? 0;
    box.replaceChildren(
      el('div', { class: 'mini-month-head' },
        el('span', { class: 'mini-month-name' }, monthName(shown)),
        el('button', { type: 'button', class: 'week-arrow', 'aria-label': 'Month before', onclick: () => { shown = monthStep(-1); draw(); } }, icon('left')),
        el('button', { type: 'button', class: 'week-arrow', 'aria-label': 'Month after', onclick: () => { shown = monthStep(1); draw(); } }, icon('right'))),
      el('div', { class: 'mini-month-grid' },
        ...Array.from({ length: 7 }, (_, i) => el('span', { class: 'mini-weekday', 'aria-hidden': 'true' }, weekdayName(addDays(start, i), 'narrow'))),
        ...Array.from({ length: 42 }, (_, i) => cell(addDays(start, i)))),
      el('p', { class: 'mini-month-count' },
        `${weekdayName(day, 'short')} ${dayNumber(day)} · ${count === 0 ? 'no entries' : `${count} ${count === 1 ? 'entry' : 'entries'}`}`));
  }

  return { box, draw };
}

// ---- A day's page ----

// The day's events, on top of its page (time/1): what is fixed that day, each with Note
// (or Open note). A click on an event opens it in the Calendar.
function dayEvents(day) {
  const place = el('section', { class: 'day-events', 'aria-label': 'Events' });
  const time = (at) => new Date(`${at}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  eventsApi.list(day, day).then((events) => {
    if (!events.length) { place.replaceChildren(el('p', { class: 'empty' }, 'Nothing on the calendar.')); return; }
    place.replaceChildren(...events.map((event) => el('div', { class: 'day-event' },
      el('span', { class: 'day-event-when' }, event.all_day ? 'all day' : time(event.starts_at)),
      el('a', {
        class: 'day-event-title', href: `/calendar/${day}?view=day&open=${encodeURIComponent(event.id)}`, style: eventLine(event),
      }, event.title, event.calendar ? el('span', { class: 'day-event-calendar' }, ` · ${event.calendar.name}`) : null),
      el('button', { type: 'button', class: 'button', onclick: () => noteAbout(event) }, event.note_id ? 'Open note' : 'Note'))));
  }).catch(() => place.replaceChildren());
  return place;
}

export async function showJournalDay(dayInAddress) {
  const day = dayInAddress && isDay(dayInAddress) ? dayInAddress : today();
  const isToday = day === today();
  document.title = isToday ? 'Journal' : `Journal · ${longDate(day)}`;
  // Which journal is shown: one (?journal=<id>), or All.
  let filter = new URLSearchParams(location.search).get('journal') || null;

  const list = el('div', { class: 'entry-list' });
  const filters = el('div', { class: 'journal-filters', role: 'group', 'aria-label': 'Journals' });
  const journalTools = el('div', { class: 'journal-tools' });
  let journals = [];
  let entries = [];

  const nothing = () => (isToday ? 'Nothing written today yet.' : 'Nothing written on this day.');
  function draw() {
    list.replaceChildren(...(entries.length
      ? entries.map((entry) => entryRow(entry, { showJournal: !filter }))
      : [el('p', { class: 'empty' }, filter ? `Nothing in ${journalName(filter)} on this day.` : nothing())]));
  }
  const journalName = (id) => journals.find((j) => j.id === id)?.name ?? 'this journal';

  // The filter: All, then every journal; and "+ Journal" to add one.
  function drawFilters() {
    const chip = (label, id) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(filter === id),
      onclick: () => choose(id),
    }, label);
    filters.replaceChildren(
      chip('All', null),
      ...journals.map((journal) => chip(journal.name, journal.id)),
      el('button', { type: 'button', class: 'chip chip-quiet', onclick: startAdding }, '+ Journal'),
    );
    drawTools();
  }

  async function choose(id) {
    filter = id;
    history.replaceState(null, '', dayHref(day, filter));
    drawFilters();
    await load();
  }

  // Adding a journal: a name, then Enter.
  function startAdding() {
    const name = el('input', {
      class: 'search-input journal-name', placeholder: 'Name, e.g. Health', 'aria-label': 'New journal name', maxlength: 60,
      onkeydown: (event) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') drawTools();
      },
    });
    const save = async () => {
      try {
        const journal = await api.createJournal(name.value);
        journals = await api.listJournals();
        await choose(journal.id);
      } catch (err) {
        message.textContent = err.message;
      }
    };
    const message = el('span', { class: 'journal-tools-message', role: 'alert' });
    journalTools.replaceChildren(el('label', { class: 'search' }, name),
      el('button', { type: 'button', class: 'button', onclick: save }, 'Add journal'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: drawTools }, 'Cancel'),
      message);
    name.focus();
  }

  // With one of your own journals chosen: Delete journal (its entries move to General).
  function drawTools() {
    const journal = journals.find((j) => j.id === filter);
    if (!journal || journal.is_general) { journalTools.replaceChildren(); return; }
    journalTools.replaceChildren(el('button', {
      type: 'button', class: 'button button-quiet',
      onclick: () => {
        const count = journal.entry_count;
        journalTools.replaceChildren(
          el('span', {}, `Delete “${journal.name}”? ${count === 1 ? 'Its entry moves' : `Its ${count} entries move`} to General; nothing is deleted.`),
          el('button', {
            type: 'button', class: 'button',
            onclick: async () => {
              await api.deleteJournal(journal.id);
              journals = await api.listJournals();
              await choose(null);
            },
          }, 'Delete journal'),
          el('button', { type: 'button', class: 'button button-quiet', onclick: drawTools }, 'Keep it'));
      },
    }, icon('trash'), 'Delete journal'));
  }

  // New entry opens its own page, in the journal being shown (General when All is).
  const newHref = () => `/journal/new?day=${day}${filter ? `&journal=${filter}` : ''}`;
  const newButton = el('a', { class: 'button button-primary', href: newHref() }, icon('plus'), 'New entry');
  // n opens it, while not typing somewhere.
  const onKey = (event) => {
    if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    event.preventDefault();
    navigate(newHref());
  };
  document.addEventListener('keydown', onKey);
  // A file let go anywhere on the day's page starts a new entry with it.
  const onDragOver = (event) => { if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault(); };
  const onDrop = (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    filesForNewEntry = files;
    navigate(newHref());
  };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  onLeave(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('drop', onDrop);
  });

  // The day's entries and the small month both follow the journal filter.
  async function load() {
    month = miniMonth(day, filter);
    monthPlace.replaceChildren(month.box);
    strip.replaceChildren(weekStrip(day, filter));
    if (todayLink) todayLink.setAttribute('href', dayHref(today(), filter));
    newButton.setAttribute('href', newHref());
    await Promise.all([
      (async () => {
        try {
          entries = await api.entriesOfDay(day, filter);
          draw();
        } catch {
          list.replaceChildren(el('p', { class: 'empty' }, "The journal couldn't be loaded. Is the app still running?"));
        }
      })(),
      month.draw(),
    ]);
  }

  let month = miniMonth(day, filter);
  const strip = el('div', { class: 'week-strip-place' }, weekStrip(day, filter));
  const monthPlace = el('aside', { class: 'journal-aside' }, month.box);
  // On a phone the small month waits behind a button, to leave room for the day.
  const monthToggle = el('button', {
    type: 'button', class: 'button button-quiet month-toggle', 'aria-label': 'Show the month', 'aria-expanded': 'false',
    onclick: () => {
      const open = monthPlace.classList.toggle('is-open');
      monthToggle.setAttribute('aria-expanded', String(open));
    },
  }, icon('calendar'));
  const todayLink = isToday ? null : el('a', { class: 'button button-quiet', href: dayHref(today(), filter) }, 'Today');

  const deleted = takeFlash();
  app.className = 'page page-journal';
  screen.replaceChildren(
    el('div', { class: 'journal-layout' },
      el('div', { class: 'journal-main' },
        el('div', { class: 'journal-top' }, strip, todayLink, monthToggle),
        // In order: the day with New entry, the day's entries (with the journal buttons),
        // the day's calendar, and what links here, each its own section.
        el('header', { class: 'day-heading' },
          el('div', { class: 'day-heading-date' },
            el('p', { class: 'day-weekday' }, isToday ? `${weekdayName(day)} · Today` : weekdayName(day)),
            el('h1', {}, longDate(day))),
          newButton),
        el('section', { class: 'journal-section', 'aria-label': isToday ? 'Today’s entries' : 'The day’s entries' },
          el('h2', { class: 'journal-section-title' }, isToday ? 'Today’s entries' : 'The day’s entries'),
          filters,
          journalTools,
          ...(deleted?.kind === 'entry'
            ? [undoBar(`Entry from ${clockTime(deleted.written_at)} deleted.`, async () => {
              await api.restoreEntry(deleted.id);
              await load();
            })]
            : []),
          list),
        el('section', { class: 'journal-section', 'aria-label': isToday ? 'Today’s calendar' : 'The day’s calendar' },
          el('h2', { class: 'journal-section-title' }, isToday ? 'Today’s calendar' : 'The day’s calendar'),
          dayEvents(day)),
        el('div', { class: 'journal-section' }, linkedFromSection('day', day))),
      monthPlace),
  );
  setFooterLink(recentlyDeletedLink());

  try {
    journals = await api.listJournals();
  } catch {
    journals = [];
  }
  if (filter && !journals.some((j) => j.id === filter)) filter = null; // a journal since deleted
  drawFilters();
  await load();
}

// ---- One entry ----

// Files dropped on a day's page, waiting for the new entry they open.
let filesForNewEntry = null;

export async function showEntry(id) {
  const top = entryTop();
  let entry;
  try {
    entry = await api.getEntry(id);
  } catch (err) {
    document.title = 'Journal';
    screen.append(err.status === 404
      ? el('p', { class: 'empty' }, "This entry doesn't exist, or it was deleted. A deleted entry can be brought back in ",
        el('a', { href: '/deleted' }, 'Recently deleted'), '.')
      : el('p', { class: 'empty' }, "This entry couldn't be loaded. Is the app still running?"));
    return;
  }
  await entryPage(top, entry);
}

// A new entry: the same page, empty, on the day (and in the journal) it was opened from.
// Nothing is made until something is written in it; from then on it is an entry like any
// other, and the address becomes its own.
export async function showNewEntry() {
  const params = new URLSearchParams(location.search);
  const day = isDay(params.get('day') ?? '') ? params.get('day') : today();
  const time = new Date().toISOString();
  const top = entryTop();
  const files = filesForNewEntry;
  filesForNewEntry = null;
  // Its journal: the one it was opened from, else General (the server's choice when none
  // is given, so writing can start before the list of journals is here).
  const wanted = params.get('journal') || undefined;
  await entryPage(top, {
    id: null, day, title: '', body: '', journal_id: wanted, journal_name: 'General', written_at: time, updated_at: time,
  }, { files });
}

// The bar at the top: back to the day, the save status and Delete.
function entryTop() {
  const status = el('span', { class: 'save-status', role: 'status' });
  const actions = el('div', { class: 'note-bar-actions' }, status);
  const back = el('a', { class: 'back-link', href: '/journal', 'aria-label': 'Back to Journal' }, icon('back'), 'Journal');
  app.className = 'page';
  screen.replaceChildren(el('header', { class: 'note-bar' }, back, actions));
  return { status, actions, back };
}

async function entryPage({ status, actions, back }, entry, { files = null } = {}) {
  back.setAttribute('href', `/journal/${entry.day}`);
  back.lastChild.replaceWith(`Journal · ${weekdayName(entry.day, 'short')}, ${longDate(entry.day)}`);

  const words = el('dd', {}, wordsLabel(plainText(entry.body)));
  const edited = el('dd', {}, timeAgo(entry.updated_at));
  const linked = el('div', {}, ...(entry.id ? [linkedFromSection('entry', entry.id)] : []));
  // A new entry is made by its first save, with everything written so far; the saves
  // after it change it. (Saves go one after another, so it is made once.)
  const save = async (changes, options) => {
    if (entry.id) return api.updateEntry(entry.id, changes, options);
    const made = await api.createEntry({
      day: entry.day, journal_id: entry.journal_id, title: changes.title ?? '', body: changes.body ?? '',
    }, options);
    // Still on it (not made on the way out to another page): the address becomes its own.
    if (location.pathname === '/journal/new') history.replaceState(null, '', `/journal/entries/${made.id}`);
    linked.replaceChildren(linkedFromSection('entry', made.id));
    return made;
  };
  const saver = makeSaver(save, {
    status,
    onSaved: (saved) => { entry = saved; edited.textContent = timeAgo(entry.updated_at); },
  });
  const clock = setInterval(() => { edited.textContent = timeAgo(entry.updated_at); }, 30_000);

  // Delete: saves what was typed first, then marks the entry deleted and goes back to its
  // day, which offers Undo. A new entry with nothing written goes back with nothing made.
  const deleteButton = el('button', {
    type: 'button', class: 'button button-quiet',
    onclick: async () => {
      deleteButton.disabled = true;
      try {
        if (!(await saver.settled())) throw new Error('not saved');
        if (entry.id) setFlash({ kind: 'entry', ...(await api.deleteEntry(entry.id)) });
        await navigate(`/journal/${entry.day}`);
      } catch {
        deleteButton.disabled = false;
        status.textContent = "Couldn't delete. Is the app still running?";
      }
    },
  }, icon('trash'), 'Delete');
  actions.append(deleteButton);

  const title = titleField({
    value: entry.title,
    onInput: (value) => { document.title = titleOf({ title: value }); saver.change('title', value); },
    onEnter: () => editor.focus(),
  });
  // Its time, and its journal: choosing another moves it there (a new one is made there).
  // The choice comes in when the list of journals does; the page doesn't wait for it.
  const journalPlace = el('span', {}, entry.journal_name);
  const meta = el('p', { class: 'entry-meta' }, clockTime(entry.written_at), ' · ', journalPlace);
  api.listJournals().then((journals) => {
    const chosen = journals.find((j) => j.id === entry.journal_id) ?? journals.find((j) => j.is_general);
    if (!entry.id) entry.journal_id = chosen?.id;
    journalPlace.replaceChildren(journalPicker(journals, chosen?.id, (journalId) => {
      if (entry.id) saver.change('journal_id', journalId);
      else entry.journal_id = journalId;
    }));
  }).catch(() => {});

  const bodyPlace = el('div', { class: 'note-body-place' });
  const editor = createEditor(bodyPlace, entry.body, {
    onChange: (markdown, text) => { words.textContent = wordsLabel(text); saver.change('body', markdown); },
    onFileProblem: (message) => { status.textContent = message; },
  });
  const stopDrops = catchPageDrops(editor);
  onLeave(async () => { await saver.close(); clearInterval(clock); stopDrops(); editor.destroy(); });

  document.title = entry.id ? titleOf(entry) : 'New entry';
  screen.append(
    title.field,
    meta,
    bodyPlace,
    el('section', { class: 'note-info', 'aria-label': 'Info' },
      el('dl', {},
        el('dt', {}, 'Count'), words,
        el('dt', {}, 'Written'), el('dd', {}, `${longDate(entry.day)}, ${clockTime(entry.written_at)}`),
        el('dt', {}, 'Edited'), edited,
      )),
    linked,
  );
  title.grow();
  if (entry.id) {
    showTaskAt(editor);
  } else {
    // A new entry starts with the cursor in its text, ready to write.
    editor.focus();
    if (files?.length) addFiles(editor, files);
  }
}
