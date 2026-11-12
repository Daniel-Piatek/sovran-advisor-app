// The assistant's tools (assistant/2), offered over MCP by the app's own server (mcp.js).
// Each runs the same code the app runs, so what the assistant changes shows in the app at
// once, and what it makes is marked as made by the assistant (origin 'assistant').
//   search_notes, read_note, list_tasks       read
//   add_task, append_to_journal               what you asked for in so many words: goes
//                                             straight in, with Undo on its card
//   propose_note_edit, propose_task_change    anything else (tidying a note, ticking a
//                                             task): a card with Apply and Dismiss; nothing
//                                             changes until you apply it, and Undo after
// There is no tool that changes a note or a task directly: the rule is in the code.
// What it may do alone is the owner's to set (permissions.js, assistant/4): an action set
// to Asks first becomes an approval card, and nothing happens until they approve it. And
// approve_step is Claude Code's own permission prompt: its steps outside the chat's folder
// are decided here at that moment, as the switch says, under the floor.

import { randomUUID } from 'node:crypto';
import { searchNotes, getNote, updateNote, createNote, deleteNote } from './notes.js';
import { modeOf, judgeStep, logActivity, ruleOf, isAllowed, allowRule } from './permissions.js';
import { plannerDay, plannerWeek, setHighlight, createBlock, deleteBlock, getSettings, addDays, BLOCK_KINDS } from './planner.js';

const BLOCK_NAMES = { deep: 'Deep Work', shallow: 'Shallow', routine: 'Routine', batch: 'Batch', buffer: 'Buffer' };
import { closeDay, reopenDay, dayClose } from './reviews.js';
import { eventsBetween } from './events.js';
import { calendarEventsBetween, ownEvent } from './calendars.js';
import { searchEntries, getEntry, createEntry, deleteEntry, localDay } from './entries.js';
import { listPeople, listCompanies, getPerson, getCompany } from './people.js';
import { getLifeItem, lifeSummary, lifeChains, kindName } from './life.js';
import { waitingCaptures } from './captures.js';
import { listTasks, createTask, changeTask, getTask, deleteTask, checkTaskInput } from './tasks.js';
import { moduleOn } from './modules.js';
import { findDocs } from './docs.js';
import { listThreads, getThread } from './mail.js';
import { checkDraft, mailToTask, draftsToday, LIMITS } from './mail-assistant.js';
import { composeSend, undoSend } from './mail-send.js';
import { laterComments, replyTo, getComment } from './comments.js';
import { saveWithMerge } from './merge.js';
import { listBoards, boardText, planDrawing, drawPlan, undoChange } from './boards.js';
import { parseQuickAdd } from './public/due.js';
import { calendarList, planProposal, applyProposal, undoProposal } from './calendar-assistant.js';
import { reconnectList } from './reconnect.js';
import { INTERACTION_KINDS, checkInteractionInput, logInteraction, deleteInteraction, findPerson } from './interactions.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text);

// Where a page lives in the app, by its kind.
export const PATHS = {
  note: (id) => `/notes/${id}`,
  entry: (id) => `/journal/entries/${id}`,
  person: (id) => `/people/${id}`,
  company: (id) => `/companies/${id}`,
  life: (id) => `/life/${id}`,
};

// A tool that belongs to a module is offered, and runs, while the module is on.
const MODULE_TOOLS = { log_interaction: 'people-plus', reconnect_list: 'people-plus', mail_search: 'mail', mail_read: 'mail', mail_draft: 'mail', mail_to_task: 'mail', list_comments: 'writing', reply_to_comment: 'writing', board_read: 'writing', board_draw: 'writing', calendar_list: 'calendar-plus', calendar_propose: 'calendar-plus', my_life: 'life', read_life_item: 'life', docs_read: 'help' };
export const offeredTools = (db) => TOOLS.filter((tool) => !MODULE_TOOLS[tool.name] || moduleOn(db, MODULE_TOOLS[tool.name]));

export const TOOLS = [
  {
    name: 'search_notes',
    description: 'Search the owner’s notes, journal entries, people, companies and My Life by words. Returns each match with its id, kind, title, path in the app and the start of its text. Use read_note for the whole text.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for' } }, required: ['query'] },
  },
  {
    name: 'read_note',
    description: 'Read one page in full by its id: a note, a journal entry, a person, a company or a My Life item.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'my_life',
    description: 'A short summary of the owner’s My Life: their Key Elements (the parts of life they permanently maintain) and, under each, the active Goals with the Projects and Habits that carry them, and the active Projects, Habits and Topics. Use it for “which Goals am I working on?” or “what matters to me?”. Each item’s id is found with search_notes; read one with read_life_item. Reading only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_life_item',
    description: 'Read one My Life item (a Key Element, Goal, Project, Habit or Topic) by its id: its fields, its chain (why it exists: Project, Goal, Key Element), what stands under it, its thinking space and its open tasks. Reading only.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'docs_read',
    description: 'Read the app’s own help pages, to answer how a part of this app works (“how does the Inbox work?”, “what is a Speedy?”). Give a view (like planner, inbox, tasks) or some words; it returns the best one or two pages with their link. Only for how the app works: for the owner’s own notes, journal and tasks use the other tools. Reading only.',
    inputSchema: { type: 'object', properties: { view: { type: 'string', description: 'A view of the app, like planner or inbox' }, words: { type: 'string', description: 'Words to look for in the help pages' } } },
  },
  {
    name: 'list_tasks',
    description: 'List the owner’s tasks. when: today (due today), overdue, upcoming (a later day), no_date, done (recently done), or all open tasks (default).',
    inputSchema: { type: 'object', properties: { when: { type: 'string', enum: ['all', 'today', 'overdue', 'upcoming', 'no_date', 'done'] } } },
  },
  {
    name: 'list_inbox',
    description: 'List what waits in the owner’s Inbox (captures not sorted yet), oldest first, each with what the assistant suggested for it, if anything.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_task',
    description: 'Add a task the owner asked for. due: a date YYYY-MM-DD, "someday", or leave out. estimate: minutes. flag: must or like. The text may carry the owner’s own words ("reply to Lena tomorrow ~5m"): a day, an estimate (~10m, ~1h), a time (2pm), a repeat (every monday) and !must or !like are read out of it, as in the quick add bar, and every other word stays the title. Only when the owner asked for this task. Depending on their settings it is added at once or waits for their approval on a card: the answer says which.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, due: { type: 'string' }, estimate: { type: 'integer' }, flag: { type: 'string', enum: ['', 'must', 'like'] } },
      required: ['text'],
    },
  },
  {
    name: 'reconnect_list',
    description: 'Who the owner wanted to keep in touch with and is due or overdue: everyone with a rhythm (a cadence), the most overdue first, each with how often, when they were last in touch (from the owner’s logged calls, coffees and messages) and how many days are left or overdue. Use it for "who should I reconnect with?". Reading only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'log_interaction',
    description: 'Log what happened with a person outside the app (a call, a meeting, a coffee, a message, other), in one sentence, on a day (YYYY-MM-DD, today by default; never in the future). person: their name as in People. Only when the owner asked for it. Depending on their settings it is logged at once or waits for their approval on a card: the answer says which.',
    inputSchema: {
      type: 'object',
      properties: { person: { type: 'string' }, kind: { type: 'string', enum: INTERACTION_KINDS }, when: { type: 'string' }, sentence: { type: 'string' } },
      required: ['person', 'kind', 'sentence'],
    },
  },
  {
    name: 'mail_search',
    description: 'Search the owner’s mail (the conversations kept in this app) by words in the subject, the people or the last words. Returns up to 10 conversations with their ids. Reading only.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'mail_read',
    description: 'Read one conversation of the owner’s mail by its id (from mail_search): who wrote, when, and the words of each mail. Reading only.',
    inputSchema: { type: 'object', properties: { thread_id: { type: 'string' } }, required: ['thread_id'] },
  },
  {
    name: 'mail_draft',
    description: 'Draft a reply on a conversation of the owner’s mail, for the owner to read and send. It NEVER sends: the answer is a card with Send, Edit and Dismiss, and nothing leaves until the owner presses Send. Limits set in the app, not in this text: only to people already in the conversation (to: leave out to reply to whoever wrote last), never an attachment, at most 10 drafts a day. If a limit stops you, say so; do not try another way.',
    inputSchema: { type: 'object', properties: { thread_id: { type: 'string' }, text: { type: 'string' }, to: { type: 'string' } }, required: ['thread_id', 'text'] },
  },
  {
    name: 'mail_to_task',
    description: 'Make a task from a conversation of the owner’s mail, linked back to it. title: its words (the subject if left out); due: YYYY-MM-DD or leave out. Depending on their settings it is added at once or waits for their approval on a card.',
    inputSchema: { type: 'object', properties: { thread_id: { type: 'string' }, title: { type: 'string' }, due: { type: 'string' } }, required: ['thread_id'] },
  },
  {
    name: 'calendar_list',
    description: 'The owner’s calendar for a stretch of days (from, to: YYYY-MM-DD, at most 21 days): each day with its events (theirs, other calendars’ and Google’s, each with an id and where it is from) and the free time left in their plan, as gaps of at least 30 minutes inside their working day. Reading only. Use it before proposing a time.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from'] },
  },
  {
    name: 'calendar_propose',
    description: 'Propose a new event, or a new time for an existing one, as a card for the owner to approve. It NEVER makes or moves anything: a meeting is agreed with other people, so it always waits for their yes on the card, whatever else they let you do alone. title; starts_at as YYYY-MM-DDTHH:MM and ends_at (or minutes); where: "mine" (their own calendar, the default) or "google" (their Google calendar, only if they have switched on changing it); guests: names from People (Google only; each needs an email address there); meet: true for a Meet link; move_event_id: the id of an event from calendar_list to move it instead (one of theirs, or a Google meeting they organise); reason: why this time, in a sentence. The card says when it overlaps something. Look at the calendar first and pick a free gap.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, starts_at: { type: 'string' }, ends_at: { type: 'string' }, minutes: { type: 'integer' }, where: { type: 'string' }, guests: { type: 'array', items: { type: 'string' } }, meet: { type: 'boolean' }, move_event_id: { type: 'string' }, reason: { type: 'string' } }, required: ['starts_at'] },
  },
  {
    name: 'board_read',
    description: 'Read a whiteboard of the owner’s notes as short text: each card with its words and what it points to (a note, person or task), and each arrow as "from → to". Without board_id it lists the boards (their ids, titles and notes). Reading is free.',
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' } } },
  },
  {
    name: 'board_draw',
    description: 'Draw cards, words and arrows on a board. items is a list: { kind: "card" | "text", text, key?, x?, y? } for something new (give it a key to point arrows at it), { kind: "arrow", from, to, label? } where from and to are ids of cards already on the board (from board_read) or keys of new ones. x is 0 to 1200 and y 0 to 700. It is a change, so it waits for the owner’s approval on a card unless they let you change things alone; what you draw is marked as yours and one Undo takes it all back.',
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' }, items: { type: 'array', items: { type: 'object' } }, reason: { type: 'string' } }, required: ['board_id', 'items'] },
  },
  {
    name: 'list_comments',
    description: 'The comments the owner left on passages of their notes for you to go through later, each with its note, the passage they mean, their words and the thread so far. Answer each with reply_to_comment.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reply_to_comment',
    description: 'Answer a comment in its thread. The reply is signed as yours. comment_id: the id from list_comments or from the message that asked you; text: your answer, short and about the passage.',
    inputSchema: { type: 'object', properties: { comment_id: { type: 'string' }, text: { type: 'string' } }, required: ['comment_id', 'text'] },
  },
  {
    name: 'add_note',
    description: 'Add a new note the owner asked for (a title and its text in Markdown). Depending on their settings it is added at once or waits for their approval on a card.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'append_to_journal',
    description: 'Write an entry in the owner’s General journal, on a day (YYYY-MM-DD, today by default). Only when the owner asked for it.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, title: { type: 'string' }, day: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'propose_note_edit',
    description: 'Propose a change to a note (its new title and/or whole new text, in Markdown). Nothing changes until the owner applies it on the card. Use this for any change to a note.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, reason: { type: 'string', description: 'Why, in a few words' } },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'approve_step',
    description: 'Used by Claude Code itself to ask the owner whether one of its own steps may run. Never call it yourself.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
  },
  {
    name: 'read_week',
    description: 'Read a week of the owner’s Planner (the week a day is in, Monday first): each day with its events, planned tasks (ids), Highlight, how full it is against the budget in minutes, and this week’s Weekly Goals and what waits in the Tray.',
    inputSchema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD, today by default' } } },
  },
  {
    name: 'read_day',
    description: 'Read one day of the Planner: its events, tasks (done and open), Highlight, how full it is, and whether it was closed and with what line.',
    inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
  },
  {
    name: 'propose_plan',
    description: 'Propose one move on the owner’s Planner, with a one-line reason; it shows as a card on the board and nothing moves until they apply it. move: a task to another day (task_id, day, optional part morning|afternoon). highlight: make a task that day’s Highlight (task_id, day). block: a time block (day, starts_at HH:MM, ends_at HH:MM, block_kind deep|shallow|routine|batch|buffer, optional title).',
    inputSchema: {
      type: 'object',
      properties: {
        move: { type: 'string', enum: ['move', 'highlight', 'block'] }, task_id: { type: 'string' }, day: { type: 'string' }, part: { type: 'string' },
        starts_at: { type: 'string' }, ends_at: { type: 'string' }, block_kind: { type: 'string' }, title: { type: 'string' }, reason: { type: 'string' },
      },
      required: ['move', 'day', 'reason'],
    },
  },
  {
    name: 'propose_close_day',
    description: 'Propose closing a day (today by default) with a line about it, and what became of its Highlight (done, not_done or moved). Ask the owner about the Highlight first. It is saved only when they approve the card.',
    inputSchema: { type: 'object', properties: { day: { type: 'string' }, line: { type: 'string' }, highlight: { type: 'string', enum: ['', 'done', 'not_done', 'moved'] } }, required: ['line'] },
  },
  {
    name: 'propose_task_change',
    description: 'Propose a change to a task: tick it (done true), untick it, or give it another day (due). Nothing changes until the owner applies it on the card.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, done: { type: 'boolean' }, due: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'reason'],
    },
  },
];

const text = (data) => JSON.stringify(data, null, 1);

function search(db, query) {
  const words = String(query ?? '').trim();
  if (!words) throw fail(400, 'query is needed.');
  const notes = searchNotes(db, words).slice(0, 10).map((n) => ({ id: n.id, kind: 'note', title: n.title || 'Untitled', path: PATHS.note(n.id), start: n.preview }));
  const entries = searchEntries(db, words).slice(0, 10).map((e) => ({
    id: e.id, kind: 'journal entry', title: e.title || `Journal, ${e.day}`, day: e.day, path: PATHS.entry(e.id), start: e.preview,
  }));
  const people = listPeople(db, { q: words }).slice(0, 5).map((p) => ({ id: p.id, kind: 'person', title: p.name, path: PATHS.person(p.id) }));
  const companies = listCompanies(db, { q: words }).slice(0, 5).map((c) => ({ id: c.id, kind: 'company', title: c.name, path: PATHS.company(c.id) }));
  const life = db.prepare(`SELECT id, kind, title FROM life_items WHERE deleted_at IS NULL AND title LIKE ? ESCAPE '\\' LIMIT 5`)
    .all(`%${words.replace(/[\\%_]/g, '\\$&')}%`).map((i) => ({ id: i.id, kind: i.kind.replace('_', ' '), title: i.title, path: PATHS.life(i.id) }));
  return [...notes, ...entries, ...people, ...companies, ...life];
}

// One page by its id, whatever its kind (null: none).
export function findPage(db, id) {
  const note = getNote(db, id);
  if (note) return { id, kind: 'note', title: note.title || 'Untitled', path: PATHS.note(id), text: note.body };
  const entry = getEntry(db, id);
  if (entry) return { id, kind: 'journal entry', title: entry.title || `Journal, ${entry.day}`, day: entry.day, journal: entry.journal_name, path: PATHS.entry(id), text: entry.body };
  const person = getPerson(db, id);
  if (person) return { id, kind: 'person', title: person.name, path: PATHS.person(id), company: person.company_name, role: person.role, text: person.body };
  const company = getCompany(db, id);
  if (company) return { id, kind: 'company', title: company.name, path: PATHS.company(id), text: company.body };
  const item = getLifeItem(db, id);
  if (item) return { id, kind: item.kind.replace('_', ' '), title: item.title, path: PATHS.life(id), state: item.state, text: item.body };
  return null;
}

// One My Life item as the assistant reads it: the fields that are filled in, its chain,
// what stands under it, its thinking space and its open tasks (those in notes at home here too).
const LIFE_FIELDS = ['description', 'not_this', 'statement', 'horizon', 'shipped_means', 'why', 'outcome', 'done_means',
  'starts_on', 'ends_on', 'pulse', 'depth', 'done_when'];
export function readLifeItem(db, id) {
  const item = getLifeItem(db, id);
  if (!item) return null;
  const fields = Object.fromEntries(LIFE_FIELDS.filter((f) => item[f]).map((f) => [f, item[f]]));
  if (item.kind === 'habit') fields.cadence = `${item.cadence_times} a ${item.cadence_per}`;
  const brief = (i) => ({ id: i.id, kind: kindName(i.kind), title: i.title, state: i.state });
  const tasks = listTasks(db, { home: id }).filter((t) => !t.done);
  return {
    id, kind: kindName(item.kind), title: item.title, state: item.state, path: PATHS.life(id), ...fields,
    chain: lifeChains(db, id).map((chain) => chain.map((s) => `${s.kind} “${s.title}”`).join(' → ')),
    ...(item.home ? { home: brief(item.home) } : {}),
    ...(item.serves.length ? { serves: item.serves.map(brief) } : {}),
    ...(item.under.length ? { under: item.under.map(brief) } : {}),
    thinking_space: item.body || '',
    open_tasks: tasks.slice(0, 50).map((t) => ({ id: t.id, text: t.text, due: t.due || 'no date', flag: t.flag || undefined })),
    open_tasks_count: tasks.length,
  };
}

function tasksFor(db, when = 'all', today = localDay()) {
  const pick = {
    all: (t) => !t.done,
    today: (t) => !t.done && t.due === today,
    overdue: (t) => !t.done && isDay(t.due) && t.due < today,
    upcoming: (t) => !t.done && isDay(t.due) && t.due > today,
    no_date: (t) => !t.done && !isDay(t.due),
  };
  const list = when === 'done' ? listTasks(db, { done: true }).slice(0, 30) : listTasks(db).filter(pick[when] ?? pick.all);
  return list.slice(0, 100).map((t) => ({
    id: t.id, text: t.text, due: t.due || 'no date', done: t.done, flag: t.flag || undefined, estimate: t.estimate ?? undefined,
    in: t.source.kind === 'own' ? 'Tasks' : `${t.source.kind} “${t.source.title}”`,
  }));
}

// ---- Cards: what the assistant did or proposes, under its answer ----

const ACTION_COLUMNS = 'id, conversation_id, message_id, kind, state, target_id, title, before, after, reason, created_at, updated_at';
const action = (row) => ({ ...row, before: JSON.parse(row.before), after: JSON.parse(row.after) });

export const getAction = (db, id) => {
  const row = db.prepare(`SELECT ${ACTION_COLUMNS} FROM assistant_actions WHERE id = ? AND deleted_at IS NULL`).get(id);
  return row ? action(row) : null;
};
// The plans proposed on the Planner, and those applied in the last half hour (to undo).
export const planCards = (db) => db.prepare(`SELECT ${ACTION_COLUMNS} FROM assistant_actions
  WHERE kind = 'plan' AND deleted_at IS NULL AND (state = 'proposed' OR (state = 'applied' AND updated_at > ?))
  ORDER BY created_at, rowid`).all(new Date(Date.now() - 30 * 60_000).toISOString()).map(action);

export const actionsOf = (db, messageId) => db.prepare(`SELECT ${ACTION_COLUMNS} FROM assistant_actions
  WHERE message_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`).all(messageId).map(action);

// ---- The Planner, as the assistant reads it ----

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function eventsOn(db, day) {
  const own = eventsBetween(db, day, day).map(ownEvent(db));
  return [...own, ...calendarEventsBetween(db, day, day)];
}
// How full a day is, counted as the Planner counts it (public/planner.js, dayLoad).
function loadOf({ events, tasks, blocks }, day, settings) {
  const from = `${day}T00:00`;
  const to = `${addDays(day, 1)}T00:00`;
  const span = (at) => (at < from ? 0 : at >= to ? 24 * 60 : minutes(at.slice(11, 16)));
  const meetings = events.filter((e) => !e.all_day).reduce((n, e) => n + Math.max(0, span(e.ends_at) - span(e.starts_at)), 0);
  const taskMinutes = (t) => t.estimate ?? settings.no_estimate_minutes;
  const work = tasks.reduce((n, t) => n + taskMinutes(t), 0);
  const slack = blocks.reduce((n, b) => n + Math.max(0, minutes(b.ends_at) - minutes(b.starts_at)
    - tasks.filter((t) => t.block_id === b.id).reduce((m, t) => m + taskMinutes(t), 0)), 0);
  const planned = meetings + work + slack;
  const budget = settings.work_minutes + settings.buffer_minutes;
  return { planned_minutes: planned, budget_minutes: budget, over_by_minutes: Math.max(0, planned - budget) };
}
const brief = (t) => ({ id: t.id, text: t.text, done: t.done, estimate: t.estimate ?? undefined, part: t.plan_part || undefined, weekly_goal: Boolean(t.goal_week) || undefined });

function readWeek(db, day) {
  const settings = getSettings(db);
  const week = plannerWeek(db, day, { eventsOf: (d) => eventsOn(db, d) });
  return {
    week_of: week.week,
    days: week.days.map((d) => ({
      day: d.day,
      ...loadOf(d, d.day, settings),
      events: d.events.map((e) => ({ title: e.title, from: e.starts_at.slice(11), to: e.ends_at.slice(11) })),
      tasks: d.tasks.map(brief),
      highlight: d.tasks.find((t) => t.id === d.highlight_id)?.text,
      blocks: d.blocks.map((b) => ({ kind: b.kind, from: b.starts_at, to: b.ends_at })),
    })),
    weekly_goals: week.week_goals.map(brief),
    tray: { missed: week.tray.missed.map((t) => ({ ...brief(t), was_due: t.due })), no_day: [...week.tray.no_day, ...week.tray.speedies].map(brief) },
  };
}

function readDay(db, day) {
  const settings = getSettings(db);
  const plan = plannerDay(db, day, { events: eventsOn(db, day) });
  const close = dayClose(db, day);
  return {
    day,
    ...loadOf(plan, day, settings),
    events: plan.events.map((e) => ({ title: e.title, from: e.starts_at.slice(11), to: e.ends_at.slice(11) })),
    tasks: plan.tasks.map(brief),
    highlight: plan.tasks.find((t) => t.id === plan.highlight_id)?.text,
    closed: close?.closed ? { line: close.line, counts: close.counts_line } : undefined,
  };
}

const dayName = (day) => new Date(`${day}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const STATE_WORDS = { done: 'did', proposed: 'asked', applied: 'approved', dismissed: 'not now', undone: 'undone', refused: 'refused' };
const KIND_WORDS = { calendar_propose: 'Propose an event', board_draw: 'Draw on a board', mail_send: 'Send a mail', add_task: 'Add a task', add_note: 'Add a note', append_to_journal: 'Write in the journal', edit_note: 'Change a note', change_task: 'Change a task', step: 'Step', plan: 'Plan', close_day: 'Close the day', log_interaction: 'Log an interaction' };

function addAction(db, run, { kind, state, target_id = '', title, before = {}, after = {}, reason = '' }) {
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO assistant_actions (id, created_at, updated_at, origin, conversation_id, message_id, kind, state, target_id, title, before, after, reason)
    VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, time, time, run.conversationId, run.messageId ?? null, kind, state, target_id, title, JSON.stringify(before), JSON.stringify(after), reason.slice(0, 300));
  const card = getAction(db, id);
  logActivity(db, { kind: STATE_WORDS[state], what: `${KIND_WORDS[kind]}: ${title}`, conversation_id: run.conversationId ?? null });
  run.card?.(card);
  return card;
}

const setState = (db, id, state) => {
  db.prepare('UPDATE assistant_actions SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), id);
  const card = getAction(db, id);
  logActivity(db, { kind: STATE_WORDS[state], what: `${KIND_WORDS[card.kind]}: ${card.title}`, conversation_id: card.conversation_id });
  return card;
};

// Steps waiting for the owner's answer: card id → resolve(allowed).
const waits = new Map();
const WAIT_MS = 10 * 60_000;

// Every step a conversation waits on is answered No (its answer was stopped).
export function cancelWaits(db, conversationId) {
  for (const [id, resolve] of waits) {
    if (getAction(db, id)?.conversation_id === conversationId) { setState(db, id, 'dismissed'); waits.delete(id); resolve(false); }
  }
}

async function approveStep(db, args, run) {
  const tool = String(args.tool_name ?? '');
  const input = args.input && typeof args.input === 'object' ? args.input : {};
  const { what, verdict, always } = judgeStep(tool, input, { folder: run.folder });
  const deny = (message) => JSON.stringify({ behavior: 'deny', message });
  if (verdict === 'never') {
    addAction(db, run, { kind: 'step', state: 'refused', title: what, after: { tool, input } });
    return deny('This is never allowed in this app (sudo, wiping a disk, passwords and the keychain). Tell the owner you may not do it.');
  }
  const kind = always ? null : ruleOf(tool, input, { folder: run.folder }); // what "Always allow" would allow
  if (kind && isAllowed(db, kind.rule)) {
    logActivity(db, { kind: 'did', what: `${what} (always allowed)`, conversation_id: run.conversationId ?? null });
    return JSON.stringify({ behavior: 'allow', updatedInput: input });
  }
  if (!always && modeOf(db, 'outside') === 'alone') {
    logActivity(db, { kind: 'did', what, conversation_id: run.conversationId ?? null });
    return JSON.stringify({ behavior: 'allow', updatedInput: input });
  }
  const card = addAction(db, run, { kind: 'step', state: 'proposed', title: what, after: { tool, input, ...(kind ? { rule: kind.rule, label: kind.label } : {}) }, reason: always ? 'Deleting always asks.' : '' });
  const allowed = await new Promise((resolve) => {
    waits.set(card.id, resolve);
    setTimeout(() => {
      if (!waits.has(card.id)) return;
      waits.delete(card.id);
      setState(db, card.id, 'dismissed');
      resolve(false);
    }, WAIT_MS).unref();
  });
  return allowed ? JSON.stringify({ behavior: 'allow', updatedInput: input }) : deny('The owner said no to this step. Do not try it another way; say what you could not do.');
}

// The tools that only read: all the Inbox reader may use (assistant/3).
export const READ_TOOLS = ['docs_read', 'search_notes', 'read_note', 'my_life', 'read_life_item', 'list_tasks', 'list_inbox', 'read_week', 'read_day', 'reconnect_list'];

// Runs one tool. run: { conversationId, messageId, folder, read(page), card(card), readOnly }
// for the answer under way. Returns text for the assistant (or a promise of it).
export function runTool(db, name, args = {}, run = {}) {
  if (run.readOnly && !READ_TOOLS.includes(name)) throw fail(403, 'Here you may only read.');
  if (name === 'approve_step') return approveStep(db, args, run);
  if (name === 'search_notes') {
    const found = search(db, args.query);
    return found.length ? text(found) : 'Nothing found for those words.';
  }
  if (name === 'read_note') {
    const page = findPage(db, String(args.id ?? ''));
    if (!page) throw fail(404, 'There is no page with that id.');
    run.read?.(page);
    return text(page);
  }
  if (name === 'my_life' || name === 'read_life_item') {
    if (!moduleOn(db, 'life')) throw fail(403, 'My Life is switched off in Settings › Modules.');
    if (name === 'my_life') {
      return lifeSummary(db, { habits: moduleOn(db, 'mylife-plus') }) || 'My Life is empty: no active Key Elements, Goals, Projects or Topics yet.';
    }
    const item = readLifeItem(db, String(args.id ?? ''));
    if (!item) throw fail(404, 'There is no My Life item with that id.');
    run.read?.({ id: item.id, kind: item.kind, title: item.title, path: item.path });
    return text(item);
  }
  if (name === 'docs_read') {
    if (!moduleOn(db, 'help')) throw fail(403, 'Help pages is switched off in Settings › Modules.');
    const found = findDocs(db, { view: args.view ?? '', words: args.words ?? '' });
    if (!found.length) return 'No help page for that. Say so, and do not guess how the app works.';
    return found.map((d) => `# ${d.title} (cite it as [${d.title} help](/help/${d.id}))\n\n${d.markdown}`).join('\n\n---\n\n');
  }
  if (name === 'list_tasks') {
    const tasks = tasksFor(db, args.when);
    return tasks.length ? text(tasks) : 'No tasks there.';
  }
  if (name === 'list_inbox') {
    const waiting = waitingCaptures(db).map((c) => {
      const s = db.prepare("SELECT kind, title, day, why FROM capture_suggestions WHERE capture_id = ? AND state = 'ready'").get(c.id);
      return { id: c.id, words: c.body.slice(0, 500), captured_at: c.captured_at, ...(s ? { suggested: { ...s } } : {}) };
    });
    return waiting.length ? text(waiting) : 'Nothing waits in the Inbox.';
  }
  if (name === 'read_week' || name === 'read_day') {
    const day = args.day && isDay(args.day) ? args.day : localDay();
    return text(name === 'read_week' ? readWeek(db, day) : readDay(db, day));
  }
  if (name === 'propose_plan') {
    const day = String(args.day ?? '');
    if (!isDay(day)) throw fail(400, 'day is YYYY-MM-DD.');
    const reason = String(args.reason ?? '').slice(0, 300);
    if (args.move === 'move' || args.move === 'highlight') {
      const task = getTask(db, String(args.task_id ?? ''));
      if (!task) throw fail(404, 'There is no task with that id.');
      const part = ['morning', 'afternoon'].includes(args.part) ? args.part : '';
      const title = args.move === 'move' ? `Move “${task.text}” to ${dayName(day)}${part ? `, ${part}` : ''}` : `Make “${task.text}” the Highlight of ${dayName(day)}`;
      addAction(db, run, {
        kind: 'plan', state: 'proposed', target_id: task.id, title, reason,
        before: { due: task.due, plan_part: task.plan_part, block_id: task.block_id }, after: { move: args.move, day, part },
      });
    } else if (args.move === 'block') {
      if (!/^\d{2}:\d{2}$/.test(args.starts_at ?? '') || !/^\d{2}:\d{2}$/.test(args.ends_at ?? '') || args.ends_at <= args.starts_at) throw fail(400, 'A block needs starts_at and ends_at (HH:MM), ending after it starts.');
      const kind = BLOCK_KINDS.includes(args.block_kind) ? args.block_kind : 'deep';
      addAction(db, run, {
        kind: 'plan', state: 'proposed', title: `A ${BLOCK_NAMES[kind]} block on ${dayName(day)}, ${args.starts_at}–${args.ends_at}`, reason,
        after: { move: 'block', day, starts_at: args.starts_at, ends_at: args.ends_at, kind, title: String(args.title ?? '').slice(0, 200) },
      });
    } else throw fail(400, 'move is move, highlight or block.');
    return text({ proposed: true, note: 'It shows as a card on the Planner and in this chat; nothing moved until the owner applies it.' });
  }
  if (name === 'propose_close_day') {
    const day = args.day && isDay(args.day) ? args.day : localDay();
    if (day > localDay()) throw fail(400, 'A day is closed once it has come.');
    const line = String(args.line ?? '').trim().slice(0, 300);
    const highlight = ['done', 'not_done', 'moved'].includes(args.highlight) ? args.highlight : '';
    addAction(db, run, { kind: 'close_day', state: 'proposed', target_id: day, title: line || '(no line)', after: { day, line, highlight } });
    return text({ proposed: true, note: 'Not saved yet: the owner approves it on the card. Say so.' });
  }
  if (name === 'add_task') {
    // The words are read as the quick add bar reads them (Tasks in depth); what was said outright wins.
    const said = String(args.text ?? '');
    const read = moduleOn(db, 'tasks-plus') ? parseQuickAdd(said, localDay()) : null;
    const found = read && read.title ? read : null;
    const input = {
      text: found && (found.due || found.estimate || found.time || found.repeat || found.flag) ? found.title : said,
      ...(args.due ? { due: args.due } : found?.due ? { due: found.due } : {}),
      ...(args.estimate ? { estimate: args.estimate } : found?.estimate ? { estimate: found.estimate } : {}),
      ...(args.flag ? { flag: args.flag } : found?.flag ? { flag: found.flag } : {}),
      ...(found?.repeat ? { repeat: found.repeat } : {}),
      ...(found?.time ? { remind_time: found.time } : {}),
    };
    const problem = checkTaskInput(input, { creating: true });
    if (problem) throw fail(400, problem);
    if (modeOf(db, 'add_task') === 'ask') {
      const card = addAction(db, run, { kind: 'add_task', state: 'proposed', title: input.text.trim(), after: input });
      return text({ waiting: card.id, note: 'Not added yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const task = createTask(db, { ...input, origin: 'assistant' });
    const card = addAction(db, run, { kind: 'add_task', state: 'done', target_id: task.id, title: task.text, after: { due: task.due } });
    return text({ added: { id: task.id, text: task.text, due: task.due || 'no date' }, card: card.id });
  }
  if (name === 'reconnect_list') {
    if (!moduleOn(db, 'people-plus')) throw fail(403, 'People in depth is switched off.');
    const list = reconnectList(db).map((p) => ({
      name: p.name, id: p.id, path: PATHS.person(p.id), rhythm: p.cadence_label, last_in_touch: p.last_in_touch ?? 'nothing logged yet',
      status: p.days_left < 0 ? `${-p.days_left} day${p.days_left === -1 ? '' : 's'} overdue` : p.days_left === 0 ? 'due today' : `due in ${p.days_left} day${p.days_left === 1 ? '' : 's'}`,
    }));
    return list.length ? text(list) : 'Nobody has a rhythm yet. The owner sets one on a person’s page.';
  }
  if (name === 'log_interaction') {
    if (!moduleOn(db, 'people-plus')) throw fail(403, 'People in depth is switched off, so there is nothing to log an interaction in.');
    const matches = findPerson(db, args.person);
    if (!matches.length) throw fail(404, `There is nobody like “${String(args.person ?? '').slice(0, 80)}” in People. Say so; do not guess another name.`);
    if (matches.length > 1) throw fail(400, `More than one person fits: ${matches.map((m) => m.name).join(', ')}. Ask the owner which.`);
    const [person] = matches;
    const after = { about: { kind: 'person', id: person.id }, name: person.name, kind: String(args.kind ?? ''), note: String(args.sentence ?? '').trim(), when: String(args.when ?? '') };
    const problem = checkInteractionInput(after);
    if (problem) throw fail(400, problem);
    const title = `${after.kind} with ${person.name}: ${after.note}`.slice(0, 200);
    if (modeOf(db, 'log_interaction') === 'ask') {
      const card = addAction(db, run, { kind: 'log_interaction', state: 'proposed', title, after });
      return text({ waiting: card.id, note: 'Not logged yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const made = logInteraction(db, { ...after, origin: 'assistant' });
    addAction(db, run, { kind: 'log_interaction', state: 'done', target_id: made.id, title, after });
    return text({ logged: { id: made.id, with: person.name, kind: made.kind, at: made.happened_at }, note: 'Logged, as the owner allows; they can undo it on the card.' });
  }
  if (name === 'mail_search') {
    const found = listThreads(db, { q: String(args.query ?? ''), limit: 10 });
    return found.length ? text(found.map((t) => ({ thread_id: t.id, subject: t.subject, people: t.participants, messages: t.message_count, last: t.last_at, account: t.account }))) : 'No conversation matches those words.';
  }
  if (name === 'mail_read') {
    const thread = getThread(db, String(args.thread_id ?? ''));
    if (!thread) throw fail(404, 'No such conversation. Search first for its id.');
    return text({ thread_id: thread.id, subject: thread.subject, messages: thread.messages.map((m) => ({ from: m.from.name || m.from.email, email: m.from.email, to: m.to.map((a) => a.email), at: m.sent_at, text: m.text.slice(0, 6000) })).slice(-12) });
  }
  if (name === 'mail_draft') {
    const draft = checkDraft(db, { threadId: String(args.thread_id ?? ''), to: args.to, text: args.text, attachments: args.attachments });
    const title = `${draft.subject} → ${draft.to.join(', ')}`.slice(0, 200);
    const card = addAction(db, run, { kind: 'mail_send', state: 'proposed', title, after: draft });
    return text({ waiting: card.id, note: `A draft is on a card: Send, Edit, Dismiss. Nothing was sent, and it only goes if the owner presses Send. ${LIMITS.drafts_per_day - draftsToday(db)} drafts are left today.` });
  }
  if (name === 'calendar_list') return text(calendarList(db, { from: args.from, to: args.to }));
  if (name === 'calendar_propose') {
    const plan = planProposal(db, args);
    // Always a card: the "Change a note or a task" switch never lets a meeting through on its own.
    const card = addAction(db, run, { kind: 'calendar_propose', state: 'proposed', target_id: plan.move ? plan.event_id : '', title: plan.title || plan.was?.title || 'An event', before: plan.move ? plan.was : {}, after: plan, reason: String(args.reason ?? '') });
    return text({ waiting: card.id, overlaps: plan.overlaps.map((o) => o.title), note: `${plan.overlaps.length ? `It overlaps ${plan.overlaps.map((o) => `“${o.title}”`).join(', ')}. ` : ''}Nothing was added: it waits for the owner’s approval on a card. Say so.` });
  }
  if (name === 'board_read') {
    if (!args.board_id) { const boards = listBoards(db); return boards.length ? text(boards) : 'There are no boards yet.'; }
    const board = boardText(db, String(args.board_id));
    if (!board) throw fail(404, 'No such board. Call board_read without an id for the list.');
    return board;
  }
  if (name === 'board_draw') {
    const plan = planDrawing(db, String(args.board_id ?? ''), args.items);
    const cards = plan.items.filter((i) => i.kind !== 'arrow').length;
    const arrows = plan.items.length - cards;
    const title = `${plan.board_title}: ${[cards ? `${cards} ${cards === 1 ? 'card' : 'cards'}` : '', arrows ? `${arrows} ${arrows === 1 ? 'arrow' : 'arrows'}` : ''].filter(Boolean).join(' and ')}`;
    if (modeOf(db, 'change') === 'ask') {
      const card = addAction(db, run, { kind: 'board_draw', state: 'proposed', title, after: plan, reason: String(args.reason ?? '') });
      return text({ waiting: card.id, note: 'Not drawn yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const card = addAction(db, run, { kind: 'board_draw', state: 'done', title, after: plan, reason: String(args.reason ?? '') });
    drawPlan(db, plan, card.id);
    return text({ drawn: true, card: card.id, note: 'Drawn, marked as yours; the owner can undo it on the card.' });
  }
  if (name === 'list_comments') {
    const later = laterComments(db);
    return later.length ? text(later) : 'No comments are waiting for you.';
  }
  if (name === 'reply_to_comment') {
    if (!getComment(db, String(args.comment_id ?? ''))) throw fail(404, 'No such comment. List them first for the ids.');
    const reply = replyTo(db, String(args.comment_id), { body: String(args.text ?? ''), author: 'assistant' });
    return text({ replied: true, reply_id: reply.id, note: 'Your answer is in the thread, signed as yours.' });
  }
  if (name === 'mail_to_task') {
    const thread = getThread(db, String(args.thread_id ?? ''));
    if (!thread) throw fail(404, 'No such conversation. Search first for its id.');
    const input = { text: String(args.title ?? '').trim() || thread.subject.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, '').trim() || 'A mail', ...(args.due ? { due: args.due } : {}), mail_thread_id: thread.id };
    const problem = checkTaskInput(input, { creating: true });
    if (problem) throw fail(400, problem);
    if (modeOf(db, 'add_task') === 'ask') {
      const card = addAction(db, run, { kind: 'add_task', state: 'proposed', title: input.text, after: input });
      return text({ waiting: card.id, note: 'Not added yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const task = createTask(db, { ...input, origin: 'assistant' });
    const card = addAction(db, run, { kind: 'add_task', state: 'done', target_id: task.id, title: task.text, after: { due: task.due } });
    return text({ added: { id: task.id, text: task.text, due: task.due || 'no date' }, linked_to: thread.subject, card: card.id });
  }
  if (name === 'add_note') {
    const title = String(args.title ?? '').trim();
    if (!title) throw fail(400, 'A note needs a title.');
    const after = { title: title.slice(0, 200), body: String(args.body ?? '') };
    if (modeOf(db, 'add_note') === 'ask') {
      const card = addAction(db, run, { kind: 'add_note', state: 'proposed', title: after.title, after });
      return text({ waiting: card.id, note: 'Not added yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const note = createNote(db, { ...after, origin: 'assistant' });
    addAction(db, run, { kind: 'add_note', state: 'done', target_id: note.id, title: after.title, after });
    return text({ added: { id: note.id, path: PATHS.note(note.id) } });
  }
  if (name === 'append_to_journal') {
    const body = String(args.text ?? '').trim();
    if (!body) throw fail(400, 'text is needed.');
    if (args.day && !isDay(args.day)) throw fail(400, 'day is YYYY-MM-DD.');
    const after = { day: args.day || localDay(), title: String(args.title ?? '').slice(0, 200), body };
    const title = after.title || body.split('\n')[0].slice(0, 80);
    if (modeOf(db, 'append_to_journal') === 'ask') {
      const card = addAction(db, run, { kind: 'append_to_journal', state: 'proposed', title, after });
      return text({ waiting: card.id, note: 'Not written yet: it waits for the owner’s approval on a card. Say so.' });
    }
    const entry = createEntry(db, { ...after, origin: 'assistant' });
    addAction(db, run, { kind: 'append_to_journal', state: 'done', target_id: entry.id, title, after: { day: entry.day } });
    return text({ written: { id: entry.id, day: entry.day, path: PATHS.entry(entry.id) } });
  }
  if (name === 'propose_note_edit') {
    const note = getNote(db, String(args.id ?? ''));
    if (!note) throw fail(404, 'There is no note with that id.');
    if (args.title === undefined && args.body === undefined) throw fail(400, 'Give a new title or text.');
    const after = { title: args.title ?? note.title, body: args.body ?? note.body };
    const card = addAction(db, run, {
      kind: 'edit_note', state: 'proposed', target_id: note.id, title: note.title || 'Untitled',
      before: { title: note.title, body: note.body }, after, reason: String(args.reason ?? ''),
    });
    if (modeOf(db, 'change') === 'alone') { applyAction(db, card.id); run.card?.(getAction(db, card.id)); return text({ applied: card.id, note: 'Changed, as the owner allows; they can undo it on the card.' }); }
    return text({ proposed: card.id, note: 'It is shown to the owner as a card; nothing changed until they apply it.' });
  }
  if (name === 'propose_task_change') {
    const task = getTask(db, String(args.id ?? ''));
    if (!task) throw fail(404, 'There is no task with that id.');
    const change = { ...(typeof args.done === 'boolean' ? { done: args.done } : {}), ...(args.due !== undefined ? { due: args.due } : {}) };
    const problem = checkTaskInput(change);
    if (problem || !Object.keys(change).length) throw fail(400, problem ?? 'Give done or due.');
    const card = addAction(db, run, {
      kind: 'change_task', state: 'proposed', target_id: task.id, title: task.text,
      before: { done: task.done, due: task.due }, after: change, reason: String(args.reason ?? ''),
    });
    if (modeOf(db, 'change') === 'alone') { applyAction(db, card.id); run.card?.(getAction(db, card.id)); return text({ applied: card.id, note: 'Changed, as the owner allows; they can undo it on the card.' }); }
    return text({ proposed: card.id, note: 'It is shown to the owner as a card; nothing changed until they apply it.' });
  }
  throw fail(404, `There is no tool called ${name}.`);
}

// ---- What you do on a card ----

export function applyAction(db, id, { always = false } = {}) {
  const card = getAction(db, id);
  if (!card) return null;
  if (card.state !== 'proposed') throw fail(409, 'That card was already decided.');
  const made = (targetId) => db.prepare('UPDATE assistant_actions SET target_id = ? WHERE id = ?').run(targetId, id);
  if (card.kind === 'step') {
    const resolve = waits.get(id);
    if (!resolve) throw fail(409, 'That step is no longer waiting.');
    waits.delete(id);
    if (always && card.after?.rule) allowRule(db, { rule: card.after.rule, label: card.after.label });
    const decided = setState(db, id, 'applied');
    resolve(true);
    return decided;
  }
  if (card.kind === 'plan') {
    const { move, day, part } = card.after;
    if (move === 'move') {
      if (!getTask(db, card.target_id)) throw fail(409, 'That task is gone.');
      changeTask(db, card.target_id, { due: day, plan_part: part ?? '', block_id: null });
    } else if (move === 'highlight') {
      const { previous } = setHighlight(db, day, card.target_id);
      db.prepare('UPDATE assistant_actions SET before = ? WHERE id = ?').run(JSON.stringify({ ...card.before, highlight: previous }), id);
    } else {
      made(createBlock(db, { day, starts_at: card.after.starts_at, ends_at: card.after.ends_at, kind: card.after.kind, title: card.after.title }).id);
    }
    return setState(db, id, 'applied');
  }
  if (card.kind === 'close_day') {
    const { day, line, highlight } = card.after;
    const before = dayClose(db, day);
    closeDay(db, day, { line, highlight });
    db.prepare('UPDATE assistant_actions SET before = ? WHERE id = ?').run(JSON.stringify({ was_closed: Boolean(before?.closed) }), id);
    return setState(db, id, 'applied');
  }
  if (card.kind === 'mail_send') {
    // Send: the same outbox as a mail you wrote: ten seconds to take it back, then it goes (only if “Send mail as you” is on).
    const row = composeSend(db, { accountId: card.after.account_id, threadId: card.after.thread_id, to: card.after.to, subject: card.after.subject, body: card.after.body, when: 'now' });
    made(row.id);
    return setState(db, id, 'applied');
  }
  if (card.kind === 'add_task') made(createTask(db, { ...card.after, origin: 'assistant' }).id);
  else if (card.kind === 'add_note') made(createNote(db, { ...card.after, origin: 'assistant' }).id);
  else if (card.kind === 'board_draw') { drawPlan(db, card.after, card.id); made(card.id); }
  else if (card.kind === 'calendar_propose') made(applyProposal(db, card.after));
  else if (card.kind === 'append_to_journal') made(createEntry(db, { ...card.after, origin: 'assistant' }).id);
  else if (card.kind === 'log_interaction') made(logInteraction(db, { ...card.after, origin: 'assistant' }).id);
  else if (card.kind === 'edit_note') {
    const note = getNote(db, card.target_id);
    if (!note) throw fail(409, 'That note is gone.');
    if (note.title !== card.before.title || note.body !== card.before.body) {
      // The note moved on while this waited: with Writing and thinking on, the two changes are merged line by line, and a line both changed stays yours.
      if (!moduleOn(db, 'writing') || note.title !== card.before.title) throw fail(409, 'The note changed since this was proposed. Ask again.');
      saveWithMerge(db, note.id, { title: card.after.title, body: card.after.body, author: 'assistant', winner: 'current', baseText: card.before.body });
    } else updateNote(db, note.id, { title: card.after.title, body: card.after.body, author: 'assistant' });
  } else if (card.kind === 'change_task') {
    if (!getTask(db, card.target_id)) throw fail(409, 'That task is gone.');
    changeTask(db, card.target_id, card.after);
  }
  return setState(db, id, 'applied');
}

// A draft that was opened with Edit and sent from the composer: its card is answered.
export function markCardEdited(db, cardId, sendId) {
  const card = getAction(db, cardId);
  if (!card || card.kind !== 'mail_send' || card.state !== 'proposed') return null;
  db.prepare('UPDATE assistant_actions SET target_id = ? WHERE id = ?').run(sendId, cardId);
  return setState(db, cardId, 'applied');
}

export function dismissAction(db, id) {
  const card = getAction(db, id);
  if (!card) return null;
  if (card.state !== 'proposed') throw fail(409, 'That card was already decided.');
  const resolve = waits.get(id);
  waits.delete(id);
  const decided = setState(db, id, 'dismissed');
  resolve?.(false);
  return decided;
}

// Takes back what a card did: a task or entry it made goes (soft, as every delete); an
// applied change is put back as it was.
export function undoAction(db, id) {
  const card = getAction(db, id);
  if (!card) return null;
  if (!['done', 'applied'].includes(card.state) || card.kind === 'step') throw fail(409, 'There is nothing to undo on that card.');
  if (card.kind === 'mail_send') undoSend(db, card.target_id); // only while it has not gone
  else if (card.kind === 'board_draw') undoChange(db, card.id);
  else if (card.kind === 'calendar_propose') undoProposal(db, card.after, card.target_id);
  else if (card.kind === 'add_task') deleteTask(db, card.target_id);
  else if (card.kind === 'add_note') deleteNote(db, card.target_id);
  else if (card.kind === 'plan') {
    const { move, day } = card.after;
    if (move === 'move') changeTask(db, card.target_id, { due: card.before.due, plan_part: card.before.plan_part ?? '', block_id: card.before.block_id ?? null });
    else if (move === 'highlight') setHighlight(db, day, card.before.highlight ?? null);
    else deleteBlock(db, card.target_id);
  } else if (card.kind === 'close_day') {
    if (!card.before.was_closed) reopenDay(db, card.after.day);
  }
  else if (card.kind === 'append_to_journal') deleteEntry(db, card.target_id);
  else if (card.kind === 'log_interaction') deleteInteraction(db, card.target_id);
  else if (card.kind === 'edit_note') {
    const note = getNote(db, card.target_id);
    if (!note) throw fail(409, 'That note is gone.');
    if (note.title !== card.after.title || note.body !== card.after.body) throw fail(409, 'The note changed since. Undo it there.');
    updateNote(db, note.id, { title: card.before.title, body: card.before.body });
  } else if (card.kind === 'change_task') {
    changeTask(db, card.target_id, Object.fromEntries(Object.keys(card.after).map((key) => [key, card.before[key]])));
  }
  return setState(db, id, 'undone');
}

