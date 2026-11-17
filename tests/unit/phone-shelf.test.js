// My reports on Sovran Go, the computer's side: the sealed copies on the drop box's shelf (phone-shelf.js), the
// highlights and comments that come back from the phone (report-marks.js takePhoneMark), and the finding of a
// highlight's words, which the phone and the computer must do alike (phone/anchor.js, public/report-marks.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../db.js';
import { setModule } from '../../modules.js';
import { setLibraryKey } from '../../sovran-library.js';
import { unseal, readLinkPart } from '../../phone/seal.js';
import { linkPhone, collect, phoneDropState, readShelfSoon } from '../../phone-drop.js';
import { useReports } from '../../reports.js';
import { addMark, changeMark, removeMark, listMarks, getMark } from '../../report-marks.js';
import { sectionHtml, shelfReport } from '../../phone-shelf.js';
import { locate, wholeWords } from '../../phone/anchor.js';
import { withPending, stillPending } from '../../phone/reports.js';
import { fakeBox } from '../fake-drop-box.js';

const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-shelf-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const KEY = 'sovran_madeupmadeupmadeupmadeup';
const SECTIONS = [
  { section_key: 'before-you-begin', title: 'Before You Begin', level: 1, position: 1, parent: null, body: 'A mirror, **not** a definition.' },
  { section_key: 'your-gifts', title: 'Your Gifts', level: 1, position: 2, parent: null, body: 'You notice things.\n\n<div class="break"></div>\n\nQuietly so.' },
  { section_key: 'a-part-inside', title: 'A Part Inside', level: 2, position: 3, parent: 'your-gifts', body: 'A part <script>alert(1)</script> inside.' },
  { section_key: 'the-door', title: 'The Door That Opens', level: 1, position: 4, parent: null, body: 'What may come.' },
];
const report = (name, version = 1) => ({ id: 7, report: name, title: `Your ${name}`, version, approved_on: '2026-11-16T13:31:54.501Z', words: 12, sections: SECTIONS, files: [] });

// A stand-in Sovran Library (as library-mcp answers) with the reports it holds now; it can be changed or cut off.
function library(reports) {
  const state = { reports, down: false, asked: 0 };
  state.fetcher = async (_url, init = {}) => {
    state.asked++;
    if (state.down) throw new Error('no signal');
    if (init.headers?.authorization !== `Bearer ${KEY}`) return new Response('{}', { status: 401 });
    const { name, arguments: args } = JSON.parse(init.body).params;
    const structuredContent = name === 'list_my_reports' ? { reports: state.reports.map((r) => ({ ...r, sections: r.sections.map(({ section_key, title, level }) => ({ section_key, title, level })) })) }
      : state.reports.find((r) => r.report === args.report) ? { report: state.reports.find((r) => r.report === args.report) } : undefined;
    return Response.json({ jsonrpc: '2.0', id: 1, result: { ...(structuredContent ? { structuredContent } : {}), isError: !structuredContent } });
  };
  return state;
}
// A student's computer with Reports on, a library key, and a linked phone; shelf(): what the phone would read, opened.
async function computer(t, { reports = [report('pattern')], ...boxOptions } = {}) {
  const db = openDatabase(temp(t));
  setModule(db, 'reports', true);
  setLibraryKey(db, KEY);
  const lib = library(reports);
  useReports({ fetch: lib.fetcher });
  t.after(() => useReports({ fetch: (...a) => fetch(...a) }));
  const box = fakeBox(boxOptions);
  const link = readLinkPart((await linkPhone(db, { fetcher: box.fetcher })).link.split('#')[1]);
  const collects = () => collect(db, { fetcher: box.fetcher });
  const shelf = async () => Object.fromEntries(await Promise.all([...box.boxes.get(link.box).shelf].map(async ([name, it]) => [name, await unseal(link.key, it.sealed)])));
  const puts = () => box.calls.filter((c) => c.action === 'shelf_put').map((c) => c.name);
  const phoneMark = (note) => box.phoneDrops(link, { kind: 'mark', at: new Date().toISOString(), ...note });
  return { db, box, lib, link, collects, shelf, puts, phoneMark };
}
const ID = '22222222-2222-4222-8222-222222222222';
const words = { report: 'pattern', version: 1, section_key: 'your-gifts', quote: 'notice things', prefix: 'You ', suffix: '.' };

test('a section is drawn as the Reports page draws it: Markdown, the break as a gold bar, never HTML from its text', () => {
  assert.equal(sectionHtml('A mirror, **not** a definition.'), '<p>A mirror, <strong>not</strong> a definition.</p>\n');
  const withBreak = sectionHtml('One.\n\n<div class="break"></div>\n\nTwo.');
  assert.match(withBreak, /<p>One\.<\/p>\n<div class="report-break" role="separator"><\/div>\n<p>Two\.<\/p>/);
  assert.ok(!withBreak.includes('SOVRAN-REPORT-BREAK') && !withBreak.includes('class="break"'));
  assert.ok(!sectionHtml('A part <script>alert(1)</script> inside.').includes('<script>'));
  const r = shelfReport(report('pattern'));
  assert.deepEqual(r.sections.map((s) => [s.section_key, s.level, s.part]), [['before-you-begin', 1, null], ['your-gifts', 1, 'One'], ['a-part-inside', 2, null], ['the-door', 1, 'Two']]);
  assert.ok(!('files' in r) && !('id' in r));
});

test('the computer puts sealed copies of the list, each report and the highlights on the shelf; only the phone’s key opens them', async (t) => {
  const { db, box, link, collects, shelf, puts } = await computer(t);
  addMark(db, 'pattern', { ...words, comment: 'Mine.' });
  await collects();
  const on = await shelf();
  assert.deepEqual(Object.keys(on).sort(), ['list', 'marks', 'report.pattern']);
  assert.deepEqual(on.list.reports.map((r) => [r.report, r.title, r.version]), [['pattern', 'Your pattern', 1]]);
  assert.match(on.list.reports[0].about, /Rooted in your own design/);
  assert.equal(on['report.pattern'].report.sections[0].html, '<p>A mirror, <strong>not</strong> a definition.</p>\n');
  assert.deepEqual(on.marks.marks.map((m) => [m.quote, m.comment, m.asks]), [['notice things', 'Mine.', []]]);
  assert.ok(!('conversation_id' in on.marks.marks[0]));
  for (const [, it] of box.boxes.get(link.box).shelf) { assert.match(it.sealed, /^[A-Za-z0-9_-]+$/); assert.ok(!it.sealed.includes('mirror')); }
  assert.ok(!JSON.stringify(box.calls.filter((c) => c.action === 'shelf_put')).includes(KEY), 'the library key never goes to the shelf');
  assert.equal(phoneDropState(db).shelf, 1);
  // Nothing changed: nothing is sent again, and the library is not asked again for hours.
  const before = puts().length;
  await collects(); await collects();
  assert.equal(puts().length, before);
});

test('a changed highlight goes up alone; a new version of a report replaces its copy; a report that is gone comes off', async (t) => {
  const { db, lib, collects, shelf, puts } = await computer(t, { reports: [report('pattern'), report('later')] });
  await collects();
  assert.deepEqual(Object.keys(await shelf()).sort(), ['list', 'marks', 'report.later', 'report.pattern']);
  let seen = puts().length;
  const made = addMark(db, 'pattern', words);
  await collects();
  assert.deepEqual(puts().slice(seen), ['marks']);
  changeMark(db, made.id, { comment: 'Changed here.' });
  await collects();
  assert.equal((await shelf()).marks.marks[0].comment, 'Changed here.');
  removeMark(db, made.id);
  await collects();
  assert.deepEqual((await shelf()).marks.marks, []);
  // The reports machine approves version 2 and withdraws the other: read afresh at the next start of the app.
  seen = puts().length;
  lib.reports = [report('pattern', 2)];
  readShelfSoon();
  await collects();
  assert.deepEqual(puts().slice(seen).sort(), ['list', 'report.later', 'report.pattern']);
  const on = await shelf();
  assert.deepEqual(Object.keys(on).sort(), ['list', 'marks', 'report.pattern']);
  assert.equal(on['report.pattern'].report.version, 2);
});

test('when the library can’t be reached the shelf stays as it is; Reports switched off empties it; a new link gets a fresh shelf', async (t) => {
  const { db, box, lib, link, collects, shelf } = await computer(t);
  await collects();
  lib.down = true;
  readShelfSoon();
  await collects();
  assert.deepEqual(Object.keys(await shelf()).sort(), ['list', 'marks', 'report.pattern'], 'kept while the library is away');
  lib.down = false;
  setModule(db, 'reports', false);
  await collects();
  assert.deepEqual(await shelf(), {});
  setModule(db, 'reports', true);
  await collects();
  assert.deepEqual(Object.keys(await shelf()).sort(), ['list', 'marks', 'report.pattern'], 'back as soon as Reports is on again');
  // "A new link": the old box and its shelf are gone (a lost phone reads no more); the new box gets its own copies.
  const fresh = readLinkPart((await linkPhone(db, { fetcher: box.fetcher, fresh: true })).link.split('#')[1]);
  assert.ok(!box.boxes.has(link.box));
  await collects();
  const item = box.boxes.get(fresh.box).shelf.get('report.pattern');
  assert.equal((await unseal(fresh.key, item.sealed)).report.title, 'Your pattern');
  await assert.rejects(unseal(link.key, item.sealed), 'the old phone’s key opens nothing new');
});

test('an older drop box without a shelf harms nothing: the phone’s notes still come in', async (t) => {
  const { db, box, link, collects } = await computer(t, { shelves: false });
  await box.phoneDrops(link, { body: 'Still works', world: 'inner', at: new Date().toISOString() });
  assert.equal(await collects(), 1);
  assert.equal(await collects(), 0);
  assert.equal(phoneDropState(db).problem, null);
  assert.equal(phoneDropState(db).shelf, 0);
});

test('a highlight made on the phone joins the computer’s, once; then both sides show the same', async (t) => {
  const { db, collects, shelf, phoneMark } = await computer(t);
  await phoneMark({ op: 'add', id: ID, ...words, comment: 'From the tram.' });
  await phoneMark({ op: 'add', id: ID, ...words, comment: 'From the tram.' }); // sent twice
  assert.equal(await collects(), 0, 'a highlight is not a thing for the Inbox');
  const marks = listMarks(db, 'pattern');
  assert.deepEqual(marks.map((m) => [m.id, m.quote, m.prefix, m.suffix, m.comment, m.version]), [[ID, 'notice things', 'You ', '.', 'From the tram.', 1]]);
  assert.deepEqual((await shelf()).marks.marks.map((m) => m.id), [ID], 'and it is on the shelf the phone reads');
  // Not a highlight: refused, nothing made.
  await phoneMark({ op: 'add', id: 'not-an-id', ...words });
  await phoneMark({ op: 'add', id: '33333333-3333-4333-8333-333333333333', ...words, quote: '' });
  await phoneMark({ op: 'add', id: '44444444-4444-4444-8444-444444444444', ...words, report: '../x' });
  await collects();
  assert.equal(listMarks(db, 'pattern').length, 1);
});

test('a comment changed on the phone is kept; changed on both, both are kept; a removal obeys the later change', async (t) => {
  const { db, collects, phoneMark } = await computer(t);
  await phoneMark({ op: 'add', id: ID, ...words, comment: 'First.' });
  await collects();
  await phoneMark({ op: 'comment', id: ID, comment: 'Second.', was: 'First.' });
  await collects();
  assert.equal(getMark(db, ID).comment, 'Second.');
  // Meanwhile it is changed on the computer too, and the phone (which still saw "Second.") changes it as well.
  changeMark(db, ID, { comment: 'At my desk.' });
  await phoneMark({ op: 'comment', id: ID, comment: 'On the tram.', was: 'Second.' });
  await collects();
  assert.equal(getMark(db, ID).comment, 'At my desk.\n\nOn the tram.');
  await phoneMark({ op: 'comment', id: ID, comment: 'On the tram.', was: 'Second.' }); // the same note again: not doubled
  await collects();
  assert.equal(getMark(db, ID).comment, 'At my desk.\n\nOn the tram.');
  // Removed on the phone an hour ago, but changed here since: it stays. Removed now: it goes.
  await phoneMark({ op: 'remove', id: ID, at: new Date(Date.now() - 3600_000).toISOString() });
  await collects();
  assert.ok(getMark(db, ID));
  await phoneMark({ op: 'remove', id: ID, at: new Date(Date.now() + 1000).toISOString() });
  await collects();
  assert.equal(getMark(db, ID), null);
  await phoneMark({ op: 'add', id: ID, ...words }); // an old note arriving late does not bring it back
  await collects();
  assert.equal(listMarks(db, 'pattern').length, 0);
});

test('only the phone’s own link may make highlights: one sealed by the save tool is dropped', async (t) => {
  const { db, box, collects } = await computer(t);
  box.students.set(box.sha(KEY), 'client-madeup');
  await collects(); // registers this computer for saved chats
  const { sealTo } = await import('../../cloud/library-save/sealing.js');
  const tx = box.libraryTx('client-madeup');
  const [{ k }] = await tx`SELECT phone_drop.saver_key() AS k`;
  await tx`SELECT phone_drop.save_note(${await sealTo(k, { kind: 'mark', op: 'add', id: ID, at: new Date().toISOString(), ...words })}) AS r`;
  await collects();
  assert.equal(listMarks(db, 'pattern').length, 0);
});

test('on the phone: what was done there is laid over the computer’s copy, and let go once the computer shows it', () => {
  const at = '2026-11-18T10:00:00.000Z';
  const mine = { op: 'add', id: ID, at, mark: { ...words, comment: '' } };
  const theirs = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...words, quote: 'Quietly so', comment: 'Desk.', updated_at: '2026-11-17T09:00:00.000Z' };
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.deepEqual(withPending([theirs], [mine]).map((m) => [m.id, Boolean(m.waiting)]), [[theirs.id, false], [ID, true]]);
  assert.equal(stillPending([theirs], [mine], now).length, 1, 'waits until the computer has it');
  assert.equal(stillPending([theirs, { id: ID, ...words, comment: '', updated_at: at }], [mine], now).length, 0);
  // A comment on the computer's highlight, then its removal.
  const comment = { op: 'comment', id: theirs.id, at, comment: 'Tram.', was: 'Desk.' };
  assert.equal(withPending([theirs], [comment])[0].comment, 'Tram.');
  assert.equal(stillPending([theirs], [comment], now).length, 1);
  assert.equal(stillPending([{ ...theirs, comment: 'Tram.', updated_at: '2026-11-18T10:01:00.000Z' }], [comment], now).length, 0);
  assert.equal(stillPending([{ ...theirs, comment: 'Desk two.\n\nTram.', updated_at: at }], [comment], now).length, 0, 'both kept on the computer');
  const remove = { op: 'remove', id: theirs.id, at };
  assert.deepEqual(withPending([theirs], [remove]), []);
  assert.equal(stillPending([theirs], [remove], now).length, 1);
  assert.equal(stillPending([], [remove], now).length, 0);
  assert.deepEqual(withPending([], [mine, { op: 'remove', id: ID, at }]), [], 'made and removed before the computer was on');
  assert.equal(stillPending([theirs], [mine], now + 61 * 86400_000).length, 0, 'never kept for ever');
});

test('the phone finds a highlight’s words exactly as the computer does', () => {
  const text = 'You notice things. You notice more things than most. Quietly so.';
  assert.deepEqual(locate(text, { quote: 'You notice', prefix: 'things. ', suffix: ' more' }), { start: 19, end: 29, score: 13 });
  assert.equal(locate(text, { quote: 'not here' }), null);
  assert.deepEqual(wholeWords(text, 5, 11), { quote: 'notice', prefix: 'You ', suffix: ' things. You notice more things ' });
  assert.equal(wholeWords(text, 3, 4), null);
  // The same code, line for line, as the computer's Reports page (public/report-marks.js).
  const computer = fs.readFileSync(new URL('../../public/report-marks.js', import.meta.url), 'utf8');
  const phone = fs.readFileSync(new URL('../../phone/anchor.js', import.meta.url), 'utf8');
  const body = (source, name) => { const at = source.indexOf(`function ${name}(`); assert.ok(at !== -1, name); return source.slice(source.indexOf('{', at), source.indexOf('\n}', at)).replace(/\s+/g, ' '); };
  for (const name of ['textIndex', 'offsetOf', 'locate']) assert.equal(body(phone, name), body(computer, name), `${name} is the same on both`);
  for (const line of ['while (start < end && /\\s/.test(', "const letter = (c) => c != null && /[\\p{L}\\p{N}’'-]/u.test(c);", 'const AROUND = 32;']) {
    assert.ok(computer.includes(line) && phone.includes(line), line);
  }
});
