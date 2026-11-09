// Links between pages (schema.sql, table links). A link is written in a page's Markdown
// as [words](/notes/<id>), [words](/journal/entries/<id>), [words](/journal/YYYY-MM-DD),
// [words](/people/<id>), [words](/companies/<id>) (a mention), [words](/life/<id>) (a My
// Life item) or [words](/calendar/events/<id>) (an event); its rows are made again from
// the text on every save.

import { randomUUID } from 'node:crypto';
import { searchQuery } from './notes.js';

const LINK = /\[((?:\\.|[^\]\\])*)\]\((\/notes\/([0-9a-f-]{36})|\/journal\/entries\/([0-9a-f-]{36})|\/journal\/(\d{4}-\d{2}-\d{2})|\/people\/([0-9a-f-]{36})|\/companies\/([0-9a-f-]{36})|\/life\/([0-9a-f-]{36})|\/calendar\/events\/([0-9a-f-]{36}))(?:\s+"[^"]*")?\)/g;
const MAX_CONTEXT = 240;

// A link to one bullet of a note (Writing 2): ((bullet id)).
const BLOCK_REF = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/g;

const unescape = (text) => text.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1');

// Markdown made into plain words, keeping the words of links.
export function plainWords(markdown) {
  return markdown
    .replace(BLOCK_REF, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, (_, words) => unescape(words))
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|`)(?=\S)([^*_`]*?\S)\1/g, '$2')
    .replace(/\\\n/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1');
}

// The sentence around position `at` of a line (both in plain words).
function sentenceAround(line, at) {
  const starts = [...line.slice(0, at).matchAll(/[.!?]\s+/g)];
  const start = starts.length ? starts.at(-1).index + starts.at(-1)[0].length : 0;
  const end = line.slice(at).search(/[.!?](\s|$)/);
  const sentence = line.slice(start, end === -1 ? line.length : at + end + 1).trim();
  return sentence.length > MAX_CONTEXT ? `${sentence.slice(0, MAX_CONTEXT - 1)}…` : sentence;
}

// Every link in a text: what it points at, its words and the sentence around it.
export function extractLinks(markdown) {
  const found = [];
  for (const line of markdown.split('\n')) {
    for (const match of line.matchAll(BLOCK_REF)) {
      found.push({ to_kind: 'block', to_id: match[1], link_text: '', context: sentenceAround(plainWords(line), 0) });
    }
    for (const match of line.matchAll(LINK)) {
      const [, words, , noteId, entryId, day, personId, companyId, lifeId, eventId] = match;
      const plainBefore = plainWords(line.slice(0, match.index));
      found.push({
        to_kind: noteId ? 'note' : entryId ? 'entry' : day ? 'day' : personId ? 'person' : companyId ? 'company' : lifeId ? 'life' : 'event',
        to_id: noteId ?? entryId ?? day ?? personId ?? companyId ?? lifeId ?? eventId,
        link_text: unescape(words),
        context: sentenceAround(plainWords(line), plainBefore.length),
      });
    }
  }
  return found;
}

// Makes a page's link rows again from its text.
export function syncLinks(db, fromKind, fromId, markdown) {
  db.prepare('DELETE FROM links WHERE from_kind = ? AND from_id = ?').run(fromKind, fromId);
  const time = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id, link_text, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const bullet = db.prepare('SELECT b.text, b.note_id FROM bullets b JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL WHERE b.id = ? AND b.deleted_at IS NULL');
  const insertBlock = db.prepare(`INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id, link_text, context, target_block_id)
    VALUES (?, ?, ?, ?, ?, 'note', ?, ?, ?, ?)`);
  const seen = new Set();
  for (const link of extractLinks(markdown)) {
    if (link.to_kind === 'block') { // a bullet's address: the row says which note it lives in, and keeps the bullet
      const target = bullet.get(link.to_id);
      if (!target || (fromKind === 'note' && target.note_id === fromId) || seen.has(link.to_id)) continue;
      seen.add(link.to_id);
      insertBlock.run(randomUUID(), time, time, fromKind, fromId, target.note_id, target.text, link.context, link.to_id);
      continue;
    }
    if (link.to_kind === fromKind && link.to_id === fromId) continue; // a page linking to itself
    insert.run(randomUUID(), time, time, fromKind, fromId, link.to_kind, link.to_id, link.link_text, link.context);
  }
}

// Rebuilds every page's links (for a database from before links existed).
export function syncAllLinks(db) {
  for (const note of db.prepare('SELECT id, body FROM notes').all()) syncLinks(db, 'note', note.id, note.body);
  for (const entry of db.prepare('SELECT id, body FROM journal_entries').all()) syncLinks(db, 'entry', entry.id, entry.body);
  for (const person of db.prepare('SELECT id, body FROM people').all()) syncLinks(db, 'person', person.id, person.body);
  for (const company of db.prepare('SELECT id, body FROM companies').all()) syncLinks(db, 'company', company.id, company.body);
  for (const item of db.prepare('SELECT id, body FROM life_items').all()) syncLinks(db, 'life', item.id, item.body);
}

const firstLine = (markdown) => plainWords(markdown).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
const entryLabel = (entry) => entry.title.trim() || firstLine(entry.body) || 'Untitled entry';

// "Linked from": the pages that link to this one, newest first, with the sentence around
// each link. Deleted pages are left out.
export function linkedFrom(db, toKind, toId) {
  const rows = db.prepare(`SELECT l.from_kind, l.from_id, l.link_text, l.context,
      n.title AS note_title, n.updated_at AS note_updated,
      e.title AS entry_title, e.body AS entry_body, e.day AS entry_day, e.written_at AS entry_written,
      p.name AS person_name, c.name AS company_name, li.title AS life_title, li.kind AS life_kind,
      tk.text AS task_text, tk.updated_at AS task_updated, coalesce(ev.title, ge.title) AS event_title, coalesce(ev.starts_at, ge.starts_at) AS event_starts, coalesce(ev.updated_at, ge.updated_at) AS event_updated
    FROM links l
    LEFT JOIN notes n ON l.from_kind = 'note' AND n.id = l.from_id AND n.deleted_at IS NULL
    LEFT JOIN journal_entries e ON l.from_kind = 'entry' AND e.id = l.from_id AND e.deleted_at IS NULL
    LEFT JOIN people p ON l.from_kind = 'person' AND p.id = l.from_id AND p.deleted_at IS NULL
    LEFT JOIN companies c ON l.from_kind = 'company' AND c.id = l.from_id AND c.deleted_at IS NULL
    LEFT JOIN life_items li ON l.from_kind = 'life' AND li.id = l.from_id AND li.deleted_at IS NULL
    LEFT JOIN tasks tk ON l.from_kind = 'task' AND tk.id = l.from_id AND tk.deleted_at IS NULL
    LEFT JOIN events ev ON l.from_kind = 'event' AND ev.id = l.from_id AND ev.deleted_at IS NULL
    LEFT JOIN google_events ge ON l.from_kind = 'event' AND ge.id = l.from_id AND ge.deleted_at IS NULL
    WHERE l.to_kind = ? AND l.to_id = ? AND coalesce(n.id, e.id, p.id, c.id, li.id, tk.id, ev.id, ge.id) IS NOT NULL
    ORDER BY coalesce(n.updated_at, e.written_at, p.updated_at, c.updated_at, li.updated_at, tk.updated_at, ev.updated_at) DESC, l.rowid`).all(toKind, toId);
  return rows.map((row) => (row.from_kind !== 'entry'
    ? {
      from_kind: row.from_kind, from_id: row.from_id, link_text: row.link_text, context: row.context,
      label: (row.note_title ?? row.person_name ?? row.company_name ?? row.life_title ?? row.task_text ?? row.event_title ?? '').trim() || 'Untitled',
      ...(row.event_starts ? { starts_at: row.event_starts } : {}),
      ...(row.life_kind ? { life_kind: row.life_kind } : {}),
    }
    : {
      from_kind: 'entry', from_id: row.from_id, day: row.entry_day, written_at: row.entry_written, title: row.entry_title.trim(),
      label: entryLabel({ title: row.entry_title, body: row.entry_body }), link_text: row.link_text, context: row.context,
    }));
}

// What a link shows: the page's current name, so a rename shows everywhere at once.
export function linkTarget(db, kind, id) {
  if (kind === 'note') {
    const note = db.prepare('SELECT title FROM notes WHERE id = ? AND deleted_at IS NULL').get(id);
    return note ? { exists: true, title: note.title.trim() || 'Untitled' } : { exists: false };
  }
  if (kind === 'entry') {
    const entry = db.prepare('SELECT title, body, day FROM journal_entries WHERE id = ? AND deleted_at IS NULL').get(id);
    return entry ? { exists: true, title: entryLabel(entry), day: entry.day } : { exists: false };
  }
  if (kind === 'day') return { exists: /^\d{4}-\d{2}-\d{2}$/.test(id), day: id };
  if (kind === 'person' || kind === 'company') {
    const row = db.prepare(`SELECT name FROM ${kind === 'person' ? 'people' : 'companies'} WHERE id = ? AND deleted_at IS NULL`).get(id);
    return row ? { exists: true, title: row.name } : { exists: false };
  }
  if (kind === 'life') {
    const row = db.prepare('SELECT title, kind FROM life_items WHERE id = ? AND deleted_at IS NULL').get(id);
    return row ? { exists: true, title: row.title, life_kind: row.kind } : { exists: false };
  }
  if (kind === 'event') {
    const row = db.prepare('SELECT title, starts_at FROM events WHERE id = ? AND deleted_at IS NULL').get(id)
      ?? db.prepare('SELECT title, starts_at FROM event_refs WHERE id = ? AND deleted_at IS NULL').get(id)
      ?? db.prepare('SELECT title, starts_at FROM google_events WHERE id = ? AND deleted_at IS NULL').get(id);
    return row ? { exists: true, title: row.title, starts_at: row.starts_at } : { exists: false };
  }
  return { exists: false };
}

// People, companies or My Life items whose name starts a word with what was typed.
function namesLike(db, table, typed, limit) {
  const rows = table === 'life_items'
    ? db.prepare(`SELECT id, title AS name, kind FROM life_items WHERE deleted_at IS NULL
        ORDER BY state = 'archived', title COLLATE NOCASE`).all()
    : db.prepare(`SELECT id, name FROM ${table} WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all();
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const fits = (name) => words.every((word) => name.toLowerCase().split(/[\s.-]+/).some((part) => part.startsWith(word)));
  return rows.filter((row) => fits(row.name)).slice(0, limit);
}

// Pages to link to, for what was typed after [[: people, companies and My Life items whose
// name fits, notes (best title match first), journal entries, and journal days for "today",
// "yesterday", "tomorrow" or a date (YYYY-MM-DD). With `only` ('person' or 'company', as
// for @ and @@), just those.
export function suggestLinks(db, text, { today, only } = {}) {
  const typed = text.trim();
  const found = [];
  if (only !== 'company') for (const p of namesLike(db, 'people', typed, only ? 8 : 3)) found.push({ kind: 'person', id: p.id, label: p.name });
  if (only !== 'person') for (const c of namesLike(db, 'companies', typed, only ? 8 : 2)) found.push({ kind: 'company', id: c.id, label: c.name });
  if (only) return found;
  for (const item of namesLike(db, 'life_items', typed, 3)) found.push({ kind: 'life', id: item.id, label: item.name, life_kind: item.kind });
  if (!typed) found.length = 0; // nothing typed: recent notes, not the whole address book
  const shift = (n) => {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(y, m - 1, d + n);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const days = { today: 0, yesterday: -1, tomorrow: 1 };
  for (const [word, n] of Object.entries(days)) {
    if (typed && word.startsWith(typed.toLowerCase())) found.push({ kind: 'day', id: shift(n), label: word[0].toUpperCase() + word.slice(1) });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(typed)) found.push({ kind: 'day', id: typed, label: typed });

  const query = searchQuery(typed);
  const notes = query
    ? db.prepare(`SELECT n.id, n.title FROM notes_search s JOIN notes n ON n.id = s.id
        WHERE notes_search MATCH ? AND n.deleted_at IS NULL ORDER BY bm25(notes_search, 0, 20, 1), n.updated_at DESC LIMIT 6`).all(query)
    : db.prepare('SELECT id, title FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6').all();
  for (const note of notes) found.push({ kind: 'note', id: note.id, label: note.title.trim() || 'Untitled' });

  const entries = query
    ? db.prepare(`SELECT e.id, e.title, e.body, e.day FROM entries_search s JOIN journal_entries e ON e.id = s.id
        WHERE entries_search MATCH ? AND e.deleted_at IS NULL ORDER BY bm25(entries_search, 0, 20, 1), e.day DESC LIMIT 4`).all(query)
    : [];
  for (const entry of entries) found.push({ kind: 'entry', id: entry.id, label: entryLabel(entry), day: entry.day });
  return found;
}
