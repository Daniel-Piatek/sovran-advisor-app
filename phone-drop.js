// Phone capture through the Sovran drop box (module phone-drop; off in a new install). The phone needs nothing but
// a home-screen icon: it opens Sovran Go (phone/, on GitHub Pages), which seals each thought with a key only
// this computer and the phone have, and leaves it in a drop box in the Sovran cloud database (cloud/phone-drop.sql).
// This computer collects what waits about once a minute while the app runs, keeps it in the Inbox (a journal entry:
// in the Journal, General, on the day it was written) and has the box delete it. The box never holds anything readable; the key travels only in the link's part after "#".
//
// Keep this chat saved (chat-saves.js): the same box also takes the parts of a chat that the student's AI saves through
// the Sovran Library. Those are sealed for this computer alone: it makes a pair of keys (the private one stays here, in
// phone.drop.seal) and registers the public one against the student's library key (action register).
//
// One box per install, kept in settings (phone.drop): { box, drop, pull, key, made_at, seal?, saver? }. "A new link" closes the old
// box in the cloud (the old link stops working) and makes a new one. Switching the module off closes the box.

import crypto from 'node:crypto';
import { unseal, randomB64 } from './phone/seal.js';
import { createCapture, WORLDS } from './captures.js';
import { createEntry, isDay, localDay } from './entries.js';
import { fixPhoneWords, rememberSpoken, rememberSpokenEntry } from './tidy.js';
import { makeSaveKeys, openSealed } from './cloud/library-save/sealing.js';
import { saveChatPart } from './chat-saves.js';
import { libraryKey } from './sovran-library.js';
import { takePhoneMark } from './report-marks.js';
import { syncShelf } from './phone-shelf.js';

export const DROP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
export const PAGE_URL = 'https://daniel-piatek.github.io/sovran-advisor-app/';
export const MAX_PHONE_TEXT = 20000;
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
  return { linked: true, link: phoneLink(box), made_at: box.made_at, last_collected_at: box.last_collected_at ?? null, collected: box.collected ?? 0, problem: box.problem ?? null, saves_chats: Boolean(box.saver), shelf: Object.keys(box.shelf ?? {}).filter((n) => n.startsWith('report.')).length };
}

// A box in the cloud for this computer, unless there is one. new: close the old one first (the old link stops).
export async function linkPhone(db, { fetcher = fetch, fresh = false } = {}) {
  const old = readBox(db);
  if (old && !fresh) return phoneDropState(db);
  if (old) await call(fetcher, { action: 'close', box: old.box, pull: old.pull }).catch(() => { /* gone already, or offline: it ages out */ });
  const box = { box: randomB64(16), drop: randomB64(32), pull: randomB64(32), key: randomB64(32), made_at: now(), ...(old?.seal ? { seal: old.seal } : {}) }; // the keys for saved chats stay
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

// Keep this chat saved: with a library key, this computer's public key is registered for the box, once per key and
// box (asked again at most once an hour while the drop box says no: an older drop box, or a key not in use).
async function ensureSaver(db, fetcher) {
  let box = readBox(db);
  const key = libraryKey(db);
  if (!box || !key) return;
  const wanted = sha(`${key}.${box.box}`);
  if (box.saver === wanted || (box.saver_asked === wanted && Date.now() - new Date(box.saver_asked_at ?? 0).getTime() < 3600_000)) return;
  const seal = box.seal ?? await makeSaveKeys();
  let registered = false;
  try { await call(fetcher, { action: 'register', box: box.box, pull: box.pull, library_key: key, public: seal.public }); registered = true; } catch { /* asked again in an hour */ }
  box = readBox(db);
  if (box) writeBox(db, { ...box, seal: box.seal ?? seal, ...(registered ? { saver: wanted, saver_asked: null } : { saver_asked: wanted, saver_asked_at: now() }) });
}

// A journal entry from the phone: the day the phone said (its own calendar day), else the day of its time here.
// Written at the time it was kept on the phone, so the day's entries stay in the order they were written.
function journalDay(note, at) {
  if (isDay(note.day)) return note.day;
  return localDay(at ?? new Date());
}

let shelfDue = true; // the reports are read afresh for the phone at each start of the app (and every few hours)
export const readShelfSoon = () => { shelfDue = true; };

// Collect what waits: each note into the Inbox (kind journal: into the Journal), then the box deletes them. A note that can't be opened (not sealed
// with this key) is deleted too, never kept. Returns how many came in.
export async function collect(db, { fetcher = fetch } = {}) {
  if (!readBox(db)) return 0;
  await ensureSaver(db, fetcher);
  const box = readBox(db);
  let total = 0;
  let marked = 0; // highlights and comments from the phone: not counted as things for the Inbox
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
        let note;
        try { note = await unseal(box.key, n.sealed); } catch (err) { // not from the phone: a saved chat, sealed for this computer?
          if (!box.seal) throw err;
          note = { ...(await openSealed(box.seal, n.sealed)), saved: true };
        }
        const body = String(note.body ?? '').trim().slice(0, MAX_PHONE_TEXT);
        if (note.kind === 'chat') { // only the Sovran Library's save tool may add to a chat, never the phone's link
          if (note.saved && saveChatPart(db, note)) total++;
        } else if (note.kind === 'mark') { // a highlight or comment made on a report on the phone (never from the save tool)
          if (!note.saved && takePhoneMark(db, note)) marked++;
        } else if (body) { // the glossary's fixes now, the punctuation by the assistant soon after (tidy.js)
          const words = fixPhoneWords(db, body);
          if (note.kind === 'journal') {
            const time = new Date(note.at);
            const at = Number.isNaN(time.getTime()) || time > new Date() ? null : time; // a phone's clock can be wrong
            const made = createEntry(db, { day: journalDay(note, at), body: words.fixed, origin: 'captured', ...(at ? { written_at: at.toISOString() } : {}) });
            rememberSpokenEntry(db, made.id, words);
          } else { // a thought; a kind this app does not know yet is kept in the Inbox too, never lost
            const made = createCapture(db, { body: words.fixed, world: WORLDS.includes(note.world) ? note.world : 'inner' });
            rememberSpoken(db, made.id, words);
          }
          total++;
        }
      } catch { /* not sealed with this key: dropped */ }
      done.push(n.id);
    }
    await call(fetcher, { action: 'done', box: box.box, pull: box.pull, ids: done });
    if (notes.length < 50) break;
  }
  let latest = readBox(db) ?? box;
  writeBox(db, { ...latest, problem: null, last_checked_at: now(), ...(total ? { last_collected_at: now(), collected: (latest.collected ?? 0) + total } : {}) });
  // My reports on Sovran Go: the shelf the phone reads (phone-shelf.js), after the phone's own marks are in.
  try {
    latest = readBox(db);
    if (latest.shelf_problem && Date.now() - new Date(latest.shelf_tried_at ?? 0).getTime() < 600_000) return total; // tried again every ten minutes
    const kept = await syncShelf(db, latest, (name, sealed) => call(fetcher, { action: 'shelf_put', box: latest.box, pull: latest.pull, name, sealed }), { force: shelfDue });
    shelfDue = false;
    if (kept && readBox(db)?.box === latest.box) writeBox(db, { ...readBox(db), ...kept, shelf_problem: null });
  } catch (err) { // an older drop box has no shelf yet, or no signal: the notes above are in all the same
    const still = readBox(db);
    if (still?.box === latest?.box) writeBox(db, { ...still, shelf_problem: err.message, shelf_tried_at: now() });
  }
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
