// Invitations in a mail (advanced/mail/12): the calendar file a mail carries is read for what it is (title, time, place, who asked),
// answered with one key (y, Shift Y, n), and the answer goes back to the organiser by mail as a small calendar file, through the
// same outbox as every mail (ten seconds to undo, claimed before it is sent, so never twice).
//
// A yes or a maybe puts the meeting in your Calendar, keyed by the meeting's own UID: answering twice never makes two.
// A no changes nothing on your day, except taking out the meeting an earlier yes had put there.
// Tests use made-up invitations only; nothing here reaches Google, and the agent never sends a mail.

import { randomUUID } from 'node:crypto';
import ICAL from 'ical.js';
import { createEvent, updateEvent, deleteEvent, restoreEvent } from './events.js';
import { composeSend, undoSend } from './mail-send.js';

const now = () => new Date().toISOString();
const fail = (status, message, code = '') => Object.assign(new Error(message), { status, code });
const pad = (n) => String(n).padStart(2, '0');
const localAt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localDay = (d) => localAt(d).slice(0, 10);

export const PARTSTAT = { yes: 'ACCEPTED', maybe: 'TENTATIVE', no: 'DECLINED' };
const WORDS = { ACCEPTED: 'Accepted', TENTATIVE: 'Tentative', DECLINED: 'Declined' };
const YOU_SAID = { ACCEPTED: 'Yes', TENTATIVE: 'Maybe', DECLINED: 'No' };

const mailto = (value) => String(value ?? '').replace(/^mailto:/i, '').trim().toLowerCase();
const clean = (text) => String(text ?? '').replace(/[\r\n]+/g, ' ').trim();

// One moment as the Calendar keeps it (this computer's own time, YYYY-MM-DDTHH:MM). A floating time is already the reader's own.
function moment(time) {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}T00:00`;
  if (time.zone?.tzid === 'floating') return `${time.year}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}`;
  return localAt(time.toJSDate());
}

// What the calendar file says, or null when it holds no meeting.
// me: the addresses that are yours, to find your own line among those invited.
export function parseInvite(ics, { me = [] } = {}) {
  if (!ics || typeof ics !== 'string') return null;
  let root;
  try { root = new ICAL.Component(ICAL.parse(ics)); } catch { return null; }
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    try { const tz = new ICAL.Timezone(zone); if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz); } catch { /* a zone it cannot read: the times stay as they are */ }
  }
  const vevent = root.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  let event;
  try { event = new ICAL.Event(vevent); } catch { return null; }
  if (!event.uid || !event.startDate) return null;
  const method = String(root.getFirstPropertyValue('method') ?? '').toUpperCase() || 'REQUEST';
  const start = moment(event.startDate);
  let end = event.endDate ? moment(event.endDate) : start;
  const allDay = event.startDate.isDate;
  if (allDay) { // a whole day: its end is the day after (exclusive); the Calendar keeps it as that day from midnight to the last minute
    const last = new Date(event.endDate ? event.endDate.toJSDate() : event.startDate.toJSDate());
    if (event.endDate) last.setUTCDate(last.getUTCDate() - 1);
    end = `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}T23:59`;
    if (end <= start) end = `${start.slice(0, 10)}T23:59`;
  } else if (end <= start) end = localAt(new Date(new Date(start).getTime() + 3_600_000));
  const organizerProp = vevent.getFirstProperty('organizer');
  const organizer = organizerProp ? { email: mailto(organizerProp.getFirstValue()), name: clean(organizerProp.getParameter('cn')) } : { email: '', name: '' };
  const attendees = vevent.getAllProperties('attendee').map((p) => ({ email: mailto(p.getFirstValue()), name: clean(p.getParameter('cn')), partstat: String(p.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase() }));
  const mine = new Set(me.map((a) => String(a).toLowerCase()));
  const you = attendees.find((a) => mine.has(a.email)) ?? null;
  return {
    uid: String(event.uid), method, summary: clean(event.summary) || 'Meeting', location: clean(event.location), start, end, all_day: allDay,
    organizer, attendees: attendees.filter((a) => a.email).slice(0, 30), you: you ? you.email : (me[0] ?? ''), sequence: Number(event.sequence ?? 0) || 0,
    lines: { start: vevent.getFirstProperty('dtstart')?.toICALString() ?? '', end: vevent.getFirstProperty('dtend')?.toICALString() ?? '' },
  };
}

// The answer, as the small calendar file the organiser's calendar reads (METHOD:REPLY).
export function buildReply(invite, partstat, { at = new Date() } = {}) {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const line = (text) => String(text).replace(/[\r\n]+/g, ' ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sovran Advisor//Mail//EN', 'METHOD:REPLY', 'BEGIN:VEVENT',
    `UID:${line(invite.uid)}`, `DTSTAMP:${stamp}`, `SEQUENCE:${invite.sequence}`, `SUMMARY:${line(invite.summary)}`,
    ...(invite.lines.start ? [invite.lines.start] : []), ...(invite.lines.end ? [invite.lines.end] : []),
    `ORGANIZER${invite.organizer.name ? `;CN=${line(invite.organizer.name).replace(/[";:,]/g, ' ')}` : ''}:mailto:${invite.organizer.email}`,
    `ATTENDEE;PARTSTAT=${partstat}:mailto:${invite.you}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// ---- Reading a message's invitation, with how you answered ----

const myAddresses = (db, accountId) => [db.prepare('SELECT email FROM mail_accounts WHERE id = ?').get(accountId)?.email].filter(Boolean);

export function answerOf(db, uid) {
  const row = db.prepare('SELECT * FROM mail_invites WHERE uid = ? AND deleted_at IS NULL').get(uid);
  if (!row) return null;
  const send = row.send_id ? db.prepare('SELECT state, send_at, problem FROM mail_sends WHERE id = ?').get(row.send_id) : null;
  const event = row.event_id ? db.prepare('SELECT id, deleted_at FROM events WHERE id = ?').get(row.event_id) : null;
  return {
    partstat: row.partstat, said: YOU_SAID[row.partstat], word: WORDS[row.partstat], answered_at: row.answered_at, in_calendar: Boolean(event && !event.deleted_at),
    send: send ? { state: send.state, send_at: send.send_at, problem: send.problem, id: row.send_id } : null,
  };
}

// The card of a message: what the meeting is and how you answered. null when the message has no meeting in it.
export function inviteOf(db, message) {
  if (!message.invite_ics) return null;
  const invite = parseInvite(message.invite_ics, { me: myAddresses(db, message.account_id) });
  if (!invite || !['REQUEST', 'CANCEL'].includes(invite.method)) return null;
  const { lines, ...card } = invite;
  return { ...card, answer: invite.method === 'REQUEST' ? answerOf(db, invite.uid) : null, cancelled: invite.method === 'CANCEL' };
}

// Every invitation in a conversation, by the id of the message that carries it.
export function invitesOfThread(db, threadId) {
  const out = {};
  for (const m of db.prepare("SELECT * FROM mail_messages WHERE thread_id = ? AND invite_ics <> '' AND deleted_at IS NULL").all(threadId)) {
    const card = inviteOf(db, m);
    if (card) out[m.id] = card;
  }
  return out;
}

// ---- Answering ----

// partstat: ACCEPTED, TENTATIVE or DECLINED. at/seconds: when the mail goes (the usual ten seconds to undo).
export function answerInvite(db, messageId, partstat, { at = new Date(), seconds } = {}) {
  if (!WORDS[partstat]) throw fail(400, 'The answer is yes, maybe or no.');
  const message = db.prepare('SELECT * FROM mail_messages WHERE id = ? AND deleted_at IS NULL').get(messageId);
  if (!message) throw fail(404, 'No such mail.');
  if (!message.invite_ics) throw fail(409, 'This mail has no invitation the app kept. Read the mail in again (Mail › Import and sync) and it will.', 'no_ics');
  const invite = parseInvite(message.invite_ics, { me: myAddresses(db, message.account_id) });
  if (!invite) throw fail(409, 'The invitation in this mail could not be read.', 'unreadable');
  if (invite.method !== 'REQUEST') throw fail(409, invite.method === 'CANCEL' ? 'The organiser cancelled this meeting: there is nothing to answer.' : 'This is not an invitation to answer.', 'not_a_request');
  const before = db.prepare('SELECT * FROM mail_invites WHERE uid = ?').get(invite.uid);
  const found = db.prepare('SELECT id, deleted_at FROM events WHERE uid = ?').get(invite.uid);

  // Your Calendar: a yes or a maybe keeps the meeting there once; a no only takes out what an earlier yes put there.
  let eventId = found?.id ?? null;
  let changed = '';
  const note = [invite.location ? `At ${invite.location}` : '', invite.organizer.name || invite.organizer.email ? `from ${invite.organizer.name || invite.organizer.email}` : '', partstat === 'TENTATIVE' ? 'maybe' : '']
    .filter(Boolean).join(' · ');
  db.exec('BEGIN');
  try {
    if (partstat === 'DECLINED') {
      if (found && !found.deleted_at) { deleteEvent(db, found.id); changed = 'removed'; }
    } else if (found) {
      if (found.deleted_at) { restoreEvent(db, found.id); changed = 'restored'; } else changed = 'updated';
      updateEvent(db, found.id, { title: invite.summary, starts_at: invite.start, ends_at: invite.end, note });
    } else {
      const made = createEvent(db, { title: invite.summary, starts_at: invite.start, ends_at: invite.end, note });
      db.prepare("UPDATE events SET uid = ?, origin = 'imported' WHERE id = ?").run(invite.uid, made.id);
      eventId = made.id;
      changed = 'created';
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }

  // The answer by mail, to the one who asked.
  let send = null;
  if (invite.organizer.email) {
    const when = invite.all_day ? invite.start.slice(0, 10) : invite.start.replace('T', ' ');
    send = composeSend(db, {
      accountId: message.account_id, threadId: message.thread_id, to: [invite.organizer.email], subject: `${WORDS[partstat]}: ${invite.summary}`,
      body: `${WORDS[partstat]}: ${invite.summary}\n${when}${invite.location ? `, ${invite.location}` : ''}`, when: 'now', at, ...(seconds === undefined ? {} : { seconds }),
      ics: buildReply(invite, partstat, { at }),
    });
  }
  const time = now();
  if (before) {
    db.prepare('UPDATE mail_invites SET updated_at = ?, message_id = ?, partstat = ?, event_id = ?, send_id = ?, changed = ?, prev_partstat = ?, answered_at = ? WHERE uid = ?')
      .run(time, messageId, partstat, eventId, send?.id ?? null, changed, before.partstat, time, invite.uid);
  } else {
    db.prepare('INSERT INTO mail_invites (id, created_at, updated_at, uid, message_id, partstat, event_id, send_id, changed, prev_partstat, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), time, time, invite.uid, messageId, partstat, eventId, send?.id ?? null, changed, '', time);
  }
  return { ...inviteOf(db, message), no_organiser: !invite.organizer.email };
}

// Undo: only while the mail has not gone. The Calendar and your earlier answer come back as they were.
export function undoAnswer(db, messageId) {
  const message = db.prepare('SELECT * FROM mail_messages WHERE id = ? AND deleted_at IS NULL').get(messageId);
  if (!message?.invite_ics) throw fail(404, 'No such invitation.');
  const invite = parseInvite(message.invite_ics, { me: myAddresses(db, message.account_id) });
  const row = invite && db.prepare('SELECT * FROM mail_invites WHERE uid = ?').get(invite.uid);
  if (!row) throw fail(409, 'There is no answer to take back.');
  if (row.send_id) undoSend(db, row.send_id); // throws when it is on its way: nothing is changed then
  if (row.changed === 'created' && row.event_id) deleteEvent(db, row.event_id);
  else if (row.changed === 'removed' && row.event_id) restoreEvent(db, row.event_id);
  if (row.prev_partstat) {
    db.prepare("UPDATE mail_invites SET partstat = ?, prev_partstat = '', send_id = NULL, changed = '', updated_at = ? WHERE uid = ?").run(row.prev_partstat, now(), invite.uid);
  } else db.prepare('DELETE FROM mail_invites WHERE uid = ?').run(invite.uid);
  return inviteOf(db, message);
}
