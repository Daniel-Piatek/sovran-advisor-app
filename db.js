// Opens the database and brings it to the shape in schema.sql.
// The shape has a version number (SQLite's user_version). An older database is first
// copied whole (app.db.before-v<N>.bak next to it), then moved step by step to the
// newest version, keeping every row.

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { syncAllLinks } from './links.js';
import { syncAllTasks } from './tasks.js';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const schema = fs.readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

export const SCHEMA_VERSION = 70;

// Each step moves the database from version N-1 to N.
const steps = {
  // 1: the first notes table called the origin column "source", and had no search.
  1(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('notes')").all().map((c) => c.name);
    if (columns.includes('source')) {
      // The old index would move along with the renamed table and be dropped with it.
      db.exec('DROP INDEX IF EXISTS notes_by_updated');
      db.exec('ALTER TABLE notes RENAME TO notes_v0');
      db.exec(schema);
      db.exec(`INSERT INTO notes (id, created_at, updated_at, deleted_at, origin, title, body)
        SELECT id, created_at, updated_at, deleted_at,
               CASE WHEN source IN ('typed', 'captured', 'imported', 'assistant') THEN source ELSE 'typed' END,
               title, body
        FROM notes_v0`);
      db.exec('DROP TABLE notes_v0');
    }
  },
  // 2: the journal: the journals and journal_entries tables (made by schema.sql).
  2() {},
  // 3: files (made by schema.sql).
  3() {},
  // 4: captures (made by schema.sql), and notes and entries remember the capture they
  // were made from.
  4(db) {
    for (const table of ['notes', 'journal_entries']) {
      const columns = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
      if (columns.length && !columns.includes('capture_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN capture_id TEXT`);
    }
  },
  // 5: links (made by schema.sql), filled from the links already written in texts.
  5(db) {
    db.exec(schema);
    syncAllLinks(db);
  },
  // 6: people and companies (made by schema.sql), and links that can point at them:
  // the links table is made again (its rows come from the texts anyway).
  6(db) {
    db.exec('DROP TABLE IF EXISTS links');
    db.exec(schema);
    syncAllLinks(db);
  },
  // 7: My Life (life_items and life_serves, made by schema.sql), and links that can
  // point at a My Life item: the links table is made again, as in 6.
  7(db) {
    db.exec('DROP TABLE IF EXISTS links');
    db.exec(schema);
    syncAllLinks(db);
  },
  // 8: a note has one home in My Life (notes.home_id).
  8(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('notes')").all().map((c) => c.name);
    if (!columns.includes('home_id')) db.exec('ALTER TABLE notes ADD COLUMN home_id TEXT REFERENCES life_items (id)');
  },
  // 9: tasks (made by schema.sql), filled from the task lines already in texts.
  9(db) {
    db.exec(schema);
    syncAllTasks(db);
  },
  // 10: the Tasks app: tasks of their own, flags, estimates, repeats, homes, and
  // reminders. The tasks table is made again (until now every task came from a text).
  10(db) {
    db.exec('DROP TABLE IF EXISTS tasks');
    db.exec(schema);
    syncAllTasks(db);
  },
  // 11: a capture can become a task (tasks/3): captures.sorted_into may be 'task' (the
  // table is moved to the new shape, keeping every capture), and a task remembers it.
  11(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('capture_id')) db.exec('ALTER TABLE tasks ADD COLUMN capture_id TEXT');
    const old = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'captures'").get()?.sql ?? '';
    if (old && !old.includes("'task'")) {
      db.exec('DROP INDEX IF EXISTS captures_waiting'); // it would move with the old table
      db.exec('ALTER TABLE captures RENAME TO captures_v10');
      db.exec(schema);
      db.exec(`INSERT INTO captures (id, created_at, updated_at, deleted_at, origin, body, captured_at, state, sorted_at, sorted_into, sorted_id, sorted_note_body)
        SELECT id, created_at, updated_at, deleted_at, origin, body, captured_at, state, sorted_at, sorted_into, sorted_id, sorted_note_body FROM captures_v10`);
      db.exec('DROP TABLE captures_v10');
    }
  },
  // 12: your own events (made by schema.sql).
  12() {},
  // 13: your other calendars, by iCal link (made by schema.sql).
  13() {},
  // 14: notes about an event (event_refs, made by schema.sql), and links that can point at
  // an event: the links table is made again, as in 6.
  14(db) {
    db.exec('DROP TABLE IF EXISTS links');
    db.exec(schema);
    syncAllLinks(db);
  },
  // 15: the Planner (time/2): where a task sits in its day, time blocks and settings.
  15(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('plan_part')) db.exec("ALTER TABLE tasks ADD COLUMN plan_part TEXT NOT NULL DEFAULT '' CHECK (plan_part IN ('', 'morning', 'afternoon'))");
    if (!columns.includes('block_id')) db.exec('ALTER TABLE tasks ADD COLUMN block_id TEXT');
  },
  // 16: Weekly Goals (tasks.goal_week), the Highlight of each day, and planning flows.
  16(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('goal_week')) db.exec("ALTER TABLE tasks ADD COLUMN goal_week TEXT NOT NULL DEFAULT ''");
  },
  // 17: closing the day (day_closes, made by schema.sql).
  17() {},
  // 18: the Weekly Review: how often a task's day was pushed later, and reviews (made by
  // schema.sql).
  18(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('due_moves')) db.exec('ALTER TABLE tasks ADD COLUMN due_moves INTEGER NOT NULL DEFAULT 0');
  },
  // 19: the quarterly review marks its Goals (reviews.marks).
  19(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('reviews')").all().map((c) => c.name);
    if (columns.length && !columns.includes('marks')) db.exec("ALTER TABLE reviews ADD COLUMN marks TEXT NOT NULL DEFAULT '{}'");
  },
  // 20: the assistant's conversations and messages (made by schema.sql).
  20() {},
  // 21: the assistant's sources, the page a question was asked on, and its cards
  // (assistant_actions, made by schema.sql).
  21(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('chat_messages')").all().map((c) => c.name);
    if (columns.length && !columns.includes('sources')) db.exec("ALTER TABLE chat_messages ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'");
    if (columns.length && !columns.includes('context')) db.exec("ALTER TABLE chat_messages ADD COLUMN context TEXT NOT NULL DEFAULT ''");
  },
  // 22: your assistant's suggestions for captures (capture_suggestions, made by schema.sql).
  22() {},
  // 23: what the assistant may do alone (permissions in settings, assistant_activity made by
  // schema.sql), and cards for a note to add or a step to allow: the cards table is made
  // again with the new kinds and states, every row copied over.
  23(db) { remakeActions(db, "'step'"); },
  // 24: cards for the assistant's plans on the Planner and for closing the day (time/3 and
  // time/4, their assistant steps): the cards table is made again, every row copied over.
  24(db) { remakeActions(db, "'close_day'"); },
  // 25: the day in hours: a placed task's time in its day (tasks.plan_at).
  25(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('plan_at')) db.exec("ALTER TABLE tasks ADD COLUMN plan_at TEXT NOT NULL DEFAULT ''");
  },
  // 26: a long task's few words, by the assistant (tasks.short_text).
  26(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('short_text')) db.exec("ALTER TABLE tasks ADD COLUMN short_text TEXT NOT NULL DEFAULT ''");
  },
  // 27: a line about every My Life item (life_items.description).
  27(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('life_items')").all().map((c) => c.name);
    if (columns.length && !columns.includes('description')) db.exec("ALTER TABLE life_items ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  },
  // 28: the home chosen for a capture in the Inbox (captures.home_id); one already read
  // starts at the home its suggestion named.
  28(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('captures')").all().map((c) => c.name);
    if (columns.length && !columns.includes('home_id')) db.exec('ALTER TABLE captures ADD COLUMN home_id TEXT REFERENCES life_items (id)');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'capture_suggestions'").get() && columns.length) {
      db.exec(`UPDATE captures SET home_id = (SELECT s.home_id FROM capture_suggestions s WHERE s.capture_id = captures.id AND s.state = 'ready')
        WHERE state = 'waiting' AND home_id IS NULL`);
    }
  },
  // 29: Snooze in the Inbox (captures.snoozed_until): a capture that comes back by itself.
  29(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('captures')").all().map((c) => c.name);
    if (columns.length && !columns.includes('snoozed_until')) db.exec('ALTER TABLE captures ADD COLUMN snoozed_until TEXT');
  },
  // 30: Inner and Outer World, and the title of a pasted link (captures.world, link_url, link_title).
  30(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('captures')").all().map((c) => c.name);
    if (!columns.length) return;
    if (!columns.includes('world')) db.exec("ALTER TABLE captures ADD COLUMN world TEXT NOT NULL DEFAULT 'inner' CHECK (world IN ('inner', 'outer'))");
    if (!columns.includes('link_url')) db.exec('ALTER TABLE captures ADD COLUMN link_url TEXT');
    if (!columns.includes('link_title')) db.exec('ALTER TABLE captures ADD COLUMN link_title TEXT');
  },
  // 31: People in depth (advanced/people/1): a task of its own can mention a person or a
  // company, so a link can come from a task (links.from_kind 'task'). The table is made
  // again, every row copied over.
  31(db) { remakeLinks(db); },
  // 32: log lines (advanced/people/4): a link can come from an interaction, and the assistant's
  // cards can be log_interaction; both tables are made again, every row copied over (the
  // interactions table itself is new, made from schema.sql).
  32(db) { remakeLinks(db); remakeActions(db, "'log_interaction'"); },
  // 33: a reconnect rhythm (advanced/people/5): how often to be in touch with a person (people.cadence_days).
  33(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('people')").all().map((c) => c.name);
    if (columns.length && !columns.includes('cadence_days')) {
      db.exec('ALTER TABLE people ADD COLUMN cadence_days INTEGER CHECK (cadence_days IS NULL OR cadence_days IN (7, 14, 21, 30, 90))');
    }
  },
  // 34: bring your contacts in (advanced/people/6): where an imported person came from (people.source_key).
  34(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('people')").all().map((c) => c.name);
    if (columns.length && !columns.includes('source_key')) db.exec('ALTER TABLE people ADD COLUMN source_key TEXT');
  },
  // 35: one person, two entries (advanced/people/7): a person merged into another (people.merged_into, merge_record).
  35(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('people')").all().map((c) => c.name);
    if (!columns.length) return;
    if (!columns.includes('merged_into')) db.exec('ALTER TABLE people ADD COLUMN merged_into TEXT REFERENCES people (id)');
    if (!columns.includes('merge_record')) db.exec('ALTER TABLE people ADD COLUMN merge_record TEXT');
  },
  // 36: Dictation (advanced/voice/1): the dictations table is new (made from schema.sql).
  36() {},
  // 37: the glossary (advanced/voice/2): the glossary table is new (made from schema.sql).
  37() {},
  // 38: Google (advanced/mail/1): google_accounts and google_log are new (made from schema.sql).
  38() {},
  // 39: Mail (advanced/mail/2): the mail tables are new (made from schema.sql).
  39() {},
  // 40: Tasks in depth 3: the next one of a repeating task remembers which one made it (tasks.repeat_from).
  40(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('repeat_from')) db.exec('ALTER TABLE tasks ADD COLUMN repeat_from TEXT');
  },
  // 41: Tasks in depth 6: a capture remembers the device that shared it (captures.device_id); capture_devices is new.
  41(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('captures')").all().map((c) => c.name);
    if (!columns.includes('device_id')) db.exec('ALTER TABLE captures ADD COLUMN device_id TEXT');
  },
  // 42: Mail 3: a message's attachments are kept once in files (mail_messages.attachment_files).
  42(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_messages')").all().map((c) => c.name);
    if (columns.length && !columns.includes('attachment_files')) db.exec("ALTER TABLE mail_messages ADD COLUMN attachment_files TEXT NOT NULL DEFAULT '[]'");
  },
  // 43: Mail 4: Live with Gmail: the account remembers where its sync stopped; mail_outbox is new (made from schema.sql).
  43(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_accounts')").all().map((c) => c.name);
    if (!columns.length) return;
    if (!columns.includes('live')) db.exec('ALTER TABLE mail_accounts ADD COLUMN live INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('history_id')) db.exec('ALTER TABLE mail_accounts ADD COLUMN history_id TEXT');
    if (!columns.includes('synced_at')) db.exec('ALTER TABLE mail_accounts ADD COLUMN synced_at TEXT');
    if (!columns.includes('sync_error')) db.exec("ALTER TABLE mail_accounts ADD COLUMN sync_error TEXT NOT NULL DEFAULT ''");
  },
  // 44: Mail 5: what the splits read: a message is bulk, has an unsubscribe link, carries an invitation.
  44(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_messages')").all().map((c) => c.name);
    if (!columns.length) return;
    for (const column of ['bulk', 'list_unsubscribe', 'has_invite']) {
      if (!columns.includes(column)) db.exec(`ALTER TABLE mail_messages ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  },
  // 45: Mail 7: a mail keeps its own html for the sealed frame (mail_messages.body_html); mail_senders is new (made from schema.sql).
  45(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_messages')").all().map((c) => c.name);
    if (columns.length && !columns.includes('body_html')) db.exec("ALTER TABLE mail_messages ADD COLUMN body_html TEXT NOT NULL DEFAULT ''");
  },
  // 46: Mail 8: writing mail: mail_sends is new (made from schema.sql).
  46() {},
  // 47: Mail 9: read confirmations: mail_sends.pixel_token; mail_opens and mail_confirm_people are new (made from schema.sql).
  47(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('mail_sends')").all().map((c) => c.name);
    if (columns.length && !columns.includes('pixel_token')) db.exec('ALTER TABLE mail_sends ADD COLUMN pixel_token TEXT');
  },
  // 48: Mail 11: a task can link back to the mail it was made from (tasks.mail_thread_id), and your assistant's draft is a card of its own kind (mail_send).
  48(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('mail_thread_id')) db.exec('ALTER TABLE tasks ADD COLUMN mail_thread_id TEXT');
    remakeActions(db, "'mail_send'");
  },
  // 49: Mail 12: invitations in a mail: the calendar file a mail carried (mail_messages.invite_ics), the meeting's own key on an event (events.uid),
  // the small calendar file an answer carries (mail_sends.ics); mail_invites is new (made from schema.sql).
  49(db) {
    const columnsOf = (table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
    // a table that is not there yet is made from schema.sql with the column
    const has = (table, column) => { const c = columnsOf(table); return !c.length || c.includes(column); };
    if (!has('mail_messages', 'invite_ics')) db.exec("ALTER TABLE mail_messages ADD COLUMN invite_ics TEXT NOT NULL DEFAULT ''");
    if (!has('events', 'uid')) db.exec('ALTER TABLE events ADD COLUMN uid TEXT');
    if (columnsOf('events').includes('uid')) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_by_uid ON events (uid) WHERE uid IS NOT NULL');
    if (!has('mail_sends', 'ics')) db.exec("ALTER TABLE mail_sends ADD COLUMN ics TEXT NOT NULL DEFAULT ''");
  },
  // 50: Writing 1: bullets: the blocks table is new (made from schema.sql).
  50() {},
  // 51: Writing 2: a link can point at one bullet (links.target_block_id).
  51(db) {
    if (!db.prepare("SELECT name FROM pragma_table_info('links')").all().some((c) => c.name === 'target_block_id')) db.exec('ALTER TABLE links ADD COLUMN target_block_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS links_to_block ON links (target_block_id) WHERE target_block_id IS NOT NULL');
  },
  // 52: Writing 3: comments on a passage: the comments table is new (made from schema.sql).
  52() {},
  // 53: Writing 4: every save of a note is a version: note_versions is new (made from schema.sql).
  53() {},
  // 54: Writing 5: clashes between you and your assistant: note_clashes is new (made from schema.sql).
  54() {},
  // 55: Writing 6: boards: boards and board_items are new (made from schema.sql).
  55() {},
  // 56: Writing 7: your assistant's drawing on a board is a card of its own kind (board_draw).
  56(db) { remakeActions(db, "'board_draw'"); },
  // 57: Writing 9: imports: notes and entries know where they came from (source_key, imported_at); import_runs is new (made from schema.sql).
  57(db) {
    const has = (table, column) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().some((c) => c.name === column);
    if (!has('notes', 'source_key')) db.exec('ALTER TABLE notes ADD COLUMN source_key TEXT');
    if (!has('notes', 'imported_at')) db.exec('ALTER TABLE notes ADD COLUMN imported_at TEXT');
    if (!has('journal_entries', 'source_key')) db.exec('ALTER TABLE journal_entries ADD COLUMN source_key TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS notes_by_source ON notes (source_key) WHERE source_key IS NOT NULL');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_by_source ON journal_entries (source_key) WHERE source_key IS NOT NULL');
  },
  // 58: Writing 8: the pen: ink_strokes is new (made from schema.sql); a board can lie on a page (boards.background_*).
  58(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('boards')").all().map((c) => c.name);
    if (columns.length && !columns.includes('background_file')) {
      db.exec('ALTER TABLE boards ADD COLUMN background_file TEXT');
      db.exec("ALTER TABLE boards ADD COLUMN background_name TEXT NOT NULL DEFAULT ''");
      db.exec("ALTER TABLE boards ADD COLUMN background_type TEXT NOT NULL DEFAULT ''");
    }
  },
  // 59: Calendar 4: a task can be pinned to a time and a length (tasks.pin_at, tasks.pin_minutes): a time block of the Planner, never an event.
  59(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (columns.length && !columns.includes('pin_at')) {
      db.exec("ALTER TABLE tasks ADD COLUMN pin_at TEXT NOT NULL DEFAULT '' CHECK (pin_at = '' OR pin_at GLOB '[0-2][0-9]:[0-5][0-9]')");
      db.exec('ALTER TABLE tasks ADD COLUMN pin_minutes INTEGER CHECK (pin_minutes IS NULL OR pin_minutes > 0)');
    }
  },
  // 60: Calendar 5: an own event can link to the people a sentence named (links.from_kind 'event').
  60(db) { remakeLinks(db); },
  // 61: Calendar 6: routines: event_templates is new (made from schema.sql); a task can say which routine it came from.
  61(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (columns.length && !columns.includes('template_id')) db.exec('ALTER TABLE tasks ADD COLUMN template_id TEXT');
  },
  // 62: Calendar 7: Google Calendar: google_events is new (made from schema.sql); an account says when its calendar was last read.
  62(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('google_accounts')").all().map((c) => c.name);
    if (columns.length && !columns.includes('calendar_read_at')) {
      db.exec('ALTER TABLE google_accounts ADD COLUMN calendar_read_at TEXT');
      db.exec("ALTER TABLE google_accounts ADD COLUMN calendar_problem TEXT NOT NULL DEFAULT ''");
    }
  },
  // 63: Calendar 8: calendar_outbox is new (made from schema.sql): the changes to Google events waiting to go, with their etags.
  63() {},
  // 64: Calendar 9: the outbox says what kind of change it holds; google_calendars is new (made from schema.sql).
  64(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('calendar_outbox')").all().map((c) => c.name);
    if (columns.length && !columns.includes('kind')) {
      db.exec("ALTER TABLE calendar_outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'insert', 'answer', 'move_all'))");
      db.exec("ALTER TABLE calendar_outbox ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'");
    }
  },
  // 65: Calendar 10: your assistant's proposals of events are a kind of card (calendar_propose).
  65(db) { remakeActions(db, "'calendar_propose'"); },
  // 66: a task has a title (its text) and, apart from it, details (tasks.details), free words shown only in the task's pop-up.
  66(db) {
    const columns = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map((c) => c.name);
    if (!columns.includes('details')) db.exec("ALTER TABLE tasks ADD COLUMN details TEXT NOT NULL DEFAULT ''");
  },
  // 67: each answer says which AI gave it (Claude or ChatGPT, ai.js) and its model, when it was told.
  // A test copy that took this step as 66 (before tasks.details) gets the task details here too.
  67(db) {
    steps[66](db);
    const columns = db.prepare("SELECT name FROM pragma_table_info('chat_messages')").all().map((c) => c.name);
    if (columns.length && !columns.includes('ai')) db.exec("ALTER TABLE chat_messages ADD COLUMN ai TEXT NOT NULL DEFAULT ''");
    if (columns.length && !columns.includes('model')) db.exec("ALTER TABLE chat_messages ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  },
  // 68: Habits, the fifth kind in My Life (advanced/mylife/1; APP Daniel's step 67): kind habit, how often (cadence_times a week
  // or a month) and what counts as done. Only adds: the table is made again with every row copied, and a second run does nothing.
  68(db) { remakeLife(db); },
  // 69: Mail drafts (APP Daniel's step 68): mail_drafts is new (made from schema.sql), a mail being written and not sent yet. Nothing else changes.
  69() {},
  // 70: voice calls (advanced/voice/3-7): call_turns and voice_log are new (made from schema.sql). Nothing else changes.
  70() {},
};

// life_items takes the kind habit and its three columns. SQLite can't change a CHECK in place, so the table is made again and the rows
// copied. Other tables point at life_items (notes, tasks, captures, life_serves) by its name, which the new table takes: prepareDatabase
// runs this step with foreign keys off (they can't be switched off inside a transaction) and checks them again before it commits.
function remakeLife(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'life_items'").get();
  if (!table || table.sql.includes("'habit'")) return;
  const start = schema.indexOf('CREATE TABLE IF NOT EXISTS life_items');
  db.exec(schema.slice(start, schema.indexOf(');', start) + 2).replace('CREATE TABLE IF NOT EXISTS life_items', 'CREATE TABLE life_items_new'));
  const columns = db.prepare("SELECT name FROM pragma_table_info('life_items')").all().map((c) => c.name).join(', ');
  db.exec(`INSERT INTO life_items_new (${columns}) SELECT ${columns} FROM life_items`);
  db.exec('DROP TABLE life_items'); // its index goes with it; schema.sql makes it again
  db.exec('ALTER TABLE life_items_new RENAME TO life_items');
}

// The links table as schema.sql has it now, every row kept (SQLite can't change a CHECK in place).
function remakeLinks(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'links'").get();
  if (!table || table.sql.includes("'interaction', 'event')")) return;
  db.exec('ALTER TABLE links RENAME TO links_before');
  db.exec('DROP INDEX IF EXISTS links_to');
  db.exec('DROP INDEX IF EXISTS links_from');
  const start = schema.indexOf('CREATE TABLE IF NOT EXISTS links');
  db.exec(schema.slice(start, schema.indexOf(');', start) + 2));
  const columns = db.prepare("SELECT name FROM pragma_table_info('links_before')").all().map((c) => c.name).join(', '); // the columns it had (the table has gained some since)
  db.exec(`INSERT INTO links (${columns}) SELECT ${columns} FROM links_before`);
  db.exec('DROP TABLE links_before');
}

// The cards table as schema.sql has it now, every row kept: for a table whose kinds or
// states changed (SQLite can't change a CHECK in place). `has` is a word the new one has.
function remakeActions(db, has) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assistant_actions'").get();
  if (!table || table.sql.includes(has)) return;
  db.exec('ALTER TABLE assistant_actions RENAME TO assistant_actions_before');
  db.exec('DROP INDEX IF EXISTS assistant_actions_by_message');
  const start = schema.indexOf('CREATE TABLE IF NOT EXISTS assistant_actions');
  db.exec(schema.slice(start, schema.indexOf(');', start) + 2));
  db.exec('INSERT INTO assistant_actions SELECT * FROM assistant_actions_before');
  db.exec('DROP TABLE assistant_actions_before');
}

// An imported row is found again by where it came from (Writing 9). These are made here, not in schema.sql, because schema.sql also runs
// against a database that is still before the column exists (a step of an older version).
function ensureSourceIndexes(db) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS notes_by_source ON notes (source_key) WHERE source_key IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_by_source ON journal_entries (source_key) WHERE source_key IS NOT NULL');
}

// General is always there: make it if it is missing.
function ensureGeneralJournal(db) {
  if (db.prepare('SELECT 1 FROM journals WHERE is_general = 1').get()) return;
  const time = new Date().toISOString();
  db.prepare("INSERT INTO journals (id, created_at, updated_at, name, is_general) VALUES (?, ?, ?, 'General', 1)")
    .run(randomUUID(), time, time);
}

// The whole copies made before a schema move (app.db.before-v<N>.bak): only the 3 with the highest numbers are kept,
// after a move has gone through. Copies with any other name (before-restart, before-mail-restore…) are left alone.
export const UPGRADE_COPIES_KEPT = 3;
export function pruneUpgradeCopies(dir, base = 'app.db', keep = UPGRADE_COPIES_KEPT) {
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.before-v(\\d+)\\.bak$`);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const copies = names.map((name) => ({ name, n: Number(name.match(pattern)?.[1]) })).filter((c) => Number.isInteger(c.n)).sort((a, b) => b.n - a.n);
  const removed = [];
  for (const c of copies.slice(keep)) { fs.rmSync(path.join(dir, c.name), { force: true }); removed.push(c.name); }
  return removed;
}

export function prepareDatabase(db, { file } = {}) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;

  if (version < SCHEMA_VERSION && hasTables) {
    if (file) db.exec(`VACUUM INTO '${`${file}.before-v${SCHEMA_VERSION}.bak`.replaceAll("'", "''")}'`);
    // Step 68 makes life_items again, which other tables point at: foreign keys are off for the move and checked before it commits
    // (a reference that was already broken before is not blamed on the move).
    const keysOff = version < 68;
    const broken = () => db.prepare('PRAGMA foreign_key_check').all().length;
    if (keysOff) db.exec('PRAGMA foreign_keys = OFF');
    const brokenBefore = keysOff ? broken() : 0;
    db.exec('BEGIN');
    try {
      for (let v = version + 1; v <= SCHEMA_VERSION; v++) steps[v](db);
      db.exec(schema);
      if (keysOff && broken() > brokenBefore) throw new Error('The move broke a reference between tables: nothing was changed.');
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    if (file) pruneUpgradeCopies(path.dirname(file), path.basename(file));
  } else {
    db.exec(schema);
    if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  ensureSourceIndexes(db);
  ensureGeneralJournal(db);
  return db;
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'app.db');
  return prepareDatabase(new DatabaseSync(file), { file });
}
