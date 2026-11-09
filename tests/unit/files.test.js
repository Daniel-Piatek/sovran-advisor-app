// Files kept once by fingerprint (files.js) and the server's file API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { storeFile, getFile, cleanName, cleanType, showsInline, filesDir } from '../../files.js';
import { startServer } from '../../server.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'files-test-'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('a file is kept under its fingerprint, with a row for its name, type and size', async () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const dir = tempDir();
  const bytes = Buffer.from('a picture, pretend');
  const { file, created } = await storeFile(db, dir, Readable.from([bytes]), { name: 'sketch.png', type: 'image/png' });
  assert.equal(created, true);
  assert.deepEqual([file.name, file.type, file.size, file.sha256], ['sketch.png', 'image/png', bytes.length, sha(bytes)]);
  assert.equal(file.url, `/files/${sha(bytes)}`);
  assert.deepEqual(fs.readFileSync(path.join(filesDir(dir), sha(bytes))), bytes);
  assert.deepEqual(getFile(db, sha(bytes)), file);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same content added twice is stored once, with one row', async () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const dir = tempDir();
  const bytes = Buffer.from('same picture');
  const first = await storeFile(db, dir, Readable.from([bytes]), { name: 'a.png', type: 'image/png' });
  const second = await storeFile(db, dir, Readable.from([bytes]), { name: 'copy of a.png', type: 'image/png' });
  assert.equal(second.created, false);
  assert.equal(second.file.id, first.file.id);
  assert.equal(second.file.name, 'a.png', 'it keeps the name it was first added with');
  assert.deepEqual(fs.readdirSync(filesDir(dir)), [sha(bytes)], 'one copy on disk, no leftovers');
  assert.equal(db.prepare('SELECT count(*) AS n FROM files').get().n, 1);

  await storeFile(db, dir, Readable.from([Buffer.from('other')]), { name: 'b.txt', type: 'text/plain' });
  assert.equal(fs.readdirSync(filesDir(dir)).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a file that is too large is refused and leaves nothing behind', async () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const dir = tempDir();
  await assert.rejects(storeFile(db, dir, Readable.from([Buffer.alloc(11)]), { name: 'big', type: 'x/y', maxBytes: 10 }),
    (err) => err.status === 413);
  assert.deepEqual(fs.readdirSync(filesDir(dir)), []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM files').get().n, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('names and types from the browser are made safe', () => {
  assert.equal(cleanName('../../etc/passwd'), 'passwd');
  assert.equal(cleanName('C:\\Users\\me\\photo.jpg'), 'photo.jpg');
  assert.equal(cleanName('line\nbreak.txt'), 'linebreak.txt');
  assert.equal(cleanName(''), 'file');
  assert.equal(cleanType('image/PNG; charset=x'), 'image/png');
  assert.equal(cleanType('nonsense'), 'application/octet-stream');
  assert.ok(showsInline('image/png') && showsInline('application/pdf'));
  assert.ok(!showsInline('image/svg+xml') && !showsInline('text/html'));
});

test('the file API: upload twice, one copy; served with its type, safely', async (t) => {
  const dataDir = tempDir();
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const upload = (bytes, name, type) => fetch(`${app.url}/api/files`, {
    method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body: bytes,
  });

  const png = fs.readFileSync(new URL('../../public/icons/favicon-16.png', import.meta.url));
  const first = await upload(png, 'crown – small.png', 'image/png');
  assert.equal(first.status, 201);
  const row = await first.json();
  assert.equal(row.name, 'crown – small.png');
  const again = await upload(png, 'crown again.png', 'image/png');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, row.id);
  assert.deepEqual(fs.readdirSync(filesDir(dataDir)), [row.sha256]);

  const served = await fetch(app.url + row.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
  assert.deepEqual((await (await fetch(`${app.url}/api/files/${row.sha256}`)).json()).size, png.length);

  const svg = await (await upload('<svg onload="alert(1)"/>', 'trick.svg', 'image/svg+xml')).json();
  const svgServed = await fetch(app.url + svg.url);
  assert.equal(svgServed.headers.get('content-type'), 'application/octet-stream');
  assert.match(svgServed.headers.get('content-disposition'), /^attachment/);

  const pdf = await (await upload('%PDF-1.4\n%%EOF', 'plan.pdf', 'application/pdf')).json();
  const pdfServed = await fetch(app.url + pdf.url);
  assert.equal(pdfServed.headers.get('content-type'), 'application/pdf');
  assert.match(pdfServed.headers.get('content-disposition'), /^inline/);

  assert.equal((await fetch(`${app.url}/api/files`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 400,
    'no name, no file');
  assert.equal((await fetch(`${app.url}/files/${'0'.repeat(64)}`)).status, 404);
  assert.equal((await fetch(`${app.url}/api/files`)).status, 405);
});
