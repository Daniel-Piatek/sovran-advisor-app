// Invitations in a mail (invite.js, advanced/mail/12). Every invitation and person is made up; nothing is sent anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { importMboxText, listThreads } from '../../mail.js';
import { eventsBetween } from '../../events.js';
import { listSends, buildRaw, undoSend } from '../../mail-send.js';
import { parseInvite, buildReply, invitesOfThread, answerInvite, undoAnswer, PARTSTAT } from '../../invite.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

const ICS = (extra = '') => `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:kick-off@nordlicht.example\nSEQUENCE:2\nSUMMARY:Kick-off Nordlicht\nDTSTART:20261015T100000\nDTEND:20261015T110000\nLOCATION:Nordlicht Studio\nORGANIZER;CN=Jonas Weber:mailto:jonas@hafenkante.example\nATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION:mailto:demo@example.com\n${extra}END:VEVENT\nEND:VCALENDAR`;

function demo() {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  importMboxText(db, makeMailbox({ filler: 0 }).text, { email: 'demo@example.com', filename: 'demo.mbox' });
  const thread = listThreads(db, { q: 'Gartenfest' })[0];
  const [messageId, card] = Object.entries(invitesOfThread(db, thread.id))[0];
  return { db, thread, messageId, card };
}
const day = (db, from = '2026-11-14', to = '2026-11-15') => eventsBetween(db, `${from}T00:00`, `${to}T00:00`);

test('the calendar file is read for what it is: title, time, place, who asked, who is invited', () => {
  const card = parseInvite(ICS(), { me: ['demo@example.com'] });
  assert.deepEqual([card.uid, card.method, card.summary, card.location, card.start, card.end, card.sequence], ['kick-off@nordlicht.example', 'REQUEST', 'Kick-off Nordlicht', 'Nordlicht Studio', '2026-10-15T10:00', '2026-10-15T11:00', 2]);
  assert.deepEqual(card.organizer, { email: 'jonas@hafenkante.example', name: 'Jonas Weber' });
  assert.equal(card.you, 'demo@example.com');
  assert.equal(parseInvite('not a calendar'), null);
  assert.equal(parseInvite('BEGIN:VCALENDAR\nEND:VCALENDAR'), null);
  const allDay = parseInvite(ICS().replace('DTSTART:20261015T100000', 'DTSTART;VALUE=DATE:20261015').replace('DTEND:20261015T110000', 'DTEND;VALUE=DATE:20261016'));
  assert.deepEqual([allDay.all_day, allDay.start, allDay.end], [true, '2026-10-15T00:00', '2026-10-15T23:59']);
  const utc = parseInvite(ICS().replace('DTSTART:20261015T100000', 'DTSTART:20261015T080000Z').replace('DTEND:20261015T110000', 'DTEND:20261015T090000Z'));
  assert.equal(utc.start, `2026-10-15T${String(new Date(Date.UTC(2026, 9, 15, 8)).getHours()).padStart(2, '0')}:00`, 'a time in UTC is shown in this computer’s own time');
});

test('the importer keeps the mail’s own calendar file, and the thread says what the meeting is', () => {
  const { card, messageId, db } = demo();
  assert.deepEqual([card.summary, card.start, card.location, card.answer, card.cancelled], ['Garden party', '2026-11-14T15:00', "Zoe's garden", null, false]);
  assert.match(db.prepare('SELECT invite_ics FROM mail_messages WHERE id = ?').get(messageId).invite_ics, /UID:garden-party-2026@example.org/);
});

test('yes puts the meeting in the Calendar once, and Accepted goes to the organiser as a calendar file in the outbox', () => {
  const { db, messageId } = demo();
  const card = answerInvite(db, messageId, PARTSTAT.yes);
  assert.deepEqual([card.answer.said, card.answer.in_calendar, card.answer.send.state], ['Yes', true, 'waiting']);
  const events = day(db);
  assert.deepEqual(events.map((e) => [e.title, e.starts_at, e.ends_at, e.note]), [['Garden party', '2026-11-14T15:00', '2026-11-14T18:00', "At Zoe's garden · from Zoe Dubois"]]);
  assert.equal(db.prepare('SELECT uid FROM events').get().uid, 'garden-party-2026@example.org');
  const [send] = listSends(db);
  assert.deepEqual([send.to, send.subject, send.state], [['zoe@example.org'], 'Accepted: Garden party', 'waiting']);
  assert.ok(new Date(send.send_at) - Date.now() > 8000, 'ten seconds, as for any mail');
  const ics = db.prepare('SELECT ics FROM mail_sends').get().ics;
  assert.match(ics, /METHOD:REPLY/);
  assert.match(ics, /ATTENDEE;PARTSTAT=ACCEPTED:mailto:demo@example.com/);
  assert.match(ics, /ORGANIZER;CN=Zoe Dubois:mailto:zoe@example.org/);
  assert.match(ics, /UID:garden-party-2026@example.org/);
  assert.match(ics, /DTSTART:20261114T150000/);
  // the message that carries it
  const raw = buildRaw({ from: 'demo@example.com', to: ['zoe@example.org'], subject: 'Accepted: Garden party', body: 'Accepted', ics });
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /Content-Type: text\/calendar; method=REPLY; charset=UTF-8/);

  // answering twice never makes two events
  answerInvite(db, messageId, PARTSTAT.yes);
  assert.equal(day(db).length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_invites').get().n, 1);
});

test('maybe puts it there, marked; no changes nothing on a fresh day; a no after a yes takes it out, and Undo brings it back', () => {
  const { db, messageId } = demo();
  const no = answerInvite(db, messageId, PARTSTAT.no);
  assert.deepEqual([no.answer.said, no.answer.in_calendar, day(db).length, listSends(db)[0].subject], ['No', false, 0, 'Declined: Garden party']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n, 0, 'your Calendar is exactly as it was');

  const maybe = answerInvite(db, messageId, PARTSTAT.maybe);
  assert.deepEqual([maybe.answer.said, day(db).map((e) => e.note)], ['Maybe', ["At Zoe's garden · from Zoe Dubois · maybe"]]);
  assert.match(db.prepare('SELECT ics FROM mail_sends ORDER BY created_at DESC, rowid DESC LIMIT 1').get().ics, /PARTSTAT=TENTATIVE/);

  answerInvite(db, messageId, PARTSTAT.no);
  assert.equal(day(db).length, 0, 'a no takes out what a maybe put there');
  const back = undoAnswer(db, messageId);
  assert.equal(day(db).length, 1, 'Undo puts the meeting back');
  assert.equal(back.answer.said, 'Maybe', 'and your earlier answer');
});

test('Undo within the ten seconds: the Calendar and the answer are as they were; when the mail is on its way it cannot be taken back', () => {
  const { db, messageId } = demo();
  answerInvite(db, messageId, PARTSTAT.yes);
  const back = undoAnswer(db, messageId);
  assert.equal(back.answer, null);
  assert.deepEqual([day(db).length, listSends(db)[0].state], [0, 'undone']);
  assert.throws(() => undoAnswer(db, messageId), /no answer to take back/);

  answerInvite(db, messageId, PARTSTAT.yes);
  db.prepare("UPDATE mail_sends SET claimed_at = ?, state = 'sending' WHERE state = 'waiting'").run(new Date().toISOString());
  assert.throws(() => undoAnswer(db, messageId), (e) => e.code === 'too_late');
  assert.equal(day(db).length, 1, 'nothing changed when it was too late');
  void undoSend;
});

test('a mail whose calendar file was not kept, a cancellation and a reply are not answered; the answer needs a plain yes, maybe or no', () => {
  const { db, messageId } = demo();
  db.exec("UPDATE mail_messages SET invite_ics = ''");
  assert.throws(() => answerInvite(db, messageId, 'ACCEPTED'), (e) => e.status === 409 && e.code === 'no_ics' && /Read the mail in again/.test(e.message));
  db.prepare('UPDATE mail_messages SET invite_ics = ? WHERE id = ?').run(ICS().replace('METHOD:REQUEST', 'METHOD:CANCEL'), messageId);
  assert.throws(() => answerInvite(db, messageId, 'ACCEPTED'), (e) => e.code === 'not_a_request' && /cancelled/.test(e.message));
  assert.equal(invitesOfThread(db, db.prepare('SELECT thread_id FROM mail_messages WHERE id = ?').get(messageId).thread_id)[messageId].cancelled, true);
  db.prepare('UPDATE mail_messages SET invite_ics = ? WHERE id = ?').run(ICS().replace('METHOD:REQUEST', 'METHOD:REPLY'), messageId);
  assert.deepEqual(invitesOfThread(db, db.prepare('SELECT thread_id FROM mail_messages WHERE id = ?').get(messageId).thread_id), {}, 'a reply to someone else’s invitation is no card');
  assert.throws(() => answerInvite(db, messageId, 'PERHAPS'), /yes, maybe or no/);
  assert.throws(() => answerInvite(db, 'nope', 'ACCEPTED'), (e) => e.status === 404);
  assert.match(buildReply(parseInvite(ICS(), { me: ['demo@example.com'] }), 'DECLINED', { at: new Date('2026-11-09T10:00:00Z') }), /DTSTAMP:20261109T100000Z[\s\S]*PARTSTAT=DECLINED/);
});

test('schema 49 moves an older database: the calendar file column, the meeting key, the answer file and the answers table; every row is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invite-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO events (id, created_at, updated_at, title, starts_at, ends_at) VALUES ('e1', 'a', 'a', 'Keep me', '2026-11-01T10:00', '2026-11-01T11:00')");
  db.exec('DROP INDEX events_by_uid; ALTER TABLE events DROP COLUMN uid; ALTER TABLE mail_messages DROP COLUMN invite_ics; ALTER TABLE mail_sends DROP COLUMN ics; DROP TABLE mail_invites; PRAGMA user_version = 48;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare("SELECT title, uid FROM events WHERE id = 'e1'").get() }, { title: 'Keep me', uid: null });
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_invites').get().n, 0);
  for (const [table, column] of [['mail_messages', 'invite_ics'], ['mail_sends', 'ics']]) assert.ok(db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().some((c) => c.name === column));
  db.close();
});
