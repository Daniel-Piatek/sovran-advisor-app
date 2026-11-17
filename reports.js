// Reports (module `reports`, 2026-11-16, the owner's wish): your own Sovran reports to read in the app. The Sovran Pattern
// now, later reports as they come, and the Layered Portrait at the top once it begins.
//
// Where they come from: the reports machine (its own project, repository daniel-piatek/sovran-machine) keeps each report in
// the Sovran Library (Supabase project sovran-library, schema sovran_machine: reports, report_sections, report_files),
// locked to the owner's own Library key; only a final report is ever given. The app reads them through the library link
// (library-mcp, LIBRARY_URL in sovran-library.js) with the key from Settings › Sovran Library:
//   list_my_reports        → structuredContent { reports: [{ id, report, title, version, approved_on, words, sections, files }] }
//   read_my_report         → structuredContent { report: { …, sections: [{ section_key, title, level, position, parent, body }] } }
//   GET <library>/files/<report id>/<pdf|for-your-ai>  with Authorization: Bearer <key> → the file's bytes
// The key never reaches a page: the server asks the library and passes the answer on. Nothing is kept on this computer
// (the owner's rule: files live elsewhere, the app links to them). Without a key, the app reads made-up reports from a folder
// in the same shape (data/reports/<report>/report.json and its files), which only the tests and the demo use.

import fs from 'node:fs';
import path from 'node:path';
import { moduleOn } from './modules.js';
import { libraryKey, LIBRARY_URL } from './sovran-library.js';
import { listMarks, marksText } from './report-marks.js';
import { plainBreaks } from './public/report-break.js';

export const REPORT = /^[a-z0-9][a-z0-9-]{0,60}$/; // a report's steady name: pattern, layered-portrait, …
export const FILE_KINDS = ['pdf', 'for-your-ai'];
export const FILE_TYPES = { pdf: 'application/pdf', 'for-your-ai': 'text/markdown; charset=utf-8' };
const FIRST = 'layered-portrait'; // the Layered Portrait sits at the top of the list (the owner's wish, 2026-11-16)
const fail = (status, message) => Object.assign(new Error(message), { status });

// Where to read (server.js sets it at start; tests give their own): the made-up folder, and the library's address.
const where = { dir: '', library: process.env.SOVRAN_LIBRARY_URL || LIBRARY_URL, fetch: (...a) => fetch(...a) };
export const useReports = (options) => Object.assign(where, options);

export const reportsOn = (db) => moduleOn(db, 'reports');
const order = (list) => list.sort((a, b) => (b.report === FIRST) - (a.report === FIRST)
  || String(b.approved_on ?? '').localeCompare(String(a.approved_on ?? '')));
const short = ({ sections = [], files = [], ...r }) => ({
  ...r,
  sections: sections.filter((s) => (s.level ?? 1) === 1).map(({ section_key, title }) => ({ section_key, title })),
  files: files.map(({ kind, file_name, bytes }) => ({ kind, file_name, bytes })),
});

// ---- The Sovran Library ----

async function callLibrary(key, name, args = {}) {
  let res;
  try {
    res = await where.fetch(where.library, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw fail(502, 'The Sovran Library could not be reached just now. Try again in a moment.'); }
  if (res.status === 401) throw fail(403, 'The Sovran Library did not accept your key. Check it in Settings › Sovran Library.');
  if (!res.ok) throw fail(502, `The Sovran Library answered ${res.status}. Try again in a moment.`);
  const body = await res.json().catch(() => ({}));
  return body.result?.structuredContent ?? null;
}

// ---- The made-up folder (no key: the tests and the demo) ----

function readFolder(name) {
  if (!where.dir || !REPORT.test(name)) return null;
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(where.dir, name, 'report.json'), 'utf8')); } catch { return null; }
  if (!report || report.status !== 'final' || report.report !== name) return null;
  const sections = (Array.isArray(report.sections) ? report.sections : []).filter((s) => s && typeof s.title === 'string')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const files = (Array.isArray(report.files) ? report.files : [])
    .filter((f) => f && FILE_KINDS.includes(f.kind) && typeof f.file_name === 'string' && fs.existsSync(path.join(where.dir, name, path.basename(f.file_name))));
  return { ...report, sections, files };
}
function folderNames() {
  try { return fs.readdirSync(where.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}

// ---- What the page and the assistant ask ----

// Each final report, the Layered Portrait first, then the newest approved; each with its main sections and its files.
export async function listReports(db) {
  if (!reportsOn(db)) return [];
  const key = libraryKey(db);
  if (key) return order(((await callLibrary(key, 'list_my_reports'))?.reports ?? []).map(short));
  return order(folderNames().map(readFolder).filter(Boolean).map(short));
}

// One report in full, with every section's text (parent: the section_key of the section a part sits in).
export async function readReport(db, name) {
  if (!reportsOn(db)) throw fail(409, 'Reports is switched off in Settings › Modules.');
  if (!REPORT.test(String(name))) throw fail(404, 'There is no such report.');
  const key = libraryKey(db);
  const report = key ? (await callLibrary(key, 'read_my_report', { report: String(name) }))?.report : readFolder(String(name));
  if (!report) throw fail(404, 'There is no such report.');
  return { ...report, files: (report.files ?? []).map(({ kind, file_name, bytes }) => ({ kind, file_name, bytes })) };
}

// One of a report's files: { name, type, bytes (a Buffer) }.
export async function reportFile(db, name, kind) {
  if (!FILE_KINDS.includes(kind)) throw fail(404, 'A report’s files are its pdf and its for-your-ai file.');
  const report = await readReport(db, name);
  const file = report.files.find((f) => f.kind === kind);
  if (!file) throw fail(404, 'This report has no such file yet.');
  const key = libraryKey(db);
  if (!key) return { name: path.basename(file.file_name), type: FILE_TYPES[kind], bytes: fs.readFileSync(path.join(where.dir, report.report, path.basename(file.file_name))) };
  let res;
  try {
    res = await where.fetch(`${where.library}/files/${report.id}/${kind}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60_000) });
  } catch { throw fail(502, 'The Sovran Library could not be reached just now. Try again in a moment.'); }
  if (!res.ok) throw fail(res.status === 404 ? 404 : 502, res.status === 404 ? 'This report has no such file yet.' : `The Sovran Library answered ${res.status}.`);
  return { name: path.basename(file.file_name), type: FILE_TYPES[kind], bytes: Buffer.from(await res.arrayBuffer()) };
}

// Text the assistant reads: the list, or one report (whole or one section with its parts), and its for-your-AI file when
// the whole report is asked for.
export async function reportsText(db, { report = '', section = '' } = {}) {
  if (!report) {
    const all = await listReports(db);
    if (!all.length) return 'There are no reports yet.';
    return all.map((r) => {
      const marks = listMarks(db, r.report);
      return `- ${r.title} (report: ${r.report}, version ${r.version}, approved ${String(r.approved_on ?? 'not yet').slice(0, 10)}; link /reports/${r.report})\n  Sections: ${r.sections.map((s) => `${s.title} [${s.section_key}]`).join('; ')}`
        + (marks.length ? `\n  The owner's highlights: ${marks.length} (${marks.filter((m) => m.comment).length} with a comment); read the report to see them.` : '');
    }).join('\n');
  }
  const r = await readReport(db, report);
  const wanted = String(section);
  const chosen = wanted ? r.sections.filter((s) => s.section_key === wanted || s.parent === wanted) : r.sections;
  if (wanted && !chosen.length) throw fail(404, `There is no section ${wanted} in ${r.title}.`);
  const head = `# ${r.title} (version ${r.version}; cite it as [${r.title}](/reports/${r.report}))\n`
    + 'A mirror, not a definition: speak about it with care, quote it rather than add to it; the owner is the authority on what is true for them.';
  // The owner's own highlights and comments (report-marks.js) come first, so they are never cut off.
  const marks = marksText(db, r.report, r.sections, wanted ? chosen.map((s) => s.section_key) : null);
  const top = marks ? `${head}\n\n${marks}\n\n---\n\n# The report` : head;
  // The whole report: its for-your-AI file when it has one (a note on how to read it, then the whole report), else its sections.
  if (!wanted && r.files.some((f) => f.kind === 'for-your-ai')) {
    try { return `${top}\n\n${plainBreaks((await reportFile(db, r.report, 'for-your-ai')).bytes.toString('utf8'))}`; } catch { /* then its sections */ }
  }
  const parts = [top];
  for (const s of chosen) parts.push('', `${s.level === 2 ? '###' : '##'} ${s.title}`, '', plainBreaks(s.body));
  return parts.join('\n');
}
