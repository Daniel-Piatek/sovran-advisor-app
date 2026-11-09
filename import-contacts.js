// Bring your contacts in (People in depth, advanced/people/6): a vCard (.vcf) from a phone or a
// CSV (.csv) from a mail program, read into people and their companies. Three rules:
//   Read only        the file is read by the page and sent as text; nothing here touches a file.
//   Safe to run twice every imported person keeps where they came from (people.source_key), so a
//                    second run finds them and adds nothing. A person you deleted is still found.
//   Your edits win   someone already here (the same key, or the same email) is left exactly as
//                    you wrote them.
// A company is found by its name (case ignored) or made from the organisation, marked imported.

import { randomUUID } from 'node:crypto';

export const MAX_CONTACTS = 20_000;
export const MAX_FILE_CHARS = 3_500_000;

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// ---- vCard ----

const unescapeVCard = (value) => value.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c));
// ORG is company;unit;...: the company is the first part. Splits on ; that is not escaped.
const firstPart = (value) => unescapeVCard(value.split(/(?<!\\);/)[0]);

export function parseVCards(text) {
  const unfolded = String(text).replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '');
  const cards = [];
  let card = null;
  for (const line of unfolded.split(/\r?\n/)) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') { card = { fn: '', n: '', uid: '', org: '', title: '', emails: [], phones: [] }; continue; }
    if (upper === 'END:VCARD') { if (card) cards.push(card); card = null; continue; }
    if (!card) continue;
    const match = /^(?:[A-Za-z0-9-]+\.)?([A-Za-z0-9-]+)(;[^:]*)?:(.*)$/.exec(line);
    if (!match) continue;
    const [, property, , raw] = match;
    const value = raw.trim();
    switch (property.toUpperCase()) {
      case 'FN': card.fn = clean(unescapeVCard(value)); break;
      case 'N': {
        const [family = '', given = ''] = value.split(/(?<!\\);/);
        card.n = clean(`${unescapeVCard(given)} ${unescapeVCard(family)}`);
        break;
      }
      case 'UID': card.uid = clean(value.replace(/^urn:uuid:/i, '')); break;
      case 'ORG': card.org = clean(firstPart(value)); break;
      case 'TITLE': card.title = clean(unescapeVCard(value)); break;
      case 'EMAIL': { const e = clean(unescapeVCard(value).replace(/^mailto:/i, '')); if (e) card.emails.push(e); break; }
      case 'TEL': { const t = clean(unescapeVCard(value).replace(/^tel:/i, '')); if (t) card.phones.push(t); break; }
      default: break;
    }
  }
  return cards.map((c) => ({ name: c.fn || c.n, uid: c.uid, org: c.org, role: c.title, emails: c.emails, phones: c.phones, type: 'vcard' }));
}

// ---- CSV ----

// Rows of a CSV: quotes, commas and line breaks inside quotes, a BOM, CRLF, and , ; or tab.
export function parseCsvRows(text) {
  const source = String(text).replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const isLabel = (header) => /\b(label|type)\b/i.test(header);
export function parseCsvContacts(text) {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return [];
  const names = header.map((h) => clean(h));
  const one = (re) => names.findIndex((h) => re.test(h) && !isLabel(h));
  const all = (re) => names.map((h, i) => (re.test(h) && !isLabel(h) ? i : -1)).filter((i) => i >= 0);
  const col = {
    full: one(/^(name|full name|display name)$/i),
    first: one(/^(first|given)( name)?$/i),
    last: one(/^(last|family)( name)?$|^surname$/i),
    emails: all(/e-?mail/i),
    phones: all(/phone|mobile|^tel/i),
    org: one(/^(organi[sz]ation( 1)?( ?- ?name)?|organi[sz]ation name|company|org)$/i),
    role: one(/^(organi[sz]ation( 1)?( ?- ?title)?|organi[sz]ation title|job ?title|title|role|position)$/i),
  };
  if (col.full < 0 && col.first < 0 && col.last < 0 && !col.emails.length) throw fail(400, 'That CSV has no name or email column I know. The first row should name its columns, like Name, Email, Phone, Company.');
  const cell = (r, i) => (i >= 0 ? clean(r[i]) : '');
  const many = (r, indexes) => indexes.flatMap((i) => clean(r[i]).split(/\s*:::\s*/)).map(clean).filter(Boolean);
  return rows.map((r) => ({
    name: cell(r, col.full) || clean(`${cell(r, col.first)} ${cell(r, col.last)}`),
    uid: '', org: cell(r, col.org), role: cell(r, col.role), emails: many(r, col.emails), phones: many(r, col.phones), type: 'csv',
  }));
}

// What kind of file it is: by its name, else by what it starts with.
export function parseContacts(text, filename = '') {
  const isVCard = /\.vcf$/i.test(filename) || (!/\.csv$/i.test(filename) && /^﻿?\s*BEGIN:VCARD/i.test(text));
  return isVCard ? parseVCards(text) : parseCsvContacts(text);
}

// ---- Importing ----

const keyOf = (card) => `${card.type}:${(card.uid || card.emails[0] || card.name).toLowerCase()}`;
const emailsOf = (stored) => String(stored).split(/\r?\n/).map((e) => e.trim().toLowerCase()).filter(Boolean);

// Reads the contacts in `text` into people and companies, in one step: all or nothing. With
// dryRun nothing is kept: it says what the import would do.
// Report: { read, added, matched, skipped, companies_made, names (those added, the first 20) }.
export function importContacts(db, { text, filename = '', dryRun = false }) {
  if (typeof text !== 'string' || !text.trim()) throw fail(400, 'The file is empty.');
  if (text.length > MAX_FILE_CHARS) throw fail(413, 'That file is too large to import in one go.');
  const cards = parseContacts(text, filename);
  if (cards.length > MAX_CONTACTS) throw fail(400, `That file has more than ${MAX_CONTACTS} contacts.`);
  const report = { read: cards.length, added: 0, matched: 0, skipped: 0, companies_made: 0, names: [] };

  // Everyone here, deleted too (a person you deleted stays deleted): by key and by email.
  const byKey = new Set();
  const byEmail = new Set();
  for (const p of db.prepare('SELECT source_key, emails FROM people').all()) {
    if (p.source_key) byKey.add(p.source_key);
    for (const e of emailsOf(p.emails)) byEmail.add(e);
  }
  const companies = new Map(db.prepare('SELECT id, name FROM companies WHERE deleted_at IS NULL').all().map((c) => [c.name.trim().toLowerCase(), c.id]));
  const insert = db.prepare(`INSERT INTO people (id, created_at, updated_at, origin, name, company_id, role, emails, phones, source_key)
    VALUES (?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)`);

  db.exec('BEGIN');
  try {
    for (const card of cards) {
      if (!card.name) { report.skipped++; continue; }
      const key = keyOf(card);
      if (byKey.has(key) || card.emails.some((e) => byEmail.has(e.toLowerCase()))) { report.matched++; continue; }
      let companyId = null;
      if (card.org) {
        companyId = companies.get(card.org.toLowerCase()) ?? null;
        if (!companyId) {
          companyId = randomUUID();
          const time = now();
          db.prepare("INSERT INTO companies (id, created_at, updated_at, origin, name) VALUES (?, ?, ?, 'imported', ?)").run(companyId, time, time, card.org);
          companies.set(card.org.toLowerCase(), companyId);
          report.companies_made++;
        }
      }
      const time = now();
      insert.run(randomUUID(), time, time, card.name.slice(0, 200), companyId, card.role, card.emails.join('\n'), card.phones.join('\n'), key);
      byKey.add(key);
      for (const e of card.emails) byEmail.add(e.toLowerCase());
      report.added++;
      if (report.names.length < 20) report.names.push(card.name);
    }
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return report;
}
