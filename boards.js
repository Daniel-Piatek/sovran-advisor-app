// Boards (advanced/writing/6): a canvas in a note, made of rows. A board has cards, words and arrows; a card can point at a note, a person
// or a task of the app and then shows it live, read from its row every time, never a copy. A line of the note's text, a link to
// /boards/<id>, is where the board sits. Deleting only marks.
// Boards of their own (schema 72 here, 75 in APP Daniel; the Boards tab of Notes, 2026-11-15, the owner's wish): a board with no note is endless, a canvas of
// ENDLESS_SIZE units each way that you move around and zoom in, started in its middle. Its cards can also point at a journal entry or an
// Inbox item; a quick card's words can become a real note (the card then points at it); a group is a coloured box with a name, and the
// cards inside it move with it.

import { randomUUID } from 'node:crypto';
import { createNote } from './notes.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 700;
export const ENDLESS_SIZE = 20000;
const KINDS = ['card', 'text', 'arrow', 'group'];
const REFS = ['notes', 'people', 'tasks', 'journal_entries', 'captures'];
// A group's colours, by name: the page draws each from a design token (style.css, .board-group.is-<colour>). Crimson is kept for the one accent.
export const GROUP_COLORS = ['goal', 'life', 'notes', 'people', 'tasks', 'plain']; // the kinds' colours, named in COLOUR_WORDS
const COLOUR_WORDS = { goal: 'gold colour', life: 'green colour', notes: 'blue colour', people: 'violet colour', tasks: 'orange colour', plain: 'grey colour' }; // said to your assistant
const MAX_TEXT = 2000;
const DEFAULT_SIZE = { card: { w: 280, h: 100 }, text: { w: 360, h: 50 }, arrow: { w: 0, h: 0 }, group: { w: 640, h: 420 } };
const MIN_GROUP = { w: 160, h: 100 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// How large a board's canvas is: 1200 by 700 for a board in a note, ENDLESS_SIZE each way for one of its own.
export function boardSize(db, boardId) {
  const b = db.prepare('SELECT endless FROM boards WHERE id = ?').get(boardId);
  return b?.endless ? { width: ENDLESS_SIZE, height: ENDLESS_SIZE } : { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

export function createBoard(db, { note_id: noteId = null, title = '', origin = 'typed', endless = false } = {}) {
  if (noteId && !db.prepare('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId)) throw fail(404, 'No such note.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO boards (id, created_at, updated_at, origin, note_id, title, endless) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, time, time, origin, noteId, String(title).slice(0, 200), endless && !noteId ? 1 : 0);
  return getBoard(db, id);
}

const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*(#+|[-*+]|\d+[.)])\s+/, '').replace(/^\s*\[[ xX]\]\s+/, '').trim()).find(Boolean) ?? '';
const restOf = (text) => { const lines = String(text ?? '').split('\n').map((l) => l.replace(/^\s*(#+|[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean); return lines.slice(1).join(' '); };
const dayWords = (day) => { const d = new Date(`${day}T12:00:00`); return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };

// What a card that points at something shows: its words as they are now.
function live(db, item) {
  if (item.ref_table === 'notes') {
    const n = db.prepare('SELECT id, title, body FROM notes WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    if (!n) return { missing: true, kind: 'note' };
    return { kind: 'note', title: n.title.trim() || 'Untitled', sub: firstLine(n.body).slice(0, 140), path: `/notes/${n.id}` };
  }
  if (item.ref_table === 'people') {
    const p = db.prepare('SELECT id, name FROM people WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    return p ? { kind: 'person', title: p.name, sub: '', path: `/people/${p.id}` } : { missing: true, kind: 'person' };
  }
  if (item.ref_table === 'tasks') {
    const t = db.prepare('SELECT id, text, due, done FROM tasks WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    return t ? { kind: 'task', title: t.text, sub: [t.done ? 'Done' : '', t.due && t.due !== 'someday' ? `due ${t.due}` : ''].filter(Boolean).join(' · '), path: '/tasks' } : { missing: true, kind: 'task' };
  }
  if (item.ref_table === 'journal_entries') {
    const e = db.prepare('SELECT id, day, title, body FROM journal_entries WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    if (!e) return { missing: true, kind: 'journal' };
    const title = e.title.trim() || firstLine(e.body) || dayWords(e.day);
    const sub = e.title.trim() ? firstLine(e.body) : restOf(e.body);
    return { kind: 'journal', title: title.slice(0, 200), sub: sub.slice(0, 140), day: e.day, when: dayWords(e.day), path: `/journal/entries/${e.id}` };
  }
  if (item.ref_table === 'captures') {
    const c = db.prepare('SELECT id, body, state FROM captures WHERE id = ? AND deleted_at IS NULL').get(item.ref_id);
    if (!c) return { missing: true, kind: 'inbox' };
    return { kind: 'inbox', title: (firstLine(c.body) || 'Inbox item').slice(0, 200), sub: restOf(c.body).slice(0, 140), path: '/inbox' };
  }
  return null;
}

const itemOut = (db, r) => ({
  id: r.id, board_id: r.board_id, kind: r.kind, ref_table: r.ref_table, ref_id: r.ref_id, text: r.text, x: r.x, y: r.y, w: r.w, h: r.h,
  from_id: r.from_id, to_id: r.to_id, label: r.label, color: r.color ?? '', origin: r.origin, change_id: r.change_id, ...(r.ref_table ? { live: live(db, r) } : {}),
});

export function getBoard(db, id) {
  const b = db.prepare('SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!b) return null;
  const items = db.prepare('SELECT * FROM board_items WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(id).map((r) => itemOut(db, r));
  const note = b.note_id ? db.prepare('SELECT id, title FROM notes WHERE id = ? AND deleted_at IS NULL').get(b.note_id) : null;
  const strokes = db.prepare('SELECT * FROM ink_strokes WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(id).map((r) => ({ id: r.id, board_id: r.board_id, points: JSON.parse(r.points), faded: r.faded === 1, text_item_id: r.text_item_id }));
  const background = b.background_file ? { sha256: b.background_file, name: b.background_name, type: b.background_type } : null;
  const size = b.endless ? { width: ENDLESS_SIZE, height: ENDLESS_SIZE } : { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  return { id: b.id, note_id: b.note_id, note_title: note ? (note.title.trim() || 'Untitled') : '', title: b.title, origin: b.origin, endless: b.endless === 1, updated_at: b.updated_at, items, strokes, background, ...size };
}

// The boards of their own, for the Boards tab: newest change first, each with how many cards it has and the first few card names.
export function listOwnBoards(db) {
  const rows = db.prepare('SELECT * FROM boards WHERE deleted_at IS NULL AND note_id IS NULL AND endless = 1').all();
  const latest = db.prepare('SELECT max(updated_at) AS at FROM board_items WHERE board_id = ?');
  return rows.map((b) => {
    const board = getBoard(db, b.id);
    const cards = board.items.filter((i) => i.kind === 'card' || i.kind === 'text');
    const touched = [b.updated_at, latest.get(b.id).at ?? ''].sort().at(-1);
    return { id: b.id, title: b.title, created_at: b.created_at, updated_at: touched, cards: cards.length,
      names: cards.slice(0, 5).map((i) => (i.live && !i.live.missing ? i.live.title : i.text)).filter(Boolean) };
  }).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// The boards that sit in a note, listed under the boards of their own.
export function listNoteBoards(db) {
  return db.prepare(`SELECT b.id, b.title, n.id AS note_id, n.title AS note_title FROM boards b JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL
    WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC`).all().map((r) => ({ id: r.id, title: r.title, note_id: r.note_id, note_title: r.note_title.trim() || 'Untitled' }));
}

// Deleting a board only marks it; Undo brings it back.
export function deleteBoard(db, id) {
  if (!getBoard(db, id)) throw fail(404, 'No such board.');
  db.prepare('UPDATE boards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return { id, deleted: true };
}
export function restoreBoard(db, id) {
  if (!db.prepare('SELECT 1 FROM boards WHERE id = ? AND deleted_at IS NOT NULL').get(id)) throw fail(404, 'No such deleted board.');
  db.prepare('UPDATE boards SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return getBoard(db, id);
}

// What can be brought onto a board, found by its words: notes, journal entries and what waits in the Inbox. With no words, the newest.
export function boardSources(db, q = '', { limit = 12 } = {}) {
  const words = String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (cols) => (words.length ? `AND ${words.map(() => `lower(${cols}) LIKE ?`).join(' AND ')}` : '');
  const args = words.map((w) => `%${w.replace(/[%_]/g, '')}%`);
  const notes = db.prepare(`SELECT id FROM notes WHERE deleted_at IS NULL ${like("title || ' ' || body")} ORDER BY updated_at DESC LIMIT ?`).all(...args, limit);
  const entries = db.prepare(`SELECT id FROM journal_entries WHERE deleted_at IS NULL ${like("title || ' ' || body")} ORDER BY day DESC, written_at DESC LIMIT ?`).all(...args, limit);
  const inbox = db.prepare(`SELECT id FROM captures WHERE deleted_at IS NULL AND state = 'waiting' ${like('body')} ORDER BY captured_at DESC LIMIT ?`).all(...args, limit);
  const out = (refTable, rows) => rows.map((r) => ({ ref_table: refTable, ref_id: r.id, ...live(db, { ref_table: refTable, ref_id: r.id }) }));
  return { notes: out('notes', notes), journal: out('journal_entries', entries), inbox: out('captures', inbox) };
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
  if (!KINDS.includes(kind)) throw fail(400, 'kind is card, text, arrow or group.');
  const text = String(input.text ?? '').trim().slice(0, MAX_TEXT);
  const { width, height } = boardSize(db, boardId);
  let refTable = null;
  let refId = null;
  if (input.ref_table) {
    if (kind !== 'card' || !REFS.includes(input.ref_table) || !input.ref_id) throw fail(400, 'A card can point at a note, a person, a task, a journal entry or an Inbox item.');
    if (!live(db, { ref_table: input.ref_table, ref_id: String(input.ref_id) }) || live(db, { ref_table: input.ref_table, ref_id: String(input.ref_id) }).missing) throw fail(404, 'There is no such page to put on the board.');
    refTable = input.ref_table;
    refId = String(input.ref_id);
  }
  let fromId = null;
  let toId = null;
  if (kind === 'arrow') {
    fromId = String(input.from_id ?? '');
    toId = String(input.to_id ?? '');
    const there = (id) => db.prepare("SELECT 1 FROM board_items WHERE id = ? AND board_id = ? AND deleted_at IS NULL AND kind IN ('card', 'text')").get(id, boardId);
    if (!fromId || !toId || fromId === toId || !there(fromId) || !there(toId)) throw fail(400, 'An arrow joins two different cards of this board.');
  } else if (!text && !refTable && kind !== 'group') throw fail(400, 'Write something on it first.');
  let color = '';
  if (kind === 'group') {
    color = input.color ?? GROUP_COLORS[0];
    if (!GROUP_COLORS.includes(color)) throw fail(400, `A group's colour is one of ${GROUP_COLORS.join(', ')}.`);
  }
  const size = kind === 'group'
    ? { w: clamp(num(input.w, DEFAULT_SIZE.group.w), MIN_GROUP.w, width), h: clamp(num(input.h, DEFAULT_SIZE.group.h), MIN_GROUP.h, height) }
    : DEFAULT_SIZE[kind];
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO board_items (id, created_at, updated_at, origin, board_id, kind, ref_table, ref_id, text, x, y, w, h, from_id, to_id, label, change_id, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, origin, boardId, kind, refTable, refId, text,
    clamp(num(input.x, 40), 0, width - 40), clamp(num(input.y, 40), 0, height - 20), size.w, size.h, fromId, toId, String(input.label ?? '').slice(0, 200), changeId, color);
  return itemOut(db, db.prepare('SELECT * FROM board_items WHERE id = ?').get(id));
}

// Moves a card or changes its words. A group can also change its size and colour; moving a group moves the cards whose middle is inside it
// (and the groups wholly inside it), unless carry is false.
export function changeItem(db, id, input) {
  const r = db.prepare('SELECT * FROM board_items WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!r) throw fail(404, 'No such item.');
  const { width, height } = boardSize(db, r.board_id);
  const group = r.kind === 'group';
  const next = {
    x: 'x' in input ? clamp(num(input.x, r.x), 0, width - 40) : r.x,
    y: 'y' in input ? clamp(num(input.y, r.y), 0, height - 20) : r.y,
    text: 'text' in input ? String(input.text ?? '').trim().slice(0, MAX_TEXT) : r.text,
    label: 'label' in input ? String(input.label ?? '').slice(0, 200) : r.label,
    w: group && 'w' in input ? clamp(num(input.w, r.w), MIN_GROUP.w, width) : r.w,
    h: group && 'h' in input ? clamp(num(input.h, r.h), MIN_GROUP.h, height) : r.h,
    color: group && 'color' in input ? input.color : r.color,
  };
  if (group && !GROUP_COLORS.includes(next.color)) throw fail(400, `A group's colour is one of ${GROUP_COLORS.join(', ')}.`);
  if (!group && r.kind !== 'arrow' && !next.text && !r.ref_table) throw fail(400, 'Write something on it first.');
  const time = now();
  db.exec('SAVEPOINT change_item');
  try {
    const dx = next.x - r.x;
    const dy = next.y - r.y;
    if (group && input.carry !== false && (dx || dy)) {
      const inside = db.prepare("SELECT * FROM board_items WHERE board_id = ? AND deleted_at IS NULL AND id <> ? AND kind <> 'arrow'").all(r.board_id, id).filter((o) => (o.kind === 'group'
        ? o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h
        : o.x + o.w / 2 >= r.x && o.x + o.w / 2 <= r.x + r.w && o.y + o.h / 2 >= r.y && o.y + o.h / 2 <= r.y + r.h));
      const move = db.prepare('UPDATE board_items SET x = ?, y = ?, updated_at = ? WHERE id = ?');
      for (const o of inside) move.run(clamp(o.x + dx, 0, width - 40), clamp(o.y + dy, 0, height - 20), time, o.id);
    }
    db.prepare('UPDATE board_items SET x = ?, y = ?, text = ?, label = ?, w = ?, h = ?, color = ?, updated_at = ? WHERE id = ?').run(next.x, next.y, next.text, next.label, next.w, next.h, next.color, time, id);
    db.exec('RELEASE change_item');
  } catch (err) { db.exec('ROLLBACK TO change_item'); db.exec('RELEASE change_item'); throw err; }
  return itemOut(db, db.prepare('SELECT * FROM board_items WHERE id = ?').get(id));
}

// A quick card's words become a real note: the note is made (its title the first line, the rest its text) and the card points at it from now on.
export function cardToNote(db, id) {
  const r = db.prepare('SELECT * FROM board_items WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!r) throw fail(404, 'No such item.');
  if (!['card', 'text'].includes(r.kind) || r.ref_table) throw fail(400, 'Only a card with its own words can become a note.');
  const lines = r.text.split('\n');
  db.exec('SAVEPOINT card_note');
  try {
    const note = createNote(db, { title: lines[0].trim().slice(0, 200), body: lines.slice(1).join('\n').trim() });
    db.prepare("UPDATE board_items SET kind = 'card', ref_table = 'notes', ref_id = ?, text = '', w = max(w, 280), h = max(h, 100), updated_at = ? WHERE id = ?").run(note.id, now(), id);
    db.exec('RELEASE card_note');
    return { note_id: note.id, item: itemOut(db, db.prepare('SELECT * FROM board_items WHERE id = ?').get(id)) };
  } catch (err) { db.exec('ROLLBACK TO card_note'); db.exec('RELEASE card_note'); throw err; }
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
  const things = board.items.filter((i) => i.kind === 'card' || i.kind === 'text');
  const groups = board.items.filter((i) => i.kind === 'group').map((g) => `- Group “${g.text || 'Unnamed'}” (${COLOUR_WORDS[g.color] ?? g.color}) holds: ${things.filter((i) => i.x + i.w / 2 >= g.x && i.x + i.w / 2 <= g.x + g.w && i.y + i.h / 2 >= g.y && i.y + i.h / 2 <= g.y + g.h).map(name).join('; ') || 'nothing'}`);
  const lines = things.map((i) => `- ${i.kind === 'text' ? 'Text' : 'Card'} [${i.id}]: ${name(i)}${i.live && !i.live.missing ? ` — points to a ${i.live.kind}${i.live.sub ? `, ${i.live.sub}` : ''}` : ''}${i.origin === 'assistant' ? ' (drawn by the assistant)' : ''}`);
  const byId = new Map(things.map((i) => [i.id, i]));
  const arrows = board.items.filter((i) => i.kind === 'arrow').map((a) => `- ${name(byId.get(a.from_id) ?? { text: '?' })} → ${name(byId.get(a.to_id) ?? { text: '?' })}${a.label ? ` (${a.label})` : ''}`);
  const where = board.note_id ? ` in the note “${board.note_title}”` : ' (a board of its own)';
  return `Board “${board.title || 'Untitled board'}”${where}.\nCards:\n${lines.join('\n') || '(none)'}\nArrows:\n${arrows.join('\n') || '(none)'}${groups.length ? `\nGroups:\n${groups.join('\n')}` : ''}`;
}

// ---- Your assistant on a board (Writing 7) ----

export function listBoards(db) {
  return db.prepare(`SELECT b.id, b.title, n.title AS note_title, n.id AS note_id FROM boards b LEFT JOIN notes n ON n.id = b.note_id AND n.deleted_at IS NULL
    WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC`).all().map((r) => ({ board_id: r.id, title: r.title || 'Untitled board', note: r.note_title?.trim() || 'No note: a board of its own', note_id: r.note_id }));
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
  let spot = board.items.filter((i) => i.kind === 'card' || i.kind === 'text').length;
  // On an endless board the assistant's cards go under what is there, from its left edge (the middle when it is empty).
  const things = board.items.filter((i) => i.kind !== 'arrow');
  const origin = board.endless ? { x: things.length ? Math.min(...things.map((i) => i.x)) : ENDLESS_SIZE / 2, y: things.length ? Math.max(...things.map((i) => i.y + i.h)) + 80 : ENDLESS_SIZE / 2 } : { x: 40, y: 40 };
  if (board.endless) spot = 0;
  db.exec('SAVEPOINT draw');
  try {
    for (const item of plan.items.filter((p) => p.kind !== 'arrow')) {
      const at = { x: item.x ?? origin.x + (spot % 3) * 380, y: item.y ?? origin.y + (Math.floor(spot / 3) % 4) * 160 };
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
