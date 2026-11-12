// Modules (Settings › Modules, advanced/people/1): parts of the app that can be switched
// off. A module that is off hides its menus and its chips and keeps everything it made.
// Each one is a row in settings (module.<id>, "on" or "off"); a module is on until it is
// switched off.

import { randomUUID } from 'node:crypto';

export const MODULES = [
  // The sections (Sovran Advisor): whole parts of the app that a new install starts with switched off
  // (starter: false). A student switches one on in Settings › Modules when they want it; off again, it
  // leaves the sidebar and keeps everything written in it.
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Your tasks in one place: a day for each, Today, Upcoming and Someday. Tasks written in a note or a journal entry show here too.',
    starter: false,
  },
  {
    id: 'planner',
    label: 'Planner',
    description: 'Plan your day and your week: what you will do and when, a highlight for the day, and a short close at its end.',
    starter: false,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Your own events by day, week and month, kept in this app.',
    starter: false,
  },
  {
    id: 'life',
    label: 'My Life',
    description: 'The parts of your life that matter to you (ICOR’s Key Elements), each with what serves it and the notes and tasks that belong to it.',
    starter: false,
  },
  {
    id: 'course',
    label: 'Course',
    description: 'A Course link in the sidebar: your course’s own page online, with the session replays, the homework and your questions. It opens in your browser.',
    starter: false, // off, and
    hidden: true, // not listed in Settings › Modules yet (2026-11-11): the owner is still deciding how the course page opens
  },
  {
    id: 'people-plus',
    label: 'People in depth',
    description: 'Type @ for a person or @@ for a company in any text, a task’s words too. Their page lists every place you named them.',
  },
  {
    id: 'voice',
    starter: false, // off in a new install. On: the free voice model is fetched once (about 200 MB); an ElevenLabs key is optional
    label: 'Dictation',
    description: 'Hold a key in any field, speak, let go: your words land at the cursor. Every dictation is kept as text in Settings.',
  },
  {
    // The manifest (advanced/tasks/1): quick add on q, and what an estimate makes a task (a Speedy or a Task).
    id: 'tasks-plus',
    label: 'Tasks in depth',
    description: 'Press q anywhere and add a task in one line: a day and an estimate read from your words. Fifteen minutes or less is a Speedy, a longer one a Task, shown on every row.',
    keys: ['q'],
    tables: ['tasks'],
    tools: ['add_task'],
  },
  {
    // The manifest (advanced/calendar/1): your other calendars by their iCal link. Off, the pane, the events and the job
    // are gone and the rows stay in the database (`calendars`, whose events are read from the link and kept in its body).
    id: 'calendar-links',
    label: 'Calendar links',
    description: 'Other people’s calendars by their iCal link, read only, shown beside your own events and read again every ten minutes.',
    tables: ['calendars'],
    jobs: ['calendar-read'],
  },
  {
    // The manifest (advanced/calendar/2): the Planner's day as its order, and one, three or seven days in hours.
    // Nothing is stored for it: the pictures are drawn from the Planner's own day. Off, the Planner is as it was.
    id: 'calendar-plus',
    label: 'Calendar in depth',
    description: 'The Planner’s day as its order (events and the gaps between them), or one, three or seven days in hours; tasks keep their place, never a time on the Calendar. Your assistant can look at your calendar and propose events as cards.',
    tables: ['event_templates'],
    tools: ['calendar_list', 'calendar_propose'],
  },
  {
    // The manifest (advanced/mylife/1): Habits, the fifth kind in My Life. Off, My Life is the core again: no Habits group, no + Habit,
    // and a Habit is not offered as a home; the rows wait in life_items.
    id: 'mylife-plus',
    starter: false, // off in a new install: switch it on in Settings › Modules when you want Habits
    label: 'My Life in depth',
    description: 'Habits join Key Elements, Goals, Projects and Topics in My Life: a rhythm you keep, with how often and what counts as done.',
    tables: ['life_items'],
  },
  {
    // The manifest (advanced/calendar/7): your Google events on your days, read only (Calendar 8 and 9 change them). Needs the
    // Google sign-in (Settings › Google) with "Read your calendar" on. Off, Google's events and the job are gone; the rows and the sign-in stay.
    id: 'calendar-google',
    starter: false, // off in a new install: it needs your own Google sign-in
    label: 'Google Calendar',
    description: 'Your Google events on your days, with a small G, read again every minute. Needs a Google sign-in (Settings › Google) with “Read your calendar” on.',
    permissions: ['calendar.read', 'calendar.modify'],
    tables: ['google_events'],
    jobs: ['google-calendar-read'],
  },
  {
    // The manifest (advanced/writing/1): notes edit as an outline. Off, every note is its plain indented text again and the bullet rows are kept.
    id: 'writing',
    label: 'Writing and thinking',
    description: 'Notes edit as an outline: Tab nests a bullet, a triangle folds it, Alt and the arrows move it, Cmd . zooms into it.',
    keys: ['Tab', 'Alt+Up', 'Alt+Down', 'Cmd+.'],
    tables: ['bullets', 'comments', 'note_versions', 'note_clashes', 'boards', 'board_items', 'ink_strokes', 'import_runs'],
    tools: ['list_comments', 'reply_to_comment'],
  },
  {
    // The manifest (advanced/everywhere 3, 8 and 11, the Sovran Advisor way: no cloud account, nothing to pay): a capture
    // page for the phone's home screen, the daily backups each checked, and a moving file for a new computer. Off, the
    // page and the Settings part are gone; the daily backup itself always runs.
    id: 'everywhere',
    starter: false, // off in a new install: switch it on in Settings › Modules
    label: 'Phone, backups and moving',
    description: 'A Capture icon for your phone’s home screen that keeps a thought in your Inbox in two taps. Your daily backups, each checked. And one moving file that takes everything to a new computer.',
    public: ['GET /quick'],
  },
  {
    // The manifest (advanced/last/2 and 3): a help page per view, in docs/ (docs.js), a "?" after every page title
    // that opens it beside the page (public/help.js), and the assistant's docs_read. Off, the "?" and the tool go.
    id: 'help',
    starter: false, // off in a new install: switch it on in Settings › Modules
    label: 'Help pages',
    description: 'A “?” after every page’s title opens a short page on what it is for and how to use it. Your assistant reads the same pages when you ask “how does this work?”.',
    tools: ['docs_read'],
  },
  {
    // The manifest (advanced/mail/1): a place after the Inbox, the Google permissions it may ask for, its tables and tools.
    // Off in a new install and dormant: it holds no Google credentials, and its jobs (sync, sending) do nothing while it is off.
    id: 'mail',
    starter: false, // off in a new install: it needs your own Google sign-in, with setup directions still to come
    hidden: true, // not listed in Settings › Modules until those directions exist (2026-11-11); a switch that cannot work yet would only confuse
    label: 'Mail',
    description: 'Your own mail, kept in the app. Needs a Google sign-in of your own (Settings › Google); setup directions will follow later. Reading your mail and sending mail as you are two separate switches.',
    permissions: ['mail.read', 'mail.send', 'mail.modify'],
    tables: ['google_accounts', 'google_log', 'mail_accounts', 'mail_threads', 'mail_messages', 'mail_labels', 'mail_imports', 'mail_outbox', 'mail_senders', 'mail_sends', 'mail_opens', 'mail_confirm_people'],
    tools: [], // its four tools (mail_search, mail_read, mail_draft, mail_to_task) go with the module: assistant-tools.js MODULE_TOOLS
    public: ['GET /o/<token>.gif'], // the one address anything outside may reach (Mail 9), and only while Mail is on
    jobs: ['mail-sync', 'mail-sender'], // Live with Gmail (Mail 4): off until switched on, stops with the module
  },
];

const now = () => new Date().toISOString();
const keyOf = (id) => `module.${id}`;
const fail = (status, message) => Object.assign(new Error(message), { status });

export function listModules(db) {
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'module.%' AND deleted_at IS NULL").all()
    .map((row) => [row.key, row.value]));
  // A module is on until it is switched off; one marked starter: false is off until it is switched on.
  return MODULES.map((m) => {
    const value = stored[keyOf(m.id)];
    return { ...m, on: value === undefined ? m.starter !== false : value !== '"off"' };
  });
}

export const moduleOn = (db, id) => listModules(db).find((m) => m.id === id)?.on ?? false;

export function checkModuleInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (typeof input.id !== 'string' || !MODULES.some((m) => m.id === input.id)) return 'There is no such module.';
  if (typeof input.on !== 'boolean') return 'on is true or false.';
  return null;
}

export function setModule(db, id, on) {
  if (!MODULES.some((m) => m.id === id)) throw fail(400, 'There is no such module.');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, keyOf(id), JSON.stringify(on ? 'on' : 'off'));
  return listModules(db);
}
