// Log lines (interactions.js, advanced/people/4): the table, the link to who it was with,
// the Timeline rows, the API, the assistant's tool, and a database from before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, createCompany } from '../../people.js';
import { logInteraction, deleteInteraction, restoreInteraction, getInteraction, checkInteractionInput, findPerson } from '../../interactions.js';
import { timeline } from '../../timeline.js';
import { linkedFrom } from '../../links.js';
import { runTool, offeredTools, applyAction, undoAction } from '../../assistant-tools.js';
import { setPermission, getPermissions } from '../../permissions.js';
import { setModule } from '../../modules.js';
import { createConversation } from '../../assistant.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const NOW = new Date(2026, 10, 8, 14, 30, 0);
const about = (p) => ({ kind: 'person', id: p.id });

test('a log line is a row and a link; today is now, another day is noon, the future is refused', () => {
  const db = emptyDb();
  const jonas = createPerson(db, { name: 'Jonas Weber' });
  const today = logInteraction(db, { about: about(jonas), kind: 'message', note: ' Sent the draft. ' }, { at: NOW });
  assert.deepEqual([today.kind, today.happened_at, today.note, today.origin, today.who], ['message', '2026-11-08T14:30', 'Sent the draft.', 'typed', [{ kind: 'person', id: jonas.id, name: 'Jonas Weber' }]]);
  assert.equal(logInteraction(db, { about: about(jonas), kind: 'call', note: 'Budget is approved', when: '2026-10-30' }, { at: NOW }).happened_at, '2026-10-30T12:00');
  assert.equal(logInteraction(db, { about: about(jonas), kind: 'coffee', note: 'Quick one', when: '2026-11-08T09:15' }, { at: NOW }).happened_at, '2026-11-08T09:15');
  for (const bad of ['2026-11-09', '2026-11-08T15:00', '2026-02-31']) {
    assert.throws(() => logInteraction(db, { about: about(jonas), kind: 'call', note: 'x', when: bad }, { at: NOW }), (e) => e.status === 400, bad);
  }
  assert.throws(() => logInteraction(db, { about: { kind: 'person', id: '11111111-1111-1111-1111-111111111111' }, kind: 'call', note: 'x' }), /not in the app/);
  // Who it was with is a link row, not a column (Mentioned in lists pages; log lines are on the Timeline tab).
  assert.deepEqual(db.prepare("SELECT from_kind, to_kind, to_id, link_text, context FROM links WHERE from_id = ?").all(today.id).map((l) => ({ ...l })),
    [{ from_kind: 'interaction', to_kind: 'person', to_id: jonas.id, link_text: 'Jonas Weber', context: 'Sent the draft.' }]);
  assert.equal(linkedFrom(db, 'person', jonas.id).length, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('interactions') WHERE name IN ('person_id', 'about')").get().n, 0);
  // Input checks.
  assert.equal(checkInteractionInput({ about: about(jonas), kind: 'text', note: 'x' }), 'kind is call, meeting, coffee, message, other.');
  assert.match(checkInteractionInput({ about: about(jonas), kind: 'call', note: '  ' }), /needs a sentence/);
  assert.match(checkInteractionInput({ about: about(jonas), kind: 'call', note: 'x'.repeat(501) }), /longer than 500/);
  assert.match(checkInteractionInput({ about: { kind: 'note', id: 'x' }, kind: 'call', note: 'x' }), /about is/);
  assert.match(checkInteractionInput({ about: about(jonas), kind: 'call', note: 'x', when: 'yesterday' }), /when is a day/);
});

test('log lines are on the Timeline and on a person’s and a company’s tab; deleting takes them off and Undo brings them back', () => {
  const db = emptyDb();
  const nord = createCompany(db, { name: 'Nordlicht Studio' });
  const jonas = createPerson(db, { name: 'Jonas Weber' });
  const lena = createPerson(db, { name: 'Lena Fischer', company_id: nord.id });
  const call = logInteraction(db, { about: about(jonas), kind: 'call', note: 'Budget is approved, wants a draft by the 20th', when: '2026-11-05' }, { at: NOW });
  const hello = logInteraction(db, { about: about(lena), kind: 'message', note: 'Said hello', when: '2026-11-07' }, { at: NOW });
  logInteraction(db, { about: { kind: 'company', id: nord.id }, kind: 'meeting', note: 'Studio visit', when: '2026-11-06' }, { at: NOW });
  const big = timeline(db, { now: NOW }).items;
  assert.deepEqual(big.map((i) => [i.kind, i.text, i.where, i.who]), [
    ['interaction', 'Said hello', 'Logged · message', ['Lena Fischer']],
    ['interaction', 'Studio visit', 'Logged · meeting', ['Nordlicht Studio']],
    ['interaction', 'Budget is approved, wants a draft by the 20th', 'Logged · call', ['Jonas Weber']],
  ]);
  assert.equal(big[2].href, `/people/${jonas.id}?tab=timeline`);
  assert.equal(big[1].href, `/companies/${nord.id}?tab=timeline`);
  assert.deepEqual(timeline(db, { now: NOW, about: about(jonas) }).items.map((i) => i.text), ['Budget is approved, wants a draft by the 20th']);
  // A company: its own line, and its people's marked with the person (Jonas's is not here).
  const company = timeline(db, { now: NOW, about: { kind: 'company', id: nord.id } }).items;
  assert.deepEqual(company.map((i) => [i.text, i.via?.name]), [['Said hello', 'Lena Fischer'], ['Studio visit', undefined]]);
  // Search finds the sentence or the name; kinds narrow.
  assert.deepEqual(timeline(db, { now: NOW, q: 'weber' }).items.map((i) => i.text), ['Budget is approved, wants a draft by the 20th']);
  assert.deepEqual(timeline(db, { now: NOW, kinds: ['interaction'], q: 'budget draft' }).items.length, 1);
  assert.deepEqual(timeline(db, { now: NOW, kinds: ['note'] }).items, []);
  // Delete and Undo.
  assert.equal(deleteInteraction(db, hello.id).deleted_at !== null, true);
  assert.equal(timeline(db, { now: NOW }).items.length, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM interactions').get().n, 3, 'the row stays: nothing is really removed');
  restoreInteraction(db, hello.id);
  assert.equal(timeline(db, { now: NOW }).items.length, 3);
  assert.equal(getInteraction(db, call.id).who.length, 1);
});

test('the assistant logs a line: Asks first waits on a card; Does it alone logs at once; Undo takes it back', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena Fischer' });
  createPerson(db, { name: 'Lena Berg' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactions-chat-'));
  const conversation = createConversation(db, dir);
  const cards = [];
  const run = { conversationId: conversation.id, card: (c) => cards.push(c) };
  assert.equal(getPermissions(db).find((p) => p.key === 'log_interaction').mode, 'ask');
  const waiting = JSON.parse(runTool(db, 'log_interaction', { person: 'Lena Fischer', kind: 'call', sentence: 'She wants the workshop in November' }, run));
  assert.ok(waiting.waiting);
  assert.equal(timeline(db, { now: new Date() }).items.length, 0, 'nothing logged until approved');
  assert.deepEqual([cards[0].kind, cards[0].state, cards[0].title], ['log_interaction', 'proposed', 'call with Lena Fischer: She wants the workshop in November']);
  applyAction(db, cards[0].id);
  const [row] = timeline(db, { now: new Date() }).items;
  assert.deepEqual([row.text, row.who], ['She wants the workshop in November', ['Lena Fischer']]);
  assert.equal(db.prepare('SELECT origin FROM interactions').get().origin, 'assistant');
  undoAction(db, cards[0].id);
  assert.equal(timeline(db, { now: new Date() }).items.length, 0);

  setPermission(db, 'log_interaction', 'alone');
  const done = JSON.parse(runTool(db, 'log_interaction', { person: lena.id, kind: 'coffee', sentence: 'Quick coffee', when: '2026-11-01' }, run));
  assert.equal(done.logged.with, 'Lena Fischer');
  assert.equal(timeline(db, { now: new Date() }).items.length, 1);
  // Not guessed: nobody like that, or two who fit.
  assert.throws(() => runTool(db, 'log_interaction', { person: 'Marta', kind: 'call', sentence: 'x' }, run), /nobody like/);
  assert.throws(() => runTool(db, 'log_interaction', { person: 'Lena', kind: 'call', sentence: 'x' }, run), /More than one person fits: Lena Berg, Lena Fischer/);
  assert.throws(() => runTool(db, 'log_interaction', { person: 'Lena Fischer', kind: 'text', sentence: 'x' }, run), (e) => e.status === 400);
  assert.deepEqual(findPerson(db, 'lena f').map((p) => p.name), ['Lena Fischer']);
});

test('with People in depth off the tool and its Settings row are not there', () => {
  const db = emptyDb();
  const names = () => offeredTools(db).map((t) => t.name);
  assert.ok(names().includes('log_interaction'));
  assert.ok(getPermissions(db).some((p) => p.key === 'log_interaction'));
  setModule(db, 'people-plus', false);
  assert.equal(names().includes('log_interaction'), false);
  assert.equal(getPermissions(db).some((p) => p.key === 'log_interaction'), false);
  assert.throws(() => runTool(db, 'log_interaction', { person: 'x', kind: 'call', sentence: 'x' }, {}), /switched off/);
});

test('a database from before log lines keeps every link and card, and takes the new table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactions-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const conversation = createConversation(db, dir);
  db.prepare(`INSERT INTO assistant_actions (id, created_at, updated_at, conversation_id, kind, state, target_id, title) VALUES ('a1', 'a', 'a', ?, 'add_task', 'done', 't', 'A card')`).run(conversation.id);
  db.prepare("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id) VALUES ('l1', 'a', 'a', 'task', 't', 'person', ?)").run(lena.id);
  // Back to the shape of version 31.
  const strip = (name, drop) => db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name).sql.replace(drop, '');
  const links = strip('links', ", 'interaction'");
  const actions = strip('assistant_actions', ", 'log_interaction'");
  db.exec(`DROP TABLE interactions; ALTER TABLE links RENAME TO links_now; DROP INDEX links_to; DROP INDEX links_from; ${links}; INSERT INTO links SELECT * FROM links_now; DROP TABLE links_now;
    ALTER TABLE assistant_actions RENAME TO actions_now; DROP INDEX assistant_actions_by_message; ${actions}; INSERT INTO assistant_actions SELECT * FROM actions_now; DROP TABLE actions_now; PRAGMA user_version = 31;`);
  assert.throws(() => db.prepare("INSERT INTO links (id, created_at, updated_at, from_kind, from_id, to_kind, to_id) VALUES ('x', 'a', 'a', 'interaction', 'y', 'person', 'z')").run(), /CHECK/);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  assert.equal(db.prepare("SELECT title FROM assistant_actions WHERE id = 'a1'").get().title, 'A card');
  assert.equal(db.prepare("SELECT count(*) AS n FROM links WHERE id = 'l1'").get().n, 1);
  const made = logInteraction(db, { about: { kind: 'person', id: lena.id }, kind: 'call', note: 'Back again' });
  assert.equal(getInteraction(db, made.id).who.length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the interactions API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactions-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const jonas = await (await send('POST', '/api/people', { name: 'Jonas Weber' })).json();
  for (const bad of [{}, { about: { kind: 'person', id: jonas.id }, kind: 'call' }, { about: { kind: 'person', id: jonas.id }, kind: 'x', note: 'n' },
    { about: { kind: 'person', id: jonas.id }, kind: 'call', note: 'n', when: '2999-01-01' }, { about: { kind: 'person', id: '11111111-1111-1111-1111-111111111111' }, kind: 'call', note: 'n' }]) {
    assert.equal((await send('POST', '/api/interactions', bad)).status, 400, JSON.stringify(bad));
  }
  const made = await (await send('POST', '/api/interactions', { about: { kind: 'person', id: jonas.id }, kind: 'message', note: 'Sent the draft' })).json();
  assert.deepEqual([made.kind, made.who[0].name], ['message', 'Jonas Weber']);
  const shown = () => fetch(`${app.url}/api/timeline?about=person:${jonas.id}`).then((r) => r.json());
  assert.equal((await shown()).items[0].text, 'Sent the draft');
  assert.equal((await send('DELETE', `/api/interactions/${made.id}`)).status, 200);
  assert.deepEqual((await shown()).items, []);
  assert.equal((await send('POST', `/api/interactions/${made.id}/restore`, {})).status, 200);
  assert.equal((await shown()).items.length, 1);
  assert.equal((await send('GET', '/api/interactions')).status, 405);
  assert.equal((await send('DELETE', '/api/interactions/11111111-1111-1111-1111-111111111111')).status, 404);
});
