// Help pages (module help, myICOR advanced/last/2 and 3): the docs stay true. Every section of
// the sidebar has a page, every file a page names exists, and the pages (and the assistant's
// docs_read) are there only while Help pages is on, and only for modules that are on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { MODULES, setModule } from '../../modules.js';
import { allDocs, listDocs, readDoc, docForPath, findDocs, parseDoc, HOW_IT_WORKS } from '../../docs.js';
import { runTool, offeredTools, READ_TOOLS } from '../../assistant-tools.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const docs = allDocs();

// The sections of the sidebar (public/shell.js), read from the source: { name, href }.
const sections = [...fs.readFileSync(path.join(root, 'public', 'shell.js'), 'utf8').matchAll(/\{ name: '([^']+)'[^\n]*?href: '(\/[^']*)'/g)]
  .map(([, name, href]) => ({ name, href }));

test('every section of the sidebar has a help page', () => {
  assert.ok(sections.length >= 10, 'the sidebar was read');
  const missing = sections.filter((s) => !docForPath(docs, s.href)).map((s) => s.name);
  assert.deepEqual(missing, [], `no help page for: ${missing.join(', ')} (add one in docs/)`);
});

test('every page has a title, two layers, and a module that exists', () => {
  assert.ok(docs.length >= 10);
  for (const d of docs) {
    assert.ok(d.markdown.includes('## How you use it'), `${d.id}: the first layer, "How you use it"`);
    assert.ok(d.markdown.includes(HOW_IT_WORKS), `${d.id}: the second layer, "How it works"`);
    if (d.module) assert.ok(MODULES.some((m) => m.id === d.module), `${d.id}: there is no module ${d.module}`);
    assert.doesNotThrow(() => new RegExp(d.paths), `${d.id}: paths is a regular expression`);
  }
});

test('every file a page names exists', () => {
  const missing = [];
  for (const d of docs) {
    for (const [, name] of d.markdown.matchAll(/`([^`\s]+\.(?:js|sql|css|md|json))`/g)) {
      if (!fs.existsSync(path.join(root, name))) missing.push(`${d.id}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a page without a title is not a page; the header is read', () => {
  assert.equal(parseDoc('x', 'no header'), null);
  assert.deepEqual(parseDoc('x', '---\ntitle: X\nmodule: tasks\npaths: ^/x$\n---\nWords'), { id: 'x', title: 'X', module: 'tasks', paths: '^/x$', markdown: 'Words' });
});

test('on in a new install; off: no pages and no docs_read; on, only the pages of modules that are on', () => {
  const db = emptyDb();
  assert.notEqual(MODULES.find((m) => m.id === 'help').starter, false, 'on in a new install (2026-11-12, the owner’s wish)');
  setModule(db, 'help', false);
  assert.deepEqual(listDocs(db), []);
  assert.equal(readDoc(db, 'notes'), null);
  assert.ok(!offeredTools(db).some((t) => t.name === 'docs_read'));
  assert.throws(() => runTool(db, 'docs_read', { view: 'notes' }), /switched off/);

  setModule(db, 'help', true);
  const ids = listDocs(db).map((d) => d.id);
  assert.ok(ids.includes('notes') && ids.includes('inbox'));
  assert.ok(!ids.includes('planner'), 'the Planner is off in a new install, so its page is too');
  setModule(db, 'planner', true);
  assert.ok(listDocs(db).some((d) => d.id === 'planner'));
  assert.equal(docForPath(listDocs(db), '/planner/2026-11-12').id, 'planner');
  assert.equal(docForPath(listDocs(db), '/notes/0b5c0f0e-0000-4000-8000-000000000000').id, 'notes');
});

test('docs_read: a view or some words give the page, with its link to cite; reading only', () => {
  const db = emptyDb();
  setModule(db, 'help', true);
  setModule(db, 'planner', true);
  assert.ok(offeredTools(db).some((t) => t.name === 'docs_read'));
  assert.ok(READ_TOOLS.includes('docs_read'));
  const planner = runTool(db, 'docs_read', { view: 'planner' });
  assert.match(planner, /^# Planner \(cite it as \[Planner help\]\(\/help\/planner\)\)/);
  assert.match(planner, /budget line/);
  assert.equal(findDocs(db, { words: 'budget line' })[0].id, 'planner');
  assert.match(runTool(db, 'docs_read', { words: 'zzzz qqqq' }), /No help page/);
  assert.match(runTool(db, 'docs_read', { view: 'planner' }, { readOnly: true }), /Planner/, 'the Inbox reader may read it too');
});
