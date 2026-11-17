// Highlights and comments on your Sovran reports (Reports, 2026-11-16, the owner's wish). The report stays untouched in the
// Sovran Library; your marks are your own layer on top, kept only in this app (report_marks). A mark is the words you chose
// (quote) in one section, with a little of the text around them (prefix, suffix) so the page finds the same place again, also
// in a later version of the report. A comment is optional. Removing a mark only sets deleted_at.
// Ask about this (2026-11-17, the owner's wish): a mark can also carry a chat with the assistant about its words
// (conversation_id). The questions and answers are that chat's own messages, so they show beside the words, in the
// Assistant's list of chats, and in what the assistant reads with the report (marksText).

import { randomUUID } from 'node:crypto';

const REPORT = /^[a-z0-9][a-z0-9-]{0,60}$/; // as in reports.js
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const COLUMNS = 'id, created_at, updated_at, report, version, section_key, quote, prefix, suffix, comment, conversation_id';
export const LIMITS = { quote: 2000, around: 64, comment: 4000 };

export const listMarks = (db, report) => db.prepare(`SELECT ${COLUMNS} FROM report_marks
  WHERE report = ? AND deleted_at IS NULL ORDER BY created_at`).all(String(report));

// A mark's questions and answers, in order: [{ role: 'user' | 'assistant', text, state }] (none without a chat).
export const asksOf = (db, mark) => (mark?.conversation_id ? db.prepare(`SELECT role, text, state FROM chat_messages
  WHERE conversation_id = ? ORDER BY created_at, rowid`).all(mark.conversation_id).map((m) => ({ ...m })) : []);
// For the page: each mark with its questions and answers.
export const listMarksWithAsks = (db, report) => listMarks(db, report).map((m) => ({ ...m, asks: asksOf(db, m) }));
// The chat a mark's questions go to (set once, when the first question is asked).
export function setMarkConversation(db, id, conversationId) {
  db.prepare('UPDATE report_marks SET conversation_id = ?, updated_at = ? WHERE id = ?').run(String(conversationId), now(), String(id));
  return getMark(db, id);
}

// What the assistant is told with a question asked about a mark's words (only the first question carries it all; its
// chat goes on from there). D's rule (2026-11-17): it names a decode, a system or a source only when the owner asks.
export function askNote({ quote, sectionTitle, report, reportTitle, first }) {
  const words = quote.replace(/\s+/g, ' ').trim();
  const where = `“${sectionTitle}” in their ${reportTitle}`;
  if (!first) return `The owner is still asking about the words they selected in ${where}: “${words}”.`;
  return [
    `The owner selected these words in ${where} and asks about them: “${words}”.`,
    `First read the report with reports_read (report: ${report}). It gives their own highlights, comments and earlier questions first, then the whole report: answer about these words in the context of the whole report.`,
    'If the report alone does not answer it, look in their own decodes with the Sovran Library tools, if you have them (search_my_decodes, then read_my_decode_section), and follow the reading note that comes with them. Where the report names the decode parts a section was written from, look there first.',
    'Do not name a decode, a system, a gene key, gate or planet, or say where an answer comes from, unless they ask where it comes from.',
    'Answer briefly, in plain words and a few short paragraphs: it shows in a narrow column beside the words.',
  ].join(' ');
}
export const getMark = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM report_marks WHERE id = ? AND deleted_at IS NULL`).get(String(id)) ?? null;

export function checkMarkInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') return 'Send a mark: { section_key, quote, prefix?, suffix?, comment? }.';
  if (!partial) {
    if (typeof input.section_key !== 'string' || !/^[a-z0-9-]{1,120}$/.test(input.section_key)) return 'section_key is the section’s key.';
    if (typeof input.quote !== 'string' || !input.quote.trim()) return 'quote is the words you chose.';
    if (input.quote.length > LIMITS.quote) return `A highlight is at most ${LIMITS.quote} characters.`;
    for (const k of ['prefix', 'suffix']) if (k in input && (typeof input[k] !== 'string' || input[k].length > LIMITS.around)) return `${k} is at most ${LIMITS.around} characters.`;
    if ('version' in input && !Number.isInteger(input.version)) return 'version is a whole number.';
  }
  if ('comment' in input && (typeof input.comment !== 'string' || input.comment.length > LIMITS.comment)) return `A comment is at most ${LIMITS.comment} characters.`;
  return null;
}

export function addMark(db, report, input) {
  if (!REPORT.test(String(report))) throw fail(404, 'There is no such report.');
  const problem = checkMarkInput(input);
  if (problem) throw fail(400, problem);
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO report_marks (id, created_at, updated_at, report, version, section_key, quote, prefix, suffix, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, String(report), input.version ?? 1, input.section_key,
    input.quote, input.prefix ?? '', input.suffix ?? '', (input.comment ?? '').trim());
  return getMark(db, id);
}

export function changeMark(db, id, input) {
  const problem = checkMarkInput(input, { partial: true });
  if (problem) throw fail(400, problem);
  if (!getMark(db, id)) throw fail(404, 'There is no such highlight.');
  if ('comment' in input) db.prepare('UPDATE report_marks SET comment = ?, updated_at = ? WHERE id = ?').run(input.comment.trim(), now(), String(id));
  return getMark(db, id);
}

export function removeMark(db, id) {
  const mark = getMark(db, id);
  if (!mark) throw fail(404, 'There is no such highlight.');
  db.prepare('UPDATE report_marks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), String(id));
  return { ...mark, deleted: true };
}

export function restoreMark(db, id) {
  const row = db.prepare('SELECT id FROM report_marks WHERE id = ? AND deleted_at IS NOT NULL').get(String(id));
  if (!row) throw fail(404, 'There is no such removed highlight.');
  db.prepare('UPDATE report_marks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), String(id));
  return getMark(db, id);
}

// For the assistant: the owner's highlights and comments on a report, by section, in reading order.
export function marksText(db, report, sections = [], only = null) {
  const marks = listMarks(db, report).filter((m) => !only || only.includes(m.section_key));
  if (!marks.length) return '';
  const order = new Map(sections.map((s, i) => [s.section_key, i]));
  const titleOf = new Map(sections.map((s) => [s.section_key, s.title]));
  const sorted = [...marks].sort((a, b) => (order.get(a.section_key) ?? 999) - (order.get(b.section_key) ?? 999));
  const lines = sorted.map((m) => {
    const where = titleOf.get(m.section_key) ?? m.section_key;
    const quote = m.quote.replace(/\s+/g, ' ').trim();
    const asks = asksOf(db, m).filter((a) => a.text).slice(-12).map((a) => a.role === 'user'
      ? `\n  They asked their assistant: ${a.text.replace(/\s+/g, ' ').slice(0, 600)}`
      : `\n  The answer: ${a.text.replace(/\s+/g, ' ').slice(0, 1500)}`).join('');
    return `- In “${where}” they highlighted: “${quote}”${m.comment ? `\n  Their comment: ${m.comment.replace(/\n+/g, ' ')}` : ''}${asks}`;
  });
  return `## The owner's own highlights and comments on this report (${marks.length})\n\nThese are theirs, kept only in their app; the report itself is unchanged. Use them: they show what struck them and what they asked (with the answers they were given beside the words).\n\n${lines.join('\n')}`;
}
