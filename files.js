// Files pasted or dropped into a note or an entry (schema.sql, table files).
// Each file is kept once, in `<data folder>/files/<sha256>`, named by the SHA-256 of its
// content: the same content added twice is stored once and keeps one row (the name it
// was first added with). Nothing here ever removes a file.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 255;

const fail = (status, message) => Object.assign(new Error(message), { status });

export const filesDir = (dataDir) => path.join(dataDir, 'files');
export const urlOf = (sha256) => `/files/${sha256}`;

const withUrl = (row) => (row ? { ...row, url: urlOf(row.sha256) } : null);

export function getFile(db, sha256) {
  return withUrl(db.prepare('SELECT id, sha256, name, type, size, origin, created_at, updated_at FROM files WHERE sha256 = ?').get(sha256));
}

// A file name as given by the browser, made safe to keep and show: no folders, no
// control characters, not too long.
export function cleanName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'file').slice(0, MAX_FILE_NAME_LENGTH);
}

// A content type as given by the browser, or "application/octet-stream" when it says
// nothing usable.
export function cleanType(type) {
  const value = String(type ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value) ? value : 'application/octet-stream';
}

// Keeps what arrives on `stream`: written to a temporary file while its fingerprint is
// worked out, then moved to its place, unless that content is already there.
// Returns { file, created }.
export async function storeFile(db, dataDir, stream, { name, type, maxBytes = MAX_FILE_BYTES }) {
  const dir = filesDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.incoming-${randomUUID()}`);
  const hash = createHash('sha256');
  let size = 0;
  const count = new Transform({
    transform(chunk, encoding, done) {
      size += chunk.length;
      if (size > maxBytes) return done(fail(413, `A file can be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(stream, count, fs.createWriteStream(temp, { flags: 'wx' }));
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err.status ? err : fail(400, 'The file did not arrive whole.');
  }

  const sha256 = hash.digest('hex');
  const target = path.join(dir, sha256);
  const known = getFile(db, sha256);
  if (known && fs.existsSync(target)) {
    fs.rmSync(temp, { force: true });
    return { file: known, created: false };
  }
  // New content (or its copy went missing): put it in place, then record it.
  fs.renameSync(temp, target);
  if (!known) {
    const time = new Date().toISOString();
    db.prepare('INSERT INTO files (id, created_at, updated_at, sha256, name, type, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), time, time, sha256, cleanName(name), cleanType(type), size);
  }
  return { file: getFile(db, sha256), created: !known };
}

// Types a browser may show inside the app. Anything else (HTML, SVG, scripts…) could run
// as part of the app if opened, so it is only ever handed over as a download.
const SHOW_INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;
// The same, for bytes already in memory (an attachment read out of a mail): kept once by its fingerprint. Returns the file's row,
// or null when it is too large to keep (the mail still names it).
export function storeBuffer(db, dataDir, buffer, { name, type, maxBytes = MAX_FILE_BYTES }) {
  if (!buffer.length || buffer.length > maxBytes) return null;
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const dir = filesDir(dataDir);
  const target = path.join(dir, sha256);
  const known = getFile(db, sha256);
  if (!known || !fs.existsSync(target)) {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) {
      const temp = path.join(dir, `.incoming-${randomUUID()}`);
      fs.writeFileSync(temp, buffer, { flag: 'wx' });
      fs.renameSync(temp, target);
    }
  }
  if (!known) {
    const time = new Date().toISOString();
    db.prepare('INSERT INTO files (id, created_at, updated_at, sha256, name, type, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), time, time, sha256, cleanName(name), cleanType(type), buffer.length);
  }
  return getFile(db, sha256);
}

export const showsInline = (type) => SHOW_INLINE.test(type);
