// Live with Gmail (the Mail module, advanced/mail/4): the archive stays current while this computer is awake.
//   Gmail's changes in   a job asks Gmail what changed since the last time (its history, by id): new messages, labels added or
//                        removed, messages deleted. The new history id is saved LAST, so a stop half way just repeats.
//   Your changes out     archive, star, a label: the list changes at once, the change is first a row in mail_outbox, and only then
//                        a call to Gmail (needs "Change your mail in Gmail" on). Nothing is lost when the network is gone.
//   Both changed it      a label changed here and a different one changed in Gmail: both are kept. The same label changed on both
//                        sides before it was sent: Gmail's change, seen later, wins and ours is marked skipped.
// A change that comes back from Gmail is the one this app just sent: it finds the label already there and changes nothing.
// It runs only for an account switched to Live, only with Mail on, and only with "Read your mail" on.

import { randomUUID } from 'node:crypto';
import { mailImporter, summariseThread } from './mail.js';
import { client, readableAccount, labelName, readMessages } from './gmail.js';
import { moduleOn } from './modules.js';
import { logGoogle } from './google.js';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const has = (labels, name) => labels.some((l) => same(l, name));

export function setLive(db, mailAccountId, on) {
  const row = db.prepare('SELECT id FROM mail_accounts WHERE id = ? AND deleted_at IS NULL').get(mailAccountId);
  if (!row) throw fail(404, 'No such mail account.');
  db.prepare('UPDATE mail_accounts SET live = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, now(), mailAccountId);
  return syncState(db, mailAccountId);
}

export function syncState(db, mailAccountId) {
  const a = db.prepare('SELECT live, history_id, synced_at, sync_error FROM mail_accounts WHERE id = ?').get(mailAccountId);
  const waiting = db.prepare("SELECT count(*) AS n FROM mail_outbox WHERE account_id = ? AND state = 'waiting'").get(mailAccountId).n;
  return { live: a?.live === 1, started: Boolean(a?.history_id), synced_at: a?.synced_at ?? null, sync_error: a?.sync_error ?? '', waiting };
}

// ---- Your changes: the row, then Gmail ----

// A change to a mail's labels, made here. The list changes at once; the change waits in the outbox (one row per mail while it waits:
// archive and then un-archive is nothing to send).
export function changeLabels(db, messageRowId, { add = [], remove = [] }) {
  const message = db.prepare('SELECT * FROM mail_messages WHERE id = ? AND deleted_at IS NULL').get(messageRowId);
  if (!message) throw fail(404, 'No such mail.');
  const clean = (names) => [...new Set((Array.isArray(names) ? names : []).map((n) => String(n).trim()).filter(Boolean))];
  const labels = list(message.labels);
  const adding = clean(add).filter((n) => !has(labels, n));
  const removing = clean(remove).filter((n) => has(labels, n));
  if (!adding.length && !removing.length) return { message: rowOf(message), changed: false };
  const next = [...labels.filter((l) => !removing.some((r) => same(r, l))), ...adding];
  const time = now();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE mail_messages SET labels = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), time, message.id);
    const waiting = message.gmail_id ? db.prepare("SELECT * FROM mail_outbox WHERE message_id = ? AND state = 'waiting' ORDER BY created_at LIMIT 1").get(message.id) : null;
    let addL = adding;
    let remL = removing;
    if (waiting) { // merged into the one waiting: a label added and then removed is nothing to send
      const wa = list(waiting.add_labels).filter((l) => !remL.some((r) => same(r, l)));
      const wr = list(waiting.remove_labels).filter((l) => !addL.some((a) => same(a, l)));
      addL = [...wa, ...addL.filter((l) => !list(waiting.remove_labels).some((r) => same(r, l)))];
      remL = [...wr, ...remL.filter((l) => !list(waiting.add_labels).some((a) => same(a, l)))];
      if (!addL.length && !remL.length) {
        db.prepare("UPDATE mail_outbox SET state = 'skipped', problem = 'Undone before it was sent.', add_labels = '[]', remove_labels = '[]', updated_at = ? WHERE id = ?").run(time, waiting.id);
      } else db.prepare('UPDATE mail_outbox SET add_labels = ?, remove_labels = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(addL), JSON.stringify(remL), time, waiting.id);
    } else if (message.gmail_id) { // a mail with no Gmail id (it did not come from Gmail) is changed here only
      db.prepare('INSERT INTO mail_outbox (id, created_at, updated_at, account_id, message_id, gmail_id, add_labels, remove_labels) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), time, time, message.account_id, message.id, message.gmail_id, JSON.stringify(addL), JSON.stringify(remL));
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { message: rowOf(db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(message.id)), changed: true };
}

// Done (e): every mail of the conversation that is in the Inbox leaves it, each as a change for the outbox. Returns the mails changed,
// so Undo can put exactly those back.
export function archiveThread(db, threadId) {
  const rows = db.prepare(`SELECT id FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL AND labels LIKE '%"Inbox"%'`).all(threadId);
  if (!db.prepare('SELECT 1 FROM mail_threads WHERE id = ? AND deleted_at IS NULL').get(threadId)) throw fail(404, 'No such conversation.');
  for (const { id } of rows) changeLabels(db, id, { remove: ['Inbox'] });
  return { messages: rows.map((r) => r.id) };
}

export function restoreToInbox(db, messageIds) {
  for (const id of (Array.isArray(messageIds) ? messageIds : []).slice(0, 500)) {
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) { try { changeLabels(db, id, { add: ['Inbox'] }); } catch { /* gone */ } }
  }
  return { messages: messageIds };
}

// Delete (#): every mail of the conversation goes to Gmail's Trash (Trash added, Inbox taken away), each as a change for the
// outbox. Never deleted for good: Gmail keeps its Trash for 30 days, and the row here is only hidden. Returns the mails changed
// and which of them were in the Inbox, so Undo puts back exactly what was there.
export function trashThread(db, threadId) {
  if (!db.prepare('SELECT 1 FROM mail_threads WHERE id = ? AND deleted_at IS NULL').get(threadId)) throw fail(404, 'No such conversation.');
  const rows = db.prepare(`SELECT id, labels FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL AND labels NOT LIKE '%"Trash"%'`).all(threadId);
  const inbox = rows.filter((r) => has(list(r.labels), 'Inbox')).map((r) => r.id);
  for (const { id } of rows) changeLabels(db, id, { add: ['Trash'], remove: ['Inbox'] });
  return { messages: rows.map((r) => r.id), inbox };
}

export function restoreFromTrash(db, messageIds, inboxIds = []) {
  const ok = (id) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
  const inbox = new Set((Array.isArray(inboxIds) ? inboxIds : []).filter(ok));
  for (const id of (Array.isArray(messageIds) ? messageIds : []).slice(0, 500)) {
    if (ok(id)) { try { changeLabels(db, id, { remove: ['Trash'], add: inbox.has(id) ? ['Inbox'] : [] }); } catch { /* gone */ } }
  }
  return { messages: messageIds };
}

const rowOf = (m) => ({ id: m.id, subject: m.subject, labels: list(m.labels), gmail_id: m.gmail_id });

export function listOutbox(db, { account = '', limit = 20 } = {}) {
  return db.prepare(`SELECT o.*, m.subject FROM mail_outbox o JOIN mail_messages m ON m.id = o.message_id
    WHERE o.deleted_at IS NULL ${account ? 'AND o.account_id = ?' : ''} ORDER BY o.created_at DESC, o.rowid DESC LIMIT ?`)
    .all(...(account ? [account] : []), Math.max(1, Math.min(100, Math.trunc(limit) || 20)))
    .map((o) => ({ id: o.id, subject: o.subject, add: list(o.add_labels), remove: list(o.remove_labels), state: o.state, tries: o.tries, sent_at: o.sent_at, problem: o.problem, created_at: o.created_at }));
}

// ---- One round: Gmail's changes in, then yours out ----

export async function syncOnce(db, keyStore, { mailAccountId, dataDir = null, env = process.env, fetcher = fetch }) {
  const { mail, google } = readableAccount(db, mailAccountId);
  const read = client(db, keyStore, google.id, { env, fetcher, why: 'Live sync' });
  const result = { baseline: false, added: 0, label_changes: 0, deleted: 0, sent: 0, waiting: 0, skipped: 0, problem: '' };
  try {
    const labelList = (await read.get('/users/me/labels')).labels ?? [];
    const names = new Map(labelList.map((l) => [l.id, labelName(l)]));
    const ids = new Map(labelList.map((l) => [labelName(l).toLowerCase(), l.id]));

    if (!mail.history_id) { // the first round only notes where Gmail is now: the fill has the rest
      result.baseline = true;
      const profile = await read.get('/users/me/profile');
      db.prepare('UPDATE mail_accounts SET history_id = ?, synced_at = ?, sync_error = ?, updated_at = ? WHERE id = ?').run(String(profile.historyId ?? ''), now(), '', now(), mailAccountId);
    } else {
      const entries = [];
      let token = '';
      let latest = mail.history_id;
      try {
        do {
          const query = new URLSearchParams({ startHistoryId: mail.history_id, maxResults: '100', ...(token ? { pageToken: token } : {}) });
          const page = await read.get(`/users/me/history?${query}`);
          entries.push(...(page.history ?? []));
          if (page.historyId) latest = String(page.historyId);
          token = page.nextPageToken ?? '';
        } while (token);
      } catch (err) {
        if (err.code === 'not_found') {
          db.prepare("UPDATE mail_accounts SET history_id = NULL, sync_error = ?, updated_at = ? WHERE id = ?").run('Gmail no longer has the history since the last sync. Use Fill what is missing, then sync again.', now(), mailAccountId);
          throw fail(409, 'Gmail no longer has the history since the last sync. Use Fill what is missing, then sync again.', 'history_gone');
        }
        throw err;
      }
      applyHistory(db, keyStore, { mail, entries, names, read, dataDir, result });
      await result.pending; // new messages are read whole
      db.prepare('UPDATE mail_accounts SET history_id = ?, synced_at = ?, sync_error = ?, updated_at = ? WHERE id = ?').run(latest, now(), '', now(), mailAccountId); // saved last
    }
    await sendOutbox(db, keyStore, { mail, google, ids, env, fetcher, result });
    db.prepare('UPDATE mail_accounts SET synced_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), mailAccountId);
  } catch (err) {
    db.prepare('UPDATE mail_accounts SET sync_error = ?, updated_at = ? WHERE id = ?').run(err.status ? err.message : 'The sync stopped half way.', now(), mailAccountId);
    throw err;
  }
  result.waiting = db.prepare("SELECT count(*) AS n FROM mail_outbox WHERE account_id = ? AND state = 'waiting'").get(mailAccountId).n;
  return result;
}

// Gmail's history, applied to the rows. A label Gmail changed that we also changed (not sent yet): Gmail's, seen later, wins.
function applyHistory(db, keyStore, { mail, entries, names, read, dataDir, result }) {
  const find = db.prepare('SELECT * FROM mail_messages WHERE account_id = ? AND source_key = ?');
  const added = [];
  const setLabels = (row, labels) => db.prepare('UPDATE mail_messages SET labels = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(labels), now(), row.id);
  const yield_ = (row, changed) => { // our waiting change on a label Gmail changed too: drop that label from it
    const waiting = db.prepare("SELECT * FROM mail_outbox WHERE message_id = ? AND state = 'waiting'").get(row.id);
    if (!waiting) return;
    const keep = (l) => !changed.some((c) => same(c, l));
    const addL = list(waiting.add_labels).filter(keep);
    const remL = list(waiting.remove_labels).filter(keep);
    if (addL.length === list(waiting.add_labels).length && remL.length === list(waiting.remove_labels).length) return;
    if (!addL.length && !remL.length) {
      db.prepare("UPDATE mail_outbox SET state = 'skipped', problem = 'Gmail changed the same label later: its change won.', add_labels = '[]', remove_labels = '[]', updated_at = ? WHERE id = ?").run(now(), waiting.id);
      result.skipped++;
    } else db.prepare('UPDATE mail_outbox SET add_labels = ?, remove_labels = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(addL), JSON.stringify(remL), now(), waiting.id);
  };
  const recent = new Date(Date.now() - 10 * 60_000).toISOString();
  const echoOf = (messageRowId, kind, touched) => db.prepare("SELECT add_labels, remove_labels FROM mail_outbox WHERE message_id = ? AND state = 'sent' AND sent_at >= ?").all(messageRowId, recent)
    .some((o) => touched.every((t) => has(list(kind === 'add' ? o.add_labels : o.remove_labels), t)));
  for (const entry of entries) {
    for (const { message } of entry.messagesAdded ?? []) if (message?.id && !find.get(mail.id, `g:${message.id}`) && !added.includes(message.id)) added.push(message.id);
    for (const [kind, key] of [['add', 'labelsAdded'], ['remove', 'labelsRemoved']]) {
      for (const change of entry[key] ?? []) {
        const row = find.get(mail.id, `g:${change.message?.id}`);
        if (!row || row.deleted_at) continue;
        const touched = (change.labelIds ?? []).map((id) => names.get(id) ?? id);
        let labels = list(row.labels);
        const before = JSON.stringify(labels);
        labels = kind === 'add' ? [...labels, ...touched.filter((n) => !has(labels, n))] : labels.filter((l) => !touched.some((t) => same(t, l)));
        // What Gmail reports back of a change this app sent a moment ago is that change coming home: it is not Gmail's own.
        if (!echoOf(row.id, kind, touched)) yield_(row, touched);
        if (JSON.stringify(labels) !== before) { setLabels(row, labels); result.label_changes++; }
      }
    }
    for (const { message } of entry.messagesDeleted ?? []) {
      const row = find.get(mail.id, `g:${message?.id}`);
      if (row && !row.deleted_at) { db.prepare('UPDATE mail_messages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id); summariseThread(db, row.thread_id); result.deleted++; }
    }
  }
  if (added.length) {
    const importer = mailImporter(db, { email: mail.email, filename: 'Live sync', size: 0, dataDir });
    result.pending = readMessages(read, added, names, importer, { dataDir }).then(async () => { const done = await importer.finish(); result.added = done.added; });
  }
}

// What waits, to Gmail: one call per mail, with label ids. Needs "Change your mail in Gmail"; without it everything stays waiting.
async function sendOutbox(db, keyStore, { mail, google, ids, env, fetcher, result }) {
  const waiting = db.prepare("SELECT * FROM mail_outbox WHERE account_id = ? AND state = 'waiting' ORDER BY created_at, rowid").all(mail.id);
  if (!waiting.length) return;
  let enabled = [];
  try { enabled = JSON.parse(google.enabled); } catch { /* none */ }
  if (!enabled.includes('mail.modify')) { result.problem = 'Switch on “Change your mail in Gmail” under Settings › Google to send what you changed here.'; return; }
  const write = client(db, keyStore, google.id, { env, fetcher, why: 'Live sync (your changes)', permission: 'mail.modify' });
  for (const row of waiting) {
    const idOf = (name) => ids.get(name.toLowerCase());
    const addL = list(row.add_labels);
    const remL = list(row.remove_labels);
    const unknown = [...addL, ...remL].find((n) => !same(n, 'Trash') && !idOf(n));
    if (unknown) {
      db.prepare("UPDATE mail_outbox SET state = 'failed', problem = ?, tries = tries + 1, updated_at = ? WHERE id = ?").run(`Gmail has no label called “${unknown}”.`, now(), row.id);
      continue;
    }
    try {
      // Trash goes by Gmail's own trash and untrash (never a delete for good); every other label by modify.
      const trash = (names) => names.some((n) => same(n, 'Trash'));
      if (trash(addL)) await write.post(`/users/me/messages/${row.gmail_id}/trash`, {});
      if (trash(remL)) await write.post(`/users/me/messages/${row.gmail_id}/untrash`, {});
      const restAdd = addL.filter((n) => !same(n, 'Trash'));
      const restRem = remL.filter((n) => !same(n, 'Trash'));
      if (restAdd.length || restRem.length) await write.post(`/users/me/messages/${row.gmail_id}/modify`, { addLabelIds: restAdd.map(idOf), removeLabelIds: restRem.map(idOf) });
      db.prepare("UPDATE mail_outbox SET state = 'sent', sent_at = ?, tries = tries + 1, problem = '', updated_at = ? WHERE id = ?").run(now(), now(), row.id);
      logGoogle(db, google.id, `Mail change sent to Gmail for ${mail.email}: ${[...addL.map((l) => `+${l}`), ...remL.map((l) => `-${l}`)].join(' ')}.`);
      result.sent++;
    } catch (err) {
      if (err.code === 'unreachable') { db.prepare('UPDATE mail_outbox SET tries = tries + 1, problem = ?, updated_at = ? WHERE id = ?').run('Waiting for the network.', now(), row.id); break; }
      db.prepare("UPDATE mail_outbox SET state = 'failed', tries = tries + 1, problem = ?, updated_at = ? WHERE id = ?").run(err.status ? err.message : 'Gmail did not take it.', now(), row.id);
    }
  }
}

// ---- The job ----

// Every `every` ms, for each account switched to Live (and only while Mail is on): one round. After the computer sleeps the first
// round catches up once. `tick()` runs a round by hand.
export function startMailSync(db, keyStore, { dataDir, env, fetcher, every = 20_000 }) {
  let running = false;
  const tick = async () => {
    if (running || !moduleOn(db, 'mail')) return;
    running = true;
    try {
      for (const a of db.prepare('SELECT id FROM mail_accounts WHERE live = 1 AND deleted_at IS NULL').all()) {
        try { await syncOnce(db, keyStore, { mailAccountId: a.id, dataDir, env, fetcher }); } catch { /* said on the account: sync_error */ }
      }
    } finally { running = false; }
  };
  const timer = every ? setInterval(tick, every) : null;
  timer?.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

// The Outbox's label changes: those that failed, and those waiting longer than a couple of minutes (a waiting change normally goes
// within one round, so only a stuck one is worth a line).
export function pendingChanges(db, { account = '', stuckAfterMs = 120_000, at = new Date() } = {}) {
  const since = new Date(at.getTime() - stuckAfterMs).toISOString();
  return db.prepare(`SELECT o.*, m.subject, m.thread_id FROM mail_outbox o JOIN mail_messages m ON m.id = o.message_id
    WHERE o.deleted_at IS NULL AND (o.state = 'failed' OR (o.state = 'waiting' AND o.created_at <= ?)) ${account ? 'AND o.account_id = ?' : ''}
    ORDER BY o.created_at, o.rowid`).all(since, ...(account ? [account] : []))
    .map((o) => ({ id: o.id, subject: o.subject, thread_id: o.thread_id, add: list(o.add_labels), remove: list(o.remove_labels), state: o.state, tries: o.tries, problem: o.problem, created_at: o.created_at }));
}

// Try a failed change again (the next round sends it), or let it go: skipped, as when Gmail's own change won. Gmail is not touched.
export function retryMailChange(db, id) {
  const done = db.prepare("UPDATE mail_outbox SET state = 'waiting', problem = '', updated_at = ? WHERE id = ? AND state = 'failed'").run(now(), id);
  if (!done.changes) throw fail(409, 'Only a change that failed can be tried again.', 'not_failed');
  return { id, state: 'waiting' };
}
export function dismissMailChange(db, id) {
  const done = db.prepare("UPDATE mail_outbox SET state = 'skipped', problem = 'Let go here.', updated_at = ? WHERE id = ? AND state IN ('failed', 'waiting')").run(now(), id);
  if (!done.changes) throw fail(409, 'That change is not waiting any more.', 'not_waiting');
  return { id, state: 'skipped' };
}
