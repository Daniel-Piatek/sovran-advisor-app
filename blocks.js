// Bullets (advanced/writing/1): the list items of a note as rows with a parent and a position. The note's Markdown stays the one truth, so
// search, links and the assistant's read_note work unchanged; the rows are made again from the text on every save, and a bullet that was
// only edited or moved keeps its id (what later lessons point at). Folding lives here, never in the text, so it is never an edit.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const ITEM = /^( *)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK = /^\[[ xX]\](?: |$)/;
const MAX_TEXT = 2000;

// The list items of a text, in reading order: { ord, depth, position, parent (an ord or null), text }.
export function parseOutline(markdown) {
  const items = [];
  const stack = []; // the open bullets: the last ord at each depth
  const siblings = new Map(); // parent ord (or -1) → how many so far
  let fenced = false;
  for (const line of String(markdown ?? '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = ITEM.exec(line);
    if (!match) { if (line.trim() === '') continue; if (!/^ {2,}\S/.test(line)) { stack.length = 0; siblings.clear(); } continue; } // a line of something else ends the list
    const depth = Math.min(Math.floor(match[1].length / 2), stack.length); // never deeper than one below the bullet above
    stack.length = depth;
    const parent = depth ? stack[depth - 1] : null;
    const key = parent ?? -1;
    const position = siblings.get(key) ?? 0;
    siblings.set(key, position + 1);
    const ord = items.length;
    items.push({ ord, depth, position, parent, text: match[2].replace(TASK, '').trim().slice(0, MAX_TEXT) });
    stack.push(ord);
  }
  return items;
}

const shape = (r, children) => ({ id: r.id, note_id: r.note_id, parent_id: r.parent_id, position: r.position, ord: r.ord, depth: r.depth, text: r.text, folded: r.folded === 1, children });

// Makes a note's bullet rows again from its text. An unchanged bullet keeps its row, an edited or moved one is found by its place or its
// words, so its id (and whether it is folded) stays.
export function syncBlocks(db, noteId, markdown) {
  const items = parseOutline(markdown);
  const old = db.prepare('SELECT * FROM bullets WHERE note_id = ? AND deleted_at IS NULL ORDER BY ord').all(noteId);
  const taken = new Set();
  const match = new Array(items.length).fill(null);
  const pathOf = (list, i) => { const parts = []; for (let p = list[i].parent ?? null; p !== null; p = list[p].parent ?? null) parts.unshift(list[p].text); return parts.join('\u0001'); };
  const oldItems = old.map((r) => ({ ...r, parent: r.parent_id ? old.findIndex((o) => o.id === r.parent_id) : null }));
  const oldPaths = oldItems.map((_, i) => pathOf(oldItems, i));
  const newPaths = items.map((_, i) => pathOf(items, i));
  // 1. the same words under the same parents; 2. the same words anywhere at the same depth; 3. the same place with other words (an edit)
  for (const [same] of [
    [(o, i) => oldItems[o].text === items[i].text && oldPaths[o] === newPaths[i] && oldItems[o].depth === items[i].depth],
    [(o, i) => oldItems[o].text === items[i].text && oldItems[o].depth === items[i].depth],
    [(o, i) => o === i && oldItems[o].depth === items[i].depth],
  ]) {
    for (let i = 0; i < items.length; i++) {
      if (match[i] !== null) continue;
      const o = oldItems.findIndex((_, k) => !taken.has(k) && same(k, i));
      if (o >= 0) { match[i] = o; taken.add(o); }
    }
  }
  const time = now();
  const ids = items.map((_, i) => (match[i] !== null ? oldItems[match[i]].id : randomUUID()));
  db.exec('SAVEPOINT bullets'); // a save may already be inside a transaction (a capture made into a note)
  try {
    const gone = db.prepare('UPDATE bullets SET deleted_at = ?, updated_at = ? WHERE id = ?');
    oldItems.forEach((o, k) => { if (!taken.has(k)) gone.run(time, time, o.id); });
    const insert = db.prepare('INSERT INTO bullets (id, created_at, updated_at, note_id, parent_id, position, ord, depth, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const update = db.prepare('UPDATE bullets SET parent_id = ?, position = ?, ord = ?, depth = ?, text = ?, updated_at = ? WHERE id = ?');
    // A moved bullet's old parent may not be written yet: parents are set after every row exists.
    items.forEach((it, i) => {
      if (match[i] === null) insert.run(ids[i], time, time, noteId, null, it.position, it.ord, it.depth, it.text);
      else {
        const o = oldItems[match[i]];
        if (o.position !== it.position || o.ord !== it.ord || o.depth !== it.depth || o.text !== it.text) update.run(o.parent_id, it.position, it.ord, it.depth, it.text, time, o.id);
      }
    });
    const parentSet = db.prepare('UPDATE bullets SET parent_id = ? WHERE id = ? AND parent_id IS NOT ?');
    items.forEach((it, i) => parentSet.run(it.parent === null ? null : ids[it.parent], ids[i], it.parent === null ? null : ids[it.parent]));
    db.exec('RELEASE bullets');
  } catch (err) { db.exec('ROLLBACK TO bullets'); db.exec('RELEASE bullets'); throw err; }
}

// A note's bullets, in reading order, with how many each has under it. null when the note is not there.
export function listBlocks(db, noteId) {
  const note = db.prepare('SELECT body FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) return null;
  syncBlocks(db, noteId, note.body); // the rows follow the text, also for a note written before this module was on
  const rows = db.prepare('SELECT * FROM bullets WHERE note_id = ? AND deleted_at IS NULL ORDER BY ord').all(noteId);
  const count = new Map();
  for (const r of rows) if (r.parent_id) count.set(r.parent_id, (count.get(r.parent_id) ?? 0) + 1);
  const used = new Map(db.prepare(`SELECT target_block_id AS id, count(DISTINCT from_kind || from_id) AS n FROM links WHERE target_block_id IN (SELECT id FROM bullets WHERE note_id = ? AND deleted_at IS NULL) GROUP BY target_block_id`).all(noteId).map((r) => [r.id, r.n]));
  return rows.map((r) => ({ ...shape(r, count.get(r.id) ?? 0), used_in: used.get(r.id) ?? 0 }));
}

export function getBlock(db, id) {
  const r = db.prepare('SELECT * FROM bullets WHERE id = ? AND deleted_at IS NULL').get(id);
  return r ? shape(r, db.prepare('SELECT count(*) AS n FROM bullets WHERE parent_id = ? AND deleted_at IS NULL').get(id).n) : null;
}

// Fold or open a bullet. It touches no note: the edited time stays.
export function setFolded(db, id, folded) {
  const block = getBlock(db, id);
  if (!block) return null;
  db.prepare('UPDATE bullets SET folded = ? WHERE id = ?').run(folded ? 1 : 0, id);
  return getBlock(db, id);
}

// Called when a note's text is saved: only while the module is on.
export const syncBlocksIfOn = (db, noteId, markdown) => { if (moduleOn(db, 'writing')) syncBlocks(db, noteId, markdown); };

// ---- Linking to a bullet (Writing 2) ----

// Notes written before the module was on have no bullet rows yet: they are made when a bullet is looked for.
function ensureBullets(db) {
  const rows = db.prepare(`SELECT n.id, n.body FROM notes n WHERE n.deleted_at IS NULL AND n.body GLOB '*[-*+] *'
    AND NOT EXISTS (SELECT 1 FROM bullets b WHERE b.note_id = n.id) LIMIT 500`).all();
  for (const row of rows) syncBlocks(db, row.id, row.body);
}

const like = (text) => `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;

// Bullets of any note whose words contain what was typed, newest note first (for the (( menu).
export function searchBullets(db, query, { limit = 8 } = {}) {
  ensureBullets(db);
  const rows = db.prepare(`SELECT b.id, b.text, b.note_id, n.title AS note_title FROM bullets b JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL
    WHERE b.deleted_at IS NULL AND b.text <> '' AND b.text LIKE ? ESCAPE '\\' ORDER BY n.updated_at DESC, b.ord LIMIT ?`).all(like(query.trim()), limit);
  return rows.map((r) => ({ id: r.id, text: r.text, note_id: r.note_id, note_title: r.note_title.trim() || 'Untitled' }));
}

// One bullet with everything under it, as the embed shows it. null when it is gone.
export function bulletDetail(db, id) {
  const b = db.prepare(`SELECT b.*, n.title AS note_title FROM bullets b JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL WHERE b.id = ? AND b.deleted_at IS NULL`).get(id);
  if (!b) return null;
  const rest = db.prepare('SELECT id, text, depth FROM bullets WHERE note_id = ? AND deleted_at IS NULL AND ord > ? ORDER BY ord').all(b.note_id, b.ord);
  const children = [];
  for (const r of rest) { if (r.depth <= b.depth) break; children.push({ id: r.id, text: r.text, depth: r.depth - b.depth - 1 }); }
  return { id: b.id, text: b.text, note_id: b.note_id, note_title: b.note_title.trim() || 'Untitled', children, used_in: usedIn(db, id).length };
}

// The pages that link to or show this bullet, once each.
export function usedIn(db, id) {
  const rows = db.prepare(`SELECT DISTINCT l.from_kind, l.from_id, n.title AS note_title, e.title AS entry_title, e.day AS entry_day FROM links l
    LEFT JOIN notes n ON l.from_kind = 'note' AND n.id = l.from_id AND n.deleted_at IS NULL
    LEFT JOIN journal_entries e ON l.from_kind = 'entry' AND e.id = l.from_id AND e.deleted_at IS NULL
    WHERE l.target_block_id = ? AND coalesce(n.id, e.id) IS NOT NULL`).all(id);
  return rows.map((r) => (r.from_kind === 'note'
    ? { kind: 'note', id: r.from_id, title: r.note_title.trim() || 'Untitled', path: `/notes/${r.from_id}` }
    : { kind: 'entry', id: r.from_id, title: r.entry_title.trim() || `Journal ${r.entry_day}`, path: `/journal/entries/${r.from_id}` }));
}
