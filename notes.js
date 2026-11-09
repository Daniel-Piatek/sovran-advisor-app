// Notes in the database: every note is one row in the notes table (schema.sql).
// A note keeps its title, its text (Markdown), where it came from, when it was created
// and last edited, and its one home in My Life (home_id, a My Life item), if it has one. Deleting only sets deleted_at: a note is never really removed,
// and nothing clears deleted notes on its own.

import { randomUUID } from 'node:crypto';
import { syncLinks } from './links.js';
import { syncBlocksIfOn } from './blocks.js';
import { writeVersion } from './versions.js';
import { syncTasks } from './tasks.js';

export const PREVIEW_LENGTH = 280;
export const MAX_TITLE_LENGTH = 1_000;
export const MAX_BODY_LENGTH = 1_000_000;
export const ORIGINS = ['typed', 'captured', 'imported', 'assistant'];

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

const LIST_COLUMNS = `id, title, substr(body, 1, ${PREVIEW_LENGTH}) AS preview, origin, created_at, updated_at, deleted_at`;
const plain = (rows) => rows.map((row) => ({ ...row }));

// Checks a title and text sent by the page. Returns what is wrong, or null.
export function checkNoteInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  for (const [field, max] of [['title', MAX_TITLE_LENGTH], ['body', MAX_BODY_LENGTH]]) {
    if (field in input && typeof input[field] !== 'string') return `${field} must be text.`;
    if (typeof input[field] === 'string' && input[field].length > max) return `${field} is longer than ${max} characters.`;
  }
  if ('home_id' in input && input.home_id !== null && typeof input.home_id !== 'string') return 'home_id must be an id.';
  if ('base_version' in input && input.base_version !== null && !Number.isInteger(input.base_version)) return 'base_version is the number of the version the text started from.';
  return null;
}

export function createNote(db, { title = '', body = '', origin = 'typed', capture_id = null } = {}) {
  if (!ORIGINS.includes(origin)) throw new Error(`Unknown origin: ${origin}`);
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO notes (id, title, body, origin, capture_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, title, body, origin, capture_id, time, time);
  syncLinks(db, 'note', id, body);
  syncTasks(db, 'note', id, body);
  syncBlocksIfOn(db, id, body);
  writeVersion(db, id, { title, body, author: origin === 'assistant' ? 'assistant' : 'me' });
  return getNote(db, id);
}

// One note, with its home (null when it has none, or its home was deleted). A deleted
// note is only found when asked for with { deleted: true }.
export function getNote(db, id, { deleted = false } = {}) {
  const note = db.prepare(`SELECT n.id, n.title, n.body, n.origin, n.capture_id, n.home_id, n.created_at, n.updated_at, n.source_key,
      n.deleted_at, h.title AS home_title, h.kind AS home_kind, h.state AS home_state
    FROM notes n LEFT JOIN life_items h ON h.id = n.home_id AND h.deleted_at IS NULL
    WHERE n.id = ? ${deleted ? '' : 'AND n.deleted_at IS NULL'}`).get(id);
  if (!note) return null;
  const { home_title: title, home_kind: kind, home_state: state, source_key: sourceKey, ...rest } = note;
  return { ...rest, ...(sourceKey ? { source_key: sourceKey } : {}), home: kind ? { id: note.home_id, title, kind, state } : null };
}

// The notes at home in a My Life item, newest first, a page at a time. A Key Element's
// list also holds the notes at home in the Goals, Projects and Topics under it (only a
// Key Element is a home for other items). Each note says which home it is in.
export function notesAtHome(db, homeId, { limit = 20, offset = 0 } = {}) {
  const homes = `n.home_id IN (SELECT id FROM life_items WHERE deleted_at IS NULL AND (id = ?1 OR home_id = ?1))`;
  const { n: total } = db.prepare(`SELECT count(*) AS n FROM notes n WHERE ${homes} AND n.deleted_at IS NULL`).get(homeId);
  const notes = db.prepare(`SELECT n.id, n.title, substr(n.body, 1, ${PREVIEW_LENGTH}) AS preview, n.origin, n.created_at, n.updated_at, n.deleted_at,
      h.id AS home_id, h.title AS home_title, h.kind AS home_kind
    FROM notes n JOIN life_items h ON h.id = n.home_id
    WHERE ${homes} AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC, n.created_at DESC, n.rowid DESC LIMIT ?2 OFFSET ?3`).all(homeId, limit, offset)
    .map(({ home_id: id, home_title: title, home_kind: kind, ...note }) => ({ ...note, home: { id, title, kind } }));
  return { total, notes };
}

// Last edited first: what was worked on most recently comes first.
export function listNotes(db) {
  return plain(db.prepare(`SELECT ${LIST_COLUMNS} FROM notes
    WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC, rowid DESC`).all());
}

// Recently deleted: most recently deleted first.
export function listDeletedNotes(db) {
  return plain(db.prepare(`SELECT ${LIST_COLUMNS} FROM notes
    WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid DESC`).all());
}

// Turns what was typed into a full-text query: every word must be in the title or the
// text, and the last letters of each may still be missing ("harb" finds "harbour").
// Returns null when there is no word to look for.
export function searchQuery(text) {
  const words = text.match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((word) => `"${word}"*`).join(' ') : null;
}

// Search by any word, best match first (a word in the title counts more). Deleted notes
// are left out.
export function searchNotes(db, text) {
  const query = searchQuery(text);
  if (!query) return listNotes(db);
  return plain(db.prepare(`SELECT notes.id, notes.title, substr(notes.body, 1, ${PREVIEW_LENGTH}) AS preview,
      notes.origin, notes.created_at, notes.updated_at, notes.deleted_at
    FROM notes_search JOIN notes ON notes.id = notes_search.id
    WHERE notes_search MATCH ? AND notes.deleted_at IS NULL
    ORDER BY bm25(notes_search, 0, 10, 1), notes.updated_at DESC`).all(query));
}

// Changes the title, the text and/or the home (null: no home). The edited time moves
// only when something changed.
export function updateNote(db, id, { title, body, home_id: homeId, author = 'me', label = '' }) {
  const note = getNote(db, id);
  if (!note) return null;
  const next = { title: title ?? note.title, body: body ?? note.body, home_id: homeId === undefined ? note.home_id : homeId || null };
  if (next.home_id !== note.home_id && next.home_id
    && !db.prepare('SELECT 1 FROM life_items WHERE id = ? AND deleted_at IS NULL').get(next.home_id)) {
    throw fail(400, 'That home is not in My Life.');
  }
  if (next.title === note.title && next.body === note.body && next.home_id === note.home_id) return note;
  db.exec('SAVEPOINT save_note'); // the note and its version are one step
  try {
    db.prepare('UPDATE notes SET title = ?, body = ?, home_id = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.body, next.home_id, now(), id);
    if (next.body !== note.body) {
      syncLinks(db, 'note', id, next.body);
      syncTasks(db, 'note', id, next.body);
      syncBlocksIfOn(db, id, next.body);
    }
    if (next.body !== note.body || next.title !== note.title) writeVersion(db, id, { title: next.title, body: next.body, author, label });
    db.exec('RELEASE save_note');
  } catch (err) { db.exec('ROLLBACK TO save_note'); db.exec('RELEASE save_note'); throw err; }
  return getNote(db, id);
}

// Sets a note's text directly (quick capture adding to a note, and its Undo).
export function setNoteBody(db, id, body) {
  db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, now(), id);
  syncLinks(db, 'note', id, body);
  syncTasks(db, 'note', id, body);
  syncBlocksIfOn(db, id, body);
  const note = db.prepare('SELECT title FROM notes WHERE id = ?').get(id);
  writeVersion(db, id, { title: note?.title ?? '', body });
}

// Deleting only marks the note. It leaves the list and search, and waits in
// Recently deleted until it is restored.
export function deleteNote(db, id) {
  const note = getNote(db, id, { deleted: true });
  if (!note) return null;
  if (note.deleted_at) return note;
  db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getNote(db, id, { deleted: true });
}

// Brings a deleted note back, exactly as it was.
export function restoreNote(db, id) {
  const note = getNote(db, id, { deleted: true });
  if (!note) return null;
  db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id);
  return getNote(db, id);
}
