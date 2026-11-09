// The Timeline (advanced/people/2): everything that happened, on one line, newest first.
// It keeps nothing of its own: it reads what every part of the app already keeps, each kind
// from its own table, and puts the rows in one stream.
//   note     when it was last edited        entry    when it was written
//   task     when it was finished           event    when it starts (your own events)
//   capture  the moment it was taken
//   interaction  a log line (advanced/people/4): when it happened, with who it was with
// Times are the owner's own time (this computer's), as YYYY-MM-DDTHH:MM:SS. Events up to the
// end of today come with it: the ones still ahead sit above "now" on the page.

import { plainWords } from './links.js';

export const TIMELINE_KINDS = ['note', 'entry', 'task', 'event', 'capture', 'interaction'];
export const MAX_LIMIT = 200;

const pad = (n) => String(n).padStart(2, '0');
// An ISO time (UTC) as the owner's own local time, to the millisecond (so a page can end exactly at a row).
export function localSecond(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
const firstLine = (markdown) => plainWords(markdown).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
const clip = (text, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Every word searched for must be somewhere in the row (case ignored, % and _ taken as letters).
function matching(words, columns) {
  const params = [];
  const sql = words.map((word) => {
    const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(...columns.map(() => like));
    return `(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  });
  return { sql: sql.map((s) => ` AND ${s}`).join(''), params };
}

// What belongs to one person or company (advanced/people/3): the notes and journal entries
// that link to them, the tasks that mention them or are written in their own notes, and
// tasks done in a page that links to them with their name in the words. A company also gets
// the rows of its people, each marked with the person. Everything else (an event, a capture)
// has no link to follow, so it is not here until something links it.
function scopeOf(db, kind, id) {
  const scope = { note: new Map(), entry: new Map(), task: new Map(), interaction: new Map() };
  const table = kind === 'person' ? 'people' : 'companies';
  const subject = db.prepare(`SELECT id, name FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!subject) return scope;
  const subjects = [{ kind, id, name: subject.name, via: null }];
  if (kind === 'company') {
    for (const p of db.prepare('SELECT id, name FROM people WHERE company_id = ? AND deleted_at IS NULL').all(id)) {
      subjects.push({ kind: 'person', id: p.id, name: p.name, via: { id: p.id, name: p.name } });
    }
  }
  const add = (type, key, via) => { if (!scope[type].has(key)) scope[type].set(key, via); };
  for (const s of subjects) {
    for (const l of db.prepare("SELECT from_kind, from_id FROM links WHERE to_kind = ? AND to_id = ? AND from_kind IN ('note', 'entry', 'task', 'interaction')").all(s.kind, s.id)) {
      add(l.from_kind, l.from_id, s.via);
    }
    for (const t of db.prepare('SELECT id FROM tasks WHERE source_kind = ? AND source_id = ? AND deleted_at IS NULL').all(s.kind, s.id)) add('task', t.id, s.via);
    const like = `%${s.name.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    for (const t of db.prepare(`SELECT t.id FROM tasks t JOIN links l ON l.from_kind = t.source_kind AND l.from_id = t.source_id
      WHERE t.source_kind IN ('note', 'entry') AND t.deleted_at IS NULL AND l.to_kind = ? AND l.to_id = ? AND lower(t.text) LIKE ? ESCAPE '\\'`).all(s.kind, s.id, like)) {
      add('task', t.id, s.via);
    }
  }
  return scope;
}

// A log line is kept to the minute. Logged in the minute it is about (the usual case: today),
// it sorts by the second it was written, so it is the newest row, as it just was.
function exactTime(row) {
  const written = localSecond(row.created_at);
  return written.slice(0, 16) === row.at ? written : `${row.at}:00.000`;
}

const SOURCE_PATHS = { note: (id) => `/notes/${id}`, entry: (id) => `/journal/entries/${id}`, person: (id) => `/people/${id}`, company: (id) => `/companies/${id}` };

// The stream: { items: [{ kind, id, at, text, where, href }], more }. `before` (a time from
// an earlier answer) goes further back; `kinds` narrows it; `q` keeps the rows with every
// word; `now` is for tests.
// Newest first; rows of the same second go by kind, then id, the same way every time (a comparison
// that answers differently for (a, b) and (b, a) makes the order depend on the sort's own steps).
export function compareRows(a, b) {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function timeline(db, { kinds = TIMELINE_KINDS, q = '', before = '', limit = 60, now = new Date(), about = null } = {}) {
  // about: { kind: 'person' | 'company', id }: only what belongs to them.
  const scope = about ? scopeOf(db, about.kind, about.id) : null;
  const wanted = TIMELINE_KINDS.filter((k) => kinds.includes(k) && (!scope || scope[k]));
  const only = (type) => (scope ? ` AND id IN (SELECT value FROM json_each('${JSON.stringify([...scope[type].keys()].filter((key) => /^[0-9a-f-]{36}$/.test(key)))}'))` : '');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const n = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit) || 60));
  const endOfToday = `${localSecond(now.toISOString()).slice(0, 10)}T23:59:59`;
  // A page ends at its last row, and the next starts at that same moment (that row comes
  // again, and the page drops the ones it has already shown), so a row at the very same
  // moment is never left out.
  const beforeIso = before ? new Date(before).toISOString() : '9999-12-31T00:00:00.000Z';
  const beforeLocal = before || '9999-12-31T00:00:00.000';
  const nowIso = now.toISOString();
  const found = [];
  // A company's tab marks the rows that are its people's with the person.
  const via = (type, id) => (scope?.[type].get(id) ? { via: scope[type].get(id) } : {});

  if (wanted.includes('note')) {
    const m = matching(words, ['title', 'body']);
    for (const r of db.prepare(`SELECT id, title, updated_at AS at FROM notes WHERE deleted_at IS NULL AND updated_at <= ? AND updated_at <= ?${only('note')}${m.sql}
      ORDER BY updated_at DESC LIMIT ?`).all(beforeIso, nowIso, ...m.params, n + 1)) {
      found.push({ kind: 'note', id: r.id, at: localSecond(r.at), text: r.title.trim() || 'Untitled', where: 'Note', href: `/notes/${r.id}`, ...via('note', r.id) });
    }
  }
  if (wanted.includes('entry')) {
    const m = matching(words, ['title', 'body']);
    for (const r of db.prepare(`SELECT id, title, body, day, written_at AS at FROM journal_entries WHERE deleted_at IS NULL AND written_at <= ? AND written_at <= ?${only('entry')}${m.sql}
      ORDER BY written_at DESC LIMIT ?`).all(beforeIso, nowIso, ...m.params, n + 1)) {
      found.push({ kind: 'entry', id: r.id, at: localSecond(r.at), text: clip(r.title.trim() || firstLine(r.body) || 'Journal entry'), where: 'Journal', href: `/journal/entries/${r.id}`, ...via('entry', r.id) });
    }
  }
  if (wanted.includes('task')) {
    const m = matching(words, ['text']);
    for (const r of db.prepare(`SELECT id, text, source_kind, source_id, done_at AS at FROM tasks
      WHERE deleted_at IS NULL AND done = 1 AND done_at IS NOT NULL AND done_at <= ? AND done_at <= ?${only('task')}${m.sql}
      ORDER BY done_at DESC LIMIT ?`).all(beforeIso, nowIso, ...m.params, n + 1)) {
      const path = SOURCE_PATHS[r.source_kind]?.(r.source_id);
      found.push({ kind: 'task', id: r.id, at: localSecond(r.at), text: clip(r.text), where: 'Task done', href: path ?? '/tasks', ...via('task', r.id) });
    }
  }
  if (wanted.includes('event')) {
    const m = matching(words, ['title', 'note']);
    for (const r of db.prepare(`SELECT id, title, starts_at AS at FROM events WHERE deleted_at IS NULL AND starts_at <= ? AND starts_at <= ?${m.sql}
      ORDER BY starts_at DESC LIMIT ?`).all(beforeLocal.slice(0, 16), endOfToday.slice(0, 16), ...m.params, n + 1)) {
      found.push({ kind: 'event', id: r.id, at: `${r.at}:00.000`, text: r.title, where: 'Event', href: `/calendar/events/${r.id}` });
    }
  }
  if (wanted.includes('interaction')) {
    // The words searched for may be in the sentence or in the name of who it was with.
    const namesOf = '(SELECT group_concat(coalesce(p.name, c.name), \' \') FROM links l LEFT JOIN people p ON l.to_kind = \'person\' AND p.id = l.to_id LEFT JOIN companies c ON l.to_kind = \'company\' AND c.id = l.to_id WHERE l.from_kind = \'interaction\' AND l.from_id = interactions.id)';
    const m = matching(words, ['note', namesOf]);
    for (const r of db.prepare(`SELECT id, kind, note, happened_at AS at, created_at FROM interactions WHERE deleted_at IS NULL AND happened_at <= ? AND happened_at <= ?${only('interaction')}${m.sql}
      ORDER BY happened_at DESC LIMIT ?`).all(beforeLocal.slice(0, 16), localSecond(nowIso).slice(0, 16), ...m.params, n + 1)) {
      const who = db.prepare(`SELECT l.to_kind AS kind, l.to_id AS id, coalesce(p.name, c.name) AS name FROM links l
        LEFT JOIN people p ON l.to_kind = 'person' AND p.id = l.to_id LEFT JOIN companies c ON l.to_kind = 'company' AND c.id = l.to_id
        WHERE l.from_kind = 'interaction' AND l.from_id = ? ORDER BY l.rowid`).all(r.id).map((w) => ({ ...w }));
      const first = who[0];
      found.push({
        kind: 'interaction', id: r.id, at: exactTime(r), text: clip(r.note), where: `Logged · ${r.kind}`,
        href: first ? `${first.kind === 'person' ? '/people/' : '/companies/'}${first.id}?tab=timeline` : '/people', who: who.map((w) => w.name), ...via('interaction', r.id),
      });
    }
  }
  if (wanted.includes('capture')) {
    const m = matching(words, ['body']);
    for (const r of db.prepare(`SELECT id, body, captured_at AS at FROM captures WHERE deleted_at IS NULL AND captured_at <= ? AND captured_at <= ?${m.sql}
      ORDER BY captured_at DESC LIMIT ?`).all(beforeIso, nowIso, ...m.params, n + 1)) {
      found.push({ kind: 'capture', id: r.id, at: localSecond(r.at), text: clip(firstLine(r.body) || 'Capture'), where: 'Capture', href: '/inbox' });
    }
  }

  found.sort(compareRows);
  return { items: found.slice(0, n), more: found.length > n };
}

export function checkTimelineQuery(params) {
  const kinds = params.get('kinds');
  if (kinds !== null && kinds.split(',').some((k) => !TIMELINE_KINDS.includes(k))) return `kinds are ${TIMELINE_KINDS.join(', ')}.`;
  const about = params.get('about');
  if (about !== null && !/^(person|company):[0-9a-f-]{36}$/.test(about)) return 'about is person:<id> or company:<id>.';
  const before = params.get('before');
  if (before && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/.test(before)) return 'before is a time (YYYY-MM-DDTHH:MM:SS.mmm).';
  const limit = params.get('limit');
  if (limit !== null && !(/^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= MAX_LIMIT)) return `limit is 1 to ${MAX_LIMIT}.`;
  return null;
}
