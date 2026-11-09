// One person, two entries (merge-people.js, advanced/people/7): possible duplicates, a merge that
// moves everything over in one step, and Restore that undoes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, createCompany, getPerson, updatePerson, restoreContact, deleteContact, listDeletedContacts, listPeople } from '../../people.js';
import { createNote, getNote } from '../../notes.js';
import { createEntry, getEntry } from '../../entries.js';
import { createTask, listTasks, changeTask } from '../../tasks.js';
import { logInteraction } from '../../interactions.js';
import { linkedFrom } from '../../links.js';
import { timeline } from '../../timeline.js';
import { reconnectList } from '../../reconnect.js';
import { importContacts } from '../../import-contacts.js';
import { nameKeys, findDuplicates, mergePeople, dismissDuplicate } from '../../merge-people.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const link = (p) => `[${p.name}](/people/${p.id})`;

test('names match the way a person would compare them', () => {
  const same = (a, b) => nameKeys(a).some((k) => nameKeys(b).includes(k));
  assert.ok(same('Mara Kühn', 'Mara Kuehn (Nordlicht)'));
  assert.ok(same('Mara Kühn', 'MARA KUHN'));
  assert.ok(same('Kühn, Mara', 'Mara Kühn'));
  assert.ok(same('Lena  Fischer', "lena fischer."));
  assert.ok(same('José Núñez', 'Jose Nunez'));
  assert.ok(!same('Mara Kühn', 'Mara Kern'));
  assert.ok(!same('Lena Fischer', 'Lena Fischer-Berg'));
});

test('possible duplicates: the same name or the same email; Not the same person hides a pair for good', () => {
  const db = emptyDb();
  const mara = createPerson(db, { name: 'Mara Kühn', role: 'Producer' });
  importContacts(db, { text: 'Name,Email,Company\nMara Kuehn (Nordlicht),mara@nordlicht.de,Nordlicht\nSomeone Else,else@x.de,\n', filename: 'g.csv' });
  const jo = createPerson(db, { name: 'J. Berg', emails: 'jonas@example.com' });
  const jonas = createPerson(db, { name: 'Jonas Berg', emails: 'JONAS@example.com\nj2@x.de' });
  const pairs = findDuplicates(db);
  assert.deepEqual(pairs.map((p) => [p.a.name, p.b.name, p.why]), [['Mara Kühn', 'Mara Kuehn (Nordlicht)', 'same name'], ['J. Berg', 'Jonas Berg', 'same email']]);
  assert.equal(pairs[0].a.id, mara.id, 'the one you wrote yourself comes first, as the one to keep');
  dismissDuplicate(db, jonas.id, jo.id);
  assert.deepEqual(findDuplicates(db).map((p) => p.a.name), ['Mara Kühn']);
  dismissDuplicate(db, pairs[0].b.id, mara.id); // either way round
  assert.deepEqual(findDuplicates(db), []);
});

test('a merge moves every mention, log line and task over; the other entry is deleted, never removed', () => {
  const db = emptyDb();
  const nord = createCompany(db, { name: 'Nordlicht' });
  const keep = createPerson(db, { name: 'Mara Kühn', role: 'Producer', emails: 'mara@home.de' });
  const drop = createPerson(db, { name: 'Mara Kuehn (Nordlicht)', role: 'Head of production', company_id: nord.id, emails: 'mara@nordlicht.de', phones: '+49 170 1', how_met: 'At the fair' });
  const n1 = createNote(db, { title: 'Ideas for the autumn workshop', body: `Ask ${link(keep)} and ${link(drop)} about it.` });
  const n2 = createNote(db, { title: 'Offer', body: `Send to ${link(drop)}.` });
  const e1 = createEntry(db, { body: `Coffee with ${link(drop)}.` });
  logInteraction(db, { about: { kind: 'person', id: drop.id }, kind: 'message', note: 'Sent the intake form' });
  createTask(db, { text: 'Ring Mara Kuehn', mentions: [{ kind: 'person', id: drop.id }] });
  const before = { n1: getNote(db, n1.id).updated_at, n2: getNote(db, n2.id).updated_at };

  const kept = mergePeople(db, keep.id, drop.id, { role: 'drop', company_id: 'drop', emails: 'both', phones: 'drop', how_met: 'drop' });
  assert.deepEqual([kept.name, kept.role, kept.company_id, kept.emails, kept.phones, kept.how_met],
    ['Mara Kühn', 'Head of production', nord.id, 'mara@home.de\nmara@nordlicht.de', '+49 170 1', 'At the fair']);
  // The text names the kept person now, and her page lists all of it.
  assert.equal(getNote(db, n1.id).body, `Ask ${link(keep)} and [${drop.name}](/people/${keep.id}) about it.`);
  assert.equal(getNote(db, n2.id).updated_at, before.n2, 'a page’s updated time is not touched');
  assert.equal(linkedFrom(db, 'person', keep.id).length, 5, 'both links of the first note, the offer, the entry and the task');
  assert.equal(linkedFrom(db, 'person', drop.id).length, 0);
  assert.equal(getEntry(db, e1.id).body.includes(keep.id), true);
  // The log line and the task mention are hers.
  assert.deepEqual(timeline(db, { now: new Date(), about: { kind: 'person', id: keep.id }, kinds: ['interaction'] }).items.map((i) => i.text), ['Sent the intake form']);
  assert.deepEqual(listTasks(db, { done: false })[0].mentions.map((m) => m.id), [keep.id]);
  // The other entry: deleted with merged_into, still there, and in Recently deleted with where it went.
  const row = db.prepare('SELECT deleted_at, merged_into FROM people WHERE id = ?').get(drop.id);
  assert.equal(row.merged_into, keep.id);
  assert.ok(row.deleted_at);
  assert.equal(getPerson(db, drop.id), null);
  assert.deepEqual(listDeletedContacts(db).map((c) => [c.name, c.merged_into_name]), [['Mara Kuehn (Nordlicht)', 'Mara Kühn']]);
  assert.deepEqual(listPeople(db).map((p) => p.name), ['Mara Kühn']);
});

test('Restore undoes the merge: both entries and what moved are back; what you edited since stays', () => {
  const db = emptyDb();
  const keep = createPerson(db, { name: 'Mara Kühn', role: 'Producer' });
  const drop = createPerson(db, { name: 'Mara Kuehn', role: 'Head of production', emails: 'mara@nordlicht.de' });
  const n1 = createNote(db, { title: 'Both', body: `${link(keep)} and ${link(drop)}` });
  const n2 = createNote(db, { title: 'Only drop', body: `Send to ${link(drop)}.` });
  logInteraction(db, { about: { kind: 'person', id: drop.id }, kind: 'call', note: 'Spoke' });
  mergePeople(db, keep.id, drop.id, { role: 'drop', emails: 'both' });
  // After the merge she edits one of the notes, and the kept person's email.
  db.prepare('UPDATE notes SET body = ? WHERE id = ?').run(`${getNote(db, n2.id).body} More.`, n2.id);
  updatePerson(db, keep.id, { emails: 'mara@new.de' });

  const restored = restoreContact(db, 'person', drop.id);
  assert.equal(restored.name, 'Mara Kuehn');
  assert.equal(db.prepare('SELECT merged_into FROM people WHERE id = ?').get(drop.id).merged_into, null);
  assert.equal(getNote(db, n1.id).body, `${link(keep)} and ${link(drop)}`, 'her mentions are back on each');
  assert.equal(getNote(db, n2.id).body, `Send to [Mara Kuehn](/people/${keep.id}). More.`, 'a note she edited since is left alone');
  assert.deepEqual([linkedFrom(db, 'person', drop.id).length, linkedFrom(db, 'person', keep.id).length], [1, 2]);
  assert.deepEqual(timeline(db, { now: new Date(), about: { kind: 'person', id: drop.id }, kinds: ['interaction'] }).items.map((i) => i.text), ['Spoke']);
  assert.deepEqual([getPerson(db, keep.id).role, getPerson(db, keep.id).emails], ['Producer', 'mara@new.de'], 'the role as it was; the email as she edited it');
  assert.deepEqual(listDeletedContacts(db), []);
  // An ordinary delete and restore is as before.
  deleteContact(db, 'person', drop.id);
  assert.equal(restoreContact(db, 'person', drop.id).name, 'Mara Kuehn');
});

test('a merge brings tasks written in their notes, a rhythm, and is all or nothing', () => {
  const db = emptyDb();
  const keep = createPerson(db, { name: 'Mara Kühn' });
  const drop = createPerson(db, { name: 'Mara Kuehn', body: '- [ ] Ask about the workshop' });
  assert.equal(listTasks(db, { done: false }).length, 1);
  db.prepare('UPDATE people SET cadence_days = 14 WHERE id = ?').run(drop.id);
  const [task] = listTasks(db, { done: false });
  changeTask(db, task.id, { flag: 'must' });
  mergePeople(db, keep.id, drop.id, { body: 'drop' });
  const [moved] = listTasks(db, { done: false });
  assert.deepEqual([moved.id, moved.text, moved.flag, moved.source.id], [task.id, 'Ask about the workshop', 'must', keep.id], 'the same task, with its flag, now in her notes');
  assert.equal(getPerson(db, keep.id).body, '- [ ] Ask about the workshop');
  assert.equal(getPerson(db, keep.id).cadence_days, 14, 'a rhythm she lacked comes along');
  restoreContact(db, 'person', drop.id);
  assert.equal(getPerson(db, keep.id).body, '');
  assert.equal(listTasks(db, { done: false })[0].source.id, drop.id);
  // Nothing half-done on a bad request.
  assert.throws(() => mergePeople(db, keep.id, keep.id), /two different/);
  assert.throws(() => mergePeople(db, keep.id, '11111111-1111-1111-1111-111111111111'), (e) => e.status === 404);
  assert.throws(() => mergePeople(db, keep.id, drop.id, { name: 'both' }), /not offered/);
  assert.throws(() => mergePeople(db, keep.id, drop.id, { color: 'keep' }), /not offered/);
  assert.equal(getPerson(db, drop.id).name, 'Mara Kuehn');
  // The reconnect list sees the kept person once.
  assert.equal(reconnectList(db).length, 1);
});

test('a database from before merging keeps every person and takes the columns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer', role: 'Producer' });
  db.exec('ALTER TABLE people DROP COLUMN merge_record; ALTER TABLE people DROP COLUMN merged_into; PRAGMA user_version = 34;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(fs.existsSync(path.join(dir, `app.db.before-v${SCHEMA_VERSION}.bak`)));
  assert.equal(getPerson(db, lena.id).role, 'Producer');
  const other = createPerson(db, { name: 'Lena Fischer (x)' });
  assert.equal(mergePeople(db, lena.id, other.id).id, lena.id);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the merge API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const a = await (await send('POST', '/api/people', { name: 'Mara Kühn' })).json();
  const b = await (await send('POST', '/api/people', { name: 'Mara Kuehn (Nordlicht)', role: 'Head' })).json();
  const pairs = await (await send('GET', '/api/people/duplicates')).json();
  assert.deepEqual([pairs.length, pairs[0].a.id, pairs[0].b.id, pairs[0].why], [1, a.id, b.id, 'same name']);
  assert.equal((await send('POST', '/api/people/merge', { keep: a.id })).status, 400);
  assert.equal((await send('POST', '/api/people/merge', { keep: a.id, drop: b.id, fields: [] })).status, 400);
  assert.equal((await send('POST', '/api/people/merge', { keep: a.id, drop: b.id, fields: { name: 'both' } })).status, 400);
  assert.equal((await send('GET', '/api/people/merge')).status, 405);
  const merged = await (await send('POST', '/api/people/merge', { keep: a.id, drop: b.id, fields: { role: 'drop' } })).json();
  assert.deepEqual([merged.id, merged.role], [a.id, 'Head']);
  assert.deepEqual(await (await send('GET', '/api/people/duplicates')).json(), []);
  const deleted = await (await send('GET', '/api/people?deleted=1')).json();
  assert.equal(deleted[0].merged_into_name, 'Mara Kühn');
  assert.equal((await send('POST', `/api/people/${b.id}/restore`, {})).status, 200);
  assert.equal((await (await send('GET', '/api/people')).json()).length, 2);
  assert.equal((await send('POST', '/api/people/duplicates/dismiss', { a: a.id })).status, 400);
  assert.equal((await send('POST', '/api/people/duplicates/dismiss', { a: a.id, b: b.id })).status, 200);
  assert.deepEqual(await (await send('GET', '/api/people/duplicates')).json(), []);
});
