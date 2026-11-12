// Small pieces every screen uses: talking to the server, making elements, icons, dates,
// saving as you type, and the "… deleted. Undo" bar.
// Text is always put on the page as text, never as HTML.

// ---- Talking to the server ----

export async function request(method, url, body, { keepalive = false } = {}) {
  const res = await fetch(url, {
    method,
    keepalive,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.error ?? `${method} ${url}: ${res.status}`), { status: res.status });
  }
  return res.json();
}

const q = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return search.size ? `?${search}` : '';
};

export const api = {
  listNotes: () => request('GET', '/api/notes'),
  searchNotes: (text) => request('GET', `/api/notes${q({ q: text })}`),
  deletedNotes: () => request('GET', '/api/notes?deleted=1'),
  deleteNote: (id) => request('DELETE', `/api/notes/${id}`),
  restoreNote: (id) => request('POST', `/api/notes/${id}/restore`, {}),
  createNote: () => request('POST', '/api/notes', {}),
  createNoteTitled: (title) => request('POST', '/api/notes', { title }),
  suggestBullets: (text) => request('GET', `/api/bullets${q({ q: text })}`),
  suggestLinks: (text, only) => request('GET', `/api/links/suggest${q({ q: text, only })}`),
  listPeople: (text) => request('GET', `/api/people${q({ q: text })}`),
  listCompanies: (text) => request('GET', `/api/companies${q({ q: text })}`),
  createPerson: (person) => request('POST', '/api/people', person),
  createCompany: (company) => request('POST', '/api/companies', company),
  getPerson: (id) => request('GET', `/api/people/${id}`),
  getCompany: (id) => request('GET', `/api/companies/${id}`),
  updatePerson: (id, changes, options) => request('PATCH', `/api/people/${id}`, changes, options),
  updateCompany: (id, changes, options) => request('PATCH', `/api/companies/${id}`, changes, options),
  deletePerson: (id) => request('DELETE', `/api/people/${id}`),
  deleteCompany: (id) => request('DELETE', `/api/companies/${id}`),
  restorePerson: (id) => request('POST', `/api/people/${id}/restore`, {}),
  restoreCompany: (id) => request('POST', `/api/companies/${id}/restore`, {}),
  deletedContacts: () => request('GET', '/api/people?deleted=1'),
  linkedFrom: (kind, id) => request('GET', `/api/links/to${q({ kind, id })}`),
  openTasks: () => request('GET', '/api/tasks'),
  doneTasks: () => request('GET', '/api/tasks?done=1'),
  tasksAtHome: (id) => request('GET', `/api/tasks${q({ home: id })}`),
  createTask: (task) => request('POST', '/api/tasks', task),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  restoreTask: (id) => request('POST', `/api/tasks/${id}/restore`, {}),
  deletedTasks: () => request('GET', '/api/tasks?deleted=1'),
  deletedEvents: () => request('GET', '/api/events?deleted=1'),
  restoreEvent: (id) => request('POST', `/api/events/${id}/restore`, {}),
  dueReminders: () => request('GET', '/api/reminders/due'),
  reminders: (state) => request('GET', `/api/reminders?state=${state}`),
  changeReminder: (id, changes) => request('PATCH', `/api/reminders/${id}`, changes),
  changeTask: (id, changes) => request('PATCH', `/api/tasks/${id}`, changes),
  listLife: () => request('GET', '/api/life'),
  createLifeItem: (item) => request('POST', '/api/life', item),
  getLifeItem: (id) => request('GET', `/api/life/${id}`),
  updateLifeItem: (id, changes, options) => request('PATCH', `/api/life/${id}`, changes, options),
  deleteLifeItem: (id) => request('DELETE', `/api/life/${id}`),
  restoreLifeItem: (id) => request('POST', `/api/life/${id}/restore`, {}),
  deletedLife: () => request('GET', '/api/life?deleted=1'),
  notesAtHome: (id, offset) => request('GET', `/api/life/${id}/notes${q({ offset })}`),
  getNote: (id) => request('GET', `/api/notes/${id}`),
  updateNote: (id, changes, options) => request('PATCH', `/api/notes/${id}`, changes, options),

  listJournals: () => request('GET', '/api/journals'),
  createJournal: (name) => request('POST', '/api/journals', { name }),
  deleteJournal: (id) => request('DELETE', `/api/journals/${id}`),
  entriesOfDay: (day, journal) => request('GET', `/api/entries${q({ day, journal })}`),
  entriesBefore: (day, journal, limit) => request('GET', `/api/entries${q({ before: day, journal, limit })}`),
  entryDays: (from, to, journal) => request('GET', `/api/entries/days${q({ from, to, journal })}`),
  searchEntries: (text) => request('GET', `/api/entries${q({ q: text })}`),
  deletedEntries: () => request('GET', '/api/entries?deleted=1'),
  createEntry: (entry, options) => request('POST', '/api/entries', entry, options),
  getEntry: (id) => request('GET', `/api/entries/${id}`),
  updateEntry: (id, changes, options) => request('PATCH', `/api/entries/${id}`, changes, options),
  deleteEntry: (id) => request('DELETE', `/api/entries/${id}`),
  restoreEntry: (id) => request('POST', `/api/entries/${id}/restore`, {}),

  createCapture: (body, world = 'inner') => request('POST', '/api/captures', { body, world }),
  waitingCaptures: () => request('GET', '/api/captures'),
  captureCount: () => request('GET', '/api/captures/count'),
  capturesIn: (view) => request('GET', `/api/captures?view=${view}`),
  updateCapture: (id, changes, options) => request('PATCH', `/api/captures/${id}`, changes, options),
  sortCapture: (id, to, noteId, task, extra = {}) => request('POST', `/api/captures/${id}/sort`, { to, note_id: noteId, task, ...extra }),
  letGoCapture: (id) => request('DELETE', `/api/captures/${id}`),
  undoCapture: (id) => request('POST', `/api/captures/${id}/undo`, {}),
  getCapture: (id) => request('GET', `/api/captures/${id}`),
  acceptCapture: (id) => request('POST', `/api/captures/${id}/accept`, {}),
  deletedCaptures: () => request('GET', '/api/captures?deleted=1'),

  // Sends a file as it is; the server keeps it once, by its fingerprint.
  async uploadFile(file) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
      body: file,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw Object.assign(new Error(detail.error ?? `The file couldn't be added (${res.status}).`), { status: res.status });
    }
    return res.json();
  },
};

// ---- Elements ----

// el('p', { class: 'x' }, 'text', child) makes an element. Strings become text, never HTML.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// Fixed drawings, in the text colour.
const svg = (inner) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const icons = {
  grid: svg('<rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>'),
  rows: svg('<path d="M2 3.5h12M2 8h12M2 12.5h12"/>'),
  back: svg('<path d="M13 8H3M7 4L3 8l4 4"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  assistant: svg('<path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/><path d="M5 7.5h.01M8 7.5h.01M11 7.5h.01"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  pin: svg('<path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3-1 1-3-3-4.5 4.5"/><path d="M6.5 4.5l-1 .5-2 2 6 6 2-2 .5-1"/>'),
  settings: svg('<circle cx="8" cy="8" r="2.25"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
  moon: svg('<path d="M13.5 10A6 6 0 1 1 6 2.5a4.75 4.75 0 0 0 7.5 7.5z"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>'),
  notes: svg('<rect x="4" y="1.5" width="10" height="11" rx="1.5"/><path d="M2 4.5v9a1 1 0 0 0 1 1h8"/>'),
  journal: svg('<rect x="2" y="2.5" width="12" height="11.5" rx="1.5"/><path d="M2 6h12M5.5 1v3M10.5 1v3"/>'),
  left: svg('<path d="M10 3L5 8l5 5"/>'),
  right: svg('<path d="M6 3l5 5-5 5"/>'),
  world_inner: svg('<circle cx="8" cy="8" r="5.5"/>'),
  world_outer: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>'),
  link: svg('<path d="M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8"/>'),
  inbox: svg('<path d="M2 9.5l1.8-6A1 1 0 0 1 4.8 2.8h6.4a1 1 0 0 1 1 .7l1.8 6M2 9.5V13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5M2 9.5h3.5l1 2h3l1-2H14"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  person: svg('<circle cx="8" cy="5.5" r="3"/><path d="M2.5 14.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/>'),
  // My Life: a Key Element is a pillar with a keyhole (2026-10-27, the owner's choice), a
  // Goal a target, a Project a flag, a Topic a #.
  key_element: svg('<path d="M2 4.6L8 1.8l6 2.8M2.5 5.6h11M2 13.8h12M3.8 7.2v4.8M12.2 7.2v4.8"/><circle cx="8" cy="8.4" r="1.3"/><path d="M7.5 9.6L7.2 12h1.6l-.3-2.4"/>'),
  goal: svg('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/>'),
  project: svg('<path d="M3.5 14.5V2M3.5 2.5h9l-2 3 2 3h-9"/>'),
  topic: svg('<path d="M6 2L4.5 14M11.5 2L10 14M2.5 5.5h11M2 10.5h11"/>'),
  // A Habit is a rhythm: an arrow that comes back round (advanced/mylife/1).
  habit: svg('<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13 2v3.2h-3.2"/>'),
  task: svg('<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="M5 8.2l2 2 4-4.5"/>'),
  attach: svg('<path d="M13 7.5l-5 5a3 3 0 0 1-4.2-4.2l5.5-5.5a2 2 0 0 1 2.8 2.8L6.5 11.2a1 1 0 0 1-1.4-1.4L10 5"/>'),
  edit: svg('<path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 0l.3.3a1.4 1.4 0 0 1 0 2L5.5 12.8zM9.5 4.2l2.3 2.3"/>'),
  house: svg('<path d="M2 7.5L8 2.5l6 5M3.5 6.5V13.5h9V6.5M6.5 13.5V9.5h3v4"/>'),
  check: svg('<path d="M3 8.5l3.2 3.2L13 4.5"/>'),
  down: svg('<path d="M3 6l5 5 5-5"/>'),
  clock: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>'),
  board: svg('<rect x="1.5" y="2.5" width="5" height="4" rx="1"/><rect x="9.5" y="9.5" width="5" height="4" rx="1"/><path d="M6.5 4.5h3a2 2 0 0 1 2 2v3"/>'),
  open: svg('<path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 10v3.5h-9v-9H6"/>'),
  chevron: svg('<path d="M5 3l6 5-6 5"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  planner: svg('<rect x="2" y="2.5" width="12" height="11.5" rx="1.5"/><path d="M2 6h12M5 9h3M5 11.5h6"/>'),
  speedy: svg('<path d="M9 1.5L3.5 9h4l-1 5.5L12.5 7h-4z"/>'),
  mail: svg('<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M2 4.5l6 4.5 6-4.5"/>'),
  mic: svg('<rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5"/>'),
  log: svg('<path d="M3 4.5h10M3 8h10M3 11.5h6"/>'),
  // A telephone handset: a voice call with your assistant (advanced/voice/3).
  phone: svg('<path d="M4.5 2h2l1 3-1.5 1a7 7 0 0 0 3.5 3.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 3 3.5 1.5 1.5 0 0 1 4.5 2z"/>'),
  timeline: svg('<path d="M4.5 2v12"/><circle cx="4.5" cy="4.5" r="1.6"/><circle cx="4.5" cy="11.5" r="1.6"/><path d="M8.5 4.5h5M8.5 11.5h5"/>'),
  // A mortarboard: the course (course.js).
  course: svg('<path d="M1.5 6L8 3l6.5 3L8 9z"/><path d="M4.5 7.4v3.4c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4V7.4M14.5 6v3.5"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12.5" cy="8" r="1"/>'),
  bell: svg('<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.2 1.5H2.8zM6.5 14.5h3"/>'),
  repeat: svg('<path d="M2.5 7V6a2.5 2.5 0 0 1 2.5-2.5h8M11 1.5l2 2-2 2M13.5 9v1a2.5 2.5 0 0 1-2.5 2.5H3M5 14.5l-2-2 2-2"/>'),
  archive: svg('<rect x="1.5" y="2.5" width="13" height="3" rx="1"/><path d="M2.5 5.5v8h11v-8M6.5 8.5h3"/>'),
  calendar: svg('<rect x="2" y="2.5" width="12" height="11.5" rx="1.5"/><path d="M2 6h12M5.5 1v3M10.5 1v3M5 9h1M8 9h1M11 9h1M5 11.5h1M8 11.5h1"/>'),
};

// A box that had the cursor when its part of the page was redrawn gets it back, at the end
// of its words, the moment the new box is on the page: call wantsCursor(box) while drawing
// and giveCursorBack(place) right after putting it there, so no key pressed in between is
// lost. If nobody does, it gets it back a frame later.
export function wantsCursor(input) {
  input.dataset.wantsCursor = '';
  requestAnimationFrame(() => { if ('wantsCursor' in input.dataset) giveCursorBack(input.parentElement ?? document); });
}

export function giveCursorBack(place = document) {
  const input = place.querySelector?.('[data-wants-cursor]') ?? (place.matches?.('[data-wants-cursor]') ? place : null);
  if (!input) return;
  delete input.dataset.wantsCursor;
  if (!input.isConnected) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// A kind's icon (2026-11-09, the owner's wish): a bold white (or charcoal) drawing on a disc of the kind's colour,
// like the brand's white-on-colour Quest icons. The disc fills the icon's square; the drawing sits well inside it.
// The colours come from style.css (--kind, --kind-ink, set by data-icon), never from here.
const disc = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="kind-disc"><circle cx="12" cy="12" r="12" style="fill: var(--kind)"/><g fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--kind-ink)">${inner}</g></svg>`;
const discs = {
  notes: disc('<path d="M8.5 6.5h5l2.5 2.5v8.5h-7.5z"/><path d="M13.5 6.5V9H16"/>'),
  journal: disc('<path d="M12 8.6c-1.4-1.1-3.2-1.5-5-1.3v8.8c1.8-.2 3.6.2 5 1.3 1.4-1.1 3.2-1.5 5-1.3V7.3c-1.8-.2-3.6.2-5 1.3z"/><path d="M12 8.6v8.8"/>'),
  task: disc('<path d="M7.6 12.4l3 3 5.8-6.4"/>'),
  planner: disc('<circle cx="12" cy="12" r="5.3"/><path d="M12 9.2V12l2 1.4"/>'),
  calendar: disc('<rect x="7" y="7.8" width="10" height="9" rx="1.6"/><path d="M7 11h10M9.6 6.3v2.6M14.4 6.3v2.6"/>'),
  person: disc('<circle cx="12" cy="9.6" r="2.6"/><path d="M7.4 17.2c.7-2.5 2.4-3.7 4.6-3.7s3.9 1.2 4.6 3.7"/>'),
  timeline: disc('<path d="M9 7v10"/><path d="M12 8.5h4M12 12h3M12 15.5h4"/>'),
  key_element: disc('<path d="M6.8 10.2L12 7l5.2 3.2M7.2 17h9.6M9 11.6v3.8M12 11.6v3.8M15 11.6v3.8"/>'),
  goal: disc('<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>'),
  project: disc('<path d="M9 17.5V6.8M9 7.2h7l-1.6 2.4L16 12H9"/>'),
  topic: disc('<path d="M10.6 7l-1.2 10M14.6 7l-1.2 10M7.6 10h9M7.2 14h9"/>'),
  habit: disc('<path d="M16.6 12a4.6 4.6 0 1 1-1.4-3.3M16.8 6.8v2.5h-2.5"/>'),
  // A small robot's face (2026-11-10, the owner's wish): its antenna, a rounded head, two eyes and a mouth.
  assistant: disc('<path d="M12 5.6v2"/><rect x="7" y="7.6" width="10" height="8.6" rx="2.2"/><path d="M10 11.2v.6M14 11.2v.6M10.2 14h3.6"/>'),
};

export function icon(name) {
  const span = el('span', { class: 'icon', 'data-icon': name }); // style.css colours a kind's icon (Kinds, tokens.css)
  span.innerHTML = discs[name] ?? icons[name];
  return span;
}

// ---- Words and dates ----

export const titleOf = (item) => item.title.trim() || 'Untitled';
export const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
export const wordsLabel = (text) => `${wordCount(text)} ${wordCount(text) === 1 ? 'word' : 'words'}`;

export function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return shortDate(iso);
}

// Days are YYYY-MM-DD in this computer's time zone, as the server keeps them.
const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const today = () => dayOf(new Date());
export function dateOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(day, n) {
  const date = dateOf(day);
  date.setDate(date.getDate() + n);
  return dayOf(date);
}
export const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && dayOf(dateOf(text)) === text;
// The Monday of the week a day is in.
export const weekStart = (day) => addDays(day, -((dateOf(day).getDay() + 6) % 7));
export const weekdayName = (day, style = 'long') => dateOf(day).toLocaleDateString(undefined, { weekday: style });
export const dayNumber = (day) => dateOf(day).getDate();
export const longDate = (day) => dateOf(day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const monthName = (day) => dateOf(day).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });

// ---- Saving as you type ----

const SAVE_AFTER_MS = 400;
const RETRY_AFTER_MS = 3000;

// Changes wait a moment while you type, then go to the server in order. A change that
// couldn't be saved is kept and tried again; nothing typed is dropped. Closing the tab
// or reloading sends what is left; only when saving has already failed does the browser
// ask before leaving. `save(changes, options)` sends; `onSaved(result)` runs after each save.
export function makeSaver(save, { status, onSaved }) {
  let pending = {};
  let timer = null;
  let saving = Promise.resolve();
  let failed = false;
  const hasPending = () => Object.keys(pending).length > 0;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!hasPending()) return saving;
    const changes = pending;
    pending = {};
    saving = saving.then(async () => {
      try {
        const result = await save(changes);
        failed = false;
        onSaved?.(result);
        if (!hasPending()) status.textContent = 'Saved';
      } catch {
        failed = true;
        pending = { ...changes, ...pending };
        status.textContent = "Couldn't save. Trying again…";
        clearTimeout(timer);
        timer = setTimeout(flush, RETRY_AFTER_MS);
      }
    });
    return saving;
  }

  function change(field, value) {
    pending[field] = value;
    status.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_AFTER_MS);
  }

  const sendNow = () => {
    if (!hasPending()) return;
    save(pending, { keepalive: true }).catch(() => {});
    pending = {};
  };
  const onBeforeUnload = (event) => {
    if (failed && hasPending()) event.preventDefault();
    else sendNow();
  };
  window.addEventListener('pagehide', sendNow);
  window.addEventListener('beforeunload', onBeforeUnload);

  return {
    change,
    flush,
    // Saved, nothing waiting and nothing failed: safe to delete or leave.
    settled: async () => { await flush(); return !hasPending() && !failed; },
    async close() {
      await flush();
      window.removeEventListener('pagehide', sendNow);
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}

// ---- "… deleted. Undo" ----

export function undoBar(text, undo) {
  const bar = el('div', { class: 'undo-bar', role: 'status' },
    el('span', {}, text),
    el('button', {
      type: 'button', class: 'button',
      onclick: async () => {
        try {
          await undo();
          bar.remove();
        } catch {
          bar.firstChild.textContent = "It couldn't be brought back here. Try Recently deleted.";
        }
      },
    }, 'Undo'));
  return bar;
}

// A title that grows with its text, where Enter goes on to the text below.
export function titleField({ value, placeholder = 'Untitled', onInput, onEnter }) {
  const field = el('textarea', {
    class: 'note-title', rows: 1, placeholder, 'aria-label': 'Title',
    oninput: () => {
      if (field.value.includes('\n')) field.value = field.value.replace(/\n/g, ' ');
      grow();
      onInput(field.value);
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') { event.preventDefault(); onEnter(); }
    },
  });
  const grow = () => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; };
  field.value = value;
  return { field, grow };
}

// ---- "Linked from" (pkm/1) ----

// Every page that links to this one, with the sentence around the link and the link's
// words in bold. Shown at the bottom of every note, journal entry and journal day.
export function linkedFromSection(kind, id, { title = 'Linked from', none = 'Nothing links here yet. Type [[ in another note or entry to link to this page.', only = null, without = null } = {}) {
  const list = el('div', { class: 'linked-from-list' });
  const heading = el('h2', { class: 'linked-from-title' }, title);
  const section = el('section', { class: 'linked-from', 'aria-label': title }, heading, list);
  const sentence = (context, words) => {
    const at = words ? context.indexOf(words) : -1;
    if (at < 0) return [context];
    return [context.slice(0, at), el('strong', {}, words), context.slice(at + words.length)];
  };
  api.linkedFrom(kind, id).then((all) => {
    const links = all.filter((l) => (only ? l.from_kind === only : true) && (without ? l.from_kind !== without : true));
    heading.textContent = links.length ? `${title} · ${links.length}` : title;
    list.replaceChildren(...(links.length ? links.map((link) => el('a', {
      class: 'linked-from-row',
      href: { note: `/notes/${link.from_id}`, entry: `/journal/entries/${link.from_id}`, person: `/people/${link.from_id}`, company: `/companies/${link.from_id}`, life: `/life/${link.from_id}`, task: '/tasks' }[link.from_kind] ?? (link.from_kind === 'event' ? `/calendar/${link.starts_at.slice(0, 10)}?view=day&open=${link.from_id}` : '/'),
    },
    el('span', { class: 'linked-from-source' },
      link.from_kind === 'life' ? icon(link.life_kind)
        : el('span', { class: 'page-link-kind', 'aria-hidden': 'true' }, { note: '▭', entry: '31', person: '@', company: '▤', task: '☐', event: '◷' }[link.from_kind]),
      // An entry: its title if it has one, else its time (its first line is the sentence below).
      link.from_kind === 'event' ? `Event · ${weekdayName(link.starts_at.slice(0, 10), 'short')}, ${longDate(link.starts_at.slice(0, 10))} · ${clockTime(`${link.starts_at}:00`)} · ${link.label}`
        : link.from_kind !== 'entry' ? link.label
        : `Journal · ${weekdayName(link.day, 'short')}, ${longDate(link.day)} · ${link.title || clockTime(link.written_at)}`),
    el('span', { class: 'linked-from-context' }, ...sentence(link.context, link.link_text)))) : [
      el('p', { class: 'empty' }, none),
    ]));
  }).catch(() => {
    list.replaceChildren(el('p', { class: 'empty' }, "What links here couldn't be loaded."));
  });
  return section;
}
