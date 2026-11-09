// The pen on a board (ink.js, advanced/writing/8): strokes kept with pressure and time; reading them as words fades the ink, never deletes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createBoard, getBoard, setBackground, changeItem } from '../../boards.js';
import { addStroke, removeStroke, cleanPoints, listStrokes, strokesToText, MAX_POINTS } from '../../ink.js';
import { storeBuffer } from '../../files.js';
import { strokePath } from '../../public/ink.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a stroke is kept as drawn: points with pressure and the time since the stroke began; a mouse is 0.5', () => {
  const db = emptyDb();
  const board = createBoard(db, {});
  const light = addStroke(db, board.id, [[10, 10, 0.1, 0], [50, 12, 0.2, 16], [90, 15, 0.3, 33]]);
  const hard = addStroke(db, board.id, [[10, 40, 0.9, 0], [50, 42, 1, 20]]);
  const mouse = addStroke(db, board.id, [[10, 80], [60, 82]]);
  assert.deepEqual(light.points[1], [50, 12, 0.2, 16]);
  assert.deepEqual(mouse.points, [[10, 80, 0.5, 0], [60, 82, 0.5, 0]]);
  assert.equal(listStrokes(db, board.id).length, 3);
  assert.deepEqual(getBoard(db, board.id).strokes.map((s) => s.id), [light.id, hard.id, mouse.id]);
  assert.deepEqual(cleanPoints([[-5, 9999, 7, -3]]), [[0, 700, 1, 0]], 'kept on the canvas, pressure 0 to 1');
});

test('what is refused: no points, a point that is not numbers, a stroke that is too long, a board that is not there', () => {
  const db = emptyDb();
  const board = createBoard(db, {});
  assert.throws(() => addStroke(db, board.id, []), /list of points/);
  assert.throws(() => addStroke(db, board.id, [[1, 'x']]), /all numbers/);
  assert.throws(() => addStroke(db, board.id, Array.from({ length: MAX_POINTS + 1 }, () => [1, 1])), (e) => e.status === 413);
  assert.throws(() => addStroke(db, '00000000-0000-4000-8000-000000000000', [[1, 1]]), (e) => e.status === 404);
});

test('To text: the words become a text item; the ink fades below them and is not deleted; a stroke already read is not read again', () => {
  const db = emptyDb();
  const board = createBoard(db, {});
  const a = addStroke(db, board.id, [[100, 100, 0.5, 0], [140, 100, 0.5, 10]]);
  const b = addStroke(db, board.id, [[100, 130, 0.5, 0], [140, 130, 0.5, 10]]);
  const item = strokesToText(db, board.id, [a.id, b.id], '  longer?  ', { x: 90, y: 90 });
  assert.deepEqual([item.kind, item.text, item.x, item.y], ['text', 'longer?', 90, 90]);
  const strokes = getBoard(db, board.id).strokes;
  assert.deepEqual(strokes.map((s) => [s.faded, s.text_item_id]), [[true, item.id], [true, item.id]]);
  assert.throws(() => strokesToText(db, board.id, [a.id], 'again', {}), /not words yet/);
  // your correction wins: a later reading never touches the text
  changeItem(db, item.id, { text: 'longer day?' });
  assert.equal(getBoard(db, board.id).items.find((i) => i.id === item.id).text, 'longer day?');
  assert.throws(() => strokesToText(db, board.id, [], 'x', {}), /not words yet/);
  const c = addStroke(db, board.id, [[1, 1, 0.5, 0]]);
  assert.throws(() => strokesToText(db, board.id, [c.id], '   ', {}), (e) => e.status === 422, 'nothing read: the ink stays as it was');
  assert.equal(getBoard(db, board.id).strokes.find((s) => s.id === c.id).faded, false);
  removeStroke(db, c.id);
  assert.equal(getBoard(db, board.id).strokes.length, 2);
  assert.throws(() => removeStroke(db, c.id), (e) => e.status === 404);
});

test('a page under the board: a kept picture or PDF, by its fingerprint; nothing else; none again', () => {
  const db = emptyDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-'));
  const board = createBoard(db, {});
  const png = storeBuffer(db, dir, Buffer.from('89504e470d0a1a0a00', 'hex'), { name: 'notebook-page.png', type: 'image/png' });
  const txt = storeBuffer(db, dir, Buffer.from('plain'), { name: 'a.txt', type: 'text/plain' });
  const set = setBackground(db, board.id, { sha256: png.sha256 });
  assert.deepEqual(set.background, { sha256: png.sha256, name: 'notebook-page.png', type: 'image/png' });
  assert.throws(() => setBackground(db, board.id, { sha256: txt.sha256 }), /picture or a PDF/);
  assert.throws(() => setBackground(db, board.id, { sha256: 'f'.repeat(64) }), /not kept/);
  assert.equal(setBackground(db, board.id, null).background, null);
});

test('a stroke is drawn as one outline that is wider where the pressure is higher', () => {
  const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
  const light = nums(strokePath([[10, 50, 0.1, 0], [200, 50, 0.1, 10]]));
  const hard = nums(strokePath([[10, 50, 1, 0], [200, 50, 1, 10]]));
  const height = (n) => { const ys = n.filter((_, i) => i % 2 === 1); return Math.max(...ys) - Math.min(...ys); };
  assert.ok(height(hard) > height(light) * 2, 'harder is thicker');
  assert.match(strokePath([[5, 5, 0.5, 0]]), /^M.*Z$/, 'a dot is a shape too');
  assert.equal(strokePath([]), '');
});

test('schema 58 moves an older database: ink is new, a board can have a page, every board is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-old-'));
  let db = openDatabase(dir);
  const board = createBoard(db, { title: 'Keep me' });
  db.exec('DROP TABLE ink_strokes; ALTER TABLE boards DROP COLUMN background_file; ALTER TABLE boards DROP COLUMN background_name; ALTER TABLE boards DROP COLUMN background_type; PRAGMA user_version = 57;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(getBoard(db, board.id).title, 'Keep me');
  assert.equal(getBoard(db, board.id).background, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM ink_strokes').get().n, 0);
  db.close();
});
