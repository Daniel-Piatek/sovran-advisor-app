// Comments on a passage (advanced/writing/3): the words you mean are the anchor; a thread of replies hangs on it, yours and your assistant's.
// Each open comment has one decision: ask your assistant now (a turn in its chat; the answer lands in the thread, signed) or leave it for
// later (on its list; "go through my comments" answers each). Rows only: the note's text is never touched.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message, code = '') => Object.assign(new Error(message), { status, code });
const MAX_BODY = 5000;
const MAX_ANCHOR = 500;

const shape = (r) => ({ id: r.id, ref_table: r.ref_table, ref_id: r.ref_id, anchor: r.anchor, occurrence: r.occurrence, body: r.body, author: r.author, parent_id: r.parent_id,
  resolved: Boolean(r.resolved_at), ask: r.ask, created_at: r.created_at });

export function getComment(db, id) {
  const r = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(id);
  return r ? shape(r) : null;
}

// A comment on words of a note.
export function createComment(db, noteId, { anchor, occurrence = 0, body, author = 'me' }) {
  if (!db.prepare('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId)) throw fail(404, 'No such note.');
  const words = String(body ?? '').trim();
  if (!words) throw fail(400, 'Write the comment first.');
  if (words.length > MAX_BODY) throw fail(400, `A comment is at most ${MAX_BODY} characters.`);
  const quote = String(anchor ?? '').trim();
  if (!quote) throw fail(400, 'Select the words you mean first.');
  if (quote.length > MAX_ANCHOR) throw fail(400, `Select at most ${MAX_ANCHOR} characters.`);
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO comments (id, created_at, updated_at, origin, ref_table, ref_id, anchor, occurrence, body, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, author === 'assistant' ? 'assistant' : 'typed', 'notes', noteId, quote, Math.max(0, Math.trunc(Number(occurrence)) || 0), words, author);
  return getComment(db, id);
}

// A reply in a thread. Yours leaves the thread as it is; your assistant's answers it.
export function replyTo(db, parentId, { body, author = 'me' }) {
  const parent = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(parentId);
  if (!parent) throw fail(404, 'No such comment.');
  const top = parent.parent_id ? db.prepare('SELECT * FROM comments WHERE id = ?').get(parent.parent_id) : parent;
  const words = String(body ?? '').trim();
  if (!words) throw fail(400, 'Write the reply first.');
  if (words.length > MAX_BODY) throw fail(400, `A reply is at most ${MAX_BODY} characters.`);
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO comments (id, created_at, updated_at, origin, ref_table, ref_id, anchor, occurrence, body, author, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, author === 'assistant' ? 'assistant' : 'typed', top.ref_table, top.ref_id, '', 0, words, author, top.id);
  if (author === 'assistant') db.prepare("UPDATE comments SET ask = 'answered', updated_at = ? WHERE id = ?").run(time, top.id);
  return getComment(db, id);
}

// The threads of a note, oldest first, each with its replies.
export function listThreads(db, noteId) {
  const rows = db.prepare("SELECT * FROM comments WHERE ref_table = 'notes' AND ref_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid").all(noteId).map(shape);
  const replies = new Map();
  for (const r of rows) if (r.parent_id) replies.set(r.parent_id, [...(replies.get(r.parent_id) ?? []), r]);
  return rows.filter((r) => !r.parent_id).map((r) => ({ ...r, replies: replies.get(r.id) ?? [] }));
}

// Resolve or reopen a thread; set what is asked of your assistant. Anything else is refused.
export function changeComment(db, id, { resolved, ask }) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL AND parent_id IS NULL').get(id);
  if (!c) throw fail(404, 'No such comment.');
  const time = now();
  if (resolved !== undefined) db.prepare('UPDATE comments SET resolved_at = ?, updated_at = ? WHERE id = ?').run(resolved ? time : null, time, id);
  if (ask !== undefined) {
    if (!['', 'later', 'asked', 'answered'].includes(ask)) throw fail(400, 'ask is later, asked or answered.');
    db.prepare('UPDATE comments SET ask = ?, updated_at = ? WHERE id = ?').run(ask, time, id);
  }
  return getComment(db, id);
}

export function deleteComment(db, id) {
  const time = now();
  db.prepare('UPDATE comments SET deleted_at = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL').run(time, id, id);
}

// What your assistant is to go through: comments left for later, with their thread so far.
export function laterComments(db) {
  const rows = db.prepare("SELECT c.*, n.title AS note_title FROM comments c JOIN notes n ON n.id = c.ref_id AND n.deleted_at IS NULL WHERE c.ref_table = 'notes' AND c.parent_id IS NULL AND c.ask = 'later' AND c.resolved_at IS NULL AND c.deleted_at IS NULL ORDER BY c.created_at").all();
  return rows.map((c) => ({ comment_id: c.id, note_id: c.ref_id, note_title: c.note_title.trim() || 'Untitled', passage: c.anchor, comment: c.body,
    thread: db.prepare('SELECT author, body FROM comments WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(c.id).map((r) => ({ author: r.author, text: r.body })) }));
}

// The message that asks your assistant to answer one comment.
export function askText(db, id) {
  const c = db.prepare('SELECT c.*, n.title AS note_title FROM comments c JOIN notes n ON n.id = c.ref_id WHERE c.id = ? AND c.parent_id IS NULL AND c.deleted_at IS NULL').get(id);
  if (!c) throw fail(404, 'No such comment.');
  return `Answer this comment I left on my note “${c.note_title.trim() || 'Untitled'}” (/notes/${c.ref_id}).\nThe passage I mean: “${c.anchor}”\nMy comment (id ${c.id}): ${c.body}\nRead the note if you need more of it, then write your answer in the comment's thread with the reply_to_comment tool.`;
}
