// Writing mail (the Mail module, advanced/mail/8). Every send stays in your control:
//   Ten seconds   a mail you send first waits in `mail_sends`, "Sending in 10 s · Undo"; Undo takes it back before it is claimed.
//   Later         Send later holds it until tomorrow at 08:00.
//   An answer     "Remind me if no answer in 3 days" makes a task when nobody has written back by then.
//   Never twice   the sender CLAIMS one waiting row at a time, atomically, before it calls Gmail. A row that was claimed when the
//                 app stopped is never sent again by itself: it is marked failed and says to look in Gmail's Sent first.
//   Threaded      the mail goes with the conversation's Gmail thread id and its In-Reply-To / References, so the answer is in the same thread.
// Sending needs the Google switch "Send mail as you" (off until you switch it on: Google is asked then, for that permission only).

import { randomUUID } from 'node:crypto';
import { accessToken } from './google.js';
import { insertTask } from './tasks.js';
import { moduleOn } from './modules.js';
import { pixelBase, pixelPath, newToken, rememberPeople, defaultFor } from './mail-confirm.js';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const apiBase = (env = process.env) => String(env.GMAIL_API_URL || 'https://gmail.googleapis.com/gmail/v1').replace(/\/+$/, '');
const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
export const UNDO_SECONDS = 10;

// ---- The message itself ----

const encodeWord = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`);
const wrap = (b64) => b64.replace(/(.{76})/g, '$1\r\n');

const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const part = (type, text) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(text, 'utf8').toString('base64'))];

// pixelUrl: a read confirmation (Mail 9): the mail then has an html version holding the one-pixel picture, beside its text.
export function buildRaw({ from, to, cc = [], subject, body, inReplyTo = '', references = [], date = new Date(), pixelUrl = '', ics = '' }) {
  const text = body.replace(/\r?\n/g, '\r\n');
  const head = [
    `From: ${from}`, `To: ${to.join(', ')}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeWord(subject.replace(/[\r\n]+/g, ' '))}`, `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    ...(inReplyTo ? [`In-Reply-To: <${inReplyTo}>`] : []), ...(references.length ? [`References: ${references.map((r) => `<${r}>`).join(' ')}`] : []),
    'MIME-Version: 1.0',
  ];
  if (ics) { // an answer to an invitation (Mail 12): the words, and the small calendar file the organiser's calendar reads
    const boundary = `=_ics${Buffer.from(ics).toString('base64url').slice(-12)}`;
    return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, ...part('text/plain', text), `--${boundary}`,
      ...part('text/calendar; method=REPLY', ics.replace(/\r?\n/g, '\r\n')), `--${boundary}--`].join('\r\n');
  }
  if (!pixelUrl) return [...head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(text, 'utf8').toString('base64'))].join('\r\n');
  const boundary = `=_${Buffer.from(pixelUrl).toString('base64url').slice(-16)}`;
  const html = `<div style="white-space:pre-wrap">${escapeHtml(body)}</div><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;
  return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, ...part('text/plain', text), `--${boundary}`, ...part('text/html', html), `--${boundary}--`].join('\r\n');
}

const rowOf = (r) => ({
  id: r.id, account_id: r.account_id, thread_id: r.thread_id, to: list(r.to_addrs), cc: list(r.cc_addrs), subject: r.subject, body: r.body_text,
  confirm: Boolean(r.pixel_token), send_at: r.send_at, state: r.state, sent_at: r.sent_at, remind_days: r.remind_days, remind_at: r.remind_at, reminded: r.reminded === 1, problem: r.problem,
});

// Whether this account may send now: signed in with Google, and “Send mail as you” is on.
export function canSend(db, mailAccountId) {
  const g = db.prepare('SELECT g.enabled FROM mail_accounts a JOIN google_accounts g ON g.id = a.google_account_id WHERE a.id = ? AND g.deleted_at IS NULL').get(mailAccountId);
  return Boolean(g && list(g.enabled).includes('mail.send'));
}

// ---- Your side: write, undo ----

// when: 'now' (ten seconds from now, to undo), 'tomorrow' (08:00 tomorrow, this computer's time), or a time (ISO). seconds: the wait for 'now'.
export function composeSend(db, { accountId, threadId = null, to, cc = [], subject, body, when = 'now', remindDays = 0, seconds = UNDO_SECONDS, at = new Date(), confirm = false, ics = '' }) {
  const account = db.prepare('SELECT * FROM mail_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId);
  if (!account) throw fail(404, 'No such mail account.');
  const clean = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const toL = clean(to);
  const ccL = clean(cc);
  if (!toL.length) throw fail(400, 'Who is it to?');
  if ([...toL, ...ccL].some((a) => !ADDRESS.test(a)) || toL.length + ccL.length > 50) throw fail(400, 'One of the addresses is not one: name@example.com.');
  const text = String(body ?? '').trim();
  if (!text) throw fail(400, 'Write something first.');
  if (text.length > 200_000) throw fail(400, 'That is too long for one mail.');
  const subj = String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (threadId && !db.prepare('SELECT 1 FROM mail_threads WHERE id = ? AND account_id = ? AND deleted_at IS NULL').get(threadId, accountId)) throw fail(404, 'No such conversation.');
  let sendAt;
  if (when === 'now') sendAt = new Date(at.getTime() + Math.max(0, Number(seconds)) * 1000);
  else if (when === 'tomorrow') { sendAt = new Date(at); sendAt.setDate(sendAt.getDate() + 1); sendAt.setHours(8, 0, 0, 0); } else {
    sendAt = new Date(when);
    if (Number.isNaN(sendAt.getTime())) throw fail(400, 'when is now, tomorrow, or a time.');
  }
  const days = Math.max(0, Math.min(60, Math.trunc(Number(remindDays)) || 0));
  // A read confirmation: only when you switched it on for this mail, and only with an address the other side can reach for the picture.
  if (confirm && !pixelBase(db)) throw fail(409, 'A read confirmation needs a public address for the picture. Set it under Mail › Import and sync first.', 'no_pixel_base');
  const token = confirm ? newToken() : null;
  rememberPeople(db, toL, Boolean(confirm)); // remembered per person
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO mail_sends (id, created_at, updated_at, account_id, thread_id, to_addrs, cc_addrs, subject, body_text, send_at, remind_days, pixel_token, ics)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, accountId, threadId, JSON.stringify(toL), JSON.stringify(ccL), subj, text, sendAt.toISOString(), days, token, String(ics ?? '').slice(0, 20_000));
  return rowOf(db.prepare('SELECT * FROM mail_sends WHERE id = ?').get(id));
}

// Undo: only while it has not been claimed. Answers the words so the composer can have them back.
export function undoSend(db, id) {
  const done = db.prepare("UPDATE mail_sends SET state = 'undone', updated_at = ? WHERE id = ? AND state = 'waiting' AND claimed_at IS NULL").run(now(), id);
  const row = db.prepare('SELECT * FROM mail_sends WHERE id = ?').get(id);
  if (!row) throw fail(404, 'No such mail.');
  if (!done.changes) throw fail(409, row.state === 'undone' ? 'It was taken back already.' : 'It is on its way: it can no longer be taken back.', 'too_late');
  return rowOf(row);
}

export const listSends = (db, { account = '', limit = 20 } = {}) => db.prepare(`SELECT * FROM mail_sends WHERE deleted_at IS NULL ${account ? 'AND account_id = ?' : ''}
  ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...(account ? [account] : []), Math.max(1, Math.min(100, Math.trunc(limit) || 20))).map(rowOf);

// What a reply to this conversation starts with: who it goes to, and the subject.
// messageId: answer that one mail of the conversation (its sender; your own mail goes back to whom you wrote), with its words quoted
// under a line that says whose they are and when. all: Reply all, everyone else on that mail is in Cc. Without messageId: the
// last mail someone else wrote, as before.
const quoteDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const plainOf = (html) => String(html ?? '').replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n');
export function quoteOf(m) {
  const words = (String(m.body_text ?? '').trim() || plainOf(m.body_html).trim()).slice(0, 20_000);
  const who = m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email;
  return `\n\nOn ${quoteDate(m.sent_at)}, ${who} wrote:\n${words.split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')).join('\n')}\n`;
}
export function replyDraft(db, threadId, { messageId = '', all = false } = {}) {
  const thread = db.prepare('SELECT t.*, a.email AS account_email FROM mail_threads t JOIN mail_accounts a ON a.id = t.account_id WHERE t.id = ? AND t.deleted_at IS NULL').get(threadId);
  if (!thread) throw fail(404, 'No such conversation.');
  const me = String(thread.account_email ?? '').toLowerCase();
  const pixel_ready = Boolean(pixelBase(db));
  if (messageId) {
    const m = db.prepare('SELECT * FROM mail_messages WHERE id = ? AND thread_id = ? AND deleted_at IS NULL').get(messageId, threadId);
    if (!m) throw fail(404, 'That mail is not in this conversation.');
    const mine = String(m.from_email).toLowerCase() === me;
    const emails = (v) => list(v).map((a) => String(a.email ?? '').toLowerCase()).filter(Boolean);
    const to = mine ? emails(m.to_addrs).slice(0, all ? 50 : 1) : [String(m.from_email).toLowerCase()];
    const cc = all ? [...new Set([...(mine ? [] : emails(m.to_addrs)), ...emails(m.cc_addrs)])].filter((a) => a !== me && !to.includes(a)) : [];
    const base = (m.subject || thread.subject || '').trim();
    return {
      account_id: thread.account_id, thread_id: threadId, to, ...(all ? { cc } : {}), subject: /^re:/i.test(base) ? base : `Re: ${base}`, body: quoteOf(m),
      replying_to: { id: m.id, name: m.from_name || m.from_email, email: m.from_email, sent_at: m.sent_at, all: Boolean(all) },
      confirm: defaultFor(db, to), pixel_ready,
    };
  }
  const last = db.prepare(`SELECT from_email, to_addrs, subject FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL AND lower(from_email) <> lower(?)
    ORDER BY sent_at DESC, rowid DESC LIMIT 1`).get(threadId, thread.account_email);
  const mine = db.prepare('SELECT to_addrs, subject FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL ORDER BY sent_at DESC, rowid DESC LIMIT 1').get(threadId);
  const to = last ? [last.from_email] : list(mine?.to_addrs).map((a) => a.email).slice(0, 1);
  const base = (last?.subject || mine?.subject || thread.subject || '').trim();
  return { account_id: thread.account_id, thread_id: threadId, to, subject: /^re:/i.test(base) ? base : `Re: ${base}`, confirm: defaultFor(db, to), pixel_ready };
}

// ---- The sender ----

// Claims ONE waiting mail that is due, atomically, before anything is sent.
function claimDue(db, at) {
  return db.prepare(`UPDATE mail_sends SET state = 'sending', claimed_at = ?, updated_at = ? WHERE id = (
      SELECT id FROM mail_sends WHERE state = 'waiting' AND claimed_at IS NULL AND send_at <= ?
        AND account_id IN (SELECT a.id FROM mail_accounts a JOIN google_accounts g ON g.id = a.google_account_id WHERE g.deleted_at IS NULL AND g.enabled LIKE '%"mail.send"%')
      ORDER BY send_at, rowid LIMIT 1) RETURNING *`).get(at, at, at);
}

// Mails that were claimed when the app stopped may or may not have gone: they are never sent again by themselves.
export function settleSends(db) {
  db.prepare("UPDATE mail_sends SET state = 'failed', problem = 'The app stopped while this was being sent. Look in Gmail’s Sent before sending it again.', updated_at = ? WHERE state = 'sending'").run(now());
}

export async function sendDue(db, keyStore, { env = process.env, fetcher = fetch, at = new Date() } = {}) {
  const sent = [];
  // Mails whose account may not send wait, and say why; the rest are claimed one at a time.
  db.prepare(`UPDATE mail_sends SET problem = 'Switch on “Send mail as you” under Settings › Google, and it goes.', updated_at = ?
    WHERE state = 'waiting' AND claimed_at IS NULL AND send_at <= ? AND problem = '' AND account_id NOT IN
      (SELECT a.id FROM mail_accounts a JOIN google_accounts g ON g.id = a.google_account_id WHERE g.deleted_at IS NULL AND g.enabled LIKE '%"mail.send"%')`).run(now(), at.toISOString());
  for (let i = 0; i < 20; i++) { // at most this many in one round
    const row = claimDue(db, at.toISOString());
    if (!row) break;
    sent.push(await sendOne(db, keyStore, row, { env, fetcher }));
  }
  return sent;
}

async function sendOne(db, keyStore, row, { env, fetcher }) {
  const account = db.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(row.account_id);
  const fail_ = (problem) => { db.prepare("UPDATE mail_sends SET state = 'failed', problem = ?, updated_at = ? WHERE id = ?").run(problem, now(), row.id); return { id: row.id, state: 'failed', problem }; };
  let reply = null;
  if (row.thread_id) {
    const thread = db.prepare('SELECT gmail_thread_id FROM mail_threads WHERE id = ?').get(row.thread_id);
    const last = db.prepare("SELECT message_id, in_reply_to FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL AND message_id <> '' ORDER BY sent_at DESC, rowid DESC LIMIT 1").get(row.thread_id);
    reply = { gmailThreadId: thread?.gmail_thread_id ?? '', inReplyTo: last?.message_id ?? '', references: [last?.in_reply_to, last?.message_id].filter(Boolean) };
  }
  let token;
  try { token = await accessToken(db, keyStore, { id: account.google_account_id, permission: 'mail.send', why: 'Sending a mail' }, { env, fetcher }); } catch (err) { return fail_(err.status ? err.message : 'Google would not give a sign-in.'); }
  let pixelUrl = '';
  if (row.pixel_token) {
    const base = pixelBase(db);
    if (!base) return fail_('The public address for the read confirmation is not set any more. Nothing was sent.');
    pixelUrl = `${base}${pixelPath(row.pixel_token)}`;
  }
  const raw = buildRaw({ from: account.email, to: list(row.to_addrs), cc: list(row.cc_addrs), subject: row.subject, body: row.body_text, inReplyTo: reply?.inReplyTo, references: reply?.references ?? [], pixelUrl, ics: row.ics });
  let res;
  try {
    res = await fetcher(`${apiBase(env)}/users/me/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), ...(reply?.gmailThreadId ? { threadId: reply.gmailThreadId } : {}) }),
    });
  } catch {
    // Unknown whether Gmail got it: never sent again by itself.
    return fail_('Gmail could not be reached while sending. Look in Gmail’s Sent before sending it again.');
  }
  if (!res.ok) return fail_(`Gmail did not take it (${res.status}).`);
  const gmail = await res.json().catch(() => ({}));
  const t = now();
  const remindAt = row.remind_days ? new Date(Date.now() + row.remind_days * 86_400_000).toISOString() : null;
  db.prepare("UPDATE mail_sends SET state = 'sent', sent_at = ?, gmail_id = ?, gmail_thread_id = ?, remind_at = ?, problem = '', updated_at = ? WHERE id = ?")
    .run(t, gmail.id ?? '', gmail.threadId ?? '', remindAt, t, row.id);
  return { id: row.id, state: 'sent' };
}

// Remind me if no answer: when the day comes and nobody has written back in the conversation, a task brings it back.
export function remindDue(db, { at = new Date() } = {}) {
  let made = 0;
  for (const s of db.prepare("SELECT * FROM mail_sends WHERE state = 'sent' AND remind_at IS NOT NULL AND reminded = 0 AND remind_at <= ?").all(at.toISOString())) {
    const account = db.prepare('SELECT email FROM mail_accounts WHERE id = ?').get(s.account_id);
    const answered = s.thread_id && db.prepare(`SELECT 1 FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL AND lower(from_email) <> lower(?) AND sent_at > ? LIMIT 1`).get(s.thread_id, account.email, s.sent_at);
    if (!answered) {
      const d = new Date(at);
      insertTask(db, { text: `No answer yet: ${s.subject || 'a mail'}`, due: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, origin: 'assistant' });
      made++;
    }
    db.prepare('UPDATE mail_sends SET reminded = 1, updated_at = ? WHERE id = ?').run(now(), s.id);
  }
  return made;
}

// The job: every few seconds, what is due goes, and the reminders come. Only while Mail is on.
export function startMailSender(db, keyStore, { env, fetcher, every = 2000 }) {
  let running = false;
  const tick = async () => {
    if (running || !moduleOn(db, 'mail')) return;
    running = true;
    try { await sendDue(db, keyStore, { env, fetcher }); remindDue(db); } catch { /* said on the row */ } finally { running = false; }
  };
  const timer = every ? setInterval(tick, every) : null;
  timer?.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

// ---- The Outbox: what has not gone yet ----
// A mail is in the Outbox while it waits (its ten seconds, or Send later), while it is being sent, and when it failed, until you send
// it again or let it go. Letting go only sets deleted_at: the row and its words stay.
export function pendingSends(db, { account = '' } = {}) {
  return db.prepare(`SELECT * FROM mail_sends WHERE deleted_at IS NULL AND state IN ('waiting', 'sending', 'failed') ${account ? 'AND account_id = ?' : ''}
    ORDER BY send_at, rowid`).all(...(account ? [account] : [])).map(rowOf);
}

// Send now: a mail waiting for Send later goes at the next round (within two seconds).
export function sendNow(db, id, { at = new Date() } = {}) {
  const done = db.prepare("UPDATE mail_sends SET send_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting' AND claimed_at IS NULL AND deleted_at IS NULL").run(at.toISOString(), now(), id);
  if (!done.changes) throw fail(409, 'It is not waiting any more.', 'not_waiting');
  return rowOf(db.prepare('SELECT * FROM mail_sends WHERE id = ?').get(id));
}

// Try again: only a mail that failed, and only because you say so (it may have gone; the problem says to look in Gmail's Sent).
export function retrySend(db, id, { at = new Date() } = {}) {
  const done = db.prepare("UPDATE mail_sends SET state = 'waiting', claimed_at = NULL, problem = '', send_at = ?, updated_at = ? WHERE id = ? AND state = 'failed' AND deleted_at IS NULL").run(at.toISOString(), now(), id);
  if (!done.changes) throw fail(409, 'Only a mail that failed can be tried again.', 'not_failed');
  return rowOf(db.prepare('SELECT * FROM mail_sends WHERE id = ?').get(id));
}

// Let it go: a failed mail leaves the Outbox (kept, with deleted_at).
export function dismissSend(db, id) {
  const done = db.prepare("UPDATE mail_sends SET deleted_at = ?, updated_at = ? WHERE id = ? AND state = 'failed' AND deleted_at IS NULL").run(now(), now(), id);
  if (!done.changes) throw fail(409, 'Only a mail that failed can be let go here. A waiting one has Undo.', 'not_failed');
  return { id, dismissed: true };
}
