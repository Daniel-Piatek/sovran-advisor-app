// From mail to action, with your assistant (the Mail module, advanced/mail/11).
//   t on a mail         a task with the subject for its words and a link back to the mail; the mail says where it went.
//   Your assistant      reads a conversation and drafts a reply as a CARD (Send, Edit, Dismiss). Nothing leaves until you press Send, and then it
//                       goes through the outbox like a mail you wrote, with the ten seconds to take it back.
//   Hard limits         checked here, in the tool, not asked of the prompt: only to people already in the conversation, never an attachment,
//                       at most ten drafts a day. No chat can change them; Settings shows them, read only.

import { insertTask } from './tasks.js';
import { replyDraft } from './mail-send.js';
import { peopleOfThread } from './mail-people.js';
import { plainSubject } from './mbox.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export const LIMITS = { known_recipients_only: true, attachments: false, drafts_per_day: 10 };

export const describeLimits = () => [
  { key: 'recipients', text: 'It may write only to people who are already in the conversation.' },
  { key: 'attachments', text: 'It never attaches a file.' },
  { key: 'per_day', text: `It drafts at most ${LIMITS.drafts_per_day} mails a day.` },
  { key: 'never_sends', text: 'It never sends by itself: every draft waits on a card for your Send.' },
];

const localMidnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
export const draftsToday = (db) => db.prepare("SELECT count(*) AS n FROM assistant_actions WHERE kind = 'mail_send' AND created_at >= ?").get(localMidnight()).n;

// A mail becomes a task: the subject (without Re:/Fwd:) for its words, a link back to the conversation, and, from Money, a day two weeks off.
export function mailToTask(db, threadId, { title = '', due = null, split = '' } = {}) {
  const thread = db.prepare('SELECT id, subject FROM mail_threads WHERE id = ? AND deleted_at IS NULL').get(threadId);
  if (!thread) throw fail(404, 'No such conversation.');
  const words = String(title).trim() || plainSubject(thread.subject) || 'A mail';
  let day = due ?? '';
  if (due === null && split === 'money') { const d = new Date(); d.setDate(d.getDate() + 14); day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return insertTask(db, { text: words.slice(0, 300), due: day, mail_thread_id: threadId });
}

// The tasks that came from a conversation (the line on the mail that says where it went).
export const tasksOf = (db, threadId) => db.prepare('SELECT id, text, due, done FROM tasks WHERE mail_thread_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid').all(threadId).map((t) => ({ id: t.id, text: t.text, due: t.due, done: t.done === 1 }));

// A draft your assistant may make: the limits, in code.
export function checkDraft(db, { threadId, to, text, attachments }) {
  const draft = replyDraft(db, threadId); // throws 404 for a conversation that is not there
  if (Array.isArray(attachments) ? attachments.length : attachments) throw fail(403, 'It never attaches a file: that is a limit set in the app, not in the prompt. Say so.', 'attachments');
  const body = String(text ?? '').trim();
  if (!body) throw fail(400, 'A draft needs its words.');
  if (body.length > 20_000) throw fail(400, 'That draft is too long.');
  const known = new Set(peopleOfThread(db, threadId).map((p) => p.email));
  const wanted = (to === undefined || to === null || to === '' ? draft.to : (Array.isArray(to) ? to : String(to).split(/[,\s;]+/))).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) throw fail(400, 'Who is the draft to? It may go only to someone in the conversation.');
  const stranger = wanted.find((a) => !known.has(a));
  if (stranger) throw fail(403, `It may write only to people already in the conversation, and ${stranger} is not one of them: that is a limit set in the app. Say so; do not try another way.`, 'recipient');
  if (draftsToday(db) >= LIMITS.drafts_per_day) throw fail(429, `It drafts at most ${LIMITS.drafts_per_day} mails a day, and that many were drafted today: that is a limit set in the app. Say so.`, 'per_day');
  return { account_id: draft.account_id, thread_id: threadId, to: wanted, subject: draft.subject, body };
}
