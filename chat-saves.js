// Keep this chat saved (Sovran Go, part 2). A student's AI (Claude, through the Sovran Library's tool
// save_to_my_sovran_advisor) saves a chat in parts: the first with everything so far, then each new question and
// answer. Every part comes through the drop box, sealed for this computer alone (phone-drop.js), and is joined here
// into ONE Inbox item per chat: "You asked: …" and the answer, in order. A turn sent twice is kept once (by its
// number). An item you have edited, sorted or deleted is left as it is: what comes after starts a new item,
// "(continued)". chat_saves remembers which item belongs to which chat.

import { randomUUID } from 'node:crypto';
import { createCapture } from './captures.js';

export const MAX_CHAT_ITEM = 200_000; // one Inbox item; a longer chat goes on in a "(continued)" item
const MAX_TURN = 60_000;
const CHAT_ID = /^[a-z0-9]{12}$/;
const now = () => new Date().toISOString();
const clean = (text, max) => String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// The item's words: the title, then each turn.
export function renderChat(title, turns) {
  const parts = turns.map((t) => [t.asked ? `**You asked:** ${t.asked}` : '', t.answer].filter(Boolean).join('\n\n'));
  return [title, ...parts].filter(Boolean).join('\n\n---\n\n');
}

function readTurns(note) {
  const out = [];
  for (const t of Array.isArray(note.turns) ? note.turns.slice(0, 200) : []) {
    const turn = { n: Number.isSafeInteger(t?.n) && t.n > 0 ? t.n : null, asked: clean(t?.asked, MAX_TURN), answer: clean(t?.answer, MAX_TURN) };
    if (turn.n !== null && (turn.asked || turn.answer)) out.push(turn);
  }
  return out;
}

// A part of a saved chat, as it was unsealed. Returns the Inbox item it is in now, or null when there was nothing to keep.
export function saveChatPart(db, note) {
  const chatId = String(note?.chat_id ?? '');
  const turns = readTurns(note ?? {});
  if (!CHAT_ID.test(chatId) || !turns.length) return null;
  const rows = db.prepare('SELECT * FROM chat_saves WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(chatId);
  const last = rows.at(-1);
  const title = clean(note.title, 120).replace(/\n+/g, ' ') || last?.title || 'A chat with my AI';
  const assistant = clean(note.assistant, 40).replace(/\n+/g, ' ') || last?.assistant || '';
  const time = now();

  db.exec('BEGIN');
  try {
    let capture = null;
    if (last) { // still as we left it? then the new turns join it
      const open = db.prepare("SELECT id, body FROM captures WHERE id = ? AND deleted_at IS NULL AND state = 'waiting'").get(last.capture_id);
      if (open && open.body === last.rendered) {
        const byNumber = new Map(JSON.parse(last.turns).map((t) => [t.n, t]));
        for (const t of turns) byNumber.set(t.n, t);
        const all = [...byNumber.values()].sort((a, b) => a.n - b.n);
        const body = renderChat(last.title, all);
        if (body.length <= MAX_CHAT_ITEM) {
          db.prepare('UPDATE captures SET body = ?, updated_at = ? WHERE id = ?').run(body, time, open.id);
          db.prepare('UPDATE chat_saves SET turns = ?, rendered = ?, assistant = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(all), body, assistant, time, last.id);
          capture = open.id;
        }
      }
    }
    if (!capture) { // a new item; only what an earlier item of this chat does not already hold, word for word
      const had = new Map(rows.flatMap((r) => JSON.parse(r.turns)).map((t) => [t.n, t]));
      const fresh = turns.filter((t) => { const old = had.get(t.n); return !old || old.asked !== t.asked || old.answer !== t.answer; }).sort((a, b) => a.n - b.n);
      if (fresh.length) {
        const name = last ? `${last.title.replace(/ \(continued\)$/, '')} (continued)` : title;
        const body = renderChat(name, fresh).slice(0, MAX_CHAT_ITEM);
        capture = createCapture(db, { body, world: 'outer' }).id;
        db.prepare("UPDATE captures SET origin = 'captured' WHERE id = ?").run(capture);
        db.prepare(`INSERT INTO chat_saves (id, created_at, updated_at, chat_id, capture_id, title, assistant, turns, rendered)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), time, time, chatId, capture, name, assistant, JSON.stringify(fresh), body);
      } else capture = last.capture_id; // all of it was saved before
    }
    db.exec('COMMIT');
    return capture;
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
