// People and companies (people.js), their mentions, and their API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote } from '../../notes.js';
import { createEntry } from '../../entries.js';
import {
  createPerson, getPerson, listPeople, updatePerson, createCompany, getCompany, listCompanies, deleteContact,
  restoreContact, listDeletedContacts,
} from '../../people.js';
import { linkedFrom, suggestLinks, linkTarget, extractLinks } from '../../links.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

test('a person with a company, role, details and how you met', () => {
  const db = emptyDb();
  const studio = createCompany(db, { name: 'Nordlicht Studio' });
  const lena = createPerson(db, {
    name: ' Lena Fischer ', company_id: studio.id, role: 'Producer', emails: 'lena@a.example\nlena@b.example', how_met: 'Workshop in Hamburg',
  });
  assert.deepEqual([lena.name, lena.company_name, lena.role, lena.emails, lena.how_met],
    ['Lena Fischer', 'Nordlicht Studio', 'Producer', 'lena@a.example\nlena@b.example', 'Workshop in Hamburg']);
  assert.deepEqual(getCompany(db, studio.id).people.map((p) => p.name), ['Lena Fischer']);
  assert.throws(() => createPerson(db, { name: '  ' }), (err) => err.status === 400);
  assert.throws(() => createPerson(db, { name: 'X', company_id: '00000000-0000-0000-0000-000000000000' }), (err) => err.status === 400);
});

test('people are listed by name, and found by name, company or role', () => {
  const db = emptyDb();
  const studio = createCompany(db, { name: 'Nordlicht Studio' });
  createPerson(db, { name: 'Jonas Berg', role: 'Architect' });
  createPerson(db, { name: 'lena Fischer', company_id: studio.id });
  assert.deepEqual(listPeople(db).map((p) => p.name), ['Jonas Berg', 'lena Fischer']);
  assert.deepEqual(listPeople(db, { q: 'nord' }).map((p) => p.name), ['lena Fischer']);
  assert.deepEqual(listPeople(db, { q: 'archi' }).map((p) => p.name), ['Jonas Berg']);
  assert.deepEqual(listPeople(db, { q: '%' }).map((p) => p.name), [], '% is just a sign');
  assert.equal(listCompanies(db)[0].people_count, 1);
});

test('mentions: a note or entry that links to a person or company is listed on their page', () => {
  const db = emptyDb();
  const studio = createCompany(db, { name: 'Nordlicht Studio' });
  const lena = createPerson(db, { name: 'Lena Fischer', company_id: studio.id });
  const entry = createEntry(db, { body: `Call with [Lena Fischer](/people/${lena.id}) about [Nordlicht Studio](/companies/${studio.id}).` });
  createNote(db, { title: 'Pilot', body: `Ask [Lena Fischer](/people/${lena.id}).` });
  assert.deepEqual(linkedFrom(db, 'person', lena.id).map((l) => l.from_kind).sort(), ['entry', 'note']);
  assert.deepEqual(linkedFrom(db, 'company', studio.id).map((l) => l.from_id), [entry.id]);
  assert.equal(getPerson(db, lena.id).mention_count, 2);
  assert.equal(listCompanies(db)[0].mention_count, 1);
  assert.deepEqual(extractLinks(`[L](/people/${lena.id})`)[0].to_kind, 'person');
});

test('a person\'s own notes can link onward, and are listed where they point', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Pilot' });
  const lena = createPerson(db, { name: 'Lena', body: `Runs the [Pilot](/notes/${note.id}).` });
  assert.deepEqual(linkedFrom(db, 'note', note.id).map((l) => [l.from_kind, l.label]), [['person', 'Lena']]);
  updatePerson(db, lena.id, { body: 'Nothing now' });
  assert.deepEqual(linkedFrom(db, 'note', note.id), []);
});

test('suggestions: @ finds people, @@ companies, [[ both and the rest', () => {
  const db = emptyDb();
  createPerson(db, { name: 'Lena Fischer' });
  createPerson(db, { name: 'Jonas Berg' });
  createCompany(db, { name: 'Lennox Ltd' });
  createNote(db, { title: 'Lentils recipe' });
  assert.deepEqual(suggestLinks(db, 'len', { today: '2026-10-25', only: 'person' }).map((f) => f.label), ['Lena Fischer']);
  assert.deepEqual(suggestLinks(db, 'fisch', { today: '2026-10-25', only: 'person' }).map((f) => f.label), ['Lena Fischer'], 'any word of the name');
  assert.deepEqual(suggestLinks(db, 'len', { today: '2026-10-25', only: 'company' }).map((f) => f.label), ['Lennox Ltd']);
  assert.deepEqual(suggestLinks(db, 'len', { today: '2026-10-25' }).map((f) => f.kind), ['person', 'company', 'note']);
  assert.deepEqual(suggestLinks(db, '', { today: '2026-10-25', only: 'person' }).map((f) => f.label), ['Jonas Berg', 'Lena Fischer']);
});

test('deleted people and companies: not suggested, mentions say so, and they come back whole', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena Fischer', how_met: 'Hamburg' });
  deleteContact(db, 'person', lena.id);
  assert.deepEqual(listPeople(db), []);
  assert.deepEqual(suggestLinks(db, 'lena', { today: '2026-10-25', only: 'person' }), []);
  assert.deepEqual(linkTarget(db, 'person', lena.id), { exists: false });
  assert.deepEqual(listDeletedContacts(db).map((d) => [d.kind, d.name]), [['person', 'Lena Fischer']]);
  assert.equal(restoreContact(db, 'person', lena.id).how_met, 'Hamburg');
});

test('an older database gets people, companies, and links that can point at them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-old-'));
  let db = openDatabase(dir);
  const target = createNote(db, { title: 'Target' });
  createNote(db, { title: 'Source', body: `See [Target](/notes/${target.id}).` });
  db.exec('DROP TABLE people; DROP TABLE companies; PRAGMA user_version = 5;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(linkedFrom(db, 'note', target.id).length, 1, 'links made again');
  const lena = createPerson(db, { name: 'Lena' });
  createNote(db, { title: 'Mention', body: `[Lena](/people/${lena.id})` });
  assert.equal(linkedFrom(db, 'person', lena.id).length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the people and companies API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const studio = await (await send('POST', '/api/companies', { name: 'Nordlicht Studio' })).json();
  const lena = await (await send('POST', '/api/people', { name: 'Lena Fischer', company_id: studio.id })).json();
  assert.equal((await send('POST', '/api/people', {})).status, 400);
  assert.equal((await (await send('PATCH', `/api/people/${lena.id}`, { how_met: 'Hamburg' })).json()).how_met, 'Hamburg');
  assert.equal((await (await send('PATCH', `/api/people/${lena.id}`, { company_id: null })).json()).company_id, null);
  assert.deepEqual((await (await fetch(`${app.url}/api/people?q=len`)).json()).map((p) => p.name), ['Lena Fischer']);
  assert.equal((await (await fetch(`${app.url}/api/links/suggest?q=len&only=person`)).json())[0].label, 'Lena Fischer');
  assert.equal((await send('DELETE', `/api/companies/${studio.id}`)).status, 200);
  assert.deepEqual((await (await fetch(`${app.url}/api/people?deleted=1`)).json()).map((d) => d.kind), ['company']);
  assert.equal((await send('POST', `/api/companies/${studio.id}/restore`, {})).status, 200);
  assert.equal((await fetch(`${app.url}/api/links/to?kind=person&id=${lena.id}`)).status, 200);
});
