// The Sovran pictures of the starter tags (2026-11-22, D's wish): the 13 characters and the 5 Quests. They live in the
// Sovran cloud (web function tag-pictures), not in the app, so only someone with a Sovran key gets them. Each is
// fetched once with this computer's key (the Sovran Library key, or in APP Daniel the guide key), kept in the app's
// files like any picture, and served from there afterwards. Without a key, or offline the first time, there is no
// picture and the tag shows its tag shape instead.

import { randomUUID } from 'node:crypto';
import { storeBuffer, getFile } from './files.js';
import { libraryKey } from './sovran-library.js';
import { guideKey } from './group-feed.js';
import { SOVRAN_PICTURES } from './tags.js';

export const PICTURES_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/tag-pictures';
const MAX_PICTURE = 400_000;
const setting = (name) => `tag-picture.${name}`;
const now = () => new Date().toISOString();

const keyOf = (db) => libraryKey(db) || guideKey(db);

// The kept copy's SHA-256, or null.
function kept(db, name) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(setting(name));
  const sha = row ? JSON.parse(row.value) : null;
  return sha && getFile(db, sha) ? sha : null;
}

// Answers the picture's SHA-256 (fetching it the first time), or null when there is none to be had.
export async function sovranPicture(db, dataDir, name, { url = process.env.SOVRAN_TAG_PICTURES_URL || PICTURES_URL, fetcher = fetch } = {}) {
  if (!SOVRAN_PICTURES.includes(name)) return null;
  const have = kept(db, name);
  if (have) return have;
  const key = keyOf(db);
  if (!key) return null;
  let got;
  try { got = await fetcher(`${url}/${name}.webp`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }); } catch { return null; }
  if (!got.ok) return null;
  const bytes = Buffer.from(await got.arrayBuffer());
  // A WebP picture: RIFF....WEBP
  if (bytes.length < 32 || bytes.length > MAX_PICTURE || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const file = storeBuffer(db, dataDir, bytes, { name: `${name}.webp`, type: 'image/webp', maxBytes: MAX_PICTURE });
  if (!file) return null;
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, setting(name), JSON.stringify(file.sha256));
  return file.sha256;
}
