// My Life (schema.sql, tables life_items and life_serves; pkm/3): Key Elements, Goals,
// Projects, Topics and (advanced/mylife/1) Habits as rows of one table. Every item but a Key Element has a home Key
// Element, and a Project can serve Goals. An item's chain says why it exists: its home
// Key Element, the Goals it serves, then the item. Deleting only sets deleted_at, as
// everywhere.

import { randomUUID } from 'node:crypto';
import { syncLinks } from './links.js';
import { MAX_BODY_LENGTH } from './notes.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));

export const LIFE_KINDS = ['key_element', 'goal', 'project', 'topic', 'habit'];
// What carries a Goal: a Project, and a Habit ("Run 3× a week" carries "Run ten kilometres").
const CARRIES = ['project', 'habit'];
export const MAX_TITLE_LENGTH = 200;
const TEXT_FIELDS = ['title', 'description', 'not_this', 'statement', 'shipped_means', 'why', 'outcome', 'done_means', 'done_when', 'pulse', 'body'];
const CHOICES = {
  state: ['active', 'archived'],
  horizon: ['', 'quarter', 'year', 'three_years', 'someday'],
  depth: ['deep', 'secondary'],
  cadence_per: ['week', 'month'],
};
const DAY = /^(\d{4}-\d{2}-\d{2})?$/;
const FIELDS = [...TEXT_FIELDS, ...Object.keys(CHOICES), 'starts_on', 'ends_on', 'home_id', 'cadence_times'];
const COLUMNS = `id, kind, title, description, state, home_id, not_this, statement, horizon, shipped_means, why, outcome,
  done_means, starts_on, ends_on, pulse, depth, body, cadence_times, cadence_per, done_when, origin, created_at, updated_at, deleted_at`;

// Checks what the page sent. Returns what is wrong, or null.
export function checkLifeInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if ('kind' in input && !LIFE_KINDS.includes(input.kind)) return `kind is ${LIFE_KINDS.join(', ')}.`;
  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    if (typeof input[field] !== 'string') return `${field} must be text.`;
    const max = field === 'body' ? MAX_BODY_LENGTH : field === 'title' || field === 'description' ? MAX_TITLE_LENGTH : 10_000;
    if (input[field].length > max) return `${field} is longer than ${max} characters.`;
  }
  if ('title' in input && !input.title.trim()) return 'A name is needed.';
  for (const [field, allowed] of Object.entries(CHOICES)) {
    if (field in input && !allowed.includes(input[field])) return `${field} is one of: ${allowed.filter(Boolean).join(', ')}.`;
  }
  for (const field of ['starts_on', 'ends_on']) {
    if (field in input && (typeof input[field] !== 'string' || !DAY.test(input[field]))) return `${field} is a date (YYYY-MM-DD) or empty.`;
  }
  if ('cadence_times' in input) {
    if (!Number.isInteger(input.cadence_times) || input.cadence_times < 1 || input.cadence_times > 31) {
      return 'cadence_times is a whole number from 1 to 31.';
    }
  }
  if ('home_id' in input && input.home_id !== null && typeof input.home_id !== 'string') return 'home_id must be an id.';
  if ('serves' in input && (!Array.isArray(input.serves) || input.serves.some((id) => typeof id !== 'string'))) {
    return 'serves is a list of Goal ids.';
  }
  return null;
}

// A week has seven days: more than seven times a week is not a rhythm.
function checkCadence(per, times) {
  if (per === 'week' && times > 7) throw fail(400, 'A week has seven days: at most 7 times a week.');
}

const itemRow = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM life_items WHERE id = ?`).get(id);

function checkHome(db, kind, homeId) {
  if (kind === 'key_element') {
    if (homeId) throw fail(400, 'A Key Element has no home.');
    return;
  }
  if (!homeId) return;
  const home = itemRow(db, homeId);
  if (!home || home.deleted_at || home.kind !== 'key_element') throw fail(400, 'The home is not a Key Element.');
}

// Sets the Goals an item serves: a Goal taken off is marked deleted, one added again
// comes back.
function setServes(db, item, goalIds) {
  if (!CARRIES.includes(item.kind)) {
    if (goalIds.length) throw fail(400, 'Only a Project or a Habit serves Goals.');
    return;
  }
  const wanted = [...new Set(goalIds)];
  for (const goalId of wanted) {
    const goal = itemRow(db, goalId);
    if (!goal || goal.deleted_at || goal.kind !== 'goal') throw fail(400, 'That is not a Goal.');
  }
  const time = now();
  const rows = db.prepare('SELECT id, goal_id, deleted_at FROM life_serves WHERE item_id = ?').all(item.id);
  for (const row of rows) {
    const keep = wanted.includes(row.goal_id);
    if (keep && row.deleted_at) db.prepare('UPDATE life_serves SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(time, row.id);
    if (!keep && !row.deleted_at) db.prepare('UPDATE life_serves SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, row.id);
  }
  for (const goalId of wanted.filter((id) => !rows.some((row) => row.goal_id === id))) {
    db.prepare('INSERT INTO life_serves (id, created_at, updated_at, item_id, goal_id) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), time, time, item.id, goalId);
  }
}

const inTransaction = (db, work) => {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export function createLifeItem(db, { kind, title, serves = [], ...fields }) {
  if (!LIFE_KINDS.includes(kind)) throw fail(400, `kind is ${LIFE_KINDS.join(', ')}.`);
  if (!title?.trim()) throw fail(400, 'A name is needed.');
  return inTransaction(db, () => {
    checkHome(db, kind, fields.home_id);
    checkCadence(fields.cadence_per ?? 'week', fields.cadence_times ?? 1);
    const id = randomUUID();
    const time = now();
    db.prepare('INSERT INTO life_items (id, created_at, updated_at, kind, title) VALUES (?, ?, ?, ?, ?)')
      .run(id, time, time, kind, title.trim());
    writeFields(db, id, fields);
    setServes(db, { id, kind }, serves);
    syncLinks(db, 'life', id, fields.body ?? '');
    return getLifeItem(db, id);
  });
}

function writeFields(db, id, fields) {
  const given = FIELDS.filter((field) => field in fields && field !== 'title');
  if (!given.length) return;
  db.prepare(`UPDATE life_items SET ${given.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...given.map((f) => (f === 'home_id' ? fields[f] || null : fields[f])), id);
}

const brief = (db, sql, ...args) => plain(db.prepare(sql).all(...args));

// One item with its home, the Goals it serves, and what sits under it: for a Key Element
// its Goals, Projects and Topics; for a Goal the Projects that serve it.
export function getLifeItem(db, id, { deleted = false } = {}) {
  const item = itemRow(db, id);
  if (!item || (item.deleted_at && !deleted)) return null;
  const home = item.home_id
    ? db.prepare("SELECT id, title, kind FROM life_items WHERE id = ? AND deleted_at IS NULL").get(item.home_id)
    : null;
  const serves = brief(db, `SELECT g.id, g.title, g.kind, g.state FROM life_serves s JOIN life_items g ON g.id = s.goal_id
    WHERE s.item_id = ? AND s.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY g.title COLLATE NOCASE`, id);
  // A Key Element holds what stands on it, and the Habits that carry one of its Goals.
  const under = item.kind === 'key_element'
    ? brief(db, `SELECT id, title, description, kind, state, cadence_times, cadence_per FROM life_items WHERE deleted_at IS NULL AND (home_id = ?1
        OR (kind = 'habit' AND id IN (SELECT s.item_id FROM life_serves s JOIN life_items g ON g.id = s.goal_id
          WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL AND g.home_id = ?1)))
        ORDER BY title COLLATE NOCASE`, id)
    : item.kind === 'goal'
      ? brief(db, `SELECT i.id, i.title, i.kind, i.state, i.description, i.cadence_times, i.cadence_per FROM life_serves s JOIN life_items i ON i.id = s.item_id
          WHERE s.goal_id = ? AND s.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.title COLLATE NOCASE`, id)
      : [];
  return { ...item, home: home ? { ...home } : null, serves, under };
}

// Every item that is not deleted, active and archived, with its home, its description,
// the Goals it serves (as ids) and how many notes are at home in it, by name. The page
// groups them by Key Element.
export function listLifeItems(db) {
  const serves = new Map();
  for (const row of db.prepare(`SELECT s.item_id, s.goal_id FROM life_serves s JOIN life_items g ON g.id = s.goal_id
      WHERE s.deleted_at IS NULL AND g.deleted_at IS NULL`).all()) {
    serves.set(row.item_id, [...(serves.get(row.item_id) ?? []), row.goal_id]);
  }
  return brief(db, `SELECT i.id, i.kind, i.title, i.description, i.state, i.updated_at, i.cadence_times, i.cadence_per,
      CASE WHEN h.deleted_at IS NULL THEN i.home_id END AS home_id,
      (SELECT count(*) FROM notes n WHERE n.home_id = i.id AND n.deleted_at IS NULL) AS notes_count
    FROM life_items i LEFT JOIN life_items h ON h.id = i.home_id
    WHERE i.deleted_at IS NULL ORDER BY i.title COLLATE NOCASE`).map((item) => ({ ...item, serves: serves.get(item.id) ?? [] }));
}

export function updateLifeItem(db, id, changes) {
  return inTransaction(db, () => {
    const item = getLifeItem(db, id);
    if (!item) return null;
    if ('kind' in changes && changes.kind !== item.kind) throw fail(400, 'An item keeps its kind.');
    if ('home_id' in changes && (changes.home_id || null) !== item.home_id) checkHome(db, item.kind, changes.home_id);
    if ('cadence_times' in changes || 'cadence_per' in changes) {
      checkCadence(changes.cadence_per ?? item.cadence_per, changes.cadence_times ?? item.cadence_times);
    }
    const fields = Object.fromEntries(FIELDS.filter((f) => f in changes && changes[f] !== item[f]).map((f) => [f, changes[f]]));
    const servesChanged = 'serves' in changes
      && [...new Set(changes.serves)].sort().join() !== item.serves.map((g) => g.id).sort().join();
    if (!Object.keys(fields).length && !servesChanged) return item;
    if ('title' in fields) db.prepare('UPDATE life_items SET title = ? WHERE id = ?').run(fields.title.trim(), id);
    writeFields(db, id, fields);
    if (servesChanged) setServes(db, item, changes.serves);
    db.prepare('UPDATE life_items SET updated_at = ? WHERE id = ?').run(now(), id);
    if ('body' in fields) syncLinks(db, 'life', id, fields.body);
    return getLifeItem(db, id);
  });
}

export function deleteLifeItem(db, id) {
  const item = itemRow(db, id);
  if (!item) return null;
  if (!item.deleted_at) db.prepare('UPDATE life_items SET deleted_at = ? WHERE id = ?').run(now(), id);
  return getLifeItem(db, id, { deleted: true });
}

export function restoreLifeItem(db, id) {
  if (!itemRow(db, id)) return null;
  db.prepare('UPDATE life_items SET deleted_at = NULL WHERE id = ?').run(id);
  return getLifeItem(db, id);
}

export function listDeletedLifeItems(db) {
  return brief(db, `SELECT id, kind, title, deleted_at FROM life_items WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, rowid DESC`);
}
