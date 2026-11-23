// My reports on Sovran Go (module phone-drop with module reports, 2026-11-18, the owner's wish). The phone holds no
// library key. This computer reads the student's reports as the Reports page does (reports.js), seals a copy of
// each with the key only this computer and the phone have (phone/seal.js) and puts it on a shelf in the same drop
// box as the phone's notes (cloud/phone-drop.sql, table shelf). The phone reads its shelf with its own token and
// opens the copies. "A new link" in Settings closes the box: the shelf goes with it, and a lost phone reads no more.
//
// On the shelf (each replaced in place, only when its words changed):
//   list             { at, reports: [{ report, title, version, approved_on, words, about }] }
//   report.<name>    { at, report: { report, title, version, approved_on, words, prepared_for,
//                      sections: [{ section_key, title, level, part, html }] } }   html: drawn here, as the app draws it
//   marks            { at, marks: [{ id, report, version, section_key, quote, prefix, suffix, comment, created_at,
//                      updated_at, asks: [{ role, text }] }] }   the highlights and comments (report-marks.js)
//   group            { at, group: { key, url } }   the phone's own Group Circle key (phone-drop.js), while Group Circle is on
//   quest            { at, marks: [{ week, piece, done, entries, last }] }   the student's own Sovran Quest Done and journal
//                    entries (quest.js questShelf), while Sovran Quest and Group Circle are on; Done and entries made on the phone come back
//                    as sealed notes (phone-drop.js → takePhoneDone, takePhoneEntry)
// Highlights and comments made on the phone come back as sealed notes (kind mark, phone-drop.js → takePhoneMark).
// So a new report, or a highlight made on the computer, reaches the phone once this computer has been on.

import crypto from 'node:crypto';
import markdownit from 'markdown-it';
import { seal } from './phone/seal.js';
import { listReports, readReport, reportsOn } from './reports.js';
import { listMarks, asksOf } from './report-marks.js';
import { markBreaks } from './public/report-break.js';
import { aboutOf } from './public/report-about.js';
import { questOn, questShelf } from './quest.js';

export const SHELF_READ_EVERY = 6 * 3600_000; // the library is asked for the reports again this often, and at each start
export const MAX_SHELF_REPORTS = 8;           // the shelf holds 12 things: the list, the marks, Group Circle, Sovran Quest and eight reports
const PART_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']; // as public/reports.js
const markdown = markdownit({ html: false, linkify: true }); // as the Reports page draws a report: no HTML inside it is ever drawn
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();
const asked = new Map(); // box → when the library last could not be read for it: asked again ten minutes later

// A section's text as the Reports page draws it: Markdown, and each break line as the short gold bar.
export const sectionHtml = (body) => markdown.render(markBreaks(body))
  .replace(/<p>\s*SOVRAN-REPORT-BREAK\s*<\/p>/g, '<div class="report-break" role="separator"></div>').replace(/SOVRAN-REPORT-BREAK/g, '');

// One report for the phone: its sections drawn, each main section after the opening with its PART word.
export function shelfReport(r) {
  const main = r.sections.filter((s) => (s.level ?? 1) === 1);
  const partOf = new Map(main.slice(main.length > 1 ? 1 : main.length).map((s, i) => [s.section_key, PART_WORDS[i] ?? String(i + 1)]));
  return { report: r.report, title: r.title, version: r.version, approved_on: r.approved_on ?? null, words: r.words ?? null, prepared_for: r.prepared_for ?? null,
    sections: r.sections.map((s) => ({ section_key: s.section_key, title: s.title, level: s.level ?? 1, part: partOf.get(s.section_key) ?? null, html: sectionHtml(s.body) })) };
}

// The highlights and comments for the phone, with a mark's questions and answers (the last few, shortened).
export function shelfMarks(db, reports) {
  return reports.flatMap((name) => listMarks(db, name).map(({ conversation_id: _chat, ...m }) => ({ ...m,
    asks: asksOf(db, { conversation_id: _chat }).filter((a) => a.text).slice(-6).map((a) => ({ role: a.role, text: a.text.slice(0, a.role === 'user' ? 600 : 3000) })) })));
}

// Keeps the shelf as it should be. box: this computer's box (phone-drop.js); put(name, sealed): the drop box call.
// Returns what to remember in the box: { shelf: { name: hash }, shelf_read_at, shelf_reports: [...] } or null (nothing changed).
export async function syncShelf(db, box, put, { force = false, group = null } = {}) {
  const had = box.shelf ?? {};
  const want = new Map(); // name → the words to seal (a string)
  let readAt = box.shelf_read_at ?? null;
  let names = box.shelf_reports ?? [];
  if (reportsOn(db)) {
    const due = force || !readAt || Date.now() - new Date(readAt).getTime() > SHELF_READ_EVERY;
    if (due && (force || Date.now() - (asked.get(box.box) ?? 0) > 600_000)) {
      try {
        const list = (await listReports(db)).slice(0, MAX_SHELF_REPORTS);
        const full = [];
        for (const r of list) full.push(shelfReport(await readReport(db, r.report)));
        want.set('list', JSON.stringify({ reports: list.map((r) => ({ report: r.report, title: r.title, version: r.version, approved_on: r.approved_on ?? null, words: r.words ?? null, about: aboutOf(r) || null })) }));
        for (const r of full) want.set(`report.${r.report}`, JSON.stringify({ report: r }));
        names = full.map((r) => r.report);
        readAt = now();
        asked.delete(box.box);
      } catch { asked.set(box.box, Date.now()); } // the library can't be reached just now: the shelf stays as it is
    }
    if (!want.has('list')) for (const name of Object.keys(had)) if (name !== 'marks') want.set(name, null); // not read this time: kept as they are
    want.set('marks', JSON.stringify({ marks: shelfMarks(db, names) }));
  }
  else { readAt = null; names = []; asked.delete(box.box); } // Reports switched off: the shelf is emptied, and read afresh when it is on again
  if (group?.key) want.set('group', JSON.stringify({ group })); else want.delete('group'); // Group Circle on the phone
  // Sovran Quest on the phone: it reads the weeks with the Group Circle key, so only while that key is on the shelf too.
  if (questOn(db) && group?.key) want.set('quest', JSON.stringify(questShelf(db))); else want.delete('quest');
  const shelf = {};
  let changed = false;
  for (const [name, words] of want) {
    if (words === null) { shelf[name] = had[name]; continue; }
    const hash = sha(words);
    if (had[name] !== hash) { await put(name, await seal(box.key, { at: now(), ...JSON.parse(words) })); changed = true; }
    shelf[name] = hash;
  }
  for (const name of Object.keys(had)) if (!want.has(name)) { await put(name, ''); changed = true; } // a report that is gone, or Reports switched off
  if (!changed && readAt === (box.shelf_read_at ?? null)) return null;
  return { shelf, shelf_read_at: readAt, shelf_reports: names };
}
