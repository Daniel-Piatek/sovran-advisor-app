// The Sovran drop box (cloud/phone-drop, cloud/phone-drop.sql), kept in memory for the tests: the same answers as
// the web function, and the two database functions the Sovran Library's save tool uses (cloud/library-save/save.js).

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { seal } from '../phone/seal.js';
import { DROP_URL } from '../phone-drop.js';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function fakeBox({ registers = true, shelves = true } = {}) {
  const boxes = new Map();
  const savers = new Map();   // student id → { box, public, saves }
  const students = new Map(); // sha256 of a library key → student id (library.student_for_key)
  let next = 1;
  const calls = [];
  const fetcher = async (url, { body }) => {
    assert.equal(url, DROP_URL);
    const msg = JSON.parse(body);
    calls.push(msg);
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    const b = boxes.get(msg.box);
    if (msg.action === 'open') { boxes.set(msg.box, { drop_hash: msg.drop_hash, pull_hash: msg.pull_hash, notes: [], shelf: new Map() }); return reply(200, { opened: true }); }
    if (msg.action === 'drop') {
      if (!b || sha(msg.drop) !== b.drop_hash) return reply(404, { error: 'This link has been replaced.' });
      b.notes.push({ id: next++, sealed: msg.sealed }); return reply(200, { kept: true });
    }
    if (msg.action === 'shelf' && shelves) { // the phone reads its shelf (phone_drop.read_shelf)
      if (!b || sha(msg.drop) !== b.drop_hash) return reply(404, { error: 'This link has been replaced.' });
      return reply(200, { shelf: [...b.shelf].sort(([a], [z]) => a.localeCompare(z)).map(([name, it]) => ({ name, updated_at: it.updated_at, ...(msg.have?.[name] === it.updated_at ? {} : { sealed: it.sealed }) })) });
    }
    if (!b || sha(msg.pull) !== b.pull_hash) return reply(404, { error: 'No such box.' });
    if (msg.action === 'take') return reply(200, { notes: b.notes.slice(0, 50) });
    if (msg.action === 'done') { const before = b.notes.length; b.notes = b.notes.filter((n) => !msg.ids.includes(n.id)); return reply(200, { deleted: before - b.notes.length }); }
    if (msg.action === 'close') { boxes.delete(msg.box); for (const [id, s] of savers) if (s.box === msg.box) savers.delete(id); return reply(200, { closed: true }); }
    if (msg.action === 'shelf_put' && shelves) { // the computer's sealed copies (phone_drop.put_shelf)
      if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(String(msg.name)) || (msg.sealed !== '' && !/^[A-Za-z0-9_-]{30,1400000}$/.test(String(msg.sealed)))) return reply(400, { error: 'Send a name and sealed text.' });
      if (msg.sealed === '') { b.shelf.delete(msg.name); return reply(200, { put: true }); }
      if (!b.shelf.has(msg.name) && b.shelf.size >= 12) return reply(429, { error: 'The shelf is full.' });
      b.shelf.set(msg.name, { sealed: msg.sealed, updated_at: new Date(Date.now() + next++).toISOString() });
      return reply(200, { put: true });
    }
    if (msg.action === 'register' && registers) {
      const student = students.get(sha(String(msg.library_key)));
      if (!student) return reply(403, { error: 'That library key is not in use.' });
      if (!/^[A-Za-z0-9_-]{87}$/.test(String(msg.public))) return reply(400, { error: 'Not a public key.' });
      for (const [id, s] of savers) if (s.box === msg.box && id !== student) savers.delete(id);
      savers.set(student, { box: msg.box, public: msg.public, saves: 0 });
      return reply(200, { registered: true });
    }
    return reply(400, { error: `Unknown action: ${msg.action}` }); // as an older drop box answers "register"
  };
  const phoneDrops = async (link, note) => fetcher(DROP_URL, { body: JSON.stringify({ action: 'drop', box: link.box, drop: link.drop, sealed: await seal(link.key, note) }) });
  // library-mcp's transaction for one student, as save.js uses it: a tagged template that answers the two functions.
  const libraryTx = (student) => async (strings, ...values) => {
    const text = strings.join('?');
    const s = savers.get(student);
    if (text.includes('phone_drop.saver_key')) return [{ k: s?.public ?? null }];
    if (text.includes('phone_drop.save_note')) {
      if (!s) return [{ r: 'none' }];
      if (s.saves >= 120) return [{ r: 'busy' }];
      const b = boxes.get(s.box);
      if (b.notes.length >= 200) return [{ r: 'full' }];
      if (!/^[A-Za-z0-9_-]+$/.test(values[0]) || values[0].length > 170000) return [{ r: 'refused' }];
      b.notes.push({ id: next++, sealed: values[0] }); s.saves++;
      return [{ r: 'ok' }];
    }
    throw new Error(`The stand-in library does not know: ${text}`);
  };
  return { boxes, savers, students, calls, fetcher, phoneDrops, libraryTx, sha };
}
