// The Sovran Library (Sovran Advisor): D's teaching and, for a client, their own decodes, kept
// online. A student pastes the key D gave them in Settings; from then on their assistant has the
// library's tools (mcp__library__…) next to the app's own. The key is kept in this computer's
// database only (settings: library.key), never sent to a page in full, and goes nowhere but the
// library itself. Without a key the app works fully on its own.

import { randomUUID } from 'node:crypto';

export const LIBRARY_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/library-mcp';
const KEY = /^[A-Za-z0-9_-]{20,200}$/;
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

export function libraryKey(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'library.key' AND deleted_at IS NULL").get();
  try { return row ? JSON.parse(row.value) : ''; } catch { return ''; }
}

// What a page may see: connected or not, and the key's last four characters.
export const getLibrary = (db) => {
  const key = libraryKey(db);
  return { connected: Boolean(key), key_end: key ? key.slice(-4) : '' };
};

export function setLibraryKey(db, key) {
  const value = String(key ?? '').trim();
  if (value && !KEY.test(value)) throw fail(400, 'That doesn’t look like a library key. Paste the whole key, exactly as you were given it.');
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, 'library.key', JSON.stringify(value));
  return getLibrary(db);
}

// The library as one more server for the claude command, or null without a key.
export const libraryServer = (db) => {
  const key = libraryKey(db);
  return key ? { type: 'http', url: `${LIBRARY_URL}/${encodeURIComponent(key)}` } : null;
};
