// Gmail (the Mail module, advanced/mail/3): the part of the app that talks to Gmail's own API, through the Google sign-in
// of google.js and only while "Read your mail" is switched on for that account. Two jobs, both read only:
//   Fill   everything newer than the export: Gmail's list of messages, each one not here yet read whole (`format=raw`), read
//          into its parts like a mailbox file, with Gmail's own id, thread and labels. Matched by Gmail's id: nothing
//          already kept is read twice, so running it twice adds nothing.
//   Count  for every label Gmail's own number next to the number of rows kept here, "Equal" when they are the same.
// Nothing is ever written to Gmail by this file.

import { accessToken } from './google.js';
import { mailImporter } from './mail.js';
import { parseMessage } from './mbox.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const apiBase = (env = process.env) => String(env.GMAIL_API_URL || 'https://gmail.googleapis.com/gmail/v1').replace(/\/+$/, '');

// How Gmail's label ids are named here, as Google Takeout names them: INBOX → Inbox, CATEGORY_PROMOTIONS → Category Promotions.
export function labelName(label) {
  if (label.type === 'system' || !label.name) return String(label.id).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return label.name;
}

// The account to read: this app's mail account, its Google sign-in, and the proof "Read your mail" is on.
export function readableAccount(db, mailAccountId) {
  const mail = db.prepare('SELECT * FROM mail_accounts WHERE id = ? AND deleted_at IS NULL').get(mailAccountId);
  if (!mail) throw fail(404, 'No such mail account.');
  const google = mail.google_account_id ? db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(mail.google_account_id) : null;
  if (!google) throw fail(409, `${mail.email} is not signed in with Google. Sign in under Settings › Google first.`, 'no_google');
  let enabled = [];
  try { enabled = JSON.parse(google.enabled); } catch { /* none */ }
  if (!enabled.includes('mail.read')) throw fail(409, 'Switch on “Read your mail” for this account under Settings › Google first.', 'switched_off');
  return { mail, google };
}

export function canRead(db, mailAccountId) {
  try { readableAccount(db, mailAccountId); return true; } catch { return false; }
}

export function client(db, keyStore, googleId, { env, fetcher, why, permission = 'mail.read' }) {
  const call = async (method, pathAndQuery, body) => {
    const token = await accessToken(db, keyStore, { id: googleId, permission, why }, { env, fetcher });
    let res;
    try {
      res = await fetcher(`${apiBase(env)}${pathAndQuery}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw fail(502, 'Gmail could not be reached. Is this computer online?', 'unreachable'); }
    if (res.status === 404) throw fail(404, 'Gmail has no such thing (any more).', 'not_found');
    if (!res.ok) throw fail(res.status === 401 || res.status === 403 ? 409 : 502, `Gmail said no (${res.status}).`, 'refused');
    return res.json();
  };
  return { get: (pathAndQuery) => call('GET', pathAndQuery), post: (pathAndQuery, body) => call('POST', pathAndQuery, body) };
}

const fromBase64Url = (text) => Buffer.from(String(text ?? ''), 'base64url');

// Reads these messages whole from Gmail and gives them to an importer: Gmail's own id, thread and labels, the rest read like a mailbox file.
// A message Gmail no longer has (deleted after it was listed: 404) is skipped, so one gone mail never stops the rest.
export async function readMessages(gmail, ids, names, importer, { dataDir = null, concurrency = 4 } = {}) {
  const gone = (err) => { if (err.code === 'not_found') return null; throw err; };
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = (await Promise.all(ids.slice(i, i + concurrency).map((id) => gmail.get(`/users/me/messages/${id}?format=raw`).catch(gone)))).filter(Boolean);
    for (const message of batch) {
      const raw = fromBase64Url(message.raw).toString('latin1');
      const m = parseMessage(raw, '', { keepData: Boolean(dataDir) });
      m.gmailId = message.id;
      m.gmailThreadId = message.threadId ?? '';
      m.labels = (message.labelIds ?? []).map((id) => names.get(id) ?? id);
      if (!m.sentAt && message.internalDate) m.sentAt = new Date(Number(message.internalDate)).toISOString();
      importer.pushParsed(m, raw);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Fill: everything newer than what is kept. A day of overlap is asked for, and the ids already here are skipped.
// everything: ask for Gmail's whole list, not only what is newer (to close a hole the count check found); ids already here are skipped all the same.
export async function fillFromGmail(db, keyStore, { mailAccountId, dataDir = null, env = process.env, fetcher = fetch, onProgress = () => {}, concurrency = 4, everything = false }) {
  const { mail, google } = readableAccount(db, mailAccountId);
  const gmail = client(db, keyStore, google.id, { env, fetcher, why: 'Fill from Gmail' });
  const names = new Map();
  for (const label of (await gmail.get('/users/me/labels')).labels ?? []) names.set(label.id, labelName(label));

  const newest = db.prepare('SELECT max(sent_at) AS at FROM mail_messages WHERE account_id = ?').get(mailAccountId).at;
  const after = newest && !everything ? Math.floor(new Date(newest).getTime() / 1000) - 86_400 : null;
  const known = db.prepare('SELECT 1 FROM mail_messages WHERE account_id = ? AND source_key = ?');
  const importer = mailImporter(db, { email: mail.email, filename: 'Fill from Gmail', size: 0, onProgress, dataDir });

  try {
    const wanted = [];
    let token = '';
    do {
      const query = new URLSearchParams({ maxResults: '100', includeSpamTrash: 'true', ...(after ? { q: `after:${after}` } : {}), ...(token ? { pageToken: token } : {}) });
      const page = await gmail.get(`/users/me/messages?${query}`);
      for (const m of page.messages ?? []) if (!known.get(mailAccountId, `g:${m.id}`)) wanted.push(m.id);
      token = page.nextPageToken ?? '';
    } while (token);

    await readMessages(gmail, wanted, names, importer, { dataDir, concurrency });
    return { ...(await importer.finish()), asked: wanted.length };
  } catch (err) {
    importer.stop('failed', err.status ? err.message : 'The fill stopped half way.');
    throw err;
  }
}

// The count check: for each label Gmail's own count next to this app's, and the whole mailbox.
export async function countCheck(db, keyStore, { mailAccountId, env = process.env, fetcher = fetch }) {
  const { google } = readableAccount(db, mailAccountId);
  const gmail = client(db, keyStore, google.id, { env, fetcher, why: 'Count check' });
  const ours = new Map(db.prepare(`SELECT j.value AS name, count(*) AS n FROM mail_messages m, json_each(m.labels) j
    WHERE m.account_id = ? AND m.deleted_at IS NULL GROUP BY j.value`).all(mailAccountId).map((r) => [r.name.toLowerCase(), r.n]));
  const rows = [];
  const seen = new Set();
  for (const listed of (await gmail.get('/users/me/labels')).labels ?? []) {
    const label = await gmail.get(`/users/me/labels/${encodeURIComponent(listed.id)}`);
    const name = labelName(label);
    const theirs = label.messagesTotal ?? 0;
    const mine = ours.get(name.toLowerCase()) ?? 0;
    seen.add(name.toLowerCase());
    if (!theirs && !mine) continue;
    rows.push({ label: name, gmail: theirs, ours: mine, equal: theirs === mine, to_fill: Math.max(0, theirs - mine) });
  }
  for (const [name, n] of ours) if (!seen.has(name)) rows.push({ label: name, gmail: 0, ours: n, equal: false, to_fill: 0, only_here: true });
  const profile = await gmail.get('/users/me/profile');
  const total = db.prepare('SELECT count(*) AS n FROM mail_messages WHERE account_id = ? AND deleted_at IS NULL').get(mailAccountId).n;
  rows.sort((a, b) => b.gmail - a.gmail || a.label.localeCompare(b.label));
  return {
    checked_at: new Date().toISOString(), rows, equal: rows.every((r) => r.equal),
    total: { gmail: profile.messagesTotal ?? 0, ours: total, equal: (profile.messagesTotal ?? 0) === total },
  };
}
