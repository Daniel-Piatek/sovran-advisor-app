// Phone capture through the Sovran drop box (module phone-drop; off in a new install). The phone needs nothing but
// a home-screen icon: it opens the Capture page (phone/, on GitHub Pages), which seals each thought with a key only
// this computer and the phone have, and leaves it in a drop box in the Sovran cloud database (cloud/phone-drop.sql).
// This computer collects what waits about once a minute while the app runs, keeps it in the Inbox and has the box
// delete it. The box never holds anything readable; the key travels only in the link's part after "#".
//
// One box per install, kept in settings (phone.drop): { box, drop, pull, key, made_at }. "A new link" closes the old
// box in the cloud (the old link stops working) and makes a new one. Switching the module off closes the box.

import crypto from 'node:crypto';
import { unseal, randomB64 } from './phone/seal.js';
import { createCapture, WORLDS } from './captures.js';

export const DROP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
export const PAGE_URL = 'https://daniel-piatek.github.io/sovran-advisor-app/';
export const MAX_PHONE_TEXT = 4000;
const SETTING = 'phone.drop';
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readBox(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(SETTING);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

function writeBox(db, value) {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(crypto.randomUUID(), time, time, SETTING, JSON.stringify(value));
}

export const phoneLink = (box) => `${PAGE_URL}#v1.${box.box}.${box.drop}.${box.key}`;

async function call(fetcher, body) {
  let res;
  try {
    res = await fetcher(DROP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch { throw fail(503, 'The Sovran drop box can’t be reached. Check this computer’s internet connection.'); }
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(res.status === 404 ? 404 : 502, answer.error ?? 'The Sovran drop box said no.');
  return answer;
}

// What Settings shows: linked or not, the link for the phone, and when notes last came in.
export function phoneDropState(db) {
  const box = readBox(db);
  if (!box) return { linked: false };
  return { linked: true, link: phoneLink(box), made_at: box.made_at, last_collected_at: box.last_collected_at ?? null, collected: box.collected ?? 0, problem: box.problem ?? null };
}

// A box in the cloud for this computer, unless there is one. new: close the old one first (the old link stops).
export async function linkPhone(db, { fetcher = fetch, fresh = false } = {}) {
  const old = readBox(db);
  if (old && !fresh) return phoneDropState(db);
  if (old) await call(fetcher, { action: 'close', box: old.box, pull: old.pull }).catch(() => { /* gone already, or offline: it ages out */ });
  const box = { box: randomB64(16), drop: randomB64(32), pull: randomB64(32), key: randomB64(32), made_at: now() };
  await call(fetcher, { action: 'open', box: box.box, drop_hash: sha(box.drop), pull_hash: sha(box.pull) });
  writeBox(db, box);
  return phoneDropState(db);
}

// Switched off: the box and anything in it are deleted in the cloud, and forgotten here.
export async function unlinkPhone(db, { fetcher = fetch } = {}) {
  const box = readBox(db);
  if (!box) return;
  db.prepare("UPDATE settings SET deleted_at = ?, updated_at = ? WHERE key = ? AND deleted_at IS NULL").run(now(), now(), SETTING);
  await call(fetcher, { action: 'close', box: box.box, pull: box.pull }).catch(() => { /* offline: the box ages out after 180 days */ });
}

// Collect what waits: each note into the Inbox, then the box deletes them. A note that can't be opened (not sealed
// with this key) is deleted too, never kept. Returns how many came in.
export async function collect(db, { fetcher = fetch } = {}) {
  const box = readBox(db);
  if (!box) return 0;
  let total = 0;
  for (let round = 0; round < 10; round++) {
    let notes;
    try { ({ notes } = await call(fetcher, { action: 'take', box: box.box, pull: box.pull })); } catch (err) {
      if (err.status === 404) writeBox(db, { ...box, problem: 'The drop box no longer knows this computer. Press “A new link” and scan it again.' });
      throw err;
    }
    if (!notes?.length) break;
    const done = [];
    for (const n of notes) {
      try {
        const note = await unseal(box.key, n.sealed);
        const body = String(note.body ?? '').trim().slice(0, MAX_PHONE_TEXT);
        if (body) { createCapture(db, { body, world: WORLDS.includes(note.world) ? note.world : 'inner' }); total++; }
      } catch { /* not sealed with this key: dropped */ }
      done.push(n.id);
    }
    await call(fetcher, { action: 'done', box: box.box, pull: box.pull, ids: done });
    if (notes.length < 50) break;
  }
  const latest = readBox(db) ?? box;
  writeBox(db, { ...latest, problem: null, last_checked_at: now(), ...(total ? { last_collected_at: now(), collected: (latest.collected ?? 0) + total } : {}) });
  return total;
}

// About once a minute while the app runs and the module is on. onNew: tell the Inbox something came.
// now(): collect at once (Settings' "Check now"), with any problem thrown.
export function startPhoneDrop(db, { every = 60_000, fetcher = fetch, isOn, onNew = () => {} } = {}) {
  let busy = null;
  const run = () => {
    busy ??= collect(db, { fetcher }).then((n) => { if (n) onNew(n); return n; }).finally(() => { busy = null; });
    return busy;
  };
  const tick = () => (isOn() && readBox(db) ? run().catch(() => 0) : Promise.resolve(0));
  const timer = every ? setInterval(tick, every) : null;
  timer?.unref?.();
  const first = every ? setTimeout(tick, 5000) : null;
  first?.unref?.();
  return { stop: () => { clearInterval(timer); clearTimeout(first); }, tick, now: run };
}
