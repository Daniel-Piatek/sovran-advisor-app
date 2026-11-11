-- The app's database: every table, in this one file.
--
-- One table per kind of thing kept (notes, journal entries, files, captures, links,
-- people and companies, My Life items, tasks and reminders, events), and every one starts with the same
-- base columns:
--   id          a UUID, so notes made on two devices never clash, and a link is an id
--               that never changes
--   created_at  when it was made (ISO time, UTC)
--   updated_at  when it last changed: sync later sends only what changed
--   deleted_at  set when it is deleted; nothing is ever really removed or cleared
--   origin      where it came from: typed, captured, imported, or written by the assistant
--
-- db.js runs this file on every start (everything here is "IF NOT EXISTS"), and moves an
-- older database to this shape first. Change a table here, then add a step in db.js.

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  capture_id TEXT, -- the capture it was made from, if any (captures)
  home_id TEXT REFERENCES life_items (id), -- its one home in My Life, if it has one (pkm/4)
  source_key TEXT,  -- where an imported note came from (Writing 9), e.g. obsidian:Workshop/Venues.md: a second import finds it by this and adds nothing
  imported_at TEXT  -- when it was imported; a note changed after this is the owner's own words and an import leaves it alone
);

CREATE INDEX IF NOT EXISTS notes_by_updated ON notes (updated_at);
CREATE INDEX IF NOT EXISTS notes_by_deleted ON notes (deleted_at);

-- Search: the database's own full-text index over every note's title and text.
-- Kept up to date by the triggers below; deleted notes stay in it and are left out
-- when searching, so a restored note is found again at once.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_search USING fts5(
  id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS notes_search_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_search (id, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_update AFTER UPDATE OF title, body ON notes BEGIN
  DELETE FROM notes_search WHERE id = old.id;
  INSERT INTO notes_search (id, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_search_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_search WHERE id = old.id;
END;

-- Journals: General is always there and cannot be deleted (db.js makes it); the owner
-- adds their own, such as Health or Dreams. Deleting a journal moves its entries to
-- General.
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  name TEXT NOT NULL,
  is_general INTEGER NOT NULL DEFAULT 0 CHECK (is_general IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS journals_one_general ON journals (is_general) WHERE is_general = 1;

-- Journal entries: one row each, on the day it belongs to. A day's page shows its
-- entries; each entry can also be opened on its own page.
--   day         the day it belongs to, as YYYY-MM-DD in the owner's own time zone
--   written_at  when it was written (ISO time, UTC), shown as the owner's local time
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  journal_id TEXT NOT NULL REFERENCES journals (id),
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  written_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  capture_id TEXT, -- the capture it was made from, if any (captures)
  source_key TEXT  -- where an imported entry came from (Writing 9), e.g. dayone:<uuid>
);

CREATE INDEX IF NOT EXISTS journal_entries_by_day ON journal_entries (day, written_at);
CREATE INDEX IF NOT EXISTS journal_entries_by_journal ON journal_entries (journal_id);
CREATE INDEX IF NOT EXISTS journal_entries_by_deleted ON journal_entries (deleted_at);

-- Search over entries, kept up to date the same way as notes_search.
CREATE VIRTUAL TABLE IF NOT EXISTS entries_search USING fts5(
  id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS entries_search_insert AFTER INSERT ON journal_entries BEGIN
  INSERT INTO entries_search (id, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS entries_search_update AFTER UPDATE OF title, body ON journal_entries BEGIN
  DELETE FROM entries_search WHERE id = old.id;
  INSERT INTO entries_search (id, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS entries_search_delete AFTER DELETE ON journal_entries BEGIN
  DELETE FROM entries_search WHERE id = old.id;
END;

-- Files: pictures, PDFs and anything else pasted or dropped into a note or an entry.
-- The file itself is kept once, in the files folder next to the database, named by
-- its fingerprint (sha256, the SHA-256 of its content). The same content added twice is
-- stored once and has one row. A note or entry points to it as /files/<sha256>.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0)
);

-- Captures: thoughts kept in seconds with quick capture, waiting in the Inbox until they
-- are sorted. A capture asks nothing: just its text and when it was captured.
--   state       waiting (in the Inbox), sorted (made into something), or done
--   sorted_into what it was made into: journal (an entry), note, or task
--   sorted_id   that entry's or note's id; it in turn keeps capture_id
--   sorted_note_body  when a capture was added to an existing note: the note's text
--               before, so that Undo can put it back
--   home_id     the home in My Life chosen for it in the Inbox (filled from your assistant's
--               suggestion once it is read, changeable); used when it becomes a task or a note
-- Letting a capture go only sets deleted_at, like any delete.
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  body TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'sorted', 'done')),
  sorted_at TEXT,
  sorted_into TEXT CHECK (sorted_into IN ('journal', 'note', 'task')),
  sorted_id TEXT,
  sorted_note_body TEXT,
  home_id TEXT REFERENCES life_items (id),
  snoozed_until TEXT,                 -- a later time (ISO, UTC) it comes back to the Inbox, after Snooze
  world TEXT NOT NULL DEFAULT 'inner' CHECK (world IN ('inner', 'outer')),  -- your own thought, or something someone else made
  link_url TEXT,                      -- the first web address in the words, once read
  link_title TEXT,                    -- and its page's title, when it could be read
  device_id TEXT                      -- the device that shared it from outside (Capture from anywhere), if any
);

CREATE INDEX IF NOT EXISTS captures_waiting ON captures (state, deleted_at, captured_at);

-- Links: one row for every link in a page's text to another page (a note, a journal
-- entry, a journal day, a person, a company or a My Life item). They are kept in step with the text: every time a
-- text is saved, its rows are made again from it (the text is where a link is written;
-- these rows are how both sides find it, like the search index). A link points at the
-- page's id, so it keeps working when the page is renamed.
--   from_kind / from_id   the page the link is written in: note, entry, person, company (an own event too, Calendar 5: the people a sentence named)
--                         or life (a My Life item)
--   to_kind / to_id       the page it points at: note, entry, day (to_id YYYY-MM-DD),
--                         person or company (a mention), life, or event (a note about
--                         an event: your own, or one of another calendar's, event_refs)
--   link_text             the words of the link when it was saved
--   context               the sentence around the link, for "Linked from"
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  from_kind TEXT NOT NULL CHECK (from_kind IN ('note', 'entry', 'person', 'company', 'life', 'task', 'interaction', 'event')),
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL CHECK (to_kind IN ('note', 'entry', 'day', 'person', 'company', 'life', 'event')),
  to_id TEXT NOT NULL,
  link_text TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  target_block_id TEXT          -- a link to one bullet of a note (Writing 2): to_kind note, to_id the note it lives in, this the bullet
);

CREATE INDEX IF NOT EXISTS links_to ON links (to_kind, to_id);
CREATE INDEX IF NOT EXISTS links_to_block ON links (target_block_id) WHERE target_block_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS links_from ON links (from_kind, from_id);

-- People and companies (pkm/2): an address book with your notes. A person may belong to
-- a company. A note or entry that mentions them links to them (links, to_kind person or
-- company), and their page lists it. Emails and phones are one per line.
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  name TEXT NOT NULL,
  company_id TEXT REFERENCES companies (id),
  role TEXT NOT NULL DEFAULT '',
  emails TEXT NOT NULL DEFAULT '',
  phones TEXT NOT NULL DEFAULT '',
  how_met TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cadence_days INTEGER CHECK (cadence_days IS NULL OR cadence_days IN (7, 14, 21, 30, 90)), -- how often to be in touch (People in depth, reconnect.js)
  source_key TEXT, -- where an imported person came from: vcard:<uid, email or name> or csv:<email or name> (import-contacts.js)
  merged_into TEXT REFERENCES people (id), -- a person merged into another (merge-people.js): deleted, and what moved is in merge_record
  merge_record TEXT -- JSON: what a merge moved, so Restore can put it back
);

CREATE INDEX IF NOT EXISTS people_by_company ON people (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS people_by_source ON people (source_key) WHERE source_key IS NOT NULL;

-- My Life (pkm/3): what your life is made of, as rows of one table. Each has a kind:
--   key_element  a part of your life you permanently maintain (work, health, family);
--                not_this says what it is not
--   goal         gives direction: statement (one sentence), horizon (quarter, year,
--                three_years or someday), shipped_means, why
--   project      something to finish: outcome, done_means, starts_on and ends_on
--                (YYYY-MM-DD, or empty)
--   topic        something you explore: pulse (where it stands now), depth (deep or
--                secondary)
-- Every item except a Key Element has a home Key Element (home_id). state is active or
-- archived. body is the thinking space: free text with links, like a note.
CREATE TABLE IF NOT EXISTS life_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('key_element', 'goal', 'project', 'topic')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', -- one line about it, shown on its card
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  home_id TEXT REFERENCES life_items (id),
  not_this TEXT NOT NULL DEFAULT '',
  statement TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL DEFAULT '' CHECK (horizon IN ('', 'quarter', 'year', 'three_years', 'someday')),
  shipped_means TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  done_means TEXT NOT NULL DEFAULT '',
  starts_on TEXT NOT NULL DEFAULT '' CHECK (starts_on = '' OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on TEXT NOT NULL DEFAULT '' CHECK (ends_on = '' OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pulse TEXT NOT NULL DEFAULT '',
  depth TEXT NOT NULL DEFAULT 'secondary' CHECK (depth IN ('deep', 'secondary')),
  body TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS life_items_by_home ON life_items (home_id);

-- Which Goals a Project serves (later a Habit too). Taking a Goal off only sets
-- deleted_at; adding it again brings the same row back.
CREATE TABLE IF NOT EXISTS life_serves (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  item_id TEXT NOT NULL REFERENCES life_items (id),
  goal_id TEXT NOT NULL REFERENCES life_items (id),
  UNIQUE (item_id, goal_id)
);

CREATE INDEX IF NOT EXISTS life_serves_by_goal ON life_serves (goal_id);

-- Tasks (tasks/1, tasks/2). A task is either a line in a page's text (- [ ] words,
-- done: - [x] words), kept in step with the text on every save like links, or a task of
-- its own, added in the Tasks app (source_kind 'own'). See tasks.js.
--   source_kind / source_id  the page it is written in: note, entry, person or company;
--                or own (source_id '')
--   position     which task line of that page it is (0 the first)
--   line         the line of the text it is on
--   text         its words, without the date and estimate
--   due          YYYY-MM-DD: the @date in the line, or a journal entry's day; 'someday';
--                '' none
--   done_at      when it was ticked
--   flag         must (it has to happen today), like (it would be nice), or '': never a
--                priority
--   estimate     minutes it should take (~10m), or NULL; under 15 is a Speedy
--   repeat       a task of its own: every day, every weekday, every 2 weeks, every monday…
--   mail_thread_id  the Mail conversation this task was made from (Mail 11), so the task links back to it; NULL otherwise
--   repeat_from  on the next one of a repeating task: the task whose finishing made it (Tasks in depth 3), so
--                unticking that one takes this one away again while it is still open; NULL otherwise
--   home_id      its own home in My Life; without one, a task in a note is at home where
--                its note is
--   capture_id   the capture it was made from in the Inbox (tasks/3), if any
--   plan_part    where in its day the Planner put it (time/2): morning, afternoon, or ''
--   block_id     the time block it was put in, if any (a block of its day)
--   goal_week    a Weekly Goal (time/3): the Monday of the week it is a goal for; '' not one
--   due_moves    how often its day was pushed later (time/4: Weekly Goals that kept moving)
--   pin_at, pin_minutes  a time block (Calendar in depth): a task pinned to a time and a length of its own, HH:MM and minutes; '' and NULL when it is not pinned
--   plan_at      its time in its day, HH:MM, once placed in the Planner's hours ('' none yet)
--   details      the task's own free words, apart from its title (text); shown in its pop-up only
--   short_text   a few words for a long task, written by the assistant (short-titles.js); '' none
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('note', 'entry', 'person', 'company', 'own')),
  source_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  line INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  due TEXT NOT NULL DEFAULT '' CHECK (due IN ('', 'someday') OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at TEXT,
  flag TEXT NOT NULL DEFAULT '' CHECK (flag IN ('', 'must', 'like')),
  estimate INTEGER CHECK (estimate IS NULL OR estimate > 0),
  repeat TEXT NOT NULL DEFAULT '',
  repeat_from TEXT,
  mail_thread_id TEXT,
  home_id TEXT REFERENCES life_items (id),
  capture_id TEXT,
  plan_part TEXT NOT NULL DEFAULT '' CHECK (plan_part IN ('', 'morning', 'afternoon')),
  block_id TEXT,
  due_moves INTEGER NOT NULL DEFAULT 0,
  short_text TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  plan_at TEXT NOT NULL DEFAULT '' CHECK (plan_at = '' OR plan_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  goal_week TEXT NOT NULL DEFAULT '' CHECK (goal_week = '' OR goal_week GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pin_at TEXT NOT NULL DEFAULT '' CHECK (pin_at = '' OR pin_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  pin_minutes INTEGER CHECK (pin_minutes IS NULL OR pin_minutes > 0),
  template_id TEXT                       -- the routine (event_templates) this task was made from: drawn dotted (Calendar in depth)
);

CREATE INDEX IF NOT EXISTS tasks_by_source ON tasks (source_kind, source_id);

-- Reminders (tasks/2): an alarm at a time that sits on a task, never a task of its own.
--   at             when, as YYYY-MM-DDTHH:MM in the owner's own time zone
--   state          waiting, or done (shown and dealt with, or its task was finished)
--   snoozed_until  a later time it shows again, after Snooze
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  at TEXT NOT NULL CHECK (at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'done')),
  snoozed_until TEXT
);

CREATE INDEX IF NOT EXISTS reminders_waiting ON reminders (state, at);

-- Events (time/1): what is fixed in a day: a call, a lunch, the dentist. Never a task.
--   starts_at / ends_at  YYYY-MM-DDTHH:MM in the owner's own time zone
--   note                 a few words about it
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL CHECK (starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
  ends_at TEXT NOT NULL CHECK (ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
  note TEXT NOT NULL DEFAULT '',
  uid TEXT,                     -- an event that came from an invitation (Mail 12) keeps the meeting's own key, so answering twice never makes two
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS events_by_uid ON events (uid) WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_by_start ON events (starts_at);

-- Your other calendars (time/1), by their iCal link: read every ten minutes, shown
-- read-only, never written to. See calendars.js.
--   url         the private link (a key to the calendar: never printed or logged)
--   colour      1 to 6: which of the calendar colours (--cal-1 … --cal-6) it shows in
--   body        what the link gave the last time it was read, so it shows offline
--   fetched_at  when that was; problem: why the last reading failed, if it did
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  colour INTEGER NOT NULL DEFAULT 1 CHECK (colour BETWEEN 1 AND 6),
  body TEXT,
  fetched_at TEXT,
  problem TEXT NOT NULL DEFAULT ''
);

-- Another calendar's event that a note is about (time/1): the calendar's events are read
-- again every ten minutes and have no row of their own, so a note's link points here.
--   calendar_id, uid, starts_at   which occurrence: the calendar, its id there, its start
--   title                         its name when the note was made
CREATE TABLE IF NOT EXISTS event_refs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  calendar_id TEXT NOT NULL REFERENCES calendars (id),
  uid TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE (calendar_id, uid, starts_at)
);

-- Time blocks (time/2): containers of time on a day in the Planner, with a kind, that
-- hold tasks. Never on the Calendar. Times are HH:MM in the owner's own time zone.
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  starts_at TEXT NOT NULL CHECK (starts_at GLOB '[0-9][0-9]:[0-9][0-9]'),
  ends_at TEXT NOT NULL CHECK (ends_at GLOB '[0-9][0-9]:[0-9][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('deep', 'shallow', 'routine', 'batch', 'buffer')),
  title TEXT NOT NULL DEFAULT '',
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS blocks_by_day ON blocks (day);

-- Settings (time/2): one row per setting, its value as JSON. The Planner's budget, its
-- day, and what happens to missed tasks (planner.js says each one's default).
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
);

-- The Highlight of the Day (time/3): exactly one task per day, at the top of that day in
-- the Planner. Choosing another replaces it (task_id NULL: none).
CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  day TEXT NOT NULL UNIQUE CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  task_id TEXT REFERENCES tasks (id)
);

-- Weekly and Daily Planning (time/3): how far a flow got, so it resumes where you left it.
--   kind      weekly (period: the week's Monday) or daily (period: the day)
--   steps     JSON: { "<step>": "done" | "skipped" }
CREATE TABLE IF NOT EXISTS planning (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'daily')),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  steps TEXT NOT NULL DEFAULT '{}',
  UNIQUE (kind, period)
);

-- Closing the day (time/4, reviews.js): one row a day. closed_at NULL: reopened (the line
-- and the counts stay until it is closed again).
--   line         the day in one line; also an entry in the General journal (entry_id)
--   highlight    '', done, not_done or moved: what became of the day's Highlight
--   planned, done, moved, missed   the counts when it was closed (moved: off the day)
CREATE TABLE IF NOT EXISTS day_closes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  day TEXT NOT NULL UNIQUE CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  closed_at TEXT,
  line TEXT NOT NULL DEFAULT '',
  highlight TEXT NOT NULL DEFAULT '' CHECK (highlight IN ('', 'done', 'not_done', 'moved')),
  highlight_task_id TEXT REFERENCES tasks (id),
  planned INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  moved INTEGER NOT NULL DEFAULT 0,
  missed INTEGER NOT NULL DEFAULT 0,
  entry_id TEXT REFERENCES journal_entries (id)
);

-- Reviews (time/4, reviews.js): a week (period: its Monday) or a quarter (its first day).
-- Closing one keeps its look back as it was (snapshot, JSON), so it never changes
-- afterwards. closed_at NULL: open (or reopened; then the look back is live again).
--   wins       the week's wins in one line (a quarter: its own line)
--   marks      a quarter's Goals, JSON: { "<goal id>": "reached" | "let_go" | "in_play" }
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('week', 'quarter')),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  closed_at TEXT,
  wins TEXT NOT NULL DEFAULT '',
  snapshot TEXT,
  marks TEXT NOT NULL DEFAULT '{}',
  UNIQUE (kind, period)
);

-- The assistant (assistant/1, assistant.js): a conversation with Claude Code, in its own
-- folder in the data folder.
--   folder       assistant/<id>, relative to the data folder
--   session_id   the Claude conversation it continues on every turn; started once it began
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  title TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started INTEGER NOT NULL DEFAULT 0
);

-- One message of a conversation: yours (user) or the assistant's, with the steps it took
-- (JSON: the tools it used and the files it made), the pages it used (sources, JSON: the
-- citations under it), the page a question was asked on (context, JSON) and how the
-- answer ended.
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'done' CHECK (state IN ('done', 'answering', 'stopped', 'failed')),
  sources TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '',
  ai TEXT NOT NULL DEFAULT '',     -- which AI gave an answer: claude or codex (ChatGPT); '' before it was kept
  model TEXT NOT NULL DEFAULT ''   -- the model it named, e.g. claude-opus-5-5 or gpt-6.1-sol
);

CREATE INDEX IF NOT EXISTS chat_messages_by_conversation ON chat_messages (conversation_id, created_at);

-- What the assistant did or asks for, shown as a card under its answer (assistant/2 and 4,
-- assistant-tools.js). kind: add_task, add_note, append_to_journal, edit_note, change_task,
-- step (one of Claude Code's own steps outside its folder), plan (a move it proposes on
-- the Planner: a task to another day, a Highlight, a time block) or close_day (the day's
-- line it suggests). Whether it is done at once or waits for you is the permission's
-- (permissions.js); a plan and closing the day always wait for you.
--   state     done, proposed (waits for you), applied, dismissed, undone, or refused (the floor)
--   before / after   JSON: what it was and what it becomes, so Undo can put it back
CREATE TABLE IF NOT EXISTS assistant_actions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'assistant' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  message_id TEXT REFERENCES chat_messages (id),
  kind TEXT NOT NULL CHECK (kind IN ('add_task', 'add_note', 'append_to_journal', 'edit_note', 'change_task', 'step', 'plan', 'close_day', 'log_interaction', 'mail_send', 'board_draw', 'calendar_propose')),
  state TEXT NOT NULL CHECK (state IN ('done', 'proposed', 'applied', 'dismissed', 'undone', 'refused')),
  target_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  before TEXT NOT NULL DEFAULT '{}',
  after TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS assistant_actions_by_message ON assistant_actions (message_id);

-- Where a capture could go, as your assistant suggests it (assistant/3, suggestions.js).
-- One row a capture; nothing moves until you accept it.
--   state     reading, ready or failed (tries: how often it was tried)
--   kind      task, note, journal or let_go; day (a task's), home_id (a My Life item)
--   connects  JSON: the pages it connects to; why: one line
CREATE TABLE IF NOT EXISTS capture_suggestions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'assistant' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  capture_id TEXT NOT NULL UNIQUE REFERENCES captures (id),
  state TEXT NOT NULL CHECK (state IN ('reading', 'ready', 'failed')),
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '' CHECK (kind IN ('', 'task', 'note', 'journal', 'let_go')),
  day TEXT NOT NULL DEFAULT '',
  home_id TEXT REFERENCES life_items (id),
  connects TEXT NOT NULL DEFAULT '[]',
  why TEXT NOT NULL DEFAULT '',
  tries INTEGER NOT NULL DEFAULT 0,
  read_at TEXT
);

-- The assistant's activity log (assistant/4, permissions.js): every switch you change, and
-- every step it took, asked for or was refused.
CREATE TABLE IF NOT EXISTS assistant_activity (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'assistant' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL,
  what TEXT NOT NULL,
  conversation_id TEXT
);

-- Interactions (People in depth, advanced/people/4, interactions.js): what happened with
-- someone outside the app, in a line: a call, a meeting, a coffee, a message, or other.
--   happened_at  when, as YYYY-MM-DDTHH:MM in the owner's own time zone
--   note         the one sentence
-- Who it was with is not a column: it is a link row (links, from_kind 'interaction', to a
-- person or a company), so a page's Timeline finds it like everything else that links.
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('call', 'meeting', 'coffee', 'message', 'other')),
  happened_at TEXT NOT NULL CHECK (happened_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS interactions_by_time ON interactions (happened_at);

-- Dictations (the Voice module, advanced/voice/1, dictation.js): every dictation kept as text.
--   went_to  where the words went (the field and the page), or empty
--   outcome  inserted (at the cursor of a field) or clipboard (no field had the focus: copied only)
--   fixed    how many words the glossary fixed (advanced/voice/2)
CREATE TABLE IF NOT EXISTS dictations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  text TEXT NOT NULL,
  went_to TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('inserted', 'clipboard')),
  fixed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS dictations_by_time ON dictations (created_at);

-- The glossary (the Voice module, advanced/voice/2, glossary.js): your names and terms for the speech to text.
--   term       how it is written
--   heard_as   what the engine keeps hearing instead (empty for a hint)
--   kind       hint (a word to expect) or fix (heard_as is written as term)
--   source     person or company (seeded from People, source_id), typed (you added it) or learned (from a correction)
CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  term TEXT NOT NULL,
  heard_as TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('hint', 'fix')),
  source TEXT NOT NULL CHECK (source IN ('person', 'company', 'typed', 'learned')),
  source_id TEXT,
  CHECK ((kind = 'fix') = (heard_as <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS glossary_by_words ON glossary (lower(term), lower(heard_as)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS glossary_by_source ON glossary (source, source_id);

-- Google (the Mail module, advanced/mail/1, google.js): one sign-in per Google account, made with the owner's own
-- Google Cloud client. The tokens that prove it are NEVER in this file: they sit in the system's key store.
--   granted   permissions Google has given (JSON list of mail.read, mail.send)
--   enabled   permissions switched on here (JSON list); a switch asks Google only the first time
--   health    unchecked, ok, needs_signin (Google no longer lets the app in) or unreachable
CREATE TABLE IF NOT EXISTS google_accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  email TEXT NOT NULL,
  granted TEXT NOT NULL DEFAULT '[]',
  enabled TEXT NOT NULL DEFAULT '[]',
  health TEXT NOT NULL DEFAULT 'unchecked' CHECK (health IN ('unchecked', 'ok', 'needs_signin', 'unreachable')),
  health_checked_at TEXT,
  calendar_read_at TEXT,                 -- when Google Calendar was last read for this account (Calendar in depth 7)
  calendar_problem TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS google_accounts_by_email ON google_accounts (lower(email)) WHERE deleted_at IS NULL;

-- Every use of a Google account, one line each (signed in, switched, checked, used by a part of the app, disconnected).
CREATE TABLE IF NOT EXISTS google_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT,
  what TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS google_log_by_time ON google_log (created_at);

-- Mail (the Mail module, advanced/mail/2, mail.js): every message you ever got, on this computer. Kept apart from notes
-- (what you think) and joined to them on purpose. Imported rows have origin imported and are never edited.
--   mail_accounts   one per address (google_account_id: the Google sign-in it reads through, if there is one)
--   mail_threads    a conversation; source_key is Gmail's thread id (g:<hex>) or, without one, the first message's id (t:...)
--   mail_messages   one message; source_key is Gmail's message id (g:<hex>), else its Message-ID (m:...), else a hash (h:...),
--                   so reading the same file twice adds nothing; to_addrs, cc_addrs, labels and attachments are JSON lists
--   mail_labels     the labels an account has (system, category or user)
--   mail_imports    every file read in: how many messages it held, how many were new
CREATE TABLE IF NOT EXISTS mail_accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  email TEXT NOT NULL,
  google_account_id TEXT,
  live INTEGER NOT NULL DEFAULT 0 CHECK (live IN (0, 1)),  -- Live with Gmail (Mail 4): the sync job runs for this account only when switched on
  history_id TEXT,                                          -- Gmail's history id: where the last sync stopped
  synced_at TEXT,                                           -- when a sync last worked
  sync_error TEXT NOT NULL DEFAULT ''                       -- why the last one did not, in words
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_accounts_by_email ON mail_accounts (lower(email));

CREATE TABLE IF NOT EXISTS mail_threads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  source_key TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  first_at TEXT,
  last_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_threads_by_key ON mail_threads (account_id, source_key);
CREATE INDEX IF NOT EXISTS mail_threads_by_last ON mail_threads (account_id, last_at);

CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  thread_id TEXT NOT NULL REFERENCES mail_threads (id),
  source_key TEXT NOT NULL,
  gmail_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  sent_at TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  body_text TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  attachment_files TEXT NOT NULL DEFAULT '[]',  -- JSON list of { name, sha256, type, size }: each attachment kept once in files (Mail 3)
  body_html TEXT NOT NULL DEFAULT '',           -- the mail's own html, shown only in a sealed frame (Mail 7); '' when it had none
  bulk INTEGER NOT NULL DEFAULT 0,              -- sent to many (a list, a bulk sender): what the splits of the Mail app read (Mail 5)
  list_unsubscribe INTEGER NOT NULL DEFAULT 0,  -- carries an unsubscribe link
  has_invite INTEGER NOT NULL DEFAULT 0,        -- carries a calendar invitation
  invite_ics TEXT NOT NULL DEFAULT '',          -- the invitation's own calendar file (Mail 12), as the mail carried it (at most 50 000 characters)
  size INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_by_key ON mail_messages (account_id, source_key);
CREATE INDEX IF NOT EXISTS mail_messages_by_thread ON mail_messages (thread_id, sent_at);
CREATE INDEX IF NOT EXISTS mail_messages_by_message_id ON mail_messages (account_id, message_id);
CREATE INDEX IF NOT EXISTS mail_messages_by_gmail_id ON mail_messages (account_id, gmail_id);

CREATE TABLE IF NOT EXISTS mail_labels (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'category', 'user'))
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_labels_by_name ON mail_labels (account_id, lower(name));

CREATE TABLE IF NOT EXISTS mail_imports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  filename TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'interrupted', 'failed')),
  messages_read INTEGER NOT NULL DEFAULT 0,
  messages_added INTEGER NOT NULL DEFAULT 0,
  messages_already INTEGER NOT NULL DEFAULT 0,
  messages_skipped INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  problem TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS mail_imports_by_time ON mail_imports (created_at);

-- Capture from anywhere (Tasks in depth 6, capture-devices.js): a device that may post a capture to POST /capture, with
-- a token of its own. The token is NEVER here: it lives in the system's key store, one per device; this row only says
-- the device is known, what it is called, and when it was last used. Revoking marks it deleted and forgets the token.
--   kind   browser (a bookmarklet), phone (its share sheet) or other
CREATE TABLE IF NOT EXISTS capture_devices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('browser', 'phone', 'other')),
  last_used_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0
);

-- The outbox (Mail 4, mail-sync.js): a change you make to a mail here (archive, star, a label) is first a row here, and only
-- then goes to Gmail, so nothing is lost when the network is gone or the permission is off.
--   add_labels / remove_labels   JSON lists of label names, as this app names them (Inbox, Starred…)
--   kind    update (a change of an event) · insert (a new event: payload says which calendar, the guests, the Meet link, and carries the app's own key so a retry never makes a second copy) · answer (your Yes, Maybe or No) · move_all (a whole repeating series moved)
--   state   waiting (not sent yet), sent, skipped (Gmail changed the same label later: Gmail's change won) or failed
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  message_id TEXT NOT NULL REFERENCES mail_messages (id),
  gmail_id TEXT NOT NULL,
  add_labels TEXT NOT NULL DEFAULT '[]',
  remove_labels TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'sent', 'skipped', 'failed')),
  tries INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  problem TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS mail_outbox_by_state ON mail_outbox (account_id, state, created_at);

-- What you chose per sender (Mail 7): whether the images of a sender's mail are loaded. Sealed until you say so, and only for that sender.
CREATE TABLE IF NOT EXISTS mail_senders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  email TEXT NOT NULL,
  load_images INTEGER NOT NULL DEFAULT 0 CHECK (load_images IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_senders_by_email ON mail_senders (lower(email));

-- Mail to send (Mail 8, mail-send.js): everything you write waits here first: ten seconds with Undo, or until tomorrow at 08:00, or a time.
--   state       waiting (not claimed yet: Undo works), sending (claimed: it is on its way and can no longer be taken back), sent,
--               undone (taken back) or failed (never retried by itself: a mail that may have gone is not sent twice)
--   claimed_at  set, atomically, by the one job that sends it, before Gmail is called
--   remind_days / remind_at / reminded   "Remind me if no answer in N days": a task when the day comes and nobody has written back
CREATE TABLE IF NOT EXISTS mail_sends (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES mail_accounts (id),
  thread_id TEXT REFERENCES mail_threads (id),
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  send_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'sending', 'sent', 'undone', 'failed')),
  claimed_at TEXT,
  sent_at TEXT,
  gmail_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  remind_days INTEGER NOT NULL DEFAULT 0,
  remind_at TEXT,
  reminded INTEGER NOT NULL DEFAULT 0,
  ics TEXT NOT NULL DEFAULT '',   -- an answer to an invitation (Mail 12): the small calendar file that goes with the mail
  pixel_token TEXT              -- a read confirmation (Mail 9): the random token the one-pixel picture's address ends in; NULL when it was not switched on
);

CREATE INDEX IF NOT EXISTS mail_sends_by_state ON mail_sends (state, send_at);

CREATE UNIQUE INDEX IF NOT EXISTS mail_sends_by_pixel ON mail_sends (pixel_token) WHERE pixel_token IS NOT NULL;

-- Read confirmations (Mail 9, mail-confirm.js): every fetch of the one-pixel picture of a mail you sent. Only what is counted is an open ("Opened"
-- is all it can know, never "Read"); a scanner, a privacy proxy or a fetch within thirty seconds of sending is listed and not counted.
--   kind  opened, scanner, proxy or early
CREATE TABLE IF NOT EXISTS mail_opens (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  send_id TEXT NOT NULL REFERENCES mail_sends (id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opened', 'scanner', 'proxy', 'early')),
  fetcher TEXT NOT NULL DEFAULT '',
  counted INTEGER NOT NULL DEFAULT 0 CHECK (counted IN (0, 1))
);

CREATE INDEX IF NOT EXISTS mail_opens_by_send ON mail_opens (send_id, at);

-- What you chose per person: whether a mail to them carries a read confirmation. Off until you switch it on, and only for them.
CREATE TABLE IF NOT EXISTS mail_confirm_people (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  email TEXT NOT NULL,
  confirm INTEGER NOT NULL DEFAULT 0 CHECK (confirm IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_confirm_people_by_email ON mail_confirm_people (lower(email));

-- How you answered an invitation in a mail (Mail 12): one row per meeting (its UID, from the organiser's calendar file).
--   partstat    ACCEPTED, TENTATIVE or DECLINED
--   event_id    the event in your Calendar, if the answer put one there
--   send_id     the mail that carries the answer to the organiser (mail_sends)
--   changed     what this answer did to your Calendar: created, updated, removed or nothing; Undo puts it back
--   prev_partstat  how you had answered before, so Undo gives it back
CREATE TABLE IF NOT EXISTS mail_invites (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  uid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  partstat TEXT NOT NULL CHECK (partstat IN ('ACCEPTED', 'TENTATIVE', 'DECLINED')),
  event_id TEXT,
  send_id TEXT,
  changed TEXT NOT NULL DEFAULT '',
  prev_partstat TEXT NOT NULL DEFAULT '',
  answered_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_invites_by_uid ON mail_invites (uid);

-- Bullets (Writing and thinking, advanced/writing/1; the course calls them blocks, but blocks is the Planner's time blocks here): the list items of a note, one row each, with a parent and a position. The note's
-- Markdown stays the one truth (the editor writes it); these rows are made again from it on every save, an edited bullet keeping its id.
-- A bullet that is gone is marked deleted, never removed.
--   parent_id   the bullet it is nested under, NULL at the top
--   position    among its siblings, from 0
--   ord         in the note, from 0, in reading order (the editor's Nth list item)
--   depth       0 at the top
--   folded      its children are put away (kept here, never in the note's text, so folding is not an edit)
CREATE TABLE IF NOT EXISTS bullets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  note_id TEXT NOT NULL REFERENCES notes (id),
  parent_id TEXT REFERENCES bullets (id),
  position INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  folded INTEGER NOT NULL DEFAULT 0 CHECK (folded IN (0, 1))
);

CREATE INDEX IF NOT EXISTS bullets_by_note ON bullets (note_id, ord);

-- Comments on a passage (Writing and thinking, advanced/writing/3): one row per comment or reply, in threads. The anchor is the quoted words
-- of the note and which occurrence of them it is (so adding text above never moves it); a reply has a parent. Anything of the app can be
-- the thing commented on (ref_table, ref_id); notes so far.
--   author    me, or assistant (a reply your assistant wrote, signed as such)
--   ask       '' (not asked), later (on your assistant's later list), asked (a turn is under way), answered
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  ref_table TEXT NOT NULL DEFAULT 'notes',
  ref_id TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  occurrence INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'me' CHECK (author IN ('me', 'assistant')),
  parent_id TEXT REFERENCES comments (id),
  resolved_at TEXT,
  ask TEXT NOT NULL DEFAULT '' CHECK (ask IN ('', 'later', 'asked', 'answered'))
);

CREATE INDEX IF NOT EXISTS comments_by_ref ON comments (ref_table, ref_id);

-- Versions of a note (Writing and thinking, advanced/writing/4): every save keeps the note's whole text with its time and its author, in the
-- same step as the save, so the note row stays the one current text and a version can never be missing. A restore is one more save.
--   seq     1, 2, 3 ... per note
--   author  me, or assistant
--   label   what made it, in a few words, when it is not a plain save (Restored from version 2, Merged, Kept both)
CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  note_id TEXT NOT NULL REFERENCES notes (id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'me' CHECK (author IN ('me', 'assistant')),
  label TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS note_versions_by_note ON note_versions (note_id, seq);

-- Clashes (Writing and thinking, advanced/writing/5): when you and your assistant changed the same line of a note, one side's words stay in
-- the note (mine) and the other side's are kept here with its whole text (theirs, theirs_text) until you choose.
--   state    open, then mine (kept yours), theirs (took the assistant's), or both
--   told     whether your assistant has been told, in its next turn, which side won
CREATE TABLE IF NOT EXISTS note_clashes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  note_id TEXT NOT NULL REFERENCES notes (id),
  line_no INTEGER NOT NULL DEFAULT 0,
  mine TEXT NOT NULL DEFAULT '',
  theirs TEXT NOT NULL DEFAULT '',
  theirs_text TEXT NOT NULL DEFAULT '',
  theirs_author TEXT NOT NULL DEFAULT 'assistant',
  version_id TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'mine', 'theirs', 'both')),
  resolved_at TEXT,
  told INTEGER NOT NULL DEFAULT 0 CHECK (told IN (0, 1))
);

CREATE INDEX IF NOT EXISTS note_clashes_by_note ON note_clashes (note_id, state);

-- Boards (Writing and thinking, advanced/writing/6): a canvas of cards, words and arrows that sits in a note (a line in its text is a link to
-- /boards/<id>). A card can point at something the app already keeps (ref_table notes, people or tasks, ref_id) and then shows it live.
--   kind        card (a box with words, or pointing at a note, person or task), text (words on the canvas), arrow (from_id to to_id)
--   x, y, w, h  where it is on the canvas, in canvas units (the canvas is 1200 wide)
--   change_id   the one change your assistant drew it in (Writing 7), so Undo takes the whole change back; origin assistant marks it as its own
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  note_id TEXT REFERENCES notes (id),
  title TEXT NOT NULL DEFAULT '',
  background_file TEXT,                  -- a page from a paper tablet or a scan (a kept file, by its sha256) that lies under the board (Writing 8)
  background_name TEXT NOT NULL DEFAULT '',
  background_type TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS board_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  board_id TEXT NOT NULL REFERENCES boards (id),
  kind TEXT NOT NULL CHECK (kind IN ('card', 'text', 'arrow')),
  ref_table TEXT CHECK (ref_table IN ('notes', 'people', 'tasks')),
  ref_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 200,
  h REAL NOT NULL DEFAULT 80,
  from_id TEXT,
  to_id TEXT,
  label TEXT NOT NULL DEFAULT '',
  change_id TEXT
);

CREATE INDEX IF NOT EXISTS board_items_by_board ON board_items (board_id);

-- Import reports (Writing and thinking, advanced/writing/9): what each run of an import did, kept as it was said.
--   kind    obsidian or dayone
--   report  JSON: how many came in, were already here, were kept because you edited them, and doubled (always 0)
CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('obsidian', 'dayone')),
  source TEXT NOT NULL DEFAULT '',
  report TEXT NOT NULL DEFAULT '{}'
);

-- Ink (Writing and thinking, advanced/writing/8): the pen on a board. A stroke is a list of points [x, y, pressure, ms since the stroke began],
-- kept as drawn. Reading handwriting as words never deletes ink: the strokes are marked faded and point at the text item they became.
CREATE TABLE IF NOT EXISTS ink_strokes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  board_id TEXT NOT NULL REFERENCES boards (id),
  points TEXT NOT NULL DEFAULT '[]',
  faded INTEGER NOT NULL DEFAULT 0 CHECK (faded IN (0, 1)),
  text_item_id TEXT
);

CREATE INDEX IF NOT EXISTS ink_strokes_by_board ON ink_strokes (board_id);

-- Routines (Calendar in depth, advanced/calendar/6): a template is a title and a length you set up once, such as a run or a
-- morning of deep work. Dragged into a day of the Planner it makes a task there (never an event), placed like any task and
-- marked with its template (tasks.template_id), so it shares its gap and is counted by the budget.
CREATE TABLE IF NOT EXISTS event_templates (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0)
);

-- Your Google events (Calendar in depth, advanced/calendar/7): what Google Calendar says, kept beside your own events and never
-- mixed into them. Matched by Google's own ids, so a read twice changes nothing; an event that is gone from Google (or cancelled)
-- is marked deleted, never removed. Read only until the lesson that changes events.
--   calendar_id, event_id   Google's own ids (the key of a row, with the account)
--   ical_uid                the meeting's own key, the same in Google, in a mail invitation and in a calendar file
--   etag                    the version of the event Google had when it was read (Calendar 8 sends changes against it)
--   attendees               JSON: [{ name, email, response, self, organizer }]; my_response is the answer of this account
CREATE TABLE IF NOT EXISTS google_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'imported' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES google_accounts (id),
  calendar_id TEXT NOT NULL,
  calendar_name TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL,
  ical_uid TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL DEFAULT '{}',
  attendees TEXT NOT NULL DEFAULT '[]',
  my_response TEXT NOT NULL DEFAULT '',
  meet_url TEXT NOT NULL DEFAULT '',
  html_link TEXT NOT NULL DEFAULT '',
  recurring_event_id TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS google_events_by_key ON google_events (account_id, calendar_id, event_id);
CREATE INDEX IF NOT EXISTS google_events_by_start ON google_events (starts_at);

-- The outbox of changes to Google events (Calendar in depth, advanced/calendar/8): a change shows in the app at once (the
-- google_events row is changed) and waits here, with the version (etag) of the event it was made on, until a job sends it to
-- Google with If-Match: Google takes it only if it still has that version. If not, Google's version is kept, the change stays
-- here as a clash with Google's side in `theirs`, and the owner decides: Use mine, or Keep Google's. Nothing is ever overwritten in silence.
--   state   waiting (not sent yet) · sending · sent · clash (Google changed it too) · failed (said in `problem`) · dismissed (a clash settled)
--   patch   JSON of what changed: { title?, starts_at?, ends_at?, location?, description? }
CREATE TABLE IF NOT EXISTS calendar_outbox (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'typed' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES google_accounts (id),
  google_event_id TEXT NOT NULL REFERENCES google_events (id),
  patch TEXT NOT NULL DEFAULT '{}',
  etag TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'sending', 'sent', 'clash', 'failed', 'dismissed')),
  tries INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  theirs TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'insert', 'answer', 'move_all')),  -- what it is (Calendar 9: a new event, an answer, a whole series moved)
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS calendar_outbox_by_state ON calendar_outbox (state, next_try_at);

-- The calendars an account shows in Google Calendar, kept at every read, so a new event can be put in one that may be written to
-- (Calendar in depth, advanced/calendar/9). access_role is Google's: owner, writer, reader or freeBusyReader.
CREATE TABLE IF NOT EXISTS google_calendars (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  origin TEXT NOT NULL DEFAULT 'imported' CHECK (origin IN ('typed', 'captured', 'imported', 'assistant')),
  account_id TEXT NOT NULL REFERENCES google_accounts (id),
  calendar_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  access_role TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS google_calendars_by_key ON google_calendars (account_id, calendar_id);
