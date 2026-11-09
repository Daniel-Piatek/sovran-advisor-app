// The glossary (glossary.js, advanced/voice/2): hints seeded from People, fixes, what goes to the
// speech to text, and what a dictation says after the fixes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createPerson, createCompany, deleteContact } from '../../people.js';
import { listGlossary, addGlossary, deleteGlossary, restoreGlossary, keyterms, fixes, applyFixes, checkGlossaryInput, seedGlossary } from '../../glossary.js';
import { startServer } from '../../server.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const terms = (db, opts) => listGlossary(db, opts).map((r) => `${r.kind}:${r.term}${r.heard_as ? `<${r.heard_as}` : ''}`);

test('every person and company is a hint from the start, and a new one is one more', () => {
  const db = emptyDb();
  createPerson(db, { name: 'Lena Fischer' });
  createCompany(db, { name: 'Nordlicht' });
  assert.deepEqual(terms(db), ['hint:Lena Fischer', 'hint:Nordlicht']);
  createPerson(db, { name: 'Jonas Weber' });
  assert.deepEqual(terms(db), ['hint:Jonas Weber', 'hint:Lena Fischer', 'hint:Nordlicht']);
  assert.deepEqual(listGlossary(db).map((r) => r.source).sort(), ['company', 'person', 'person']);
  seedGlossary(db); seedGlossary(db);
  assert.equal(listGlossary(db).length, 3, 'seeding again adds nothing');
  // A person who is deleted is not a hint any more; a name too long to be one is left out.
  const gone = createPerson(db, { name: 'Gone Person' });
  assert.equal(listGlossary(db).length, 4);
  deleteContact(db, 'person', gone.id);
  assert.equal(listGlossary(db).length, 3);
  createPerson(db, { name: 'x'.repeat(81) });
  assert.equal(listGlossary(db).length, 3);
});

test('a fix rewrites what is heard; fixes come first; adding and removing, with Undo; a hint you removed stays removed', () => {
  const db = emptyDb();
  const lena = createPerson(db, { name: 'Lena Fischer' });
  const fix = addGlossary(db, { term: 'Nordlicht', heard_as: 'North light' });
  addGlossary(db, { term: 'Hafenkante' });
  assert.deepEqual([fix.kind, fix.source], ['fix', 'typed']);
  assert.deepEqual(terms(db), ['fix:Nordlicht<North light', 'hint:Hafenkante', 'hint:Lena Fischer']);
  assert.equal(addGlossary(db, { term: 'nordlicht', heard_as: 'north light' }).id, fix.id, 'the same twice is one');
  assert.equal(addGlossary(db, { term: 'Beach house', heard_as: 'beech house' }, { source: 'learned' }).source, 'learned');
  assert.deepEqual(listGlossary(db, { q: 'north' }).map((r) => r.term), ['Nordlicht'], 'search finds what is heard too');
  // The bin: the row goes, and comes back with Undo.
  const hint = listGlossary(db).find((r) => r.term === 'Hafenkante');
  deleteGlossary(db, hint.id);
  assert.equal(listGlossary(db).some((r) => r.term === 'Hafenkante'), false);
  restoreGlossary(db, hint.id);
  assert.equal(listGlossary(db).some((r) => r.term === 'Hafenkante'), true);
  // A seeded hint removed with the bin does not come back by itself.
  const seeded = listGlossary(db).find((r) => r.term === 'Lena Fischer');
  deleteGlossary(db, seeded.id);
  assert.equal(listGlossary(db).some((r) => r.term === 'Lena Fischer'), false);
  assert.equal(listGlossary(db).some((r) => r.term === 'Lena Fischer'), false, 'still gone after seeding again');
  assert.ok(lena.id);
  assert.equal(deleteGlossary(db, 'nope'), null);
});

test('input is checked: a spelling is needed, and heard as is not the same as written as', () => {
  assert.equal(checkGlossaryInput({ term: ' ' }), 'A term needs its spelling.');
  assert.match(checkGlossaryInput({ term: 'x'.repeat(81) }), /longer than 80/);
  assert.equal(checkGlossaryInput({ term: 'Nordlicht', heard_as: 'Nordlicht' }), 'Heard as and written as are the same.');
  assert.equal(checkGlossaryInput({ term: 'Nordlicht', heard_as: 'nordlicht' }), null, 'a different case is a fix');
  assert.equal(checkGlossaryInput({ term: 'Nordlicht', heard_as: 5 }), 'heard_as is text.');
  assert.equal(checkGlossaryInput({ term: 'Nordlicht' }), null);
});

test('the speech to text is given every term once (fixes first), at most 100', () => {
  const db = emptyDb();
  createPerson(db, { name: 'Lena Fischer' });
  addGlossary(db, { term: 'Nordlicht', heard_as: 'North light' });
  addGlossary(db, { term: 'Nordlicht' }); // a hint of a fix's own word: said once
  assert.deepEqual(keyterms(db), ['Nordlicht', 'Lena Fischer']);
  assert.deepEqual(fixes(db), [{ heard_as: 'North light', term: 'Nordlicht' }]);
  for (let i = 0; i < 120; i++) addGlossary(db, { term: `Term ${i}` });
  assert.equal(keyterms(db).length, 100);
});

test('a dictation says what the fixes make of it: whole words, any case, counted', () => {
  const fix = [{ heard_as: 'North light', term: 'Nordlicht' }, { heard_as: 'lena fisher', term: 'Lena Fischer' }];
  assert.deepEqual(applyFixes('Met north light and Lena Fisher about North  Light.', fix), { text: 'Met Nordlicht and Lena Fischer about Nordlicht.', fixed: 3 });
  assert.deepEqual(applyFixes('The northlight bar and north lighting', fix), { text: 'The northlight bar and north lighting', fixed: 0 });
  assert.deepEqual(applyFixes('Nothing to fix.', fix), { text: 'Nothing to fix.', fixed: 0 });
  assert.deepEqual(applyFixes('beech house (1+1)', [{ heard_as: 'beech house (1+1)', term: 'Beach' }]), { text: 'Beach', fixed: 1 }, 'symbols in what is heard are not patterns');
  assert.deepEqual(applyFixes('Üfer und über', [{ heard_as: 'über', term: 'Uber' }]), { text: 'Üfer und Uber', fixed: 1 }, 'letters beyond a to z count as letters');
});

test('a database from before the glossary takes the table and seeds it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-'));
  let db = openDatabase(dir);
  createPerson(db, { name: 'Lena Fischer' });
  db.exec('DROP TABLE glossary; PRAGMA user_version = 36;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(terms(db), ['hint:Lena Fischer']);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the glossary API, and the session hands the speech service the terms and the page the fixes', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-api-'));
  const saved = { ...process.env };
  let asked = '';
  const http = await import('node:http');
  const eleven = http.createServer((req, res) => { asked = req.url; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"token":"sutkn_x"}'); });
  await new Promise((resolve) => eleven.listen(0, '127.0.0.1', resolve));
  process.env.ELEVENLABS_API_BASE = `http://127.0.0.1:${eleven.address().port}`;
  process.env.ELEVENLABS_API_KEY = 'sk_test_value';
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => {
    await app.close(); eleven.close();
    for (const k of ['ELEVENLABS_API_BASE', 'ELEVENLABS_API_KEY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const send = (method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  await send('POST', '/api/people', { name: 'Lena Fischer' });
  assert.deepEqual((await (await send('GET', '/api/glossary')).json()).map((r) => r.term), ['Lena Fischer']);
  assert.equal((await send('POST', '/api/glossary', { term: '' })).status, 400);
  assert.equal((await send('PUT', '/api/glossary', {})).status, 405);
  const fix = await (await send('POST', '/api/glossary', { term: 'Nordlicht', heard_as: 'North light', learned: true })).json();
  assert.deepEqual([fix.kind, fix.source], ['fix', 'learned']);
  const session = await (await send('POST', '/api/dictation/session', {})).json();
  assert.deepEqual(session.fixes, [{ heard_as: 'North light', term: 'Nordlicht' }]);
  assert.deepEqual(new URL(session.url).searchParams.getAll('keyterms'), ['Nordlicht', 'Lena Fischer']);
  assert.ok(asked.includes('single-use-token'));
  assert.equal((await send('DELETE', `/api/glossary/${fix.id}`)).status, 200);
  assert.deepEqual((await (await send('POST', '/api/dictation/session', {})).json()).fixes, []);
  assert.equal((await send('POST', `/api/glossary/${fix.id}/restore`, {})).status, 200);
  assert.equal((await send('DELETE', '/api/glossary/00000000000000000000000000000000')).status, 404);
});
