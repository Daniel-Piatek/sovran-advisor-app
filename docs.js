// Help pages (module `help`, myICOR advanced/last/2 and 3; off in a new install): one short page
// per view, kept as Markdown in docs/, beside the code. Each page starts with a small header:
//
//   ---
//   title: Planner
//   module: planner          (optional: the page goes when that module is off)
//   paths: ^/planner(/|$)    (which addresses it explains, a regular expression)
//   ---
//
// and then two layers: what it is and how you use it, then "## How it works" (the files and the
// rules underneath), which the app shows folded. tests/unit/docs.test.js keeps them honest: every
// section of the sidebar has a page, and every file a page names exists.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleOn } from './modules.js';

export const DOCS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
export const HOW_IT_WORKS = '## How it works';

// Reads one page: its header and its words. A page without a title is not a page.
export function parseDoc(id, text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const head = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) head[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!head.title) return null;
  return { id, title: head.title, module: head.module || '', paths: head.paths || '', markdown: text.slice(match[0].length).trim() };
}

// Every page in docs/, in the order of their names.
export function allDocs(dir = DOCS_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { return []; }
  return names.map((n) => parseDoc(n.slice(0, -3), fs.readFileSync(path.join(dir, n), 'utf8'))).filter(Boolean);
}

export const helpOn = (db) => moduleOn(db, 'help');

// The pages to show: none while Help pages is off, and none for a module that is off.
export function listDocs(db, dir = DOCS_DIR) {
  if (!helpOn(db)) return [];
  return allDocs(dir).filter((d) => !d.module || moduleOn(db, d.module));
}

export const readDoc = (db, id, dir = DOCS_DIR) => listDocs(db, dir).find((d) => d.id === id) ?? null;

// The page that explains an address, like /planner/2026-11-12.
export function docForPath(docs, pathname) {
  return docs.find((d) => { try { return d.paths && new RegExp(d.paths).test(pathname); } catch { return false; } }) ?? null;
}

// For the assistant (docs_read): the page for a view, or the best one or two for some words.
export function findDocs(db, { view = '', words = '' } = {}, dir = DOCS_DIR) {
  const docs = listDocs(db, dir);
  const wanted = String(view).trim().toLowerCase();
  if (wanted) {
    const exact = docs.filter((d) => d.id === wanted || d.title.toLowerCase() === wanted
      || docForPath([d], wanted.startsWith('/') ? wanted : `/${wanted}`));
    if (exact.length) return exact.slice(0, 1);
  }
  const terms = `${wanted} ${String(words)}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
  if (!terms.length) return [];
  const score = (d) => {
    const title = d.title.toLowerCase();
    const body = d.markdown.toLowerCase();
    const phrase = String(words).trim().toLowerCase();
    const whole = phrase.length > 3 && (title.includes(phrase) || body.includes(phrase)) ? 10 : 0; // the words together count most
    return terms.reduce((sum, t) => sum + (title.includes(t) ? 5 : 0) + body.split(t).length - 1, whole);
  };
  return docs.map((d) => ({ d, s: score(d) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2).map((x) => x.d);
}
