// Read confirmations, honestly (the Mail module, advanced/mail/9). A confirmation is a one-pixel picture in the mail you send. When the
// other side's mail app fetches it, this app learns that SOMETHING opened the mail. That is all it can know, so it says "Opened", never "Read".
//   Off by default      you switch it on in the composer for one mail; the choice is remembered per person. It never switches itself on
//                       (in Germany a read confirmation needs the other person's consent).
//   Not counted         a fetch within thirty seconds of sending, or by a known mail scanner or privacy proxy, is listed with the time and the
//                       reason, but is not an open.
//   One public address  GET /o/<token>.gif is the only part of this app anything outside is meant to reach. It looks the token up, writes a
//                       row, and returns the pixel: nothing else, and it answers the same picture for a token it does not know.
// The mail needs a public address to put in the picture (Settings: the address of this app as the other side can reach it). This app
// answers only this computer, so with no address set the switch is off and says why.

import { randomBytes, randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const BASE_SETTING = 'mail.pixel_base';
export const EARLY_SECONDS = 30;

// A 1 x 1 transparent GIF.
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export const pixelPath = (token) => `/o/${token}.gif`;
export const newToken = () => randomBytes(18).toString('base64url');

// ---- The address ----

export function pixelBase(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(BASE_SETTING);
  try { return JSON.parse(row?.value ?? 'null') || ''; } catch { return ''; }
}

// The address of this app as the other side can reach it: https, or this computer itself (for trying it). No path, no query.
export function setPixelBase(db, value) {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (text && !/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(text)) throw fail(400, 'Give the address as https://your-name.example (no path), the way the other side can reach this app.');
  const t = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`).run(randomUUID(), t, t, BASE_SETTING, JSON.stringify(text));
  return { base: text };
}

// ---- Per person ----

export const rememberPeople = (db, emails, on) => {
  const t = now();
  for (const e of emails) {
    db.prepare(`INSERT INTO mail_confirm_people (id, created_at, updated_at, email, confirm) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (lower(email)) DO UPDATE SET confirm = excluded.confirm, updated_at = excluded.updated_at, deleted_at = NULL`).run(randomUUID(), t, t, String(e).toLowerCase(), on ? 1 : 0);
  }
};
// On for a mail only when every person it goes to was chosen before; otherwise off.
export const defaultFor = (db, emails) => emails.length > 0 && emails.every((e) => db.prepare('SELECT confirm FROM mail_confirm_people WHERE lower(email) = ? AND deleted_at IS NULL').get(String(e).toLowerCase())?.confirm === 1);
export const listPeople = (db) => db.prepare('SELECT email, confirm FROM mail_confirm_people WHERE deleted_at IS NULL ORDER BY email').all().map((r) => ({ email: r.email, confirm: r.confirm === 1 }));

// ---- The picture, and what a fetch of it means ----

// Mail scanners and privacy proxies fetch every picture on arrival, long before a person looks: listed, never counted.
const SCANNERS = /proofpoint|mimecast|barracuda|symantec|forcepoint|trend ?micro|mailscanner|safelinks|messagelabs|fireeye|cisco|sophos|kaspersky|avanan|bot\b|crawl|spider|preview|python-requests|curl\/|wget|java\/|go-http-client|libwww|headless/i;
const PROXIES = /googleimageproxy|yahoomailproxy|ggpht|apple ?mail ?privacy|mail ?privacy ?protection/i;

export function classifyOpen({ userAgent = '', sentAt, at = new Date() }) {
  if (PROXIES.test(userAgent)) return { kind: 'proxy', counted: false, why: 'a privacy proxy' };
  if (SCANNERS.test(userAgent)) return { kind: 'scanner', counted: false, why: 'a mail scanner' };
  if (sentAt && at.getTime() - new Date(sentAt).getTime() < EARLY_SECONDS * 1000) return { kind: 'early', counted: false, why: `it came within ${EARLY_SECONDS} seconds of sending, which is a scanner on arrival` };
  return { kind: 'opened', counted: true, why: '' };
}

// A fetch of the picture. Unknown tokens write nothing and tell nothing.
export function recordOpen(db, token, { userAgent = '', at = new Date() } = {}) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token))) return null;
  const send = db.prepare("SELECT id, sent_at FROM mail_sends WHERE pixel_token = ? AND state = 'sent'").get(token);
  if (!send) return null;
  const verdict = classifyOpen({ userAgent, sentAt: send.sent_at, at });
  const t = at.toISOString();
  db.prepare('INSERT INTO mail_opens (id, created_at, updated_at, send_id, at, kind, fetcher, counted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), t, t, send.id, t, verdict.kind, String(userAgent).slice(0, 120), verdict.counted ? 1 : 0);
  return { send_id: send.id, ...verdict };
}

// What the conversation shows under a mail you sent with a confirmation: the first open that counts, and the fetches that did not.
export function confirmationsOf(db, threadId) {
  return db.prepare("SELECT * FROM mail_sends WHERE thread_id = ? AND pixel_token IS NOT NULL AND state = 'sent' AND deleted_at IS NULL ORDER BY sent_at").all(threadId).map((s) => {
    const opens = db.prepare('SELECT at, kind, fetcher, counted FROM mail_opens WHERE send_id = ? ORDER BY at, rowid').all(s.id);
    const first = opens.find((o) => o.counted === 1);
    return {
      send_id: s.id, subject: s.subject, to: JSON.parse(s.to_addrs), sent_at: s.sent_at,
      opened_at: first?.at ?? null, opens: opens.filter((o) => o.counted === 1).length,
      not_counted: opens.filter((o) => o.counted === 0).map((o) => ({ at: o.at, kind: o.kind, why: o.kind === 'proxy' ? 'a privacy proxy' : o.kind === 'scanner' ? 'a mail scanner' : 'a scanner on arrival' })),
    };
  });
}
