// Mail drafts (2026-11-11): a mail being written, kept in this database as you type, so it survives a reload, a restart and closing
// the composer. It waits in Mail's Drafts until you send it or discard it. Only here: never copied to Gmail's Drafts.
//   Empty is nothing   a draft with no words (and, for a new mail, no To or Subject either) is not kept; one that becomes empty goes.
//   A reply's draft    stays with its conversation (thread_id), one per conversation: writing again continues it.
//   Sent or discarded  deleted_at is set (never removed); Undo of a discard, or of a send, brings it back.

import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max) => String(Array.isArray(v) ? v.join(', ') : v ?? '').slice(0, max);

const rowOf = (r) => ({
  id: r.id, account_id: r.account_id, thread_id: r.thread_id, to: r.to_addrs, cc: r.cc_addrs, subject: r.subject, body: r.body_text,
  remind_days: r.remind_days, confirm: r.confirm === 1, created_at: r.created_at, updated_at: r.updated_at,
});

export const isEmpty = (d) => !String(d.body ?? '').trim() && (d.thread_id || (!String(d.to ?? '').trim() && !String(d.cc ?? '').trim() && !String(d.subject ?? '').trim()));

// Save as you type. id: the draft being continued (else a reply continues its conversation's draft). Answers the draft, or null when
// there is nothing worth keeping (and the draft, if there was one, is let go).
export function saveDraft(db, input) {
  const accountId = String(input.account_id ?? '');
  if (!db.prepare('SELECT 1 FROM mail_accounts WHERE id = ? AND deleted_at IS NULL').get(accountId)) throw fail(404, 'No such mail account.');
  const threadId = input.thread_id || null;
  if (threadId && !db.prepare('SELECT 1 FROM mail_threads WHERE id = ? AND deleted_at IS NULL').get(threadId)) throw fail(404, 'No such conversation.');
  const draft = {
    account_id: accountId, thread_id: threadId, to: text(input.to, 5000), cc: text(input.cc, 5000), subject: text(input.subject, 300), body: text(input.body, 200_000),
    remind_days: Math.max(0, Math.min(60, Math.trunc(Number(input.remind_days)) || 0)), confirm: input.confirm === true ? 1 : 0,
  };
  let existing = input.id ? db.prepare('SELECT * FROM mail_drafts WHERE id = ? AND deleted_at IS NULL').get(input.id) : null;
  if (!existing && !input.id && threadId) existing = db.prepare('SELECT * FROM mail_drafts WHERE thread_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1').get(threadId);
  const time = now();
  if (isEmpty(draft)) {
    if (existing) db.prepare('UPDATE mail_drafts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, existing.id);
    return null;
  }
  if (existing) {
    db.prepare('UPDATE mail_drafts SET updated_at = ?, account_id = ?, to_addrs = ?, cc_addrs = ?, subject = ?, body_text = ?, remind_days = ?, confirm = ? WHERE id = ?')
      .run(time, draft.account_id, draft.to, draft.cc, draft.subject, draft.body, draft.remind_days, draft.confirm, existing.id);
    return rowOf(db.prepare('SELECT * FROM mail_drafts WHERE id = ?').get(existing.id));
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO mail_drafts (id, created_at, updated_at, account_id, thread_id, to_addrs, cc_addrs, subject, body_text, remind_days, confirm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, draft.account_id, threadId, draft.to, draft.cc, draft.subject, draft.body, draft.remind_days, draft.confirm);
  return rowOf(db.prepare('SELECT * FROM mail_drafts WHERE id = ?').get(id));
}

export const listDrafts = (db, { account = '' } = {}) => db.prepare(`SELECT * FROM mail_drafts WHERE deleted_at IS NULL ${account ? 'AND account_id = ?' : ''}
  ORDER BY updated_at DESC, rowid DESC`).all(...(account ? [account] : [])).map(rowOf);

export function getDraft(db, id) {
  const row = db.prepare('SELECT * FROM mail_drafts WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw fail(404, 'That draft is not here any more.');
  return rowOf(row);
}

// Discard (and a send, which ends the draft the same way). Kept, with deleted_at, so Undo can bring it back.
export function discardDraft(db, id) {
  const done = db.prepare('UPDATE mail_drafts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), now(), id);
  if (!done.changes) throw fail(404, 'That draft is not here any more.');
  return { id, discarded: true };
}

export function restoreDraft(db, id) {
  const row = db.prepare('SELECT * FROM mail_drafts WHERE id = ?').get(id);
  if (!row) throw fail(404, 'No such draft.');
  db.prepare('UPDATE mail_drafts SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return rowOf(db.prepare('SELECT * FROM mail_drafts WHERE id = ?').get(id));
}
