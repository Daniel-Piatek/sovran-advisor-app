// Mail (the Mail module, advanced/mail/2): every message you ever got, as rows in this app's own database.
// Your whole history comes in once, from a Google Takeout .mbox read on this computer one message at a time:
//   Read once         the file is streamed through; it is never kept whole in memory, and never leaves this computer.
//   Safe to run twice every message keeps where it came from (source_key), so reading a file again, or a newer
//                     export that holds the same mail, adds only what is new. A message you deleted is still found.
//   Never edited      an imported message is what the file said; only labels and the like change later.
// Notes and mail live in one database but in their own tables, so they never mix by accident.

import crypto, { randomUUID } from 'node:crypto';
import { MboxSplitter, parseMessage, plainSubject, labelKind } from './mbox.js';
import { storeBuffer } from './files.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const FLUSH_MESSAGES = 200;
const FLUSH_BYTES = 8 * 1024 * 1024;

export const checkAccountEmail = (value) => {
  const email = String(value ?? '').trim();
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email) && email.length <= 254 ? email.toLowerCase() : null;
};

export function findOrCreateAccount(db, email) {
  const clean = checkAccountEmail(email);
  if (!clean) throw fail(400, 'Which address is this mail from? Give it as name@example.com.');
  const found = db.prepare('SELECT id FROM mail_accounts WHERE lower(email) = ?').get(clean);
  if (found) {
    db.prepare('UPDATE mail_accounts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(found.id);
    return found.id;
  }
  const id = randomUUID();
  const time = now();
  const google = db.prepare('SELECT id FROM google_accounts WHERE lower(email) = ? AND deleted_at IS NULL').get(clean);
  db.prepare('INSERT INTO mail_accounts (id, created_at, updated_at, email, google_account_id) VALUES (?, ?, ?, ?, ?)').run(id, time, time, clean, google?.id ?? null);
  return id;
}

// ---- Reading a file in ----

// push(chunk) with each piece of the file as it comes, then `await finish()`. Everything between two awaits is
// one short, synchronous step, so the app stays usable while a big file goes in and no transaction is ever left open.
// dataDir: where attachments are kept once in files (without it, only their names are kept).
export function mailImporter(db, { email, filename = '', size = 0, onProgress = () => {}, dataDir = null }) {
  const accountId = findOrCreateAccount(db, email);
  const time0 = now();
  const importId = randomUUID();
  db.prepare('INSERT INTO mail_imports (id, created_at, updated_at, origin, account_id, filename, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(importId, time0, time0, 'imported', accountId, filename.slice(0, 300), size);

  const stats = { read: 0, added: 0, already: 0, skipped: 0, bytes: 0, labels: {} };
  const touched = new Set();
  const seenLabels = new Set(db.prepare('SELECT lower(name) AS name FROM mail_labels WHERE account_id = ?').all(accountId).map((r) => r.name));
  const threadIds = new Map(); // source_key → thread id
  let pending = [];
  let pendingBytes = 0;
  let failed = false;

  const sql = {
    thread: db.prepare('SELECT id FROM mail_threads WHERE account_id = ? AND source_key = ?'),
    makeThread: db.prepare(`INSERT INTO mail_threads (id, created_at, updated_at, origin, account_id, source_key, gmail_thread_id, subject)
      VALUES (?, ?, ?, 'imported', ?, ?, ?, ?) ON CONFLICT (account_id, source_key) DO NOTHING`),
    replyTo: db.prepare('SELECT thread_id FROM mail_messages WHERE account_id = ? AND message_id = ? LIMIT 1'),
    message: db.prepare(`INSERT INTO mail_messages (id, created_at, updated_at, origin, account_id, thread_id, source_key, gmail_id, message_id, in_reply_to,
      subject, from_name, from_email, to_addrs, cc_addrs, sent_at, labels, body_text, snippet, attachments, attachment_files, size, bulk, list_unsubscribe, has_invite, body_html, invite_ics)
      VALUES (?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (account_id, source_key) DO NOTHING`),
    label: db.prepare("INSERT INTO mail_labels (id, created_at, updated_at, origin, account_id, name, kind) VALUES (?, ?, ?, 'imported', ?, ?, ?) ON CONFLICT DO NOTHING"),
    signals: db.prepare("UPDATE mail_messages SET bulk = ?, list_unsubscribe = ?, has_invite = ?, body_html = CASE WHEN body_html = '' THEN ? ELSE body_html END, invite_ics = CASE WHEN invite_ics = '' THEN ? ELSE invite_ics END WHERE account_id = ? AND source_key = ?"),
    fillFiles: db.prepare("UPDATE mail_messages SET attachment_files = ? WHERE account_id = ? AND source_key = ? AND attachment_files = '[]'"),
    progress: db.prepare(`UPDATE mail_imports SET updated_at = ?, messages_read = ?, messages_added = ?, messages_already = ?, messages_skipped = ? WHERE id = ?`),
  };

  function threadFor(m, sourceKey) {
    const key = m.gmailThreadId ? `g:${m.gmailThreadId}` : null;
    // Without Gmail's thread id: the thread of the message this one answers, if it is here, else a thread of its own.
    let found = key ? threadIds.get(key) ?? sql.thread.get(accountId, key)?.id : undefined;
    if (!found && !key) {
      for (const ref of [m.inReplyTo, ...[...m.references].reverse()].filter(Boolean)) {
        found = sql.replyTo.get(accountId, ref)?.thread_id;
        if (found) break;
      }
    }
    if (!found) {
      const threadKey = key ?? `t:${m.messageId || sourceKey}`;
      found = threadIds.get(threadKey) ?? sql.thread.get(accountId, threadKey)?.id;
      if (!found) {
        const id = randomUUID();
        const t = now();
        sql.makeThread.run(id, t, t, accountId, threadKey, m.gmailThreadId, plainSubject(m.subject));
        found = sql.thread.get(accountId, threadKey).id;
        threadIds.set(threadKey, found);
      }
      if (key) threadIds.set(key, found);
    }
    return found;
  }

  const keyOf = (m, raw) => (m.gmailId ? `g:${m.gmailId}` : m.messageId ? `m:${m.messageId}` : `h:${crypto.createHash('sha1').update(raw).digest('hex')}`);

  function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    pendingBytes = 0;
    db.exec('BEGIN');
    try {
      for (const { m, raw } of batch) {
        const sourceKey = keyOf(m, raw);
        const threadId = threadFor(m, sourceKey);
        const t = now();
        // Each attachment is kept once in the files, by its fingerprint; the same PDF twice is one file with two links.
        const kept = dataDir ? (m.files ?? []).map((f) => ({ f, row: storeBuffer(db, dataDir, f.data, { name: f.name, type: f.type }) }))
          .filter(({ row }) => row).map(({ f, row }) => ({ name: f.name, sha256: row.sha256, type: row.type, size: row.size })) : [];
        const done = sql.message.run(randomUUID(), t, t, accountId, threadId, sourceKey, m.gmailId, m.messageId, m.inReplyTo, m.subject, m.from.name, m.from.email,
          JSON.stringify(m.to), JSON.stringify(m.cc), m.sentAt, JSON.stringify(m.labels), m.text, m.snippet, JSON.stringify(m.attachments), JSON.stringify(kept), m.size, m.bulk ? 1 : 0, m.listUnsubscribe ? 1 : 0, m.hasInvite ? 1 : 0, m.html ?? '', m.calendar ?? '');
        if (done.changes) { stats.added++; touched.add(threadId); } else {
          stats.already++;
          sql.signals.run(m.bulk ? 1 : 0, m.listUnsubscribe ? 1 : 0, m.hasInvite ? 1 : 0, m.html ?? '', m.calendar ?? '', accountId, sourceKey); // read again: what the splits read is filled in
          if (kept.length) sql.fillFiles.run(JSON.stringify(kept), accountId, sourceKey); // a message read before its files were kept gets them now
        }
        for (const name of m.labels) {
          stats.labels[name] = (stats.labels[name] ?? 0) + 1;
          if (!seenLabels.has(name.toLowerCase())) {
            seenLabels.add(name.toLowerCase());
            sql.label.run(randomUUID(), t, t, accountId, name, labelKind(name));
          }
        }
      }
      sql.progress.run(now(), stats.read, stats.added, stats.already, stats.skipped, importId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    onProgress({ ...stats, labels: { ...stats.labels } });
  }

  const splitter = new MboxSplitter(({ fromLine, raw }) => {
    stats.read++;
    let m;
    try { m = parseMessage(raw, fromLine, { keepData: Boolean(dataDir) }); } catch { stats.skipped++; return; }
    queue(m, raw);
  });
  function queue(m, raw) {
    pending.push({ m, raw });
    pendingBytes += raw.length;
    if (pending.length >= FLUSH_MESSAGES || pendingBytes >= FLUSH_BYTES) flush();
  }

  const close = (status, problem = '') => {
    const t = now();
    db.prepare(`UPDATE mail_imports SET status = ?, problem = ?, updated_at = ?, finished_at = ?, messages_read = ?, messages_added = ?,
      messages_already = ?, messages_skipped = ? WHERE id = ?`).run(status, problem, t, t, stats.read, stats.added, stats.already, stats.skipped, importId);
  };

  const done = () => {
    close('done');
    onProgress({ ...stats, labels: { ...stats.labels } });
    return { import_id: importId, account_id: accountId, read: stats.read, added: stats.added, already_here: stats.already, skipped: stats.skipped, labels: stats.labels };
  };

  return {
    importId,
    accountId,
    stats,
    // A message already read into its parts (from Gmail's own API: its id, thread and labels are Gmail's, not the file's).
    pushParsed(m, raw) { stats.read++; queue(m, raw); },
    push(chunk) {
      stats.bytes += chunk.length;
      splitter.push(chunk);
    },
    // Every thread this file touched gets its count, dates, people and last words made again.
    async finish() {
      splitter.end();
      flush();
      const ids = [...touched];
      for (let i = 0; i < ids.length; i += 300) {
        db.exec('BEGIN');
        try { for (const id of ids.slice(i, i + 300)) summariseThread(db, id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
        await new Promise((resolve) => setImmediate(resolve));
      }
      return done();
    },
    // The same, without a pause (the demo copy, which fills a database in one go).
    finishNow() {
      splitter.end();
      flush();
      db.exec('BEGIN');
      try { for (const id of touched) summariseThread(db, id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
      return done();
    },
    // The file stopped coming (the page closed, the computer slept) or could not be read: what came in stays.
    stop(status, problem = '') {
      if (failed) return;
      failed = true;
      try { flush(); } catch { /* what is in is in */ }
      close(status, problem);
    },
  };
}

// A thread's subject, count, first and last day, people and last words, worked out from its messages.
export function summariseThread(db, id) {
  const rows = db.prepare(`SELECT subject, from_name, from_email, sent_at, snippet FROM mail_messages
    WHERE thread_id = ? AND deleted_at IS NULL ORDER BY sent_at IS NULL, sent_at, rowid`).all(id);
  if (!rows.length) { // every message of it is gone: the conversation goes too (marked deleted, never removed)
    db.prepare('UPDATE mail_threads SET deleted_at = ?, message_count = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), now(), id);
    return;
  }
  const people = [];
  for (const r of rows) {
    const who = r.from_name || r.from_email;
    if (who && !people.includes(who)) people.push(who);
  }
  const dated = rows.filter((r) => r.sent_at);
  db.prepare(`UPDATE mail_threads SET subject = ?, snippet = ?, participants = ?, message_count = ?, first_at = ?, last_at = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`)
    .run(plainSubject(rows[0].subject) || rows[0].subject, rows[rows.length - 1].snippet, JSON.stringify(people.slice(0, 6)), rows.length,
      dated[0]?.sent_at ?? null, dated[dated.length - 1]?.sent_at ?? null, now(), id);
}

// A whole file, in one go (the demo copy and tests): the same steps as a streamed one. A string is written as UTF-8,
// as a file would be; give a Buffer for any other bytes.
export function importMboxText(db, text, options) {
  const importer = mailImporter(db, options);
  importer.push(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'));
  return importer.finishNow();
}

// A file arriving as a stream (the page's upload): the same steps, piece by piece.
export async function importMboxStream(db, stream, options) {
  const importer = mailImporter(db, options);
  try {
    for await (const chunk of stream) importer.push(chunk);
    return await importer.finish();
  } catch (err) {
    importer.stop(err?.code === 'ECONNRESET' || err?.message === 'aborted' ? 'interrupted' : 'failed', err?.status ? err.message : 'The file could not be read to the end.');
    throw err;
  }
}

// An import still marked as under way when the app starts was cut off by a stop.
export function settleImports(db) {
  db.prepare("UPDATE mail_imports SET status = 'interrupted', updated_at = ? WHERE status = 'running'").run(now());
}

// ---- What is there ----

const parse = (text) => { try { return JSON.parse(text); } catch { return []; } };
const importOf = (r) => ({
  id: r.id, filename: r.filename, bytes: r.bytes, status: r.status, account: r.email, created_at: r.created_at, finished_at: r.finished_at,
  read: r.messages_read, added: r.messages_added, already_here: r.messages_already, skipped: r.messages_skipped, problem: r.problem,
});

// Totals, the labels with their counts, and the files read in.
export function mailOverview(db, { account = '' } = {}) {
  const where = account ? 'AND m.account_id = ?' : '';
  const args = account ? [account] : [];
  const messages = db.prepare(`SELECT count(*) AS n FROM mail_messages m WHERE m.deleted_at IS NULL ${where}`).get(...args).n;
  const threads = db.prepare(`SELECT count(*) AS n FROM mail_threads m WHERE m.deleted_at IS NULL ${where}`).get(...args).n;
  const labels = db.prepare(`SELECT j.value AS name, count(*) AS count FROM mail_messages m, json_each(m.labels) j
    WHERE m.deleted_at IS NULL ${where} GROUP BY j.value ORDER BY count(*) DESC, j.value`).all(...args)
    .map((r) => ({ name: r.name, count: r.count, kind: labelKind(r.name) }));
  const imports = db.prepare(`SELECT i.*, a.email FROM mail_imports i JOIN mail_accounts a ON a.id = i.account_id
    WHERE i.deleted_at IS NULL ${account ? 'AND i.account_id = ?' : ''} ORDER BY i.created_at DESC, i.rowid DESC LIMIT 20`).all(...args).map(importOf);
  const attached = db.prepare(`SELECT count(*) AS links, count(DISTINCT json_extract(j.value, '$.sha256')) AS files FROM mail_messages m, json_each(m.attachment_files) j
    WHERE m.deleted_at IS NULL ${where}`).get(...args);
  const accounts = db.prepare(`SELECT a.id, a.email, a.google_account_id, (SELECT count(*) FROM mail_messages m WHERE m.account_id = a.id AND m.deleted_at IS NULL) AS messages
    FROM mail_accounts a WHERE a.deleted_at IS NULL ORDER BY a.created_at, a.rowid`).all();
  return { messages, threads, labels, imports, accounts, attachments: { links: attached.links, files: attached.files } };
}

// A mail that is neither in Trash nor in Spam.
const OUTSIDE_TRASH = `m.labels NOT LIKE '%"Trash"%' AND m.labels NOT LIKE '%"Spam"%'`;

const threadOf = (r) => ({
  id: r.id, account: r.email, subject: r.subject, snippet: r.snippet, participants: parse(r.participants), message_count: r.message_count,
  first_at: r.first_at, last_at: r.last_at,
});

// Conversations, the latest first. label: only those with a message under it; q: words in the subject, the people or the last words.
export function listThreads(db, { account = '', label = '', q = '', before = '', limit = 50 } = {}) {
  const where = ['t.deleted_at IS NULL', `EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = t.id AND m.deleted_at IS NULL AND ${OUTSIDE_TRASH})`];
  const args = [];
  if (account) { where.push('t.account_id = ?'); args.push(account); }
  if (label) { where.push('EXISTS (SELECT 1 FROM mail_messages m, json_each(m.labels) j WHERE m.thread_id = t.id AND m.deleted_at IS NULL AND j.value = ?)'); args.push(label); }
  if (before) { where.push('t.last_at < ?'); args.push(before); }
  for (const word of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(lower(t.subject) LIKE ? ESCAPE '\\' OR lower(t.participants) LIKE ? ESCAPE '\\' OR lower(t.snippet) LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const n = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  return db.prepare(`SELECT t.*, a.email FROM mail_threads t JOIN mail_accounts a ON a.id = t.account_id
    WHERE ${where.join(' AND ')} ORDER BY t.last_at IS NULL, t.last_at DESC, t.rowid DESC LIMIT ?`).all(...args, n).map(threadOf);
}

// What you chose for a sender's images (Mail 7): sealed until you say so, and only for that sender.
export const imagesOk = (db, email) => db.prepare('SELECT load_images FROM mail_senders WHERE lower(email) = ? AND deleted_at IS NULL').get(String(email ?? '').toLowerCase())?.load_images === 1;
export function setImagesOk(db, email, on) {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw fail(400, 'A sender is an address, like name@example.com.');
  const t = now();
  db.prepare(`INSERT INTO mail_senders (id, created_at, updated_at, email, load_images) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (lower(email)) DO UPDATE SET load_images = excluded.load_images, updated_at = excluded.updated_at, deleted_at = NULL`).run(randomUUID(), t, t, clean, on ? 1 : 0);
  return { email: clean, load_images: Boolean(on) };
}
export const listSenders = (db) => db.prepare('SELECT email, load_images FROM mail_senders WHERE deleted_at IS NULL ORDER BY email').all().map((r) => ({ email: r.email, load_images: r.load_images === 1 }));

// One conversation with its messages, oldest first. A mail in Trash or Spam is not shown (deleted here, or in Gmail); a
// conversation with nothing else is not found.
export function getThread(db, id) {
  const row = db.prepare('SELECT t.*, a.email FROM mail_threads t JOIN mail_accounts a ON a.id = t.account_id WHERE t.id = ? AND t.deleted_at IS NULL').get(id);
  if (!row) return null;
  const messages = db.prepare(`SELECT * FROM mail_messages m WHERE thread_id = ? AND deleted_at IS NULL AND ${OUTSIDE_TRASH} ORDER BY sent_at IS NULL, sent_at, rowid`).all(id).map((m) => ({
    id: m.id, gmail_id: m.gmail_id, message_id: m.message_id, subject: m.subject, from: { name: m.from_name, email: m.from_email },
    to: parse(m.to_addrs), cc: parse(m.cc_addrs), sent_at: m.sent_at, labels: parse(m.labels), text: m.body_text, snippet: m.snippet,
    attachments: parse(m.attachments), attachment_files: parse(m.attachment_files), html: m.body_html, images_ok: imagesOk(db, m.from_email), origin: m.origin,
  }));
  if (!messages.length) return null;
  return { ...threadOf(row), messages };
}
