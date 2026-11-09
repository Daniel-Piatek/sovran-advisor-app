// Capture from anywhere (Tasks in depth 6): one address, POST /capture, takes a short text and an optional link from a
// bookmarklet in a browser, from a phone's share sheet or from any other app, and keeps it in the Inbox with the device
// it came from. Each device has a token of its own, so you can see which one sent what and revoke one you lost without
// touching the others. The tokens are kept in the system's key store (the macOS Keychain), one per device, and never in
// a table, a log or the browser after they were shown once; the database only knows that a device exists.

import crypto, { randomUUID } from 'node:crypto';
import { createCapture } from './captures.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const KINDS = ['browser', 'phone', 'other'];
export const MAX_TEXT = 20_000;
const secretName = (id) => `capture:${id}`;
const digest = (text) => crypto.createHash('sha256').update(text).digest();

const rowOf = (r) => ({ id: r.id, name: r.name, kind: r.kind, created_at: r.created_at, last_used_at: r.last_used_at, uses: r.uses });

export function listDevices(db) {
  return db.prepare('SELECT * FROM capture_devices WHERE deleted_at IS NULL ORDER BY created_at, rowid').all().map(rowOf);
}

// A new device and its token. The token is returned this once and is not kept anywhere else than the key store.
export async function addDevice(db, keyStore, { name, kind = 'other' }) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 60) throw fail(400, 'Give the device a short name, like “Phone” or “Work browser”.');
  if (!KINDS.includes(kind)) throw fail(400, `kind is ${KINDS.join(', ')}.`);
  const id = randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  await keyStore.set(secretName(id), secret);
  const time = now();
  db.prepare('INSERT INTO capture_devices (id, created_at, updated_at, name, kind) VALUES (?, ?, ?, ?, ?)').run(id, time, time, clean, kind);
  return { device: rowOf(db.prepare('SELECT * FROM capture_devices WHERE id = ?').get(id)), token: `${id}.${secret}` };
}

// Revoke: the token is forgotten and the device is marked deleted (never removed).
export async function revokeDevice(db, keyStore, id) {
  const row = db.prepare('SELECT * FROM capture_devices WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) return null;
  await keyStore.remove(secretName(id));
  const time = now();
  db.prepare('UPDATE capture_devices SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, id);
  return rowOf(row);
}

// The device a token belongs to, or null. The secret is read from the key store and compared without leaking its length or content.
export async function deviceForToken(db, keyStore, token) {
  const [id, secret] = String(token ?? '').split('.');
  if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !secret) return null;
  const row = db.prepare('SELECT * FROM capture_devices WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) return null;
  const kept = await keyStore.get(secretName(id));
  if (!kept || !crypto.timingSafeEqual(digest(kept), digest(secret))) return null;
  return rowOf(row);
}

export function checkShareInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object: { "text": "…", "link": "https://…" }.';
  for (const key of ['text', 'link', 'title']) {
    if (key in input && input[key] !== null && typeof input[key] !== 'string') return `${key} is text.`;
  }
  const text = String(input.text ?? '').trim();
  const link = String(input.link ?? '').trim();
  if (!text && !link) return 'Send some text, a link, or both.';
  if (text.length > MAX_TEXT || link.length > 2000) return 'That is too long for a capture.';
  if (link && !/^https?:\/\/\S+$/i.test(link)) return 'link is a web address (http or https).';
  return null;
}

// The words of a shared capture: the text, and the link on its own line unless the text holds it already.
// Shared from outside is, to begin with, something someone else made: it waits in the Outer World pile (Tasks in depth 7);
// sometimes it is your own thought from your phone, and w in the Inbox switches it.
export function shareCapture(db, device, { text = '', link = '' }) {
  const words = String(text ?? '').trim();
  const url = String(link ?? '').trim();
  const body = url && !words.includes(url) ? [words, url].filter(Boolean).join('\n') : words;
  const made = createCapture(db, { body, world: 'outer', device: device.id });
  const time = now(); // a use is a capture that was kept
  db.prepare('UPDATE capture_devices SET last_used_at = ?, uses = uses + 1, updated_at = ? WHERE id = ?').run(time, time, device.id);
  return made;
}
