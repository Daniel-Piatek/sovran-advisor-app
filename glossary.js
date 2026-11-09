// The glossary (the Voice module, advanced/voice/2): your names and terms, given to the speech to
// text with every dictation, and learned from the corrections you make.
//   hint  a word the engine should expect ("Lena Fischer" is a name). Every person and every
//         company of the app is a hint from the start (seeded from People), and a new one is one more.
//   fix   a rewrite of what it keeps getting wrong: heard_as "North light" is written "Nordlicht".
//         Every fix is a hint too.
// Deleting only sets deleted_at (Undo brings it back); a seeded hint you removed stays removed.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const MAX_TERM = 80;
export const MAX_KEYTERMS = 100;
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// Every person and every company becomes a hint, once (a hint you removed does not come back).
export function seedGlossary(db) {
  const time = now();
  for (const [table, source] of [['people', 'person'], ['companies', 'company']]) {
    db.prepare(`INSERT OR IGNORE INTO glossary (id, created_at, updated_at, origin, term, heard_as, kind, source, source_id)
      SELECT lower(hex(randomblob(16))), ?, ?, 'imported', trim(t.name), '', 'hint', ?, t.id FROM ${table} t
      WHERE t.deleted_at IS NULL AND trim(t.name) <> '' AND length(trim(t.name)) <= ${MAX_TERM}
        AND NOT EXISTS (SELECT 1 FROM glossary g WHERE g.source = ? AND g.source_id = t.id)`).run(time, time, source, source);
  }
}

const rowOf = (r) => ({ id: r.id, term: r.term, heard_as: r.heard_as, kind: r.kind, source: r.source, created_at: r.created_at });
// A seeded hint shows while its person or company is still there.
const LIVE = `g.deleted_at IS NULL AND (g.source NOT IN ('person', 'company')
  OR (g.source = 'person' AND EXISTS (SELECT 1 FROM people p WHERE p.id = g.source_id AND p.deleted_at IS NULL))
  OR (g.source = 'company' AND EXISTS (SELECT 1 FROM companies c WHERE c.id = g.source_id AND c.deleted_at IS NULL)))`;

// Fixes first, then what you added, then People and companies; q narrows by what it says.
export function listGlossary(db, { q = '', limit = 300 } = {}) {
  seedGlossary(db);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const like = (w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = [LIVE, ...words.map(() => "(lower(g.term) LIKE ? ESCAPE '\\' OR lower(g.heard_as) LIKE ? ESCAPE '\\')")];
  const rows = db.prepare(`SELECT g.* FROM glossary g WHERE ${where.join(' AND ')}
    ORDER BY (g.kind = 'fix') DESC, (g.source IN ('person', 'company')), g.term COLLATE NOCASE LIMIT ?`)
    .all(...words.flatMap((w) => [like(w), like(w)]), Math.max(1, Math.min(1000, Math.trunc(limit) || 300)));
  return rows.map(rowOf);
}

export function checkGlossaryInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  const term = clean(input.term);
  if (!term) return 'A term needs its spelling.';
  if (term.length > MAX_TERM) return `The term is longer than ${MAX_TERM} characters.`;
  if ('heard_as' in input && typeof input.heard_as !== 'string') return 'heard_as is text.';
  const heard = clean(input.heard_as);
  if (heard.length > MAX_TERM) return `heard_as is longer than ${MAX_TERM} characters.`;
  if (heard && heard.toLowerCase() === term.toLowerCase() && heard === term) return 'Heard as and written as are the same.';
  return null;
}

// Adds a hint (no heard_as) or a fix; `source` is typed (you added it) or learned (from a correction).
export function addGlossary(db, { term, heard_as = '' }, { source = 'typed' } = {}) {
  const problem = checkGlossaryInput({ term, heard_as });
  if (problem) throw fail(400, problem);
  const [t, h] = [clean(term), clean(heard_as)];
  const had = db.prepare('SELECT * FROM glossary WHERE lower(term) = lower(?) AND lower(heard_as) = lower(?) AND deleted_at IS NULL').get(t, h);
  if (had) return rowOf(had);
  const id = randomUUID();
  const time = now();
  db.prepare("INSERT INTO glossary (id, created_at, updated_at, origin, term, heard_as, kind, source) VALUES (?, ?, ?, 'typed', ?, ?, ?, ?)")
    .run(id, time, time, t, h, h ? 'fix' : 'hint', source);
  return rowOf(db.prepare('SELECT * FROM glossary WHERE id = ?').get(id));
}

export function deleteGlossary(db, id) {
  const row = db.prepare('SELECT * FROM glossary WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('UPDATE glossary SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return rowOf(row);
}

export function restoreGlossary(db, id) {
  const row = db.prepare('SELECT * FROM glossary WHERE id = ?').get(id);
  if (!row) return null;
  // A twin made since would clash: the restored one then stays out.
  const twin = db.prepare('SELECT id FROM glossary WHERE lower(term) = lower(?) AND lower(heard_as) = lower(?) AND deleted_at IS NULL AND id <> ?').get(row.term, row.heard_as, id);
  if (twin) throw fail(409, 'The glossary already has that.');
  db.prepare('UPDATE glossary SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return rowOf(row);
}

// What goes to the speech to text with a dictation: the written forms (fixes and what you added
// first, then People and companies), each once, at most MAX_KEYTERMS.
export function keyterms(db) {
  const seen = new Set();
  const terms = [];
  for (const r of listGlossary(db, { limit: 1000 })) {
    const key = r.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(r.term);
    if (terms.length >= MAX_KEYTERMS) break;
  }
  return terms;
}

export const fixes = (db) => listGlossary(db, { limit: 1000 }).filter((r) => r.kind === 'fix').map((r) => ({ heard_as: r.heard_as, term: r.term }));

// What a dictation says after the fixes: the same rule the page uses (public/glossary-learn.js).
export { applyFixes } from './public/glossary-learn.js';
