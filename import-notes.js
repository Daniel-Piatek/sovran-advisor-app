// Bring your notes in (Writing and thinking, advanced/writing/9): an Obsidian folder becomes notes, a Day One export becomes journal entries.
// Three rules, as for contacts:
//   Read only        the page reads the files and sends their text; nothing here touches a file of yours.
//   Safe to run twice  every imported row keeps where it came from (source_key), so a second run finds it and adds nothing; a note you deleted is
//                    still found, so it does not come back.
//   Your edits win   a note changed after it was imported is left exactly as you wrote it, and the report says it was kept.
// The report is how you know: how many came in, were already here, were kept, and that none were doubled.

import { randomUUID } from 'node:crypto';
import { createNote, updateNote } from './notes.js';
import { createEntry } from './entries.js';
import { syncLinks } from './links.js';

export const MAX_CHARS = 3_500_000;
export const MAX_FILES = 5000;
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

// ---- Obsidian ----

const stripFrontMatter = (text) => String(text).replace(/^﻿/, '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
const titleOfPath = (p) => p.split('/').pop().replace(/\.md$/i, '');

// [[Target]], [[Target|words]] and [[Target#Heading]] where Target is a note that was imported from this vault: a link to it. Other [[ ]] stay as they are.
function linkWikilinks(body, byTitle) {
  return body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (whole, target, alias) => {
    const hit = byTitle.get(target.trim().toLowerCase());
    return hit ? `[${(alias || target).trim()}](/notes/${hit})` : whole;
  });
}

// files: [{ path, text }] with the paths as they are in the vault. dryRun: say what it would do and change nothing.
export function importObsidian(db, files, { dryRun = false, source = '' } = {}) {
  if (!Array.isArray(files)) throw fail(400, 'files is a list of { path, text }.');
  if (files.length > MAX_FILES) throw fail(413, `That is more than ${MAX_FILES} files at once: import a smaller folder.`);
  let chars = 0;
  const wanted = [];
  for (const f of files) {
    const p = String(f?.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!/\.md$/i.test(p) || p.split('/').some((part) => part.startsWith('.'))) continue; // Markdown only; .obsidian and other hidden folders are settings
    chars += String(f.text ?? '').length;
    if (chars > MAX_CHARS) throw fail(413, 'That folder is too large for one import. Import a part of it.');
    wanted.push({ path: p, text: String(f.text ?? '') });
  }
  const report = { imported: 0, already: 0, kept: 0, doubled: 0, files: wanted.length, linked: 0, kept_titles: [], would: dryRun };
  const find = db.prepare('SELECT id, updated_at, imported_at, title FROM notes WHERE source_key = ?');
  const made = [];
  db.exec('SAVEPOINT import_notes');
  try {
    const seen = new Set();
    for (const f of wanted) {
      const key = `obsidian:${f.path}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      const there = find.get(key);
      if (there) {
        if (there.imported_at && there.updated_at > there.imported_at) { report.kept += 1; report.kept_titles.push(there.title || titleOfPath(f.path)); } else report.already += 1;
        continue;
      }
      report.imported += 1;
      if (dryRun) continue;
      const note = createNote(db, { title: titleOfPath(f.path), body: stripFrontMatter(f.text).trim(), origin: 'imported' });
      db.prepare('UPDATE notes SET source_key = ?, imported_at = updated_at WHERE id = ?').run(key, note.id);
      made.push(note.id);
    }
    if (!dryRun && made.length) {
      // Second pass: [[links]] between the notes of this vault become links of the app (rows in links, made from the text).
      const byTitle = new Map(db.prepare("SELECT id, title FROM notes WHERE source_key LIKE 'obsidian:%' AND deleted_at IS NULL").all().map((n) => [n.title.toLowerCase(), n.id]));
      for (const id of made) {
        const note = db.prepare('SELECT body FROM notes WHERE id = ?').get(id);
        const linked = linkWikilinks(note.body, byTitle);
        if (linked !== note.body) {
          updateNote(db, id, { body: linked });
          db.prepare('UPDATE notes SET imported_at = updated_at WHERE id = ?').run(id); // still as imported, not an edit of yours
          report.linked += 1;
        } else syncLinks(db, 'note', id, note.body);
      }
    }
    db.exec('RELEASE import_notes');
  } catch (err) { db.exec('ROLLBACK TO import_notes'); db.exec('RELEASE import_notes'); throw err; }
  report.doubled = db.prepare("SELECT count(*) AS n FROM (SELECT source_key FROM notes WHERE source_key IS NOT NULL GROUP BY source_key HAVING count(*) > 1)").get().n;
  return dryRun ? report : saveRun(db, 'obsidian', source, report);
}

// ---- Day One ----

// The day an entry belongs to, in the time zone it was written in (else in this computer's).
function dayOf(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    if (zone) return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch { /* an unknown zone: this computer's */ }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const unescapeDayOne = (text) => String(text ?? '').replace(/\\([.\-!()#*_{}[\]+>`])/g, '$1').replace(/!\[\]\(dayone-moment:\/\/[^)]*\)/g, '').trim();

export function importDayOne(db, json, { dryRun = false, source = '' } = {}) {
  let data = json;
  if (typeof json === 'string') { try { data = JSON.parse(json); } catch { throw fail(400, 'That is not a Day One export: it is not JSON.'); } }
  const entries = data?.entries;
  if (!Array.isArray(entries)) throw fail(400, 'That is not a Day One export: it has no entries.');
  if (entries.length > 50_000) throw fail(413, 'That is more than 50 000 entries at once.');
  const report = { added: 0, already: 0, doubled: 0, entries: entries.length, days: 0, first: '', last: '', skipped: 0, would: dryRun };
  const find = db.prepare('SELECT id FROM journal_entries WHERE source_key = ?');
  const days = new Set();
  db.exec('SAVEPOINT import_dayone');
  try {
    for (const e of entries) {
      const uuid = String(e?.uuid ?? '').trim();
      const day = dayOf(e?.creationDate, e?.timeZone);
      if (!uuid || !day || !isDay(day)) { report.skipped += 1; continue; }
      days.add(day);
      const key = `dayone:${uuid}`;
      if (find.get(key)) { report.already += 1; continue; }
      report.added += 1;
      if (dryRun) continue;
      const entry = createEntry(db, { day, body: unescapeDayOne(e.text), origin: 'imported' });
      db.prepare('UPDATE journal_entries SET source_key = ?, written_at = ? WHERE id = ?').run(key, new Date(e.creationDate).toISOString(), entry.id);
    }
    db.exec('RELEASE import_dayone');
  } catch (err) { db.exec('ROLLBACK TO import_dayone'); db.exec('RELEASE import_dayone'); throw err; }
  const sorted = [...days].sort();
  report.days = sorted.length;
  report.first = sorted[0] ?? '';
  report.last = sorted.at(-1) ?? '';
  report.doubled = db.prepare('SELECT count(*) AS n FROM (SELECT source_key FROM journal_entries WHERE source_key IS NOT NULL GROUP BY source_key HAVING count(*) > 1)').get().n;
  return dryRun ? report : saveRun(db, 'dayone', source, report);
}

// ---- The reports ----

function saveRun(db, kind, source, report) {
  const id = randomUUID();
  const time = now();
  db.prepare("INSERT INTO import_runs (id, created_at, updated_at, origin, kind, source, report) VALUES (?, ?, ?, 'imported', ?, ?, ?)").run(id, time, time, kind, String(source).slice(0, 300), JSON.stringify(report));
  return { id, kind, source, created_at: time, ...report };
}

export const listRuns = (db, limit = 12) => db.prepare('SELECT * FROM import_runs WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
  .map((r) => ({ id: r.id, kind: r.kind, source: r.source, created_at: r.created_at, ...JSON.parse(r.report) }));
