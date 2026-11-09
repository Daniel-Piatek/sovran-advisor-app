// Boards (advanced/writing/6): a canvas in a note, made of rows. A board has cards, words and arrows; a card can point at a note, a person
// or a task of the app and then shows it live, read from its row every time, never a copy. A line of the note's text, a link to
// /boards/<id>, is where the board sits. Deleting only marks.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 700;
const KINDS = ['card', 'text', 'arrow'];
const REFS = ['notes', 'people', 'tasks'];
const MAX_TEXT = 2000;
const DEFAULT_SIZE = { card: { w: 280, h: 100 }, text: { w: 360, h: 50 }, arrow: { w: 0, h: 0 } };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function createBoard(db, { note_id: noteId = null, title = '', origin = 'typed' } = {}) {
  if (noteId && !db.prepare('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId)) throw fail(404, 'No such note.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO boards (id, created_at, updated_at, origin, note_id, title) VALUES (?, ?, ?, ?, ?, ?)').run(id, time, time, origin, noteId, String(title).slice(0, 200));
  return getBoard(db, id);
}

// What a card that points at something shows: its words as they are now.
function live(db, item) {
  if (item.ref_table === 'notes') {
    const n = db.prepare('SELECT id, title, body FROM notes WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    if (!n) return { missing: true, kind: 'note' };
    const first = n.body.split('\n').map((l) => l.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim()).find(Boolean) ?? '';
    return { kind: 'note', title: n.title.trim() || 'Untitled', sub: first.slice(0, 140), path: `/notes/${n.id}` };
  }
  if (item.ref_table === 'people') {
    const p = db.prepare('SELECT id, name FROM people WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    return p ? { kind: 'person', title: p.name, sub: '', path: `/people/${p.id}` } : { missing: true, kind: 'person' };
  }
  if (item.ref_table === 'tasks') {
    const t = db.prepare('SELECT id, text, due, done FROM tasks WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    return t ? { kind: 'task', title: t.text, sub: [t.done ? 'Done' : '', t.due && t.due !== 'someday' ? `due ${t.due}` : ''].filter(Boolean).join(' · '), path: '/tasks' } : { missing: true, kind: 'task' };
  }
  return null;
}

const itemOut = (db, r) => ({
  id: r.id, board_id: r.board_id, kind: r.kind, ref_table: r.ref_table, ref_id: r.ref_id, text: r.text, x: r.x, y: r.y, w: r.w, h: r.h,
  from_id: r.from_id, to_id: r.to_id, label: r.label, origin: r.origin, change_id: r.change_id, ...(r.ref_table ? { live: live(db, r) } : {}),
});

export function getBoard(db, id) {
  const b = db.prepare('SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!b) return null;
  const items = db.prepare('SELECT * FROM board_items WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(id).map((r) => itemOut(db, r));
  const note = b.note_id ? db.prepare('SELECT id, title FROM notes WHERE id = ? AND deleted_at IS NULL').get(b.note_id) : null;
  const strokes = db.prepare('SELECT * FROM ink_strokes WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(id).map((r) => ({ id: r.id, board_id: r.board_id, points: JSON.parse(r.points), faded: r.faded === 1, text_item_id: r.text_item_id }));
  const background = b.background_file ? { sha256: b.background_file, name: b.background_name, type: b.background_type } : null;
  return { id: b.id, note_id: b.note_id, note_title: note ? (note.title.trim() || 'Untitled') : '', title: b.title, origin: b.origin, items, strokes, background, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

export function renameBoard(db, id, title) {
  if (!getBoard(db, id)) throw fail(404, 'No such board.');
  db.prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?').run(String(title ?? '').slice(0, 200), now(), id);
  return getBoard(db, id);
}

// A page under the board (or none): a kept file, by its fingerprint. Pictures and PDFs only, as the files that are shown in the browser.
export function setBackground(db, id, file) {
  if (!getBoard(db, id)) throw fail(404, 'No such board.');
  if (file === null) {
    db.prepare("UPDATE boards SET background_file = NULL, background_name = '', background_type = '', updated_at = ? WHERE id = ?").run(now(), id);
    return getBoard(db, id);
  }
  const row = db.prepare('SELECT sha256, name, type FROM files WHERE sha256 = ?').get(String(file?.sha256 ?? ''));
  if (!row) throw fail(404, 'That file is not kept.');
  if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(row.type)) throw fail(400, 'A page is a picture or a PDF.');
  db.prepare('UPDATE boards SET background_file = ?, background_name = ?, background_type = ?, updated_at = ? WHERE id = ?').run(row.sha256, row.name, row.type, now(), id);
  return getBoard(db, id);
}

// Puts a card, words or an arrow on a board.
export function addItem(db, boardId, input, { origin = 'typed', changeId = null } = {}) {
  if (!db.prepare('SELECT 1 FROM boards WHERE id = ? AND deleted_at IS NULL').get(boardId)) throw fail(404, 'No such board.');
  const kind = input.kind;
  if (!KINDS.includes(kind)) throw fail(400, 'kind is card, text or arrow.');
  const text = String(input.text ?? '').trim().slice(0, MAX_TEXT);
  let refTable = null;
  let refId = null;
  if (input.ref_table) {
    if (kind !== 'card' || !REFS.includes(input.ref_table) || !input.ref_id) throw fail(400, 'A card can point at a note, a person or a task.');
    if (!live(db, { ref_table: input.ref_table, ref_id: String(input.ref_id) }) || live(db, { ref_table: input.ref_table, ref_id: String(input.ref_id) }).missing) throw fail(404, 'There is no such page to put on the board.');
    refTable = input.ref_table;
    refId = String(input.ref_id);
  }
  let fromId = null;
  let toId = null;
  if (kind === 'arrow') {
    fromId = String(input.from_id ?? '');
    toId = String(input.to_id ?? '');
    const there = (id) => db.prepare("SELECT 1 FROM board_items WHERE id = ? AND board_id = ? AND deleted_at IS NULL AND kind <> 'arrow'").get(id, boardId);
    if (!fromId || !toId || fromId === toId || !there(fromId) || !there(toId)) throw fail(400, 'An arrow joins two different cards of this board.');
  } else if (!text && !refTable) throw fail(400, 'Write something on it first.');
  const size = DEFAULT_SIZE[kind];
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO board_items (id, created_at, updated_at, origin, board_id, kind, ref_table, ref_id, text, x, y, w, h, from_id, to_id, label, change_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, origin, boardId, kind, refTable, refId, text,
    clamp(num(input.x, 40), 0, CANVAS_WIDTH - 40), clamp(num(input.y, 40), 0, CANVAS_HEIGHT - 20), size.w, size.h, fromId, toId, String(input.label ?? '').slice(0, 200), changeId);
  return itemOut(db, db.prepare('SELECT * FROM board_items WHERE id = ?').get(id));
}

// Moves a card or changes its words.
export function changeItem(db, id, input) {
  const r = db.prepare('SELECT * FROM board_items WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!r) throw fail(404, 'No such item.');
  const next = {
    x: 'x' in input ? clamp(num(input.x, r.x), 0, CANVAS_WIDTH - 40) : r.x,
    y: 'y' in input ? clamp(num(input.y, r.y), 0, CANVAS_HEIGHT - 20) : r.y,
    text: 'text' in input ? String(input.text ?? '').trim().slice(0, MAX_TEXT) : r.text,
    label: 'label' in input ? String(input.label ?? '').slice(0, 200) : r.label,
  };
  db.prepare('UPDATE board_items SET x = ?, y = ?, text = ?, label = ?, updated_at = ? WHERE id = ?').run(next.x, next.y, next.text, next.label, now(), id);
  return itemOut(db, db.prepare('SELECT * FROM board_items WHERE id = ?').get(id));
}

// Takes a card off the board, with the arrows that joined it.
export function removeItem(db, id) {
  const r = db.prepare('SELECT * FROM board_items WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!r) throw fail(404, 'No such item.');
  const time = now();
  db.prepare('UPDATE board_items SET deleted_at = ? WHERE id = ? OR from_id = ? OR to_id = ?').run(time, id, id, id);
  return { removed: true, board_id: r.board_id };
}

// The board as short text, for your assistant (Writing 7): each card with its words and what it points to, each arrow as "from → to".
export function boardText(db, id) {
  const board = getBoard(db, id);
  if (!board) return null;
  const name = (item) => (item.live && !item.live.missing ? `${item.live.title}${item.text ? ` (“${item.text}”)` : ''}` : item.text || 'Removed page');
  const things = board.items.filter((i) => i.kind !== 'arrow');
  const lines = things.map((i) => `- ${i.kind === 'text' ? 'Text' : 'Card'} [${i.id}]: ${name(i)}${i.live && !i.live.missing ? ` — points to a ${i.live.kind}${i.live.sub ? `, ${i.live.sub}` : ''}` : ''}${i.origin === 'assistant' ? ' (drawn by the assistant)' : ''}`);
  const byId = new Map(things.map((i) => [i.id, i]));
  const arrows = board.items.filter((i) => i.kind === 'arrow').map((a) => `- ${name(byId.get(a.from_id) ?? { text: '?' })} → ${name(byId.get(a.to_id) ?? { text: '?' })}${a.label ? ` (${a.label})` : ''}`);
  return `Board “${board.title || 'Untitled board'}” in the note “${board.note_title}”.\nCards:\n${lines.join('\n') || '(none)'}\nArrows:\n${arrows.join('\n') || '(none)'}`;
}

// ---- Your assistant on a board (Writing 7) ----

export function listBoards(db) {
  return db.prepare(`SELECT b.id, b.title, n.title AS note_title, n.id AS note_id FROM boards b LEFT JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL
    WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC`).all().map((r) => ({ board_id: r.id, title: r.title || 'Untitled board', note: r.note_title?.trim() || 'No note', note_id: r.note_id }));
}

const MAX_DRAWN = 20;

// What your assistant asks to draw, checked before it is shown on a card: new cards and words (with a key of their own to point arrows at) and
// arrows between cards that are there or new. Returns the plan, or throws what is wrong.
export function planDrawing(db, boardId, items) {
  const board = getBoard(db, boardId);
  if (!board) throw fail(404, 'No such board. Use board_read without an id to see the boards.');
  if (!Array.isArray(items) || !items.length) throw fail(400, 'items is a list of cards and arrows to draw.');
  if (items.length > MAX_DRAWN) throw fail(400, `Draw at most ${MAX_DRAWN} things at once.`);
  const keys = new Set();
  const there = new Set(board.items.filter((i) => i.kind !== 'arrow').map((i) => i.id));
  const plan = [];
  for (const raw of items) {
    const kind = raw?.kind;
    if (kind === 'arrow') {
      plan.push({ kind, from: String(raw.from ?? ''), to: String(raw.to ?? ''), label: String(raw.label ?? '').slice(0, 200) });
    } else if (kind === 'card' || kind === 'text') {
      const text = String(raw.text ?? '').trim();
      if (!text) throw fail(400, 'A card or text needs its words.');
      const key = String(raw.key ?? '');
      if (key) { if (keys.has(key)) throw fail(400, `Two items have the key ${key}.`); keys.add(key); }
      plan.push({ kind, key, text: text.slice(0, MAX_TEXT), ...(Number.isFinite(Number(raw.x)) && raw.x !== undefined ? { x: Number(raw.x) } : {}), ...(Number.isFinite(Number(raw.y)) && raw.y !== undefined ? { y: Number(raw.y) } : {}) });
    } else throw fail(400, 'Each item is a card, text or arrow.');
  }
  for (const item of plan.filter((p) => p.kind === 'arrow')) {
    for (const end of [item.from, item.to]) if (!there.has(end) && !keys.has(end)) throw fail(400, `An arrow points at “${end}”, which is neither a card of the board nor a new one (give new ones a key).`);
    if (item.from === item.to) throw fail(400, 'An arrow joins two different cards.');
  }
  return { board_id: boardId, board_title: board.title || 'Untitled board', items: plan };
}

// Draws a plan: every item carries origin assistant and the id of this one change, so Undo takes the whole change back.
export function drawPlan(db, plan, changeId) {
  const made = new Map();
  const out = [];
  const board = getBoard(db, plan.board_id);
  if (!board) throw fail(409, 'That board is gone.');
  let spot = board.items.filter((i) => i.kind !== 'arrow').length;
  db.exec('SAVEPOINT draw');
  try {
    for (const item of plan.items.filter((p) => p.kind !== 'arrow')) {
      const at = { x: item.x ?? 40 + (spot % 3) * 380, y: item.y ?? 40 + (Math.floor(spot / 3) % 4) * 160 };
      spot += 1;
      const row = addItem(db, plan.board_id, { kind: item.kind, text: item.text, ...at }, { origin: 'assistant', changeId });
      if (item.key) made.set(item.key, row.id);
      out.push(row);
    }
    for (const item of plan.items.filter((p) => p.kind === 'arrow')) {
      out.push(addItem(db, plan.board_id, { kind: 'arrow', from_id: made.get(item.from) ?? item.from, to_id: made.get(item.to) ?? item.to, label: item.label }, { origin: 'assistant', changeId }));
    }
    db.exec('RELEASE draw');
  } catch (err) { db.exec('ROLLBACK TO draw'); db.exec('RELEASE draw'); throw err; }
  return out;
}

// Takes back the whole of one change: everything it drew goes, nothing else.
export function undoChange(db, changeId) {
  db.prepare('UPDATE board_items SET deleted_at = ? WHERE change_id = ? AND deleted_at IS NULL').run(now(), changeId);
}
