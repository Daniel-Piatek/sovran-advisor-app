// People and companies (schema.sql, tables people and companies; pkm/2): an address book
// with your notes. A person may belong to a company. Notes and entries mention them with
// links (links.js), and their pages list what mentions them. Deleting only sets
// deleted_at, as everywhere.

import { randomUUID } from 'node:crypto';
import { syncLinks } from './links.js';
import { syncTasks } from './tasks.js';
import { MAX_BODY_LENGTH } from './notes.js';
import { CADENCE_DAYS, rhythmOf } from './reconnect.js';
import { unmergePerson } from './merge-people.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));

export const MAX_NAME_LENGTH = 200;
const PERSON_FIELDS = ['name', 'company_id', 'role', 'emails', 'phones', 'how_met', 'body'];
const COMPANY_FIELDS = ['name', 'website', 'body'];

// Checks what the page sent. Returns what is wrong, or null.
export function checkInput(input, fields) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  for (const field of fields) {
    if (!(field in input)) continue;
    if (field === 'company_id' && input[field] === null) continue;
    if (typeof input[field] !== 'string') return `${field} must be text.`;
    const max = field === 'body' ? MAX_BODY_LENGTH : field === 'name' ? MAX_NAME_LENGTH : 10_000;
    if (input[field].length > max) return `${field} is longer than ${max} characters.`;
  }
  if ('name' in input && !input.name.trim()) return 'A name is needed.';
  return null;
}
export const checkPersonInput = (input) => {
  const problem = checkInput(input, PERSON_FIELDS);
  if (problem) return problem;
  if ('cadence_days' in input && input.cadence_days !== null && !CADENCE_DAYS.includes(input.cadence_days)) {
    return `cadence_days is ${CADENCE_DAYS.join(', ')} or null (Off).`;
  }
  return null;
};
export const checkCompanyInput = (input) => checkInput(input, COMPANY_FIELDS);

const mentions = (kind) => `(SELECT count(*) FROM links l
  LEFT JOIN notes n ON l.from_kind = 'note' AND n.id = l.from_id AND n.deleted_at IS NULL
  LEFT JOIN journal_entries e ON l.from_kind = 'entry' AND e.id = l.from_id AND e.deleted_at IS NULL
  WHERE l.to_kind = '${kind}' AND l.to_id = %ID% AND coalesce(n.id, e.id) IS NOT NULL)`;

// ---- Companies ----

function activeCompany(db, id) {
  return id ? db.prepare('SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL').get(id) : null;
}

export function createCompany(db, { name, website = '', body = '' }) {
  if (!name?.trim()) throw fail(400, 'A name is needed.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO companies (id, created_at, updated_at, name, website, body) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, time, time, name.trim(), website, body);
  syncLinks(db, 'company', id, body);
  syncTasks(db, 'company', id, body);
  return getCompany(db, id);
}

export function getCompany(db, id, { deleted = false } = {}) {
  const company = db.prepare(`SELECT id, name, website, body, origin, created_at, updated_at, deleted_at,
      ${mentions('company').replace('%ID%', 'companies.id')} AS mention_count
    FROM companies WHERE id = ? ${deleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
  if (!company) return null;
  const people = plain(db.prepare(`SELECT id, name, role FROM people WHERE company_id = ? AND deleted_at IS NULL
    ORDER BY name COLLATE NOCASE`).all(id));
  return { ...company, people };
}

export function listCompanies(db, { q = '' } = {}) {
  return plain(db.prepare(`SELECT id, name, website, updated_at,
      (SELECT count(*) FROM people p WHERE p.company_id = companies.id AND p.deleted_at IS NULL) AS people_count,
      ${mentions('company').replace('%ID%', 'companies.id')} AS mention_count
    FROM companies WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE`)
    .all(`%${q.replace(/[\\%_]/g, '\\$&')}%`));
}

export function updateCompany(db, id, changes) {
  const company = getCompany(db, id);
  if (!company) return null;
  const next = Object.fromEntries(COMPANY_FIELDS.map((f) => [f, changes[f] ?? company[f]]));
  if (COMPANY_FIELDS.every((f) => next[f] === company[f])) return company;
  db.prepare('UPDATE companies SET name = ?, website = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(next.name.trim() || company.name, next.website, next.body, now(), id);
  if (next.body !== company.body) {
    syncLinks(db, 'company', id, next.body);
    syncTasks(db, 'company', id, next.body);
  }
  return getCompany(db, id);
}

// ---- People ----

export function createPerson(db, { name, company_id = null, role = '', emails = '', phones = '', how_met = '', body = '' }) {
  if (!name?.trim()) throw fail(400, 'A name is needed.');
  if (company_id && !activeCompany(db, company_id)) throw fail(400, 'There is no such company.');
  const id = randomUUID();
  const time = now();
  db.prepare(`INSERT INTO people (id, created_at, updated_at, name, company_id, role, emails, phones, how_met, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, time, time, name.trim(), company_id, role, emails, phones, how_met, body);
  syncLinks(db, 'person', id, body);
  syncTasks(db, 'person', id, body);
  return getPerson(db, id);
}

export function getPerson(db, id, { deleted = false } = {}) {
  const person = db.prepare(`SELECT p.id, p.name, p.company_id, c.name AS company_name, p.role, p.emails, p.phones,
      p.how_met, p.body, p.origin, p.created_at, p.updated_at, p.deleted_at, p.cadence_days,
      ${mentions('person').replace('%ID%', 'p.id')} AS mention_count
    FROM people p LEFT JOIN companies c ON c.id = p.company_id AND c.deleted_at IS NULL
    WHERE p.id = ? ${deleted ? '' : 'AND p.deleted_at IS NULL'}`).get(id);
  return person ? { ...person, ...rhythmOf(db, person) } : null;
}

export function listPeople(db, { q = '' } = {}) {
  return plain(db.prepare(`SELECT p.id, p.name, p.company_id, c.name AS company_name, p.role, p.emails, p.updated_at,
      ${mentions('person').replace('%ID%', 'p.id')} AS mention_count
    FROM people p LEFT JOIN companies c ON c.id = p.company_id AND c.deleted_at IS NULL
    WHERE p.deleted_at IS NULL AND (p.name LIKE ?1 ESCAPE '\\' OR c.name LIKE ?1 ESCAPE '\\' OR p.role LIKE ?1 ESCAPE '\\')
    ORDER BY p.name COLLATE NOCASE`).all(`%${q.replace(/[\\%_]/g, '\\$&')}%`));
}

export function updatePerson(db, id, changes) {
  let person = getPerson(db, id);
  if (!person) return null;
  // The rhythm (People in depth): how often to be in touch, or null for Off.
  if ('cadence_days' in changes && (changes.cadence_days ?? null) !== person.cadence_days) {
    db.prepare('UPDATE people SET cadence_days = ?, updated_at = ? WHERE id = ?').run(changes.cadence_days ?? null, now(), id);
    person = getPerson(db, id);
  }
  if (changes.company_id && changes.company_id !== person.company_id && !activeCompany(db, changes.company_id)) {
    throw fail(400, 'There is no such company.');
  }
  const next = Object.fromEntries(PERSON_FIELDS.map((f) => [f, f in changes ? changes[f] : person[f]]));
  if (PERSON_FIELDS.every((f) => next[f] === person[f])) return person;
  db.prepare(`UPDATE people SET name = ?, company_id = ?, role = ?, emails = ?, phones = ?, how_met = ?, body = ?, updated_at = ?
    WHERE id = ?`).run(next.name.trim() || person.name, next.company_id || null, next.role, next.emails, next.phones,
    next.how_met, next.body, now(), id);
  if (next.body !== person.body) {
    syncLinks(db, 'person', id, next.body);
    syncTasks(db, 'person', id, next.body);
  }
  return getPerson(db, id);
}

// ---- Delete and bring back, for both ----

const tableOf = (kind) => (kind === 'person' ? 'people' : 'companies');
const getOf = (kind) => (kind === 'person' ? getPerson : getCompany);

export function deleteContact(db, kind, id) {
  const item = getOf(kind)(db, id, { deleted: true });
  if (!item) return null;
  if (!item.deleted_at) db.prepare(`UPDATE ${tableOf(kind)} SET deleted_at = ? WHERE id = ?`).run(now(), id);
  return getOf(kind)(db, id, { deleted: true });
}

export function restoreContact(db, kind, id) {
  const item = getOf(kind)(db, id, { deleted: true });
  if (!item) return null;
  // A person merged into another comes back with what moved to the other put back (merge-people.js).
  if (kind === 'person' && unmergePerson(db, id)) return getOf(kind)(db, id);
  db.prepare(`UPDATE ${tableOf(kind)} SET deleted_at = NULL WHERE id = ?`).run(id);
  return getOf(kind)(db, id);
}

export function listDeletedContacts(db) {
  return [
    ...plain(db.prepare(`SELECT 'person' AS kind, p.id, p.name, p.deleted_at, k.name AS merged_into_name
      FROM people p LEFT JOIN people k ON k.id = p.merged_into WHERE p.deleted_at IS NOT NULL`).all()),
    ...plain(db.prepare("SELECT 'company' AS kind, id, name, deleted_at FROM companies WHERE deleted_at IS NOT NULL").all()),
  ].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}
