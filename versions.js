// Versions of a note (advanced/writing/4): every save is kept, with its author and time, in the same step as the save. Two versions are
// compared word by word, and Restore brings an old text back as the next version, never over one. Only while the module is on.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

const shape = (r) => ({ id: r.id, note_id: r.note_id, seq: r.seq, title: r.title, body: r.body, author: r.author, label: r.label, created_at: r.created_at });

// Keeps the text as the next version. Only while the module is on. Returns it, or null.
export function writeVersion(db, noteId, { title, body, author = 'me', label = '', force = false }) {
  if (!moduleOn(db, 'writing')) return null;
  const last = db.prepare('SELECT seq, title, body FROM note_versions WHERE note_id = ? ORDER BY seq DESC LIMIT 1').get(noteId);
  if (!force && last && last.title === title && last.body === body) return null; // nothing new
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO note_versions (id, created_at, updated_at, origin, note_id, seq, title, body, author, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, author === 'assistant' ? 'assistant' : 'typed', noteId, (last?.seq ?? 0) + 1, title, body, author, label);
  return getVersion(db, id);
}

export function getVersion(db, id) {
  const r = db.prepare('SELECT * FROM note_versions WHERE id = ? AND deleted_at IS NULL').get(id);
  return r ? shape(r) : null;
}

export const latestVersion = (db, noteId) => {
  const r = db.prepare('SELECT * FROM note_versions WHERE note_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1').get(noteId);
  return r ? shape(r) : null;
};

// The words of a text (whitespace kept with them), for counting and comparing.
const tokens = (text) => text.match(/\s+|[^\s]+/g) ?? [];
const wordCount = (text) => (text.match(/[^\s]+/g) ?? []).length;

// A word-by-word difference: [{ t: 'same' | 'add' | 'del', text }]. Common beginning and end first, then the longest common run of words.
export function diffWords(from, to) {
  const a = tokens(from);
  const b = tokens(to);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const parts = [];
  const push = (t, words) => { const text = words.join(''); if (!text) return; const last = parts.at(-1); if (last && last.t === t) last.text += text; else parts.push({ t, text }); };
  push('same', a.slice(0, start));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > 4_000_000) { push('del', midA); push('add', midB); } else {
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const lcs = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) lcs[i * cols + j] = midA[i] === midB[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { push('same', [midA[i]]); i++; j++; } else if (i < midA.length && (j === midB.length || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])) { push('del', [midA[i]]); i++; } else { push('add', [midB[j]]); j++; } // removed words first, then the added ones
    }
  }
  push('same', a.slice(endA));
  return parts;
}

// What changed, in a few words.
function summary(prev, v) {
  if (!prev) return 'First version';
  const parts = [];
  const delta = wordCount(v.body) - wordCount(prev.body);
  const diff = diffWords(prev.body, v.body);
  const added = diff.filter((p) => p.t === 'add').reduce((n, p) => n + wordCount(p.text), 0);
  const removed = diff.filter((p) => p.t === 'del').reduce((n, p) => n + wordCount(p.text), 0);
  if (added) parts.push(`${added} ${added === 1 ? 'word' : 'words'} added`);
  if (removed) parts.push(`${removed} ${removed === 1 ? 'word' : 'words'} removed`);
  if (v.title !== prev.title) parts.push('title changed');
  void delta;
  return parts.join(', ') || 'No words changed';
}

// The versions of a note, newest first. A note written before the module was on gets its present text as the first one.
export function listVersions(db, noteId) {
  const note = db.prepare('SELECT title, body FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
  if (!note) return null;
  const last = latestVersion(db, noteId);
  if (!last || last.title !== note.title || last.body !== note.body) writeVersion(db, noteId, { title: note.title, body: note.body, author: 'me', label: last ? 'The note as it was found' : '' });
  const rows = db.prepare('SELECT * FROM note_versions WHERE note_id = ? AND deleted_at IS NULL ORDER BY seq').all(noteId).map(shape);
  return rows.map((v, i) => ({ id: v.id, seq: v.seq, author: v.author, label: v.label, created_at: v.created_at, title: v.title, words: wordCount(v.body), summary: summary(rows[i - 1], v) })).reverse();
}

// Two versions compared: the older to the newer.
export function compareVersions(db, aId, bId) {
  const a = getVersion(db, aId);
  const b = getVersion(db, bId);
  if (!a || !b || a.note_id !== b.note_id) throw fail(404, 'No such versions.');
  const [from, to] = a.seq <= b.seq ? [a, b] : [b, a];
  return { from: { id: from.id, seq: from.seq, author: from.author, created_at: from.created_at }, to: { id: to.id, seq: to.seq, author: to.author, created_at: to.created_at }, parts: diffWords(from.body, to.body), title_changed: from.title !== to.title };
}
