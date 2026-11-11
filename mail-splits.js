// The Mail app's splits (Mail 5): the Inbox of what others sent you, sorted into six by rules you can read.
//   Important   from someone in your People, and not a bulk mail
//   Calendar    it carries an invitation
//   Money       the subject says invoice, receipt or the like
//   Newsletters it has an unsubscribe link (or Gmail filed it under a Category)
//   Other       no rule matched
//   Done        nothing of it is in the Inbox any more (archived, or only what you sent)
// The rules are the list SPLITS, read from top to bottom, the first that matches wins: no model guesses behind your back, and
// the line over an open mail says which rule put it where it is. A conversation is sorted by its newest mail that is in the
// Inbox. Nothing is copied for the screen: it reads the same rows the import and the sync write.

const CATEGORY = /^category (promotions|updates|forums|social)$/i;
const hasLabel = (labels, name) => labels.some((l) => l.toLowerCase() === name.toLowerCase());

// `m` is a message row with its labels as a list and its address lower case; `known` is the set of addresses in People.
export const SPLITS = [
  { id: 'important', name: 'Important', rule: 'From someone in your People, and not a bulk mail.', when: (m, known) => known.has(m.from_email) && !m.bulk,
    why: (m) => `Important: from ${m.from_name || m.from_email}, who is in your People, and it is not a bulk mail.` },
  { id: 'calendar', name: 'Calendar', rule: 'It carries an invitation, or the subject says invitation.', when: (m) => Boolean(m.has_invite) || /\b(invitation|einladung)\b/i.test(m.subject),
    why: (m) => (m.has_invite ? 'Calendar: it carries an invitation.' : 'Calendar: the subject says invitation.') },
  { id: 'money', name: 'Money', rule: 'The subject says invoice, receipt or payment.', when: (m) => /invoice|receipt|rechnung|quittung|payment|zahlung/i.test(m.subject),
    why: () => 'Money: the subject says invoice, receipt or payment.' },
  { id: 'news', name: 'Newsletters', rule: 'It has an unsubscribe link, was sent to many, or Gmail filed it under a Category.', when: (m) => Boolean(m.list_unsubscribe) || m.labels.some((l) => CATEGORY.test(l)) || Boolean(m.bulk),
    why: (m) => (m.list_unsubscribe ? 'Newsletters: it has an unsubscribe link.' : m.bulk ? 'Newsletters: it was sent to many (a list or a bulk sender).' : `Newsletters: Gmail filed it under ${m.labels.find((l) => CATEGORY.test(l))}.`) },
  { id: 'other', name: 'Other', rule: 'No rule above matched.', when: () => true, why: () => 'Other: no rule matched.' },
];
export const DONE = { id: 'done', name: 'Done', rule: 'Nothing of it is in your Inbox any more (archived, or only what you sent).', why: () => 'Done: it is not in your Inbox any more.' };
// Drafts, Sent and Outbox are views beside the six, not splits: a conversation you wrote in is in Sent as well as wherever its Inbox mail is.
export const SENT = { id: 'sent', name: 'Sent', rule: 'Conversations you wrote in (Gmail’s Sent, or from your own address), the latest you sent first.' };
export const DRAFTS = { id: 'drafts', name: 'Drafts', rule: 'Mail you are writing, saved as you type, until you send or discard it (kept in this app only).' };
export const OUTBOX = { id: 'outbox', name: 'Outbox', rule: 'Mail not delivered yet: in its ten seconds, waiting for Send later, or failed; and changes Gmail did not take.' };
// Inbox (2026-11-11, the owner's wish): every conversation with mail in the Inbox, the five splits above together.
export const INBOX = { id: 'inbox', name: 'Inbox', rule: 'Every conversation with mail in your Inbox: Important, Calendar, Money, Newsletters and Other together.' };
export const SPLIT_IDS = [INBOX.id, ...SPLITS.map((s) => s.id), DONE.id, DRAFTS.id, SENT.id, OUTBOX.id];

export function classify(message, known) {
  for (const split of SPLITS) if (split.when(message, known)) return { split: split.id, why: split.why(message) };
  return { split: 'other', why: 'Other: no rule matched.' };
}

const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };

// The addresses in People (and Companies), lower case.
function knownAddresses(db) {
  const known = new Set();
  for (const table of ['people', 'companies']) {
    let rows = [];
    try { rows = db.prepare(`SELECT emails FROM ${table} WHERE deleted_at IS NULL AND emails <> ''`).all(); } catch { rows = []; }
    for (const { emails } of rows) for (const e of String(emails).toLowerCase().split(/[\s,;]+/)) if (e.includes('@')) known.add(e);
  }
  return known;
}

const messageRow = (m) => ({ ...m, labels: list(m.labels), from_email: String(m.from_email ?? '').toLowerCase() });

// Every conversation: its newest mail in the Inbox, which split it is in and why; counts per split. account: one account, or all.
export function inboxView(db, { account = '', split = 'inbox', limit = 50, before = '' } = {}) {
  const scope = account ? 'AND t.account_id = ?' : '';
  const args = account ? [account] : [];
  const threads = new Map(db.prepare(`SELECT t.id, t.account_id, a.email AS account_email, t.subject, t.snippet, t.participants, t.message_count, t.last_at
    FROM mail_threads t JOIN mail_accounts a ON a.id = t.account_id WHERE t.deleted_at IS NULL ${scope}`).all(...args).map((t) => [t.id, t]));
  const inbox = new Map(); // thread → its newest mail in the Inbox
  for (const m of db.prepare(`SELECT m.thread_id, m.id, m.from_name, m.from_email, m.subject, m.labels, m.bulk, m.list_unsubscribe, m.has_invite, m.sent_at, m.snippet
    FROM mail_messages m WHERE m.deleted_at IS NULL AND m.labels LIKE '%"Inbox"%' AND m.labels NOT LIKE '%"Trash"%' AND m.labels NOT LIKE '%"Spam"%' ORDER BY m.sent_at DESC, m.rowid DESC`).all()) {
    if (!inbox.has(m.thread_id) && threads.has(m.thread_id)) inbox.set(m.thread_id, messageRow(m));
  }
  const hidden = new Set(db.prepare(`SELECT DISTINCT thread_id FROM mail_messages WHERE deleted_at IS NULL AND (labels LIKE '%"Spam"%' OR labels LIKE '%"Trash"%')`).all().map((r) => r.thread_id));
  const known = knownAddresses(db);
  const counts = Object.fromEntries(SPLIT_IDS.map((id) => [id, 0]));
  const shown = [];
  // Sent: the time of your latest mail in each conversation (Gmail's Sent label or your own address), and replies sent from here
  // that the sync has not read back yet. A conversation in the Trash or Spam is in no view.
  const sentAt = new Map();
  const mark = (thread, at) => { if (threads.has(thread) && !hidden.has(thread) && at && !((sentAt.get(thread) ?? '') >= at)) sentAt.set(thread, at); };
  for (const r of db.prepare(`SELECT m.thread_id, max(m.sent_at) AS at FROM mail_messages m JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.deleted_at IS NULL AND (m.labels LIKE '%"Sent"%' OR lower(m.from_email) = lower(a.email)) GROUP BY m.thread_id`).all()) mark(r.thread_id, r.at);
  for (const r of db.prepare("SELECT thread_id, max(sent_at) AS at FROM mail_sends WHERE state = 'sent' AND deleted_at IS NULL AND thread_id IS NOT NULL GROUP BY thread_id").all()) mark(r.thread_id, r.at);
  counts.sent = sentAt.size;
  if (split === 'sent') {
    for (const [id, at] of sentAt) {
      const t = threads.get(id);
      if (before && !(at < before)) continue;
      shown.push({
        id, subject: t.subject, snippet: t.snippet, participants: list(t.participants), message_count: t.message_count, last_at: at,
        account: t.account_id, account_letter: (t.account_email[0] ?? '?').toUpperCase(), account_email: t.account_email,
        unread: false, split: 'sent', why: SENT.rule,
      });
    }
  }
  for (const [id, t] of threads) {
    if (hidden.has(id) && !inbox.has(id)) continue;
    const m = inbox.get(id);
    const verdict = m ? classify(m, known) : { split: 'done', why: DONE.why() };
    counts[verdict.split]++;
    if (m) counts.inbox++;
    if (split === 'inbox' ? !m : verdict.split !== split) continue;
    if (before && !(t.last_at < before)) continue;
    shown.push({
      id, subject: t.subject, snippet: t.snippet, participants: list(t.participants), message_count: t.message_count, last_at: t.last_at,
      account: t.account_id, account_letter: (t.account_email[0] ?? '?').toUpperCase(), account_email: t.account_email,
      unread: Boolean(m && m.labels.some((l) => l.toLowerCase() === 'unread')), split: verdict.split, why: verdict.why,
    });
  }
  shown.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return { counts, threads: shown.slice(0, Math.max(1, Math.min(200, Math.trunc(limit) || 50))), more: shown.length > limit };
}

// Why one conversation is where it is (for the line over an open mail).
export function explainThread(db, threadId) {
  // (A conversation opened from Sent still says where its Inbox mail is: Sent is a view beside the splits.)
  const row = db.prepare(`SELECT m.id, m.from_name, m.from_email, m.subject, m.labels, m.bulk, m.list_unsubscribe, m.has_invite FROM mail_messages m
    WHERE m.thread_id = ? AND m.deleted_at IS NULL AND m.labels LIKE '%"Inbox"%' AND m.labels NOT LIKE '%"Trash"%' AND m.labels NOT LIKE '%"Spam"%' ORDER BY m.sent_at DESC, m.rowid DESC LIMIT 1`).get(threadId);
  if (!row) return { split: 'done', why: DONE.why() };
  return classify(messageRow(row), knownAddresses(db));
}

export const describeSplits = () => [INBOX, ...SPLITS, DONE, DRAFTS, SENT, OUTBOX].map(({ id, name, rule }) => ({ id, name, rule }));
