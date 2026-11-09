// Links to one bullet (Writing 2): ((bullet id)) is a row in links with the note it lives in and the bullet as its target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, updateNote } from '../../notes.js';
import { extractLinks, linkedFrom, plainWords } from '../../links.js';
import { listBlocks, searchBullets, bulletDetail, usedIn } from '../../blocks.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
function seed(db) {
  const pricing = createNote(db, { title: 'Pricing thoughts', body: '* Package: 3 days for 4800 EUR\n  * Prep and a follow-up call\n  * Travel on top\n* Day rate: 1700 EUR' });
  const [pack] = searchBullets(db, 'package');
  return { pricing, pack };
}

test('((id)) is a link to a bullet; its words are not part of the plain text', () => {
  const id = '9877f6f1-9eb1-4cfb-9535-1edfd828f1ee';
  assert.deepEqual(extractLinks(`See ((${id})) for the price.`).map((l) => [l.to_kind, l.to_id]), [['block', id]]);
  assert.equal(plainWords(`See ((${id})) for the price.`), 'See  for the price.');
  assert.deepEqual(extractLinks('Just ((words)) in brackets'), []);
});

test('saving a note with a link makes a row: the note the bullet lives in, the bullet as target; Linked from lists it; once per bullet', () => {
  const db = emptyDb();
  const { pricing, pack } = seed(db);
  const proposal = createNote(db, { title: 'Proposal outline', body: `* Price it as a fixed package\n  * ((${pack.id}))\n  * Again ((${pack.id}))` });
  const rows = db.prepare('SELECT from_kind, from_id, to_kind, to_id, link_text, target_block_id FROM links WHERE target_block_id IS NOT NULL').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { from_kind: 'note', from_id: proposal.id, to_kind: 'note', to_id: pricing.id, link_text: 'Package: 3 days for 4800 EUR', target_block_id: pack.id });
  assert.deepEqual(linkedFrom(db, 'note', pricing.id).map((l) => l.label), ['Proposal outline']);
  updateNote(db, proposal.id, { body: '* nothing now' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM links WHERE target_block_id IS NOT NULL').get().n, 0, 'taken out of the text, taken out of the rows');
});

test('a link to a bullet of the same note, a made-up id or a bullet of a deleted note makes no row', () => {
  const db = emptyDb();
  const { pricing, pack } = seed(db);
  updateNote(db, pricing.id, { body: `${pricing.body}\n* ((${pack.id}))` });
  createNote(db, { title: 'X', body: '* ((00000000-0000-4000-8000-000000000000))' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM links WHERE target_block_id IS NOT NULL').get().n, 0);
});

test('searching bullets, one bullet with what is under it, and where it is used', () => {
  const db = emptyDb();
  const { pricing, pack } = seed(db);
  assert.deepEqual(searchBullets(db, 'RATE').map((b) => [b.text, b.note_title]), [['Day rate: 1700 EUR', 'Pricing thoughts']]);
  assert.deepEqual(searchBullets(db, '100%'), [], 'a % in the words is a % and nothing more');
  assert.equal(searchBullets(db, '').length, 4, 'nothing typed: the latest bullets');
  const detail = bulletDetail(db, pack.id);
  assert.deepEqual([detail.text, detail.note_title, detail.children.map((c) => [c.text, c.depth]), detail.used_in], ['Package: 3 days for 4800 EUR', 'Pricing thoughts', [['Prep and a follow-up call', 0], ['Travel on top', 0]], 0]);

  const proposal = createNote(db, { title: 'Proposal outline', body: `* ((${pack.id}))` });
  const workshop = createNote(db, { title: 'Workshop ideas', body: `* Ideas\n  * See ((${pack.id}))` });
  assert.deepEqual(usedIn(db, pack.id).map((p) => p.title).sort(), ['Proposal outline', 'Workshop ideas']);
  assert.equal(listBlocks(db, pricing.id)[0].used_in, 2);
  assert.equal(listBlocks(db, proposal.id)[0].used_in, 0);
  assert.equal(bulletDetail(db, pack.id).used_in, 2);

  updateNote(db, pricing.id, { body: '* Day rate: 1700 EUR' }); // the passage is removed
  assert.equal(bulletDetail(db, pack.id), null, 'Removed passage (the route answers { removed: true })');
  void workshop;
});

test('the first search makes bullets for notes written before they were kept', () => {
  const db = emptyDb();
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('11111111-1111-4111-8111-111111111111', 'a', 'a', 'Old', '* an old idea')");
  assert.deepEqual(searchBullets(db, 'old idea').map((b) => b.text), ['an old idea']);
});

test('schema 51 moves an older database: links gain the bullet column and old rows are kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocklinks-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id) VALUES ('l1', 'a', 'a', 'note', 'n1', 'note', 'n2')");
  db.exec('DROP INDEX links_to_block; ALTER TABLE links DROP COLUMN target_block_id; PRAGMA user_version = 50;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare("SELECT from_id, to_id, target_block_id FROM links WHERE id = 'l1'").get() }, { from_id: 'n1', to_id: 'n2', target_block_id: null });
  db.close();
});
