// Bring your contacts in (import-contacts.js, advanced/people/6): vCard and CSV read into people
// and companies, safe to run twice, and whatever you wrote yourself wins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, createCompany, listPeople, listCompanies, getPerson, updatePerson, deleteContact } from '../../people.js';
import { parseVCards, parseCsvRows, parseCsvContacts, importContacts } from '../../import-contacts.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

const VCARDS = [
  'BEGIN:VCARD', 'VERSION:3.0', 'UID:uid-lena', 'FN:Lena Fischer', 'N:Fischer;Lena;;;', 'ORG:Elbkontor', 'TITLE:Operations lead',
  'item1.EMAIL;type=INTERNET;type=WORK:lena@elbkontor.de', 'TEL;TYPE=CELL:+49 170 1234567', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ',
  ' AAAAAAAAAAAAAAAAAA', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Berg;Jonas;;;', 'ORG:Elbkontor\\; Ltd;Berlin', 'EMAIL:Jonas@Example.com', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Marta Ko\\,walska', 'NOTE:folded line that\r\n  goes on', 'ORG:Nordlicht', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'ORG:Only a company', 'END:VCARD',
].join('\r\n');

test('a vCard is read: folded lines, escapes, groups, the name from N, the company from ORG, photos ignored', () => {
  const cards = parseVCards(VCARDS);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0], { name: 'Lena Fischer', uid: 'uid-lena', org: 'Elbkontor', role: 'Operations lead', emails: ['lena@elbkontor.de'], phones: ['+49 170 1234567'], type: 'vcard' });
  assert.deepEqual([cards[1].name, cards[1].org, cards[1].emails], ['Jonas Berg', 'Elbkontor; Ltd', ['Jonas@Example.com']]);
  assert.equal(cards[2].name, 'Marta Ko,walska');
  assert.equal(cards[3].name, '');
  assert.deepEqual(parseVCards('nothing here'), []);
});

test('a CSV is read: quotes, line breaks inside quotes, a BOM, semicolons, and Google’s column names', () => {
  assert.deepEqual(parseCsvRows('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n1,2'), [['a', 'b'], ['x, y', 'say "hi"\nthere'], ['1', '2']]);
  assert.deepEqual(parseCsvRows('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  const google = 'First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Organization Name,Organization Title\n'
    + 'Lena,Fischer,Work,lena@elbkontor.de,lena@home.de,+49 170 1,Elbkontor,Operations lead\n'
    + ',,,only@email.de,,,,\n';
  assert.deepEqual(parseCsvContacts(google), [
    { name: 'Lena Fischer', uid: '', org: 'Elbkontor', role: 'Operations lead', emails: ['lena@elbkontor.de', 'lena@home.de'], phones: ['+49 170 1'], type: 'csv' },
    { name: '', uid: '', org: '', role: '', emails: ['only@email.de'], phones: [], type: 'csv' },
  ]);
  assert.deepEqual(parseCsvContacts('Name,Email,Company,Job Title\nJonas Berg,j@x.de,Nordlicht,Producer\n')[0],
    { name: 'Jonas Berg', uid: '', org: 'Nordlicht', role: 'Producer', emails: ['j@x.de'], phones: [], type: 'csv' });
  assert.throws(() => parseCsvContacts('Foo,Bar\n1,2\n'), /no name or email column/);
});

test('an import adds people and finds or makes their companies, and the report counts them', () => {
  const db = emptyDb();
  createCompany(db, { name: 'elbkontor' }); // found by name, whatever the case
  const report = importContacts(db, { text: VCARDS, filename: 'phone.vcf' });
  assert.deepEqual({ ...report, names: undefined }, { read: 4, added: 3, matched: 0, skipped: 1, companies_made: 2, names: undefined });
  assert.deepEqual(report.names, ['Lena Fischer', 'Jonas Berg', 'Marta Ko,walska']);
  const people = listPeople(db);
  assert.equal(people.length, 3);
  const lena = people.find((p) => p.name === 'Lena Fischer');
  assert.deepEqual([lena.role, lena.company_name], ['Operations lead', 'elbkontor']);
  assert.equal(listCompanies(db).length, 3, 'elbkontor, "Elbkontor; Ltd" and Nordlicht');
  const row = db.prepare('SELECT origin, emails, phones, source_key FROM people WHERE name = ?').get('Lena Fischer');
  assert.deepEqual({ ...row }, { origin: 'imported', emails: 'lena@elbkontor.de', phones: '+49 170 1234567', source_key: 'vcard:uid-lena' });
  assert.equal(db.prepare("SELECT origin FROM companies WHERE name = 'Nordlicht'").get().origin, 'imported');
});

test('run twice: the second import adds nothing, and nobody is doubled', () => {
  const db = emptyDb();
  importContacts(db, { text: VCARDS, filename: 'a.vcf' });
  const second = importContacts(db, { text: VCARDS, filename: 'a.vcf' });
  assert.deepEqual([second.added, second.matched, second.companies_made], [0, 3, 0]);
  assert.equal(listPeople(db).length, 3);
  assert.equal(listCompanies(db).length, 3);
  // The same person in a CSV is found by their email.
  const csv = importContacts(db, { text: 'Name,Email\nLena F.,LENA@elbkontor.de\nNew One,new@x.de\n', filename: 'g.csv' });
  assert.deepEqual([csv.added, csv.matched], [1, 1]);
  // The same person twice in one file is added once.
  const twice = importContacts(db, { text: 'Name,Email\nA B,ab@x.de\nA B again,ab@x.de\n', filename: 'g.csv' });
  assert.deepEqual([twice.added, twice.matched], [1, 1]);
});

test('your edits win: someone already here is left exactly as you wrote them, and a deleted person stays deleted', () => {
  const db = emptyDb();
  const mine = createPerson(db, { name: 'Lena Fischer', role: 'Head of operations', emails: 'lena@elbkontor.de' });
  const gone = createPerson(db, { name: 'Jonas Berg', emails: 'jonas@example.com' });
  deleteContact(db, 'person', gone.id);
  const report = importContacts(db, { text: VCARDS, filename: 'a.vcf' });
  assert.deepEqual([report.added, report.matched], [1, 2]);
  assert.deepEqual([getPerson(db, mine.id).role, getPerson(db, mine.id).emails, getPerson(db, mine.id).source_key ?? null], ['Head of operations', 'lena@elbkontor.de', null]);
  assert.equal(getPerson(db, gone.id), null, 'not brought back');
  assert.deepEqual(listPeople(db).map((p) => p.name).sort(), ['Lena Fischer', 'Marta Ko,walska']);
  // An imported person you then edit stays as you edited them on the next run.
  const marta = db.prepare("SELECT id FROM people WHERE name = 'Marta Ko,walska'").get();
  updatePerson(db, marta.id, { role: 'Producer' });
  importContacts(db, { text: VCARDS, filename: 'a.vcf' });
  assert.equal(getPerson(db, marta.id).role, 'Producer');
});

test('a preview changes nothing; a bad file changes nothing', () => {
  const db = emptyDb();
  const preview = importContacts(db, { text: VCARDS, filename: 'a.vcf', dryRun: true });
  assert.deepEqual([preview.added, preview.companies_made], [3, 3]);
  assert.equal(listPeople(db).length, 0);
  assert.equal(listCompanies(db).length, 0);
  assert.equal(importContacts(db, { text: VCARDS, filename: 'a.vcf' }).added, 3, 'the real one finds the same');
  assert.throws(() => importContacts(db, { text: '  ' }), /empty/);
  assert.throws(() => importContacts(db, { text: 'Foo,Bar\n1,2' }), /no name or email column/);
  assert.throws(() => importContacts(db, { text: 'x'.repeat(3_600_000) }), (e) => e.status === 413);
});

test('a database from before the import keeps every person and takes the column', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
  let db = openDatabase(dir);
  const lena = createPerson(db, { name: 'Lena Fischer', role: 'Producer' });
  db.exec('DROP INDEX people_by_source; ALTER TABLE people DROP COLUMN source_key; PRAGMA user_version = 33;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(getPerson(db, lena.id).role, 'Producer');
  assert.equal(importContacts(db, { text: VCARDS, filename: 'a.vcf' }).added, 3);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the import API', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-api-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await send('GET', '/api/import/contacts')).status, 405);
  assert.equal((await send('POST', '/api/import/contacts', { filename: 'a.vcf' })).status, 400);
  assert.equal((await send('POST', '/api/import/contacts', { text: '' })).status, 400);
  const preview = await (await send('POST', '/api/import/contacts', { text: VCARDS, filename: 'a.vcf', dry_run: true })).json();
  assert.equal(preview.added, 3);
  assert.deepEqual(await (await send('GET', '/api/people')).json(), []);
  const done = await (await send('POST', '/api/import/contacts', { text: VCARDS, filename: 'a.vcf' })).json();
  assert.equal(done.added, 3);
  assert.equal((await (await send('GET', '/api/people')).json()).length, 3);
  assert.equal((await (await send('POST', '/api/import/contacts', { text: VCARDS, filename: 'a.vcf' })).json()).added, 0);
});
