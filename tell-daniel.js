// Tell Daniel (module tell, 2026-11-19, the owner's wish): a student lets Daniel know about something, from where it
// happened. On an Assistant answer, a note, a journal entry, a report passage, or the app itself (Help), they pick one of
// "Something isn't working" (broken), "Something seems off here" (off), "I have a question about this" (question) or
// "Other", say why, and see exactly what goes with it before sending: the question and answer and the library pieces
// used, or the passage, or the note's words, and always this app's version. It goes to the Sovran cloud with the
// student's Sovran Library key (cloud/tell-daniel.sql, through the group-feed web function) and waits there for Daniel's
// Student reports page in APP Daniel, with a status: New, Needs digging, Dealt with. Nothing is kept on this computer.
//
// The guide's part (APP Daniel, with the guide key): listTells, markTell, and the daily "new student reports" note.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleOn } from './modules.js';
import { askCloud } from './group-feed.js';

export const KINDS = { broken: 'Something isn’t working', off: 'Something seems off here', question: 'I have a question about this', other: 'Other' };
export const PLACES = ['assistant', 'note', 'journal', 'report', 'group', 'app'];
export const STATUSES = { new: 'New', digging: 'Needs digging', done: 'Dealt with' };
const MAX_CONTEXT = 50_000; // characters of JSON; the cloud takes up to 60,000
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
export const tellOn = (db) => moduleOn(db, 'tell');

// This app's version, said with every report: the package's version and the commit it runs, and the computer's kind.
const HERE = path.dirname(fileURLToPath(import.meta.url));
let version = null;
export function appVersion() {
  if (version) return version;
  let pkg = '?';
  let commit = '';
  try { pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version ?? '?'; } catch { /* left as ? */ }
  try {
    const head = fs.readFileSync(path.join(HERE, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5) : null;
    let sha = ref ? '' : head;
    if (ref) {
      try { sha = fs.readFileSync(path.join(HERE, '.git', ...ref.split('/')), 'utf8').trim(); } catch {
        const packed = fs.readFileSync(path.join(HERE, '.git', 'packed-refs'), 'utf8').split('\n').find((line) => line.endsWith(` ${ref}`));
        sha = packed?.split(' ')[0] ?? '';
      }
    }
    commit = /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : '';
  } catch { /* not a git copy */ }
  version = `${pkg}${commit ? ` (${commit})` : ''} · ${{ darwin: 'Mac', win32: 'Windows', linux: 'Linux' }[process.platform] ?? process.platform}`;
  return version;
}

// Only plain words, numbers and lists of them go with a report, and not too much of them.
function cleanContext(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return value.slice(0, 20_000);
  if (depth > 3) return null;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => cleanContext(v, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [String(k).slice(0, 40), cleanContext(v, depth + 1)]));
  return null;
}

// A student's report. input: { kind, why, place, context }
export async function tellDaniel(db, input) {
  const kind = Object.hasOwn(KINDS, input?.kind) ? input.kind : null;
  if (!kind) throw fail(400, 'Pick what kind of thing this is.');
  const why = typeof input?.why === 'string' ? input.why.replace(/\r\n/g, '\n').trim() : '';
  if (why.length > 4000) throw fail(400, 'Say it in at most 4,000 characters.');
  if (kind === 'other' && !why) throw fail(400, 'Tell Daniel what it’s about.');
  const place = PLACES.includes(input?.place) ? input.place : 'app';
  const context = cleanContext(input?.context && typeof input.context === 'object' && !Array.isArray(input.context) ? input.context : {}, 0) ?? {};
  if (JSON.stringify(context).length > MAX_CONTEXT) throw fail(413, 'That is too much to send at once. Select a smaller part and try again.');
  try {
    return await askCloud(db, { action: 'tell', kind, why, place, context, version: appVersion() });
  } catch (err) {
    if (err.code === 'nolibrary') throw fail(409, 'Tell Daniel needs your Sovran Library key. Add it in Settings › Sovran Library.', 'nolibrary');
    throw err;
  }
}

// ---- The guide's part (APP Daniel) ----
export async function listTells(db, { status = null, before = null } = {}) {
  const answer = await askCloud(db, { action: 'tells', status: Object.hasOwn(STATUSES, status) ? status : null, before: Number(before) > 0 ? Number(before) : null });
  return { reports: answer.reports ?? [], counts: answer.counts ?? { new: 0, digging: 0, done: 0 } };
}
export async function markTell(db, id, input) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw fail(404, 'There is no such report.');
  if (!Object.hasOwn(STATUSES, input?.status)) throw fail(400, 'Pick New, Needs digging or Dealt with.');
  const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 4000) : '';
  return askCloud(db, { action: 'tell_status', id: n, status: input.status, note: note || null });
}
