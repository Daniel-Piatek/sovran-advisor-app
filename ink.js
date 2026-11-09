// The pen on a board (advanced/writing/8): ink is kept as it was drawn. A stroke is a row of points, each [x, y, pressure, ms since the stroke
// began]; the line is drawn thicker where you pressed harder, and time and pressure are kept from the first stroke because they cannot be
// found again later. "To text" reads a group of strokes with your assistant (your own Claude plan, no key of mine) and puts the words on the
// board as an ordinary text item; the ink is never deleted, only faded below the words, and your corrections to the words win.

import { randomUUID } from 'node:crypto';
import { addItem, getBoard, CANVAS_WIDTH, CANVAS_HEIGHT } from './boards.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const MAX_POINTS = 5000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// A stroke as it is kept: numbers only, on the canvas, pressure 0 to 1 (0.5 for a mouse), time in ms from the first point.
export function cleanPoints(points) {
  if (!Array.isArray(points) || points.length < 1) throw fail(400, 'A stroke is a list of points: [x, y, pressure, ms].');
  if (points.length > MAX_POINTS) throw fail(413, `A stroke has at most ${MAX_POINTS} points.`);
  return points.map((p) => {
    if (!Array.isArray(p) || p.length < 2 || p.some((v) => v !== undefined && !Number.isFinite(Number(v)))) throw fail(400, 'Each point is [x, y, pressure, ms], all numbers.');
    const [x, y, pressure = 0.5, ms = 0] = p.map(Number);
    return [Math.round(clamp(x, 0, CANVAS_WIDTH) * 10) / 10, Math.round(clamp(y, 0, CANVAS_HEIGHT) * 10) / 10, Math.round(clamp(pressure, 0, 1) * 100) / 100, Math.max(0, Math.round(ms))];
  });
}

export function addStroke(db, boardId, points, { origin = 'typed' } = {}) {
  if (!db.prepare('SELECT 1 FROM boards WHERE id = ? AND deleted_at IS NULL').get(boardId)) throw fail(404, 'No such board.');
  const clean = cleanPoints(points);
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO ink_strokes (id, created_at, updated_at, origin, board_id, points) VALUES (?, ?, ?, ?, ?, ?)').run(id, time, time, origin, boardId, JSON.stringify(clean));
  return strokeOut(db.prepare('SELECT * FROM ink_strokes WHERE id = ?').get(id));
}

const strokeOut = (r) => ({ id: r.id, board_id: r.board_id, points: JSON.parse(r.points), faded: r.faded === 1, text_item_id: r.text_item_id });

export const listStrokes = (db, boardId) => db.prepare('SELECT * FROM ink_strokes WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(boardId).map(strokeOut);

// Takes a stroke away (marks it deleted, as everywhere).
export function removeStroke(db, id) {
  const done = db.prepare('UPDATE ink_strokes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), id);
  if (!done.changes) throw fail(404, 'No such stroke.');
  return { removed: true };
}

// The words of a group of strokes, as an ordinary text item under which the ink fades. x and y: where the group was drawn.
export function strokesToText(db, boardId, strokeIds, words, { x = 40, y = 40 } = {}) {
  const board = getBoard(db, boardId);
  if (!board) throw fail(404, 'No such board.');
  const text = String(words ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw fail(422, 'Nothing could be read from that handwriting. The ink is as it was.');
  const ids = [...new Set((Array.isArray(strokeIds) ? strokeIds : []).map(String))];
  const mine = db.prepare(`SELECT id FROM ink_strokes WHERE board_id = ? AND deleted_at IS NULL AND text_item_id IS NULL AND id IN (${ids.map(() => '?').join(',') || "''"})`).all(boardId, ...ids);
  if (!mine.length) throw fail(400, 'Pick strokes of this board that are not words yet.');
  db.exec('SAVEPOINT ink_text');
  try {
    const item = addItem(db, boardId, { kind: 'text', text, x, y });
    const mark = db.prepare('UPDATE ink_strokes SET faded = 1, text_item_id = ?, updated_at = ? WHERE id = ?');
    for (const s of mine) mark.run(item.id, now(), s.id);
    db.exec('RELEASE ink_text');
    return item;
  } catch (err) { db.exec('ROLLBACK TO ink_text'); db.exec('RELEASE ink_text'); throw err; }
}
