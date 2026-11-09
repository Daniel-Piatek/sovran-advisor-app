// You and your assistant at once (advanced/writing/5): a three-way merge, line by line, when a note changed since the text a save started from.
// The base is the version both started from (versions, lesson 4). A line only one side changed takes that change; a line both changed
// differently is a clash: the winning side's words stay in the note, the other side's whole text is kept in the clash, a box shows both,
// and the choice is one more version. Your assistant is then told which side won, so it never builds on a line that is gone.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';
import { getNote, updateNote } from './notes.js';
import { latestVersion, writeVersion } from './versions.js';

const now = () => new Date().toISOString();
const fail = (status, message, code = '') => Object.assign(new Error(message), { status, code });
const MAX_CELLS = 4_000_000;

// The lines both texts share, in order: [[i in a, j in b], ...] (the longest run).
function matches(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const pairs = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length <= MAX_CELLS) {
    const cols = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) lcs[i * cols + j] = midA[i] === midB[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) { pairs.push([start + i, start + j]); i++; j++; } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) i++; else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

const same = (x, y) => x.length === y.length && x.every((line, i) => line === y[i]);

// Merges two changes of one base. mine wins a clash. Returns { text, clashes: [{ line, mine, theirs }] } (line: where mine's lines start).
export function merge3(base, mine, theirs) {
  if (mine === theirs) return { text: mine, clashes: [] };
  if (mine === base) return { text: theirs, clashes: [] };
  if (theirs === base) return { text: mine, clashes: [] };
  const b = base.split('\n');
  const m = mine.split('\n');
  const t = theirs.split('\n');
  const inMine = new Map(matches(b, m));
  const inTheirs = new Map(matches(b, t));
  const stable = [...inMine.keys()].filter((i) => inTheirs.has(i)).sort((x, y) => x - y).map((i) => [i, inMine.get(i), inTheirs.get(i)]);
  stable.push([b.length, m.length, t.length]);
  const out = [];
  const clashes = [];
  let pb = 0;
  let pm = 0;
  let pt = 0;
  for (const [i, mj, tj] of stable) {
    const baseSeg = b.slice(pb, i);
    const mineSeg = m.slice(pm, mj);
    const theirSeg = t.slice(pt, tj);
    if (same(mineSeg, baseSeg)) out.push(...theirSeg);
    else if (same(theirSeg, baseSeg) || same(mineSeg, theirSeg)) out.push(...mineSeg);
    else { clashes.push({ line: out.length, mine: mineSeg.join('\n'), theirs: theirSeg.join('\n') }); out.push(...mineSeg); }
    if (i < b.length) out.push(b[i]);
    pb = i + 1;
    pm = mj + 1;
    pt = tj + 1;
  }
  return { text: out.join('\n'), clashes };
}

const clashRow = (r) => ({ id: r.id, note_id: r.note_id, line: r.line_no, mine: r.mine, theirs: r.theirs, state: r.state, author_of_theirs: r.theirs_author, created_at: r.created_at });

// Records a clash for the note: the winning side's words are in the note, the other side's whole text is kept here.
function recordClashes(db, noteId, clashes, { theirsText, theirsAuthor, versionId }) {
  const time = now();
  const insert = db.prepare(`INSERT INTO note_clashes (id, created_at, updated_at, origin, note_id, line_no, mine, theirs, theirs_text, theirs_author, version_id)
    VALUES (?, ?, ?, 'typed', ?, ?, ?, ?, ?, ?, ?)`);
  return clashes.map((c) => { const id = randomUUID(); insert.run(id, time, time, noteId, c.line, c.mine, c.theirs, theirsText, theirsAuthor, versionId ?? null); return id; });
}

// A save that started from version `base` (its seq). If the note moved on since, merge: `body` is the incoming text and `winner` is which
// side wins a clash: 'incoming' (you typing: your words stay) or 'current' (your assistant's change meeting yours: the note's words stay).
export function saveWithMerge(db, id, { title, body, home_id: homeId, base, author = 'me', winner = 'incoming', baseText = null }) {
  const note = getNote(db, id);
  if (!note) return null;
  const latest = latestVersion(db, id);
  const baseVersion = baseText === null && base != null ? db.prepare('SELECT * FROM note_versions WHERE note_id = ? AND seq = ? AND deleted_at IS NULL').get(id, Number(base)) : null;
  const known = baseText ?? baseVersion?.body ?? null;
  const moved = baseText !== null ? note.body !== baseText : Boolean(latest && baseVersion && latest.seq > baseVersion.seq && note.body !== baseVersion.body);
  if (!moduleOn(db, 'writing') || body === undefined || known === null || !moved) {
    return { note: updateNote(db, id, { title, body, home_id: homeId, author }), merged: false, clashes: [] };
  }
  const mine = winner === 'incoming' ? body : note.body;
  const theirs = winner === 'incoming' ? note.body : body;
  const result = merge3(known, mine, theirs);
  const label = result.clashes.length ? 'Merged, with a clash' : 'Merged';
  const saved = updateNote(db, id, { title, body: result.text, home_id: homeId, author, label });
  const version = latestVersion(db, id);
  const ids = result.clashes.length ? recordClashes(db, id, result.clashes, { theirsText: theirs, theirsAuthor: winner === 'incoming' ? (latest?.author ?? 'assistant') : author, versionId: version?.id }) : [];
  return { note: saved, merged: true, clashes: ids.map((cid) => getClash(db, cid)) };
}

export function getClash(db, id) {
  const r = db.prepare('SELECT * FROM note_clashes WHERE id = ?').get(id);
  return r ? clashRow(r) : null;
}

export function listClashes(db, noteId, { open = true } = {}) {
  return db.prepare(`SELECT * FROM note_clashes WHERE note_id = ? ${open ? "AND state = 'open'" : ''} ORDER BY created_at, rowid`).all(noteId).map(clashRow);
}

// The choice: mine (keep what is in the note), theirs (the other side's lines instead), both (yours, then theirs). One more version, and the
// clash is closed; your assistant is told in its next turn.
export function resolveClash(db, id, choice) {
  const clash = db.prepare('SELECT * FROM note_clashes WHERE id = ?').get(id);
  if (!clash) throw fail(404, 'No such clash.');
  if (clash.state !== 'open') throw fail(409, 'That clash was settled already.');
  if (!['mine', 'theirs', 'both'].includes(choice)) throw fail(400, 'Choose yours, the assistant’s, or both.');
  const note = getNote(db, clash.note_id);
  if (!note) throw fail(404, 'No such note.');
  let body = note.body;
  const at = clash.mine ? body.indexOf(clash.mine) : -1;
  if (choice !== 'mine') {
    if (clash.mine && at < 0) throw fail(409, 'That line was changed since. Edit the note by hand.', 'moved');
    const gap = note.body.includes('\n\n') ? '\n\n' : '\n'; // lines of a note written in paragraphs stay paragraphs
    const replacement = choice === 'theirs' ? clash.theirs : `${clash.mine}${gap}${clash.theirs}`;
    body = clash.mine ? body.slice(0, at) + replacement + body.slice(at + clash.mine.length) : `${body}\n${replacement}`;
  }
  const label = { mine: 'Kept yours', theirs: 'Took the assistant’s side', both: 'Kept both' }[choice];
  db.exec('SAVEPOINT clash');
  try {
    if (body !== note.body) updateNote(db, note.id, { body, label });
    else writeVersion(db, note.id, { title: note.title, body, label, force: true }); // keeping yours changes no word: the choice is still a version
    db.prepare('UPDATE note_clashes SET state = ?, updated_at = ?, resolved_at = ? WHERE id = ?').run(choice, now(), now(), id);
    db.exec('RELEASE clash');
  } catch (err) { db.exec('ROLLBACK TO clash'); db.exec('RELEASE clash'); throw err; }
  return getClash(db, id);
}

// What your assistant is told in its next turn about clashes settled since it last heard: which side won.
export function takeClashNotes(db) {
  const rows = db.prepare(`SELECT c.*, n.title AS note_title FROM note_clashes c JOIN notes n ON n.id = c.note_id WHERE c.state <> 'open' AND c.told = 0 ORDER BY c.resolved_at`).all();
  const notes = rows.map((c) => {
    const side = { mine: `the owner's words won: “${c.mine}”; your text “${c.theirs}” was not kept`, theirs: `your text won: “${c.theirs}”; the owner's words “${c.mine}” were replaced`, both: `both were kept: “${c.mine}” and “${c.theirs}”` }[c.state];
    return `On the note “${c.note_title.trim() || 'Untitled'}” you and the owner changed the same line, and ${side}. Never build on a line that is gone.`;
  });
  if (rows.length) db.prepare(`UPDATE note_clashes SET told = 1 WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id));
  return notes;
}
