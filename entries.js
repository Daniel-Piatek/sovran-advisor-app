// The journal in the database: journals (General plus the owner's own) and journal
// entries (schema.sql). An entry belongs to one journal and one day. Like notes, nothing
// is ever really removed: deleting only sets deleted_at.

import { randomUUID } from 'node:crypto';
import { searchQuery, PREVIEW_LENGTH, MAX_TITLE_LENGTH, MAX_BODY_LENGTH } from './notes.js';
import { syncLinks } from './links.js';
import { syncTasks } from './tasks.js';

export const MAX_JOURNAL_NAME_LENGTH = 60;

const now = () => new Date().toISOString();
const plain = (rows) => rows.map((row) => ({ ...row }));
const fail = (status, message) => Object.assign(new Error(message), { status });

// A day as YYYY-MM-DD in this computer's own time zone.
export function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDay(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// ---- Journals ----

export function generalJournal(db) {
  return { ...db.prepare('SELECT id, name, is_general FROM journals WHERE is_general = 1').get() };
}

// General first, then the owner's own in the order they were made, each with how many
// entries it holds.
export function listJournals(db) {
  return plain(db.prepare(`SELECT j.id, j.name, j.is_general,
      (SELECT count(*) FROM journal_entries e WHERE e.journal_id = j.id AND e.deleted_at IS NULL) AS entry_count
    FROM journals j WHERE j.deleted_at IS NULL ORDER BY j.is_general DESC, j.created_at, j.rowid`).all());
}

function activeJournal(db, id) {
  const journal = db.prepare('SELECT id, name, is_general FROM journals WHERE id = ? AND deleted_at IS NULL').get(id);
  return journal ? { ...journal } : null;
}

export function createJournal(db, name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) throw fail(400, 'A journal needs a name.');
  if (clean.length > MAX_JOURNAL_NAME_LENGTH) throw fail(400, `A journal name is at most ${MAX_JOURNAL_NAME_LENGTH} characters.`);
  if (db.prepare('SELECT 1 FROM journals WHERE deleted_at IS NULL AND lower(name) = lower(?)').get(clean)) {
    throw fail(409, `There is already a journal called “${clean}”.`);
  }
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO journals (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)').run(id, time, time, clean);
  return activeJournal(db, id);
}

// Deleting a journal moves every entry in it (deleted ones too) to General, so no entry
// is ever lost with it. General itself can't be deleted.
export function deleteJournal(db, id) {
  const journal = activeJournal(db, id);
  if (!journal) return null;
  if (journal.is_general) throw fail(400, 'General is always there and can’t be deleted.');
  const general = generalJournal(db);
  const time = now();
  db.exec('BEGIN');
  try {
    const moved = db.prepare('UPDATE journal_entries SET journal_id = ?, updated_at = ? WHERE journal_id = ?')
      .run(general.id, time, id).changes;
    db.prepare('UPDATE journals SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, id);
    db.exec('COMMIT');
    return { ...journal, moved, moved_to: general.id };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---- Entries ----

const ENTRY_COLUMNS = `e.id, e.journal_id, j.name AS journal_name, e.day, e.written_at, e.title,
  substr(e.body, 1, ${PREVIEW_LENGTH}) AS preview, e.origin, e.created_at, e.updated_at, e.deleted_at`;
const FROM_ENTRIES = 'FROM journal_entries e JOIN journals j ON j.id = e.journal_id';

// Checks what the page sent for an entry. Returns what is wrong, or null.
export function checkEntryInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  for (const [field, max] of [['title', MAX_TITLE_LENGTH], ['body', MAX_BODY_LENGTH]]) {
    if (field in input && typeof input[field] !== 'string') return `${field} must be text.`;
    if (typeof input[field] === 'string' && input[field].length > max) return `${field} is longer than ${max} characters.`;
  }
  if ('journal_id' in input && typeof input.journal_id !== 'string') return 'journal_id must be text.';
  if ('day' in input && !isDay(input.day)) return 'day must be a date like 2026-10-25.';
  return null;
}

// A new entry: in the chosen journal (General when none is chosen), on the chosen day
// (today when none is chosen), written now.
export function createEntry(db, { journal_id, day = localDay(), title = '', body = '', origin = 'typed', capture_id = null } = {}) {
  const journal = journal_id ? activeJournal(db, journal_id) : generalJournal(db);
  if (!journal) throw fail(400, 'There is no such journal.');
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO journal_entries (id, created_at, updated_at, origin, capture_id, journal_id, day, written_at, title, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, origin, capture_id, journal.id, day, time, title, body);
  syncLinks(db, 'entry', id, body);
  syncTasks(db, 'entry', id, body);
  return getEntry(db, id);
}

export function getEntry(db, id, { deleted = false } = {}) {
  const entry = db.prepare(`SELECT e.id, e.journal_id, j.name AS journal_name, e.day, e.written_at, e.title, e.body,
      e.origin, e.capture_id, e.created_at, e.updated_at, e.deleted_at ${FROM_ENTRIES}
    WHERE e.id = ? ${deleted ? '' : 'AND e.deleted_at IS NULL'}`).get(id);
  return entry ? { ...entry } : null;
}

const inJournal = (journalId) => (journalId ? 'AND e.journal_id = ?' : '');
const withJournal = (args, journalId) => (journalId ? [...args, journalId] : args);

// One day's entries, in the order they were written.
export function entriesOfDay(db, day, { journalId } = {}) {
  return plain(db.prepare(`SELECT ${ENTRY_COLUMNS} ${FROM_ENTRIES}
    WHERE e.day = ? AND e.deleted_at IS NULL ${inJournal(journalId)}
    ORDER BY e.written_at, e.rowid`).all(...withJournal([day], journalId)));
}

// Entries from the days before `day`, newest first.
export function entriesBefore(db, day, { journalId, limit = 30 } = {}) {
  return plain(db.prepare(`SELECT ${ENTRY_COLUMNS} ${FROM_ENTRIES}
    WHERE e.day < ? AND e.deleted_at IS NULL ${inJournal(journalId)}
    ORDER BY e.day DESC, e.written_at DESC, e.rowid DESC LIMIT ?`).all(...withJournal([day], journalId), limit));
}

// The days from `from` to `to` (both included) that have entries, with how many.
export function entryDays(db, from, to, { journalId } = {}) {
  return plain(db.prepare(`SELECT e.day, count(*) AS count ${FROM_ENTRIES}
    WHERE e.day >= ? AND e.day <= ? AND e.deleted_at IS NULL ${inJournal(journalId)}
    GROUP BY e.day ORDER BY e.day`).all(...withJournal([from, to], journalId)));
}

// Changes the title, text and/or journal. The edited time moves only when something changed.
export function updateEntry(db, id, { title, body, journal_id }) {
  const entry = getEntry(db, id);
  if (!entry) return null;
  if (journal_id !== undefined && journal_id !== entry.journal_id && !activeJournal(db, journal_id)) {
    throw fail(400, 'There is no such journal.');
  }
  const next = { title: title ?? entry.title, body: body ?? entry.body, journal_id: journal_id ?? entry.journal_id };
  if (next.title === entry.title && next.body === entry.body && next.journal_id === entry.journal_id) return entry;
  db.prepare('UPDATE journal_entries SET title = ?, body = ?, journal_id = ?, updated_at = ? WHERE id = ?')
    .run(next.title, next.body, next.journal_id, now(), id);
  if (next.body !== entry.body) {
    syncLinks(db, 'entry', id, next.body);
    syncTasks(db, 'entry', id, next.body);
  }
  return getEntry(db, id);
}

export function deleteEntry(db, id) {
  const entry = getEntry(db, id, { deleted: true });
  if (!entry) return null;
  if (entry.deleted_at) return entry;
  db.prepare('UPDATE journal_entries SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getEntry(db, id, { deleted: true });
}

export function restoreEntry(db, id) {
  const entry = getEntry(db, id, { deleted: true });
  if (!entry) return null;
  db.prepare('UPDATE journal_entries SET deleted_at = NULL WHERE id = ?').run(id);
  return getEntry(db, id);
}

export function listDeletedEntries(db) {
  return plain(db.prepare(`SELECT ${ENTRY_COLUMNS} ${FROM_ENTRIES}
    WHERE e.deleted_at IS NOT NULL ORDER BY e.deleted_at DESC, e.rowid DESC`).all());
}

// Search entries by any word, best match first; deleted entries are left out.
export function searchEntries(db, text) {
  const query = searchQuery(text);
  if (!query) return [];
  return plain(db.prepare(`SELECT ${ENTRY_COLUMNS}
    FROM entries_search s JOIN journal_entries e ON e.id = s.id JOIN journals j ON j.id = e.journal_id
    WHERE entries_search MATCH ? AND e.deleted_at IS NULL
    ORDER BY bm25(entries_search, 0, 10, 1), e.day DESC, e.written_at DESC`).all(query));
}
