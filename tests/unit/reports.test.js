// Reports (module reports, reports.js; on in a new install since 2026-11-17): from the Sovran Library with the owner's key (a stand-in library here), the Layered
// Portrait first; files fetched with the key; the assistant's reports_read; without a key the made-up folder; off is off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { setModule } from '../../modules.js';
import { setLibraryKey } from '../../sovran-library.js';
import { listReports, readReport, reportFile, reportsText, useReports } from '../../reports.js';
import { runTool, offeredTools, READ_TOOLS } from '../../assistant-tools.js';

// Reports is off in a new install (starter: false); each test switches it on.
const emptyDb = () => { const db = prepareDatabase(new DatabaseSync(':memory:')); setModule(db, 'reports', true); return db; };
const KEY = 'sovran_madeupmadeupmadeupmadeup';
const SECTIONS = [
  { section_key: 'before-you-begin', title: 'Before You Begin', level: 1, position: 1, parent: null, body: 'A mirror.' },
  { section_key: 'your-gifts', title: 'Your Gifts', level: 1, position: 2, parent: null, body: 'You notice things.' },
  { section_key: 'a-part-inside', title: 'A Part Inside', level: 2, position: 3, parent: 'your-gifts', body: 'Quietly so.' },
  { section_key: 'the-door-that-opens', title: 'The Door That Opens', level: 1, position: 4, parent: null, body: 'What may come.' },
];
const made = (report, approved_on, files = []) => ({ id: report.length, report, title: `Your ${report}`, version: 1, approved_on, words: 12, sections: SECTIONS, files });
const PATTERN = made('pattern', '2026-11-16T13:31:54.501Z', [{ kind: 'pdf', file_name: 'Pattern.pdf', bytes: 3 }, { kind: 'for-your-ai', file_name: 'Pattern-for-your-ai.md', bytes: 9 }]);

// A stand-in library: answers as library-mcp does, and only to KEY.
function library() {
  const asked = [];
  const fetcher = async (url, init = {}) => {
    asked.push({ url, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
    if (init.headers?.authorization !== `Bearer ${KEY}`) return new Response('{}', { status: url.includes('/files/') ? 404 : 401 });
    if (url.endsWith(`/files/${PATTERN.id}/pdf`)) return new Response('PDF');
    if (url.endsWith(`/files/${PATTERN.id}/for-your-ai`)) return new Response('FOR YOUR AI: the whole report');
    if (url.includes('/files/')) return new Response('{}', { status: 404 });
    const { name, arguments: args } = JSON.parse(init.body).params;
    const all = [PATTERN, made('layered-portrait', '2026-01-01T00:00:00Z'), made('later', '2026-10-01T00:00:00Z')];
    const structuredContent = name === 'list_my_reports' ? { reports: all.map((r) => ({ ...r, sections: r.sections.map(({ section_key, title, level }) => ({ section_key, title, level })) })) }
      : all.find((r) => r.report === args.report) ? { report: all.find((r) => r.report === args.report) } : undefined;
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '…' }], ...(structuredContent ? { structuredContent } : {}), isError: !structuredContent } });
  };
  return { asked, fetcher };
}

test('with the key: the library’s reports, the Layered Portrait first, then the newest; files fetched with the key', async () => {
  const db = emptyDb();
  setLibraryKey(db, KEY);
  const lib = library();
  useReports({ fetch: lib.fetcher, library: 'https://library.test/library-mcp', dir: '' });
  const list = await listReports(db);
  assert.deepEqual(list.map((r) => r.report), ['layered-portrait', 'pattern', 'later']);
  assert.deepEqual(list[1].sections.map((s) => s.title), ['Before You Begin', 'Your Gifts', 'The Door That Opens'], 'the list names the main sections');
  assert.deepEqual(list[1].files.map((f) => f.kind), ['pdf', 'for-your-ai']);
  assert.equal(lib.asked[0].body.params.name, 'list_my_reports');
  assert.equal(lib.asked[0].auth, `Bearer ${KEY}`, 'the key goes in the header');
  assert.equal((await readReport(db, 'pattern')).sections.length, 4);
  const pdf = await reportFile(db, 'pattern', 'pdf');
  assert.equal(pdf.bytes.toString(), 'PDF');
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(lib.asked.at(-1).url, `https://library.test/library-mcp/files/${PATTERN.id}/pdf`);
  await assert.rejects(readReport(db, 'nothing'), /no such report/);
  await assert.rejects(readReport(db, '../pattern'), /no such report/);
  await assert.rejects(reportFile(db, 'later', 'pdf'), /no such file/);
  await assert.rejects(reportFile(db, 'pattern', '../x'), /pdf and its for-your-ai/);

  setLibraryKey(db, 'sovran_switchedoffswitchedoffoff');
  await assert.rejects(listReports(db), /did not accept your key/);
  useReports({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(listReports(db), /could not be reached/);
});

test('reports_read: the list, the whole report as its for-your-AI file, one section with its parts; reading only; off is off', async () => {
  const db = emptyDb();
  setLibraryKey(db, KEY);
  useReports({ fetch: library().fetcher, library: 'https://library.test/library-mcp', dir: '' });
  assert.ok(READ_TOOLS.includes('reports_read'));
  assert.ok(offeredTools(db).some((t) => t.name === 'reports_read'), 'offered once switched on');
  assert.match(await runTool(db, 'reports_read', {}), /Your pattern \(report: pattern, version 1, approved 2026-11-16; link \/reports\/pattern\)/);
  const whole = await runTool(db, 'reports_read', { report: 'pattern' });
  assert.match(whole, /^# Your pattern \(version 1; cite it as \[Your pattern\]\(\/reports\/pattern\)\)\nA mirror, not a definition/);
  assert.match(whole, /FOR YOUR AI: the whole report$/);
  const one = await reportsText(db, { report: 'pattern', section: 'your-gifts' });
  assert.match(one, /## Your Gifts[\s\S]*### A Part Inside/, 'a section comes with its parts');
  assert.doesNotMatch(one, /Door That Opens|FOR YOUR AI/);
  const noFile = await reportsText(db, { report: 'later' });
  assert.match(noFile, /## The Door That Opens\n\nWhat may come\./, 'no for-your-AI file: the sections');
  await assert.rejects(Promise.resolve().then(() => runTool(db, 'reports_read', { report: 'nothing' })), /no such report/);

  setModule(db, 'reports', false);
  assert.deepEqual(await listReports(db), []);
  assert.ok(!offeredTools(db).some((t) => t.name === 'reports_read'));
  assert.throws(() => runTool(db, 'reports_read', {}), /switched off/);
});

test('without a key: only final made-up reports from the folder, and only files that are there', async () => {
  const db = emptyDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  const place = (report, extra = {}, files = {}) => {
    fs.mkdirSync(path.join(dir, report), { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, report, name), text);
    fs.writeFileSync(path.join(dir, report, 'report.json'), JSON.stringify({ ...made(report, '2026-08-24'), status: 'final', ...extra }));
  };
  place('pattern', { files: [{ kind: 'pdf', file_name: 'P.pdf', bytes: 3 }, { kind: 'for-your-ai', file_name: 'gone.md', bytes: 1 }] }, { 'P.pdf': 'pdf' });
  place('draft-one', { status: 'draft' });
  fs.mkdirSync(path.join(dir, 'Not-A-Name'));
  useReports({ dir, fetch: async () => { throw new Error('the library is never asked without a key'); } });
  const list = await listReports(db);
  assert.deepEqual(list.map((r) => r.report), ['pattern']);
  assert.deepEqual(list[0].files.map((f) => f.kind), ['pdf'], 'a file that is not there is not offered');
  assert.equal((await reportFile(db, 'pattern', 'pdf')).bytes.toString(), 'pdf');
  await assert.rejects(readReport(db, 'draft-one'), /no such report/, 'a draft is never shown');
  useReports({ dir: '' });
});
