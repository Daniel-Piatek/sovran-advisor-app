// Interactions (People in depth, advanced/people/4): a log line for what happened with
// someone outside the app: a kind (call, meeting, coffee, message, other), when, and one
// sentence. The row is in the interactions table; who it was with is a link row (links,
// from_kind 'interaction', to the person or company), so a page's Timeline and the big
// Timeline find it with no code of their own. Deleting only sets deleted_at; Undo brings it back.

import { randomUUID } from 'node:crypto';

export const INTERACTION_KINDS = ['call', 'meeting', 'coffee', 'message', 'other'];
export const MAX_NOTE = 500;

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const pad = (n) => String(n).padStart(2, '0');
const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localMinute = (date = new Date()) => `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const TABLES = { person: 'people', company: 'companies' };

// Checks what the page sent. `when` is a day (YYYY-MM-DD: today is now, any other day noon)
// or a time (YYYY-MM-DDTHH:MM); it can't be in the future: this is what happened.
export function checkInteractionInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  const about = input.about;
  if (!about || !TABLES[about.kind] || typeof about.id !== 'string') return 'about is { kind: person or company, id }.';
  if (!INTERACTION_KINDS.includes(input.kind)) return `kind is ${INTERACTION_KINDS.join(', ')}.`;
  if (typeof input.note !== 'string' || !input.note.trim()) return 'A log line needs a sentence.';
  if (input.note.length > MAX_NOTE) return `The sentence is longer than ${MAX_NOTE} characters.`;
  if ('when' in input && input.when !== '' && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(input.when))) return 'when is a day (YYYY-MM-DD) or a time (YYYY-MM-DDTHH:MM).';
  return null;
}

// The time a log line is kept at: a time as given; today as now; another day at noon.
function happenedAt(when, at = new Date()) {
  const today = localDay(at);
  const text = when || today;
  const time = text.includes('T') ? text : text === today ? localMinute(at) : `${text}T12:00`;
  const real = new Date(time);
  if (Number.isNaN(real.getTime()) || localMinute(real) !== time) throw fail(400, 'That is not a real day or time.');
  if (time > localMinute(at)) throw fail(400, 'A log line is for what already happened: that day has not come yet.');
  return time;
}

export function getInteraction(db, id, { deleted = false } = {}) {
  const row = db.prepare(`SELECT id, kind, happened_at, note, origin, created_at, deleted_at FROM interactions WHERE id = ? ${deleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
  if (!row) return null;
  const who = db.prepare(`SELECT l.to_kind AS kind, l.to_id AS id, coalesce(p.name, c.name) AS name FROM links l
    LEFT JOIN people p ON l.to_kind = 'person' AND p.id = l.to_id
    LEFT JOIN companies c ON l.to_kind = 'company' AND c.id = l.to_id
    WHERE l.from_kind = 'interaction' AND l.from_id = ? ORDER BY l.rowid`).all(id).map((w) => ({ ...w }));
  return { ...row, who };
}

// Logs what happened with a person or a company.
export function logInteraction(db, { about, kind, note, when = '', origin = 'typed' }, { at = new Date() } = {}) {
  const problem = checkInteractionInput({ about, kind, note, when });
  if (problem) throw fail(400, problem);
  const target = db.prepare(`SELECT id, name FROM ${TABLES[about.kind]} WHERE id = ? AND deleted_at IS NULL`).get(about.id);
  if (!target) throw fail(400, `That ${about.kind} is not in the app.`);
  const time = now();
  const id = randomUUID();
  const sentence = note.trim();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO interactions (id, created_at, updated_at, origin, kind, happened_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, time, time, origin, kind, happenedAt(when, at), sentence);
    db.prepare(`INSERT INTO links (id, created_at, updated_at, origin, from_kind, from_id, to_kind, to_id, link_text, context)
      VALUES (?, ?, ?, ?, 'interaction', ?, ?, ?, ?, ?)`).run(randomUUID(), time, time, origin, id, about.kind, about.id, target.name, sentence);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getInteraction(db, id);
}

export function deleteInteraction(db, id) {
  const row = getInteraction(db, id, { deleted: true });
  if (!row) return null;
  if (!row.deleted_at) db.prepare('UPDATE interactions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return getInteraction(db, id, { deleted: true });
}

export function restoreInteraction(db, id) {
  if (!getInteraction(db, id, { deleted: true })) return null;
  db.prepare('UPDATE interactions SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return getInteraction(db, id);
}

// The people and companies a name could mean (for the assistant): an id, or a name that
// fits exactly, or the one person whose name starts with the words.
export function findPerson(db, who) {
  const text = String(who ?? '').trim();
  if (!text) return [];
  const byId = db.prepare('SELECT id, name FROM people WHERE id = ? AND deleted_at IS NULL').get(text);
  if (byId) return [{ ...byId }];
  const all = db.prepare('SELECT id, name FROM people WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE').all().map((p) => ({ ...p }));
  const exact = all.filter((p) => p.name.toLowerCase() === text.toLowerCase());
  if (exact.length) return exact;
  const words = text.toLowerCase().split(/\s+/);
  return all.filter((p) => words.every((w) => p.name.toLowerCase().split(/[\s.-]+/).some((part) => part.startsWith(w))));
}
