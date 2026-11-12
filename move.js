// Moving to a new computer (myICOR advanced/everywhere/11, the Sovran Advisor way: no cloud account needed).
// "Make a moving file" puts everything you wrote into one file: a whole copy of the database and every kept
// file (pictures, PDFs). On the new computer, with the app installed, "Bring in a moving file" reads it,
// checks it, shows what is in it and waits for your yes. Only then, on a restart, does it take the place of
// what is there; what was there is kept in data/before-move-<time>/, never removed.
//
// The file is a .tar.gz (a common archive any computer can open), holding only:
//   sovran-move.json     what is in it: when it was made, the database's version, how many of each
//   app.db               the database (a VACUUM INTO copy: whole and consistent)
//   files/<sha256>       each kept file, under the name it already has in data/files
// Anything else in an archive is refused, so a file can never write outside its own folder.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './db.js';
import { filesDir } from './files.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const BLOCK = 512;
const ALLOWED = /^(sovran-move\.json|app\.db|files\/[0-9a-f]{64})$/;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export const pendingDir = (dataDir) => path.join(dataDir, 'move-pending');
const lastMoveFile = (dataDir) => path.join(dataDir, 'last-move.json');

// What is in a database, in words a person knows (only rows that were not deleted).
const COUNTED = [
  ['notes', 'notes'], ['journal_entries', 'journal entries'], ['people', 'people'], ['tasks', 'tasks'],
  ['captures', 'Inbox items'], ['conversations', 'assistant chats'], ['files', 'pictures and files'],
];
export function countsOf(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const out = {};
  for (const [table, words] of COUNTED) {
    if (!tables.has(table)) continue;
    const hasDeleted = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'deleted_at');
    out[words] = db.prepare(`SELECT count(*) AS n FROM ${table}${hasDeleted ? ' WHERE deleted_at IS NULL' : ''}`).get().n;
  }
  return out;
}

// --- Writing: a tar archive, gzipped, as a stream -----------------------------------------------------

function header(name, size, mtime = Math.floor(Date.now() / 1000)) {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 'ascii');
  h.write('0000000\0', 108, 'ascii');
  h.write('0000000\0', 116, 'ascii');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  h.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 'ascii');
  h.write('        ', 148, 'ascii'); // the checksum is counted with spaces in its place
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}
const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

async function* tarOf(entries) {
  for (const entry of entries) {
    const size = entry.data ? entry.data.length : fs.statSync(entry.file).size;
    yield header(entry.name, size);
    if (entry.data) yield entry.data;
    else for await (const chunk of fs.createReadStream(entry.file)) yield chunk;
    yield padding(size);
  }
  yield Buffer.alloc(BLOCK * 2);
}

// Writes the moving file to `out` (a response or a file stream). Answers what it put in.
export async function writeMoveFile(db, dataDir, out) {
  const copy = path.join(dataDir, `move-out-${stamp()}-${process.pid}.db`);
  db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  try {
    const dir = filesDir(dataDir);
    const kept = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[0-9a-f]{64}$/.test(f)) : [];
    const about = { app: 'sovran-advisor', made_at: new Date().toISOString(), schema: SCHEMA_VERSION, counts: countsOf(db), files: kept.length };
    const entries = [
      { name: 'sovran-move.json', data: Buffer.from(JSON.stringify(about, null, 2)) },
      { name: 'app.db', file: copy },
      ...kept.map((f) => ({ name: `files/${f}`, file: path.join(dir, f) })),
    ];
    await pipeline(tarOf(entries), zlib.createGzip(), out);
    return about;
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

export const moveFileName = (d = new Date()) => `sovran-advisor-move-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.tar.gz`;

// --- Reading: a tar archive, one block at a time, into data/move-pending ------------------------------

class TarReader extends Writable {
  constructor(dir) {
    super();
    this.dir = dir;
    this.buffer = Buffer.alloc(0);
    this.entry = null; // { fd, left, pad }
    this.ended = false;
    this.names = [];
  }

  _write(chunk, _enc, done) {
    try { this.take(chunk); done(); } catch (err) { this.closeEntry(); done(err); }
  }

  _final(done) {
    this.closeEntry();
    if (!this.ended && this.names.length === 0) return done(fail(400, 'That is not a moving file from Sovran Advisor.'));
    done();
  }

  closeEntry() { if (this.entry?.fd != null) { fs.closeSync(this.entry.fd); } this.entry = null; }

  take(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      if (this.ended) { this.buffer = Buffer.alloc(0); return; }
      if (this.entry) {
        if (this.entry.left > 0) {
          if (!this.buffer.length) return;
          const piece = this.buffer.subarray(0, Math.min(this.entry.left, this.buffer.length));
          fs.writeSync(this.entry.fd, piece);
          this.entry.left -= piece.length;
          this.buffer = this.buffer.subarray(piece.length);
          continue;
        }
        if (this.buffer.length < this.entry.pad) return;
        this.buffer = this.buffer.subarray(this.entry.pad);
        this.closeEntry();
        continue;
      }
      if (this.buffer.length < BLOCK) return;
      const h = this.buffer.subarray(0, BLOCK);
      this.buffer = this.buffer.subarray(BLOCK);
      if (h.every((b) => b === 0)) { this.ended = true; continue; }
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (parseInt(h.subarray(148, 156).toString('ascii').replace(/\0.*$/s, '').trim(), 8) !== sum) throw fail(400, 'That is not a moving file from Sovran Advisor (or it is damaged).');
      const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const type = String.fromCharCode(h[156]);
      const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
      if (!(type === '0' || type === '\0') || !ALLOWED.test(name)) throw fail(400, `The moving file holds something it should not (${name.slice(0, 80)}). Nothing was changed.`);
      if (this.names.includes(name)) throw fail(400, 'The moving file holds the same thing twice. Nothing was changed.');
      this.names.push(name);
      const target = path.join(this.dir, ...name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      this.entry = { fd: fs.openSync(target, 'w'), left: size, pad: (BLOCK - (size % BLOCK)) % BLOCK };
    }
  }
}

// Reads an uploaded moving file (a stream) into data/move-pending and checks it. Answers what is in it. Nothing in the
// app changes until confirmMove() and a restart.
export async function receiveMoveFile(dataDir, stream) {
  const dir = pendingDir(dataDir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const reader = new TarReader(dir);
    try {
      await pipeline(stream, zlib.createGunzip(), reader);
    } catch (err) {
      if (err.status) throw err;
      throw fail(400, 'That is not a moving file from Sovran Advisor (or it is damaged).');
    }
    if (!reader.names.includes('app.db') || !reader.names.includes('sovran-move.json')) throw fail(400, 'That is not a moving file from Sovran Advisor.');
    let about;
    try { about = JSON.parse(fs.readFileSync(path.join(dir, 'sovran-move.json'), 'utf8')); } catch { about = null; }
    if (about?.app !== 'sovran-advisor') throw fail(400, 'That is not a moving file from Sovran Advisor.');
    const copy = new DatabaseSync(path.join(dir, 'app.db'), { readOnly: true });
    let summary;
    try {
      const check = copy.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
      if (check.length !== 1 || check[0] !== 'ok') throw fail(400, 'The database in the moving file is damaged. Nothing was changed. Make a new moving file on the old computer.');
      const version = copy.prepare('PRAGMA user_version').get().user_version;
      if (version > SCHEMA_VERSION) throw fail(400, 'The moving file was made by a newer Sovran Advisor. Update this one first (ask Claude: "update Sovran Advisor"), then bring it in.');
      summary = { made_at: about.made_at, schema: version, counts: countsOf(copy), files: reader.names.filter((n) => n.startsWith('files/')).length };
    } finally { copy.close(); }
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
    return summary;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

// What waits: { waiting: false } or { waiting: true, confirmed, ...summary }; and the last move made, if any.
export function moveStatus(dataDir) {
  const dir = pendingDir(dataDir);
  let last = null;
  try { last = JSON.parse(fs.readFileSync(lastMoveFile(dataDir), 'utf8')); } catch { /* none yet */ }
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* nothing waits */ }
  return summary ? { waiting: true, confirmed: fs.existsSync(path.join(dir, 'confirmed')), ...summary, last } : { waiting: false, last };
}

export function cancelMove(dataDir) {
  fs.rmSync(pendingDir(dataDir), { recursive: true, force: true });
  return moveStatus(dataDir);
}

// Your yes: the move happens at the next start (the database can't be swapped while the app has it open).
export function confirmMove(dataDir) {
  const dir = pendingDir(dataDir);
  if (!fs.existsSync(path.join(dir, 'summary.json'))) throw fail(409, 'No moving file waits. Bring one in first.');
  fs.writeFileSync(path.join(dir, 'confirmed'), new Date().toISOString());
  return moveStatus(dataDir);
}

// At start, before the database is opened: a confirmed move takes the place of what is there. What was there is
// kept, whole, in data/before-move-<time>/. Kept files come along (they are named by their content, so a file
// already here is the same file).
export function applyPendingMove(dataDir) {
  const dir = pendingDir(dataDir);
  if (!fs.existsSync(path.join(dir, 'confirmed')) || !fs.existsSync(path.join(dir, 'app.db'))) return null;
  const keptAt = path.join(dataDir, `before-move-${stamp()}`);
  fs.mkdirSync(keptAt, { recursive: true });
  for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const file = path.join(dataDir, name);
    if (fs.existsSync(file)) fs.renameSync(file, path.join(keptAt, name));
  }
  fs.renameSync(path.join(dir, 'app.db'), path.join(dataDir, 'app.db'));
  const incoming = path.join(dir, 'files');
  if (fs.existsSync(incoming)) {
    const target = filesDir(dataDir);
    fs.mkdirSync(target, { recursive: true });
    for (const f of fs.readdirSync(incoming)) {
      const to = path.join(target, f);
      if (fs.existsSync(to)) fs.rmSync(path.join(incoming, f));
      else fs.renameSync(path.join(incoming, f), to);
    }
  }
  let summary = {};
  try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* the move is done all the same */ }
  const last = { at: new Date().toISOString(), made_at: summary.made_at ?? null, kept_at: path.basename(keptAt) };
  fs.writeFileSync(lastMoveFile(dataDir), JSON.stringify(last));
  fs.rmSync(dir, { recursive: true, force: true });
  return last;
}
