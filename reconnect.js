// A reconnect rhythm (People in depth, advanced/people/5): a cadence per person (people.cadence_days:
// how often you want to be in touch), and the Reconnect list of who is due. Last in touch is
// never typed: it comes from the person's logged interactions (interactions.js and the links
// table), so logging a line moves the clock and nothing is kept in step. It is a rhythm, not a
// to-do: nothing to tick. "Remind me" writes a normal task (tasks.js) for tomorrow.

import { createTask } from './tasks.js';

export const CADENCES = [
  { days: 7, label: 'Weekly' }, { days: 14, label: 'Every 2 weeks' }, { days: 21, label: 'Every 3 weeks' },
  { days: 30, label: 'Monthly' }, { days: 90, label: 'Quarterly' },
];
export const CADENCE_DAYS = CADENCES.map((c) => c.days);
export const cadenceLabel = (days) => CADENCES.find((c) => c.days === days)?.label ?? null;

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayNumber = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
export const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); };

// The last day you were in touch with them: the newest of their logged lines, or null.
export function lastInTouch(db, personId) {
  const row = db.prepare(`SELECT max(i.happened_at) AS at FROM interactions i
    JOIN links l ON l.from_kind = 'interaction' AND l.from_id = i.id AND l.to_kind = 'person' AND l.to_id = ?
    WHERE i.deleted_at IS NULL`).get(personId);
  return row?.at ? row.at.slice(0, 10) : null;
}

// Days left until they are due (negative: overdue). With nothing logged yet they are due today.
export function daysLeft(cadenceDays, last, today = dayOf(new Date())) {
  if (!cadenceDays) return null;
  return last ? cadenceDays - (dayNumber(today) - dayNumber(last)) : 0;
}

// What a person's page shows: last in touch and days left.
export function rhythmOf(db, person, today = dayOf(new Date())) {
  const last = lastInTouch(db, person.id);
  return { last_in_touch: last, days_left: daysLeft(person.cadence_days, last, today) };
}

// Everyone with a cadence, the most overdue first.
export function reconnectList(db, { today = dayOf(new Date()) } = {}) {
  const rows = db.prepare(`SELECT p.id, p.name, p.role, p.cadence_days, c.name AS company_name
    FROM people p LEFT JOIN companies c ON c.id = p.company_id AND c.deleted_at IS NULL
    WHERE p.cadence_days IS NOT NULL AND p.deleted_at IS NULL`).all();
  return rows.map((p) => {
    const last = lastInTouch(db, p.id);
    return { ...p, cadence_label: cadenceLabel(p.cadence_days), last_in_touch: last, days_left: daysLeft(p.cadence_days, last, today) };
  }).sort((a, b) => a.days_left - b.days_left || a.name.localeCompare(b.name));
}

// "Remind me": a task "Reconnect with <first name>" for tomorrow, linked to the person. One
// that is still open is not made twice.
export function remindToReconnect(db, personId, { today = dayOf(new Date()) } = {}) {
  const person = db.prepare('SELECT id, name FROM people WHERE id = ? AND deleted_at IS NULL').get(personId);
  if (!person) return null;
  const open = db.prepare(`SELECT t.id FROM tasks t JOIN links l ON l.from_kind = 'task' AND l.from_id = t.id AND l.to_kind = 'person' AND l.to_id = ?
    WHERE t.source_kind = 'own' AND t.done = 0 AND t.deleted_at IS NULL AND t.text LIKE 'Reconnect with %' LIMIT 1`).get(personId);
  if (open) return { existing: true, task_id: open.id };
  const first = person.name.trim().split(/\s+/)[0];
  const task = createTask(db, { text: `Reconnect with ${first}`, due: addDays(today, 1), mentions: [{ kind: 'person', id: personId }] });
  return { existing: false, task_id: task.id, task };
}
