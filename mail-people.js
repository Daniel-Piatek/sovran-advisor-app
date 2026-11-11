// Mail meets People (the Mail module, advanced/mail/10): every address in a mail finds its person, or the company whose address it is.
//   Matched as it is read   by the addresses written on a person's page, and else by a company's website (its domain); nothing is copied:
//                           change an address on a page and the mail finds them differently at once.
//   Beside every mail       who wrote it and the company behind them; an unknown sender is one key away from People (Shift P), marked "From a mail".
//   On a person's page      a section "Mail with …", and the day you were last in touch (the newest mail, or the newest line you logged).
// Switch Mail off and the people stay; only the mail section goes.

import { createPerson } from './people.js';
import { addressesIn, addressFilter, lastMailDay } from './mail-touch.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const hostOf = (site) => { try { return new URL(/^[a-z]+:\/\//i.test(site) ? site : `https://${site}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const domainOf = (email) => String(email).toLowerCase().split('@')[1] ?? '';
const sameSite = (a, b) => a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

const personRow = (p) => ({ id: p.id, name: p.name, role: p.role, company_id: p.company_id, company_name: p.company_name ?? null });

// The person with this address on their page, else the company whose website it is; a person brings their own company along.
export function matchAddress(db, email) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address) return { person: null, company: null };
  const people = db.prepare(`SELECT p.id, p.name, p.role, p.company_id, p.emails, c.name AS company_name FROM people p LEFT JOIN companies c ON c.id = p.company_id AND c.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND p.merged_into IS NULL AND p.emails <> '' AND lower(p.emails) LIKE ?`).all(`%${address.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const person = people.find((p) => addressesIn(p.emails).includes(address)) ?? null;
  let company = person?.company_id ? { id: person.company_id, name: person.company_name } : null;
  if (!company) {
    const host = domainOf(address);
    const found = db.prepare("SELECT id, name, website FROM companies WHERE deleted_at IS NULL AND website <> ''").all().find((c) => sameSite(hostOf(c.website), host));
    company = found ? { id: found.id, name: found.name } : null;
  }
  return { person: person ? personRow(person) : null, company };
}

// Who is in a conversation (not you), each with the person and company behind the address.
export function peopleOfThread(db, threadId) {
  const own = db.prepare('SELECT a.email FROM mail_threads t JOIN mail_accounts a ON a.id = t.account_id WHERE t.id = ?').get(threadId)?.email?.toLowerCase();
  const seen = new Map();
  for (const m of db.prepare('SELECT from_name, from_email, to_addrs, cc_addrs FROM mail_messages WHERE thread_id = ? AND deleted_at IS NULL ORDER BY sent_at, rowid').all(threadId)) {
    for (const a of [{ name: m.from_name, email: m.from_email }, ...list(m.to_addrs), ...list(m.cc_addrs)]) {
      const email = String(a.email ?? '').toLowerCase();
      if (!email || email === own) continue;
      if (!seen.has(email) || (!seen.get(email).name && a.name)) seen.set(email, { email, name: a.name ?? '' });
    }
  }
  return [...seen.values()].slice(0, 8).map((a) => ({ ...a, ...matchAddress(db, a.email) }));
}

// A new sender becomes a person (Shift P), with their address, marked "From a mail"; a company that owns their domain becomes theirs.
export function addSender(db, { email, name = '', subject = '' }) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw fail(400, 'That is not an address.');
  const known = matchAddress(db, address);
  if (known.person) return { person: known.person, created: false };
  const local = address.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const person = createPerson(db, { name: String(name).trim() || local, emails: address, company_id: known.company?.id ?? null, how_met: `From a mail${subject ? `: ${String(subject).slice(0, 120)}` : ''}` });
  db.prepare("UPDATE people SET origin = 'imported' WHERE id = ?").run(person.id);
  return { person: personRow({ ...person, company_name: known.company?.name }), created: true };
}

// The addresses that stand for a person (what is written on their page) or a company (its domain, and its people's addresses).
function addressesFor(db, kind, id) {
  if (kind === 'person') return addressesIn(db.prepare('SELECT emails FROM people WHERE id = ? AND deleted_at IS NULL').get(id)?.emails);
  const company = db.prepare('SELECT website FROM companies WHERE id = ? AND deleted_at IS NULL').get(id);
  const people = db.prepare("SELECT emails FROM people WHERE company_id = ? AND deleted_at IS NULL AND merged_into IS NULL").all(id).flatMap((p) => addressesIn(p.emails));
  return { people, host: hostOf(company?.website ?? '') };
}

// The conversations with a person or a company, the latest first, and the day you were last in touch by mail.
export function mailWith(db, { kind, id, limit = 20 }) {
  const found = addressesFor(db, kind, id);
  const addresses = kind === 'person' ? found : found.people;
  const clauses = [];
  const args = [];
  if (addresses.length) { const f = addressFilter(addresses); clauses.push(f.sql); args.push(...f.args); }
  if (kind === 'company' && found.host) {
    clauses.push(`(lower(m.from_email) LIKE ? OR EXISTS (SELECT 1 FROM json_each(m.to_addrs) j WHERE lower(json_extract(j.value, '$.email')) LIKE ?))`);
    args.push(`%@${found.host}`, `%@${found.host}`);
  }
  if (!clauses.length) return { threads: [], last_in_touch: null };
  const rows = db.prepare(`SELECT t.id, t.subject, t.snippet, t.participants, t.message_count, t.last_at, a.email AS account_email FROM mail_threads t
    JOIN mail_accounts a ON a.id = t.account_id WHERE t.deleted_at IS NULL AND t.id IN (SELECT m.thread_id FROM mail_messages m WHERE m.deleted_at IS NULL AND (${clauses.join(' OR ')}))
    ORDER BY t.last_at DESC LIMIT ?`).all(...args, Math.max(1, Math.min(100, Math.trunc(limit) || 20)));
  const newest = db.prepare(`SELECT max(m.sent_at) AS at FROM mail_messages m WHERE m.deleted_at IS NULL AND (${clauses.join(' OR ')})`).get(...args).at;
  return {
    threads: rows.map((t) => ({ id: t.id, subject: t.subject, snippet: t.snippet, participants: list(t.participants), message_count: t.message_count, last_at: t.last_at, account_letter: t.account_email[0].toUpperCase(), account_email: t.account_email })),
    last_in_touch: newest ? new Date(newest).toISOString() : null,
  };
}

export { lastMailDay };
