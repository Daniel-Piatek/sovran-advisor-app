// The Sovran Quest page (module quest, 2026-11-23, the owner's wish): a Quest group's weeks, newest first. Each week has
// the daily practice (a plain link to Xperiencify, which keeps the reminders and points), the homework in the guide's
// words, and the weekly group call (its transcript to read and search, and the replay in Google Drive).
//
// For each piece of homework a student can start a journal entry or a Sovran Advisor chat. The entry lives only in the
// Journal and the chat only in Sovran Advisor: this file keeps links to them (quest_work), never copies, and shows them
// back in the "Your work" column. The entry and the chat are named "Sovran Quest · Week 2 · Homework 1", which is also how
// Sovran Advisor can gather a student's Quest work later. Done is a private tick per piece (quest_marks), kept on this
// computer and sent nowhere.
//
// Where the weeks come from is set at start (useQuest): in APP Daniel, the weeks the guide published (quest-weeks.js);
// in Sovran Central, the group's Quest shelf in the Sovran cloud (cloudWeeks, cloud/quest.sql). A week looks the same from either:
//   { group, number, title, call_on, practice_url, replay_url, homework: [{ text, where }], transcript }
// where is journal, advisor or elsewhere: which start the piece offers.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';
import { createEntry, localDay } from './entries.js';
import { createConversation, renameConversation } from './assistant.js';
import { plainWords } from './links.js';

export const WHERE = ['journal', 'advisor', 'elsewhere'];
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

// transcript: one week's transcript, asked for only when it is read or searched (Sovran Central keeps no copy of it).
const where = { weeks: async () => [], transcript: async (db, w) => w.transcript ?? '', guide: false };
export const useQuest = (options) => Object.assign(where, options);
export const questOn = (db) => moduleOn(db, 'quest');

export const weekKey = (group, number) => `${group}-${number}`;
export const labelOf = (number, piece) => `Sovran Quest · Week ${number} · Homework ${piece}`;

// "Sat 21 Nov" from a day or a time.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDay(text) {
  const day = String(text ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Sovran Central: the weeks from the group's Quest shelf in the Sovran cloud (group-feed.js questWeeks), asked at most
// once a minute and kept here, so the page and Sovran Advisor still have them when this computer is offline. A key in
// no group, or no key: no weeks. → [week]
const CACHE = 'quest.weeks';
export async function cloudWeeks(db, ask, { everyMs = 60_000 } = {}) {
  const row = db.prepare('SELECT value, updated_at FROM settings WHERE key = ? AND deleted_at IS NULL').get(CACHE);
  let kept = null;
  try { kept = row ? JSON.parse(row.value) : null; } catch { kept = null; }
  if (Array.isArray(kept) && Date.now() - Date.parse(row.updated_at) < everyMs) return kept;
  let weeks;
  let own = ''; // the student's own daily practice link, which Daniel added for them alone (2026-11-24)
  try { ({ weeks, practice_url: own = '' } = await ask(db)); } catch (err) {
    if (err.status === 401 || err.code === 'nolibrary') weeks = [];
    else return Array.isArray(kept) ? kept : [];
  }
  // Never a transcript here: it stays in the cloud and is asked for when read or searched.
  // Their own practice link, when Daniel added one, stands in for the week's: Open today's practice opens it.
  weeks = Array.isArray(weeks) ? weeks.filter((w) => w && typeof w === 'object').map(({ transcript, ...w }) => ({
    ...w, has_transcript: Boolean(w.has_transcript || transcript), ...(typeof own === 'string' && /^https:\/\//.test(own) ? { practice_url: own } : {}) })) : [];
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, CACHE, JSON.stringify(weeks));
  return weeks;
}

async function allWeeks(db) {
  const weeks = await where.weeks(db);
  return (Array.isArray(weeks) ? weeks : []).filter((w) => w && Number.isInteger(w.number)).sort((a, b) => b.number - a.number);
}
async function oneWeek(db, number) {
  const week = (await allWeeks(db)).find((w) => w.number === Number(number));
  if (!week) throw fail(404, 'There is no such week.');
  return week;
}
function onePiece(week, piece) {
  const n = Number(piece);
  const homework = week.homework?.[n - 1];
  if (!Number.isInteger(n) || !homework) throw fail(404, 'There is no such piece of homework.');
  return { n, homework };
}

// The links to what was started from one piece: entries and chats still there, oldest first.
export function workOf(db, key, piece) {
  const rows = db.prepare('SELECT kind, item_id, created_at FROM quest_work WHERE week_key = ? AND piece = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(key, piece);
  const out = [];
  for (const row of rows) {
    if (row.kind === 'entry') {
      const entry = db.prepare('SELECT id, day FROM journal_entries WHERE id = ? AND deleted_at IS NULL').get(row.item_id);
      if (entry) out.push({ kind: 'entry', id: entry.id, href: `/journal/entries/${entry.id}`, label: `Journal · ${shortDay(entry.day)}` });
    } else {
      const chat = db.prepare('SELECT id, created_at FROM conversations WHERE id = ? AND deleted_at IS NULL').get(row.item_id);
      if (chat) out.push({ kind: 'chat', id: chat.id, href: `/assistant/${chat.id}`, label: `Advisor chat · ${shortDay(chat.created_at)}` });
    }
  }
  return out;
}
const isDone = (db, key, piece) => Boolean(db.prepare('SELECT 1 FROM quest_marks WHERE week_key = ? AND piece = ? AND deleted_at IS NULL').get(key, piece));

// Where a piece stands, as the "Your work" marker says it.
function standing(done, work) {
  if (done) return { state: 'done', words: 'Done' };
  if (!work.length) return { state: 'new', words: 'Not started' };
  const entries = work.filter((w) => w.kind === 'entry').length;
  const chats = work.length - entries;
  const parts = [entries ? `${entries} ${entries === 1 ? 'entry' : 'entries'}` : '', chats ? `${chats} ${chats === 1 ? 'chat' : 'chats'}` : ''].filter(Boolean);
  return { state: 'progress', words: `In progress · ${parts.join(', ')}` };
}

// The page: every week, newest first, with this student's own marks and links.
export async function questPage(db) {
  const weeks = await allWeeks(db);
  return {
    guide: Boolean(where.guide),
    weeks: weeks.map((w) => {
      const key = weekKey(w.group, w.number);
      return {
        group: w.group, number: w.number, title: w.title || '', call_on: w.call_on || '',
        practice_url: w.practice_url || '', replay_url: w.replay_url || '', has_transcript: Boolean(w.transcript || w.has_transcript), summary: w.summary || '',
        homework: (w.homework ?? []).map((h, i) => {
          const work = workOf(db, key, i + 1);
          const done = isDone(db, key, i + 1);
          return { piece: i + 1, text: h.text, plain: plainWords(String(h.text ?? '')), where: WHERE.includes(h.where) ? h.where : 'elsewhere', label: labelOf(w.number, i + 1), done, work, ...standing(done, work) };
        }),
      };
    }),
  };
}

// "Start in my journal" or "Start with Sovran Advisor": an ordinary journal entry (today, the homework at the top) or a
// new chat, named with the piece's label, and the link kept here. → { kind, id, href, draft? }
export async function startWork(db, number, piece, kind, { dataDir } = {}) {
  const week = await oneWeek(db, number);
  const { n, homework } = onePiece(week, piece);
  if (kind !== 'entry' && kind !== 'chat') throw fail(400, 'Start in the journal or with Sovran Advisor.');
  const label = labelOf(week.number, n);
  let item;
  if (kind === 'entry') {
    const quoted = String(homework.text).split('\n').map((line) => `> ${line}`).join('\n');
    item = createEntry(db, { day: localDay(), title: label, body: `${quoted}\n\n` });
  } else {
    item = createConversation(db, dataDir);
    renameConversation(db, item.id, label);
  }
  const time = now();
  db.prepare('INSERT INTO quest_work (id, created_at, updated_at, week_key, piece, kind, item_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), time, time, weekKey(week.group, week.number), n, kind, item.id);
  return kind === 'entry'
    ? { kind, id: item.id, href: `/journal/entries/${item.id}` }
    : { kind, id: item.id, href: `/assistant/${item.id}`, draft: `I'm working on this week's homework (${label}): “${plainWords(String(homework.text)).replace(/\s*\n\s*/g, ' ')}”\n\n` };
}

// The private Done on one piece.
export async function setDone(db, number, piece, on) {
  const week = await oneWeek(db, number);
  const { n } = onePiece(week, piece);
  const key = weekKey(week.group, week.number);
  const time = now();
  if (on) {
    if (!isDone(db, key, n)) db.prepare('INSERT INTO quest_marks (id, created_at, updated_at, week_key, piece) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), time, time, key, n);
  } else {
    db.prepare('UPDATE quest_marks SET deleted_at = ?, updated_at = ? WHERE week_key = ? AND piece = ? AND deleted_at IS NULL').run(time, time, key, n);
  }
  return { piece: n, done: Boolean(on) };
}

// A transcript as Google's Gemini notes write it: "### **00:12:04**" headings for the time, then one paragraph per turn,
// "**Name Surname:** what was said". Lines that are neither go on with the turn before. → [{ at, who, text }]
export function transcriptLines(text) {
  const lines = [];
  let at = '';
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const time = line.match(/^#{1,4}\s*\**\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\**\s*$/);
    if (time) { at = time[1]; continue; }
    if (/^#/.test(line)) continue;
    const turn = line.match(/^\*\*([^*:]{1,60}):\*\*\s*(.*)$/) || line.match(/^\*\*([^*]{1,60})\*\*:\s*(.*)$/);
    if (turn) lines.push({ at, who: turn[1].trim(), text: turn[2].trim() });
    else if (lines.length) lines[lines.length - 1].text += ` ${line}`;
    else lines.push({ at, who: '', text: line });
  }
  return lines;
}

// A week's transcript text: from the week itself (APP Daniel) or asked for from the cloud (Sovran Central).
async function textOf(db, week) {
  if (week.transcript) return week.transcript;
  if (week.has_transcript === false) return '';
  try { return String((await where.transcript(db, week)) ?? ''); } catch { return ''; }
}

// One week's transcript, with the lines that hold the words looked for (any case).
export async function readTranscript(db, number, { words = '' } = {}) {
  const week = await oneWeek(db, number);
  const lines = transcriptLines(await textOf(db, week));
  const look = String(words ?? '').trim().toLowerCase();
  const found = look ? lines.map((l, i) => (l.text.toLowerCase().includes(look) ? i : -1)).filter((i) => i >= 0) : [];
  return { number: week.number, title: week.title || '', call_on: week.call_on || '', replay_url: week.replay_url || '', lines, found };
}

// For Sovran Advisor (the quest_read tool): with no week, every week with its homework; with a week, its homework and
// the whole transcript; with words, the lines in every transcript that hold them, each with its week and time.
export async function questText(db, { week = null, words = '' } = {}) {
  const weeks = await allWeeks(db);
  if (!weeks.length) return 'No Quest weeks are here yet.';
  const homeworkText = (w) => (w.homework ?? []).map((h, i) => `  ${labelOf(w.number, i + 1)}: ${plainWords(String(h.text ?? ''))}`).join('\n') || '  (no homework)';
  const head = (w) => `Week ${w.number}${w.title ? ` · ${w.title}` : ''}${w.call_on ? ` (call ${w.call_on})` : ''} — /quest/week-${w.number}`;
  const look = String(words ?? '').trim().toLowerCase();
  if (look) {
    const hits = [];
    for (const w of weeks) {
      for (const l of transcriptLines(await textOf(db, w))) {
        if (l.text.toLowerCase().includes(look)) hits.push(`Week ${w.number} ${l.at} ${l.who}: ${l.text}`);
        if (hits.length >= 60) break;
      }
    }
    return hits.length ? `Lines that say “${words}” (week, time, speaker), link to a week's transcript: /quest/week-<n>/transcript\n${hits.join('\n')}` : `No transcript says “${words}”.`;
  }
  if (week != null && week !== '') {
    const w = weeks.find((x) => x.number === Number(week));
    if (!w) return `There is no Week ${week}.`;
    const transcript = transcriptLines(await textOf(db, w)).map((l) => `${l.at} ${l.who}: ${l.text}`).join('\n');
    return `${head(w)}\nHomework:\n${homeworkText(w)}\n\n${w.summary ? `Summary of the group call:\n${plainWords(w.summary)}\n\n` : ''}Transcript of the group call (/quest/week-${w.number}/transcript):\n${transcript || '(none yet)'}`;
  }
  return `Sovran Quest weeks, newest first:\n${weeks.map((w) => `${head(w)}\n${homeworkText(w)}${w.summary ? `\n  The call, in short: ${plainWords(w.summary).replace(/\s+/g, ' ').slice(0, 600)}` : ''}`).join('\n\n')}`;
}

// ---- go Sovran (phone/quest.js) ----
// The phone shows the same Done and "Your work" as this page. This computer leaves them on the phone's sealed shelf
// (phone-shelf.js, item "quest"): for each piece with something on it, whether it is Done and how many journal entries
// were started from it. → { marks: [{ week, piece, done, entries, last }] }   week: the week key, e.g. "SQ01-2"
export function questShelf(db) {
  const marks = new Map();
  const at = (week, piece) => {
    const k = `${week}#${piece}`;
    if (!marks.has(k)) marks.set(k, { week, piece, done: false, entries: 0, last: '' });
    return marks.get(k);
  };
  for (const m of db.prepare('SELECT week_key, piece FROM quest_marks WHERE deleted_at IS NULL').all()) at(m.week_key, m.piece).done = true;
  const work = db.prepare(`SELECT w.week_key, w.piece, e.day FROM quest_work w JOIN journal_entries e ON e.id = w.item_id AND e.deleted_at IS NULL
    WHERE w.kind = 'entry' AND w.deleted_at IS NULL ORDER BY e.day`).all();
  for (const w of work) { const m = at(w.week_key, w.piece); m.entries++; m.last = w.day; }
  return { marks: [...marks.values()].sort((a, b) => a.week.localeCompare(b.week) || a.piece - b.piece) };
}

const GROUP_CODE = /^[A-Za-z0-9_-]{1,20}$/;
const phoneWeek = (q) => (q && GROUP_CODE.test(String(q.group ?? '')) && Number.isInteger(q.number) && q.number >= 0 && q.number <= 200
  && Number.isInteger(q.piece) && q.piece >= 1 && q.piece <= 50 ? { key: weekKey(q.group, q.number), number: q.number, piece: q.piece } : null);

// Done ticked or unticked on the phone (a sealed note, phone-drop.js): the same private tick as on this page.
export function takePhoneDone(db, note) {
  const w = phoneWeek(note);
  if (!w) return false;
  const time = now();
  if (note.on === false) {
    db.prepare('UPDATE quest_marks SET deleted_at = ?, updated_at = ? WHERE week_key = ? AND piece = ? AND deleted_at IS NULL').run(time, time, w.key, w.piece);
  } else if (!isDone(db, w.key, w.piece)) {
    db.prepare('INSERT INTO quest_marks (id, created_at, updated_at, week_key, piece) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), time, time, w.key, w.piece);
  }
  return true;
}

// A journal entry written on the phone for a piece ("Start in my Journal" there): named and begun as on this page, the
// phone's words under the homework, and linked to the piece. quest: { group, number, piece, text }. → the entry, or null.
export function takePhoneEntry(db, quest, { day, body, written_at } = {}) {
  const w = phoneWeek(quest);
  if (!w) return null;
  const homework = String(quest.text ?? '').trim().slice(0, 4000);
  const quoted = homework ? `${homework.split('\n').map((line) => `> ${line}`).join('\n')}\n\n` : '';
  const entry = createEntry(db, { day, title: labelOf(w.number, w.piece), body: `${quoted}${body}`, origin: 'captured', ...(written_at ? { written_at } : {}) });
  const time = now();
  db.prepare('INSERT INTO quest_work (id, created_at, updated_at, week_key, piece, kind, item_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), time, time, w.key, w.piece, 'entry', entry.id);
  return entry;
}
