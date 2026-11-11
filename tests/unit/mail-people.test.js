// Mail meets People (mail-people.js, advanced/mail/10): each address finds its person or company; a new sender becomes a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { importMboxText, listThreads } from '../../mail.js';
import { createPerson, createCompany, getPerson } from '../../people.js';
import { matchAddress, peopleOfThread, addSender, mailWith } from '../../mail-people.js';
import { lastInTouch } from '../../reconnect.js';
import { setModule } from '../../modules.js';
import { startServer } from '../../server.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

function demo() {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const nordlicht = createCompany(db, { name: 'Nordlicht Studio', website: 'https://www.nordlicht.example' });
  const hafen = createCompany(db, { name: 'Hafenkante', website: 'hafenkante.example' });
  const lena = createPerson(db, { name: 'Lena Fischer', company_id: nordlicht.id, role: 'Designer', emails: 'lena@nordlicht.example\nlena.private@example.net' });
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  return { db, lena, nordlicht, hafen };
}

test('an address finds its person, with the company behind them; else the company whose domain it is; else nobody', () => {
  const { db, lena, nordlicht, hafen } = demo();
  const a = matchAddress(db, 'Lena@Nordlicht.example');
  assert.deepEqual([a.person.id, a.person.name, a.person.role, a.company.id], [lena.id, 'Lena Fischer', 'Designer', nordlicht.id]);
  assert.equal(matchAddress(db, 'lena.private@example.net').person.id, lena.id, 'any of the addresses on their page');
  const b = matchAddress(db, 'jonas@hafenkante.example');
  assert.deepEqual([b.person, b.company.id], [null, hafen.id], 'not a person yet, but a company’s address');
  assert.deepEqual(matchAddress(db, 'billing@printshop.example'), { person: null, company: null });
  assert.deepEqual(matchAddress(db, 'lena@nordlicht.example.evil.net'), { person: null, company: null });
  assert.deepEqual(matchAddress(db, ''), { person: null, company: null });
});

test('who is in a conversation: not you, each with who they are', () => {
  const { db, lena } = demo();
  const thread = listThreads(db, { q: 'onboarding' })[0];
  const cards = peopleOfThread(db, thread.id);
  assert.deepEqual(cards.map((c) => [c.email, c.person?.id ?? null]), [['lena@nordlicht.example', lena.id]]);
  const brief = peopleOfThread(db, listThreads(db, { q: 'brief' })[0].id);
  assert.deepEqual(brief.map((c) => c.email).sort(), ['jonas@hafenkante.example', 'mara@example.com']);
  assert.equal(brief.find((c) => c.email === 'jonas@hafenkante.example').company.name, 'Hafenkante');
});

test('Shift P: a new sender becomes a person with their address, marked From a mail, under the company of their domain; a known one is not added twice', () => {
  const { db, hafen } = demo();
  const made = addSender(db, { email: 'Petra.Albers@hafenkante.example', name: 'Petra Albers', subject: 'Invoice 2026-114' });
  assert.equal(made.created, true);
  const person = getPerson(db, made.person.id);
  assert.deepEqual([person.name, person.emails, person.company_id, person.origin], ['Petra Albers', 'petra.albers@hafenkante.example', hafen.id, 'imported']);
  assert.equal(person.how_met, 'From a mail: Invoice 2026-114');
  assert.equal(matchAddress(db, 'petra.albers@hafenkante.example').person.id, person.id);
  const again = addSender(db, { email: 'petra.albers@hafenkante.example', name: 'Someone Else' });
  assert.deepEqual([again.created, again.person.id], [false, person.id]);
  assert.equal(addSender(db, { email: 'no.name@example.com' }).person.name, 'No Name');
  assert.throws(() => addSender(db, { email: 'nope' }), /not an address/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').get().n, 3);
});

test('mail with a person, and with a company by its domain; the day of the newest', () => {
  const { db, lena, nordlicht, hafen } = demo();
  const withLena = mailWith(db, { kind: 'person', id: lena.id });
  assert.deepEqual(withLena.threads.map((t) => t.subject), ['Onboarding call on Thursday?']);
  assert.ok(withLena.last_in_touch.startsWith('2026-'));
  assert.deepEqual(mailWith(db, { kind: 'company', id: nordlicht.id }).threads.map((t) => t.subject), ['Onboarding call on Thursday?']);
  const hafenMail = mailWith(db, { kind: 'company', id: hafen.id });
  assert.deepEqual(hafenMail.threads.map((t) => t.subject), ['Brief for the launch event'], 'by the domain, though Jonas is not a person yet');
  const nobody = createPerson(db, { name: 'Nobody', emails: '' });
  assert.deepEqual(mailWith(db, { kind: 'person', id: nobody.id }), { threads: [], last_in_touch: null });
});

test('last in touch is the newer of your logged lines and your mail, and mail counts only with Mail on', () => {
  const { db, lena } = demo();
  assert.equal(lastInTouch(db, lena.id), null, 'Mail is off in a new install (Sovran Advisor): only what you logged counts');
  setModule(db, 'mail', true);
  const mailDay = lastInTouch(db, lena.id);
  assert.match(mailDay, /^\d{4}-\d{2}-\d{2}$/);
  setModule(db, 'mail', false);
  assert.equal(lastInTouch(db, lena.id), null, 'with Mail off only what you logged counts');
  setModule(db, 'mail', true);
  assert.equal(lastInTouch(db, lena.id), mailDay);
});

test('the API: people in a conversation, a sender added, the mail with a person', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailpeople-'));
  const app = await startServer({ port: 0, dataDir: dir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0 });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const json = async (method, url, body) => { const res = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const lena = (await json('POST', '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' })).body;
  await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'demo@example.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'd.mbox' }, body: Buffer.from(makeMailbox({ filler: 0 }).text) });
  const thread = (await json('GET', '/api/mail/threads?q=onboarding')).body[0];
  assert.deepEqual((await json('GET', `/api/mail/threads/${thread.id}`)).body.people.map((p) => p.person.id), [lena.id]);
  const invoice = (await json('GET', '/api/mail/threads?q=invoice')).body[0];
  const unknown = (await json('GET', `/api/mail/threads/${invoice.id}`)).body.people[0];
  assert.deepEqual([unknown.email, unknown.person], ['billing@printshop.example', null]);
  const added = await json('POST', '/api/mail/people', { email: unknown.email, name: unknown.name, subject: invoice.subject });
  assert.deepEqual([added.status, added.body.person.name, added.body.created], [201, 'Billing', true]);
  assert.equal((await json('POST', '/api/mail/people', { email: unknown.email })).status, 200);
  assert.equal((await json('POST', '/api/mail/people', { email: 'x' })).status, 400);
  assert.deepEqual((await json('GET', `/api/mail/with?kind=person&id=${lena.id}`)).body.threads.map((x) => x.subject), ['Onboarding call on Thursday?']);
  assert.equal((await json('GET', '/api/mail/with?kind=thing&id=x')).status, 400);
});
