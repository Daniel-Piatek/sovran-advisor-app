// One person, two entries (People in depth, advanced/people/7): possible duplicates, and a merge.
// Possible duplicates are pairs whose names match the way a person would compare them (case,
// accents, ü and ue, brackets, punctuation, "Kühn, Mara") or that share an email. A merge keeps
// one entry and, in one step, moves everything that points at the other one to it: the links in
// text (notes, entries, thinking spaces, captures, other people's notes) are rewritten to name the
// kept person, log lines and task mentions move over, and the chosen fields are written to the kept
// row. The other entry is marked deleted with merged_into, never removed, and keeps a record of
// what moved, so Restore in Recently deleted undoes the merge.

import { randomUUID } from 'node:crypto';
import { syncLinks } from './links.js';
import { syncTasks } from './tasks.js';
import { getPerson } from './people.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const FIELDS = ['name', 'role', 'company_id', 'emails', 'phones', 'how_met', 'body'];
const MANY = ['emails', 'phones', 'how_met', 'body']; // these can take both sides
const DISMISSED = 'people.not_duplicates';

// ---- Possible duplicates ----

// The ways a name can be written the same: ü as ue (Kühn, Kuehn) or as u (Kuhn), without brackets
// ("Mara Kuehn (Nordlicht)"), punctuation or case, and "Kühn, Mara" as "Mara Kühn".
export function nameKeys(name) {
  let text = String(name).replace(/\(.*?\)|\[.*?\]/g, ' ').trim();
  if (/^[^,]+,[^,]+$/.test(text)) text = text.split(',').map((s) => s.trim()).reverse().join(' ');
  text = text.toLowerCase();
  const translit = text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const stripped = text.replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tidy = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([tidy(translit), tidy(stripped)].filter(Boolean))];
}
const emailsOf = (stored) => String(stored).split(/\r?\n/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const pairKey = (a, b) => [a, b].sort().join('|');

function dismissed(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(DISMISSED);
  try { return new Set(row ? JSON.parse(row.value) : []); } catch { return new Set(); }
}

export function dismissDuplicate(db, aId, bId) {
  const set = dismissed(db);
  set.add(pairKey(aId, bId));
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, DISMISSED, JSON.stringify([...set]));
}

// Pairs of people who may be one: { a, b, why }. `a` is the entry to keep by default (one you
// wrote yourself before an imported one, else the older); both are the people as their pages have them.
export function findDuplicates(db) {
  const people = db.prepare('SELECT id, name, emails, origin, created_at FROM people WHERE deleted_at IS NULL ORDER BY created_at, rowid').all();
  const hidden = dismissed(db);
  const found = new Map();
  const add = (x, y, why) => {
    const key = pairKey(x.id, y.id);
    if (hidden.has(key)) return;
    const had = found.get(key);
    if (had) { if (!had.why.includes(why)) had.why.push(why); return; }
    const [a, b] = x.origin === 'imported' && y.origin !== 'imported' ? [y, x] : [x, y];
    found.set(key, { a: a.id, b: b.id, why: [why] });
  };
  const group = (keysOf, why) => {
    const groups = new Map();
    for (const p of people) for (const key of keysOf(p)) groups.set(key, [...groups.get(key) ?? [], p]);
    for (const members of groups.values()) {
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) add(members[i], members[j], why);
    }
  };
  group((p) => nameKeys(p.name), 'same name');
  group((p) => emailsOf(p.emails), 'same email');
  return [...found.values()].map((pair) => ({ a: getPerson(db, pair.a), b: getPerson(db, pair.b), why: pair.why.join(' and ') }));
}

// ---- Merge ----

const lines = (text) => String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
function combine(field, keepValue, dropValue) {
  if (!keepValue.trim()) return dropValue;
  if (!dropValue.trim()) return keepValue;
  if (field === 'emails' || field === 'phones') {
    const seen = new Set();
    return [...lines(keepValue), ...lines(dropValue)].filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).join('\n');
  }
  return `${keepValue.trimEnd()}\n\n${dropValue.trimStart()}`;
}

// The pages whose text can link to a person, with the kind syncLinks knows them by.
const TEXT_PAGES = [['notes', 'note'], ['journal_entries', 'entry'], ['people', 'person'], ['companies', 'company'], ['life_items', 'life'], ['captures', null]];

// fields: per field 'keep' or 'drop' (emails, phones, how_met, body also 'both'); by default
// the kept entry's value, or the other's when the kept one has none.
export function mergePeople(db, keepId, dropId, fields = {}) {
  if (keepId === dropId) throw fail(400, 'Choose two different people.');
  const keep = getPerson(db, keepId);
  const drop = getPerson(db, dropId);
  if (!keep || !drop) throw fail(404, 'One of them is not in People (or was deleted).');
  for (const [f, how] of Object.entries(fields)) {
    if (!FIELDS.includes(f) || !['keep', 'drop', ...(MANY.includes(f) ? ['both'] : [])].includes(how)) throw fail(400, `${f}: that choice is not offered.`);
  }
  const choose = (f) => fields[f] ?? 'keep';
  db.exec('BEGIN');
  try {
    const before = Object.fromEntries([...FIELDS, 'cadence_days'].map((f) => [f, keep[f] ?? null]));
    const merged = {};
    for (const f of FIELDS) {
      const how = choose(f);
      const k = keep[f] ?? '';
      const d = drop[f] ?? '';
      merged[f] = how === 'drop' ? d : how === 'both' ? combine(f, k, d) : (f === 'company_id' ? (k || d || null) : (String(k).trim() ? k : d));
    }
    if (fields.name === undefined) merged.name = keep.name;
    if (!merged.company_id) merged.company_id = null;
    merged.body = merged.body.split(`/people/${dropId}`).join(`/people/${keepId}`);
    const cadence = keep.cadence_days ?? drop.cadence_days ?? null;
    db.prepare(`UPDATE people SET name = ?, company_id = ?, role = ?, emails = ?, phones = ?, how_met = ?, body = ?, cadence_days = ?, updated_at = ? WHERE id = ?`)
      .run(merged.name, merged.company_id, merged.role, merged.emails, merged.phones, merged.how_met, merged.body, cadence, now(), keepId);
    // Tasks written in the other's own notes come along when their text does.
    let tasks = [];
    if (['drop', 'both'].includes(choose('body'))) {
      tasks = db.prepare("SELECT id FROM tasks WHERE source_kind = 'person' AND source_id = ? AND deleted_at IS NULL").all(dropId).map((t) => t.id);
      for (const id of tasks) db.prepare('UPDATE tasks SET source_id = ? WHERE id = ?').run(keepId, id);
    }
    if (merged.body !== keep.body) { syncLinks(db, 'person', keepId, merged.body); syncTasks(db, 'person', keepId, merged.body); }
    // Text that names the other person names the kept one (the page's updated time is not touched).
    const pages = [];
    for (const [table, kind] of TEXT_PAGES) {
      const rows = db.prepare(`SELECT id, body FROM ${table} WHERE body LIKE ?${table === 'people' ? ' AND id NOT IN (?, ?)' : ''}`)
        .all(`%/people/${dropId}%`, ...(table === 'people' ? [keepId, dropId] : []));
      for (const row of rows) {
        const after = row.body.split(`/people/${dropId}`).join(`/people/${keepId}`);
        db.prepare(`UPDATE ${table} SET body = ? WHERE id = ?`).run(after, row.id);
        if (kind) syncLinks(db, kind, row.id, after);
        pages.push({ table, id: row.id, before: row.body, after });
      }
    }
    // What points at them without being text: log lines and task mentions.
    const links = db.prepare("SELECT id FROM links WHERE to_kind = 'person' AND to_id = ? AND from_kind IN ('task', 'interaction') AND deleted_at IS NULL").all(dropId).map((l) => l.id);
    for (const id of links) db.prepare('UPDATE links SET to_id = ?, updated_at = ? WHERE id = ?').run(keepId, now(), id);
    const final = getPerson(db, keepId);
    const record = { keep: keepId, links, pages, tasks, before, after: Object.fromEntries([...FIELDS, 'cadence_days'].map((f) => [f, final[f] ?? null])) };
    db.prepare('UPDATE people SET deleted_at = ?, merged_into = ?, merge_record = ?, updated_at = ? WHERE id = ?').run(now(), keepId, JSON.stringify(record), now(), dropId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getPerson(db, keepId);
}

// Restore of a merged person: what moved goes back, and the kept entry's fields as they were
// (a field you have edited since stays as you edited it).
export function unmergePerson(db, dropId) {
  const row = db.prepare('SELECT merged_into, merge_record FROM people WHERE id = ?').get(dropId);
  if (!row?.merged_into) return false;
  let record;
  try { record = JSON.parse(row.merge_record); } catch { record = null; }
  db.exec('BEGIN');
  try {
    if (record) {
      const keepId = record.keep;
      for (const id of record.links) db.prepare('UPDATE links SET to_id = ?, updated_at = ? WHERE id = ? AND to_id = ?').run(dropId, now(), id, keepId);
      for (const id of record.tasks) db.prepare('UPDATE tasks SET source_id = ? WHERE id = ? AND source_id = ?').run(dropId, id, keepId);
      for (const page of record.pages) {
        const current = db.prepare(`SELECT body FROM ${page.table} WHERE id = ?`).get(page.id);
        if (current?.body !== page.after) continue; // edited since: left as it is
        db.prepare(`UPDATE ${page.table} SET body = ? WHERE id = ?`).run(page.before, page.id);
        const kind = TEXT_PAGES.find(([table]) => table === page.table)[1];
        if (kind) syncLinks(db, kind, page.id, page.before);
      }
      const keep = db.prepare('SELECT * FROM people WHERE id = ?').get(keepId);
      if (keep) {
        const back = {};
        for (const f of [...FIELDS, 'cadence_days']) if ((keep[f] ?? null) === record.after[f]) back[f] = record.before[f];
        const names = Object.keys(back);
        if (names.length) {
          db.prepare(`UPDATE people SET ${names.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...names.map((f) => back[f]), now(), keepId);
          if ('body' in back) { syncLinks(db, 'person', keepId, back.body); syncTasks(db, 'person', keepId, back.body); }
        }
      }
      // The tasks of the other's own notes are theirs again, from their own text.
      if (record.tasks.length) {
        const body = db.prepare('SELECT body FROM people WHERE id = ?').get(dropId).body;
        syncTasks(db, 'person', dropId, body);
      }
    }
    db.prepare('UPDATE people SET deleted_at = NULL, merged_into = NULL, merge_record = NULL, updated_at = ? WHERE id = ?').run(now(), dropId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return true;
}
