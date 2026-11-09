// Routines (Calendar in depth, advanced/calendar/6; table event_templates): a title and a length you set up once (a run, a morning
// of deep work). Dragged into a day of the Planner a routine makes a TASK there, placed like any task and marked with its
// template, never an event: your Calendar stays a picture of what is fixed. Deleting only sets deleted_at, as everywhere.

import { randomUUID } from 'node:crypto';
import { insertTask, changeTask } from './tasks.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const COLUMNS = 'id, title, minutes, created_at, updated_at, deleted_at';
const plain = (rows) => rows.map((r) => ({ ...r }));

export function checkTemplateInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Send a JSON object.';
  if (typeof input.title !== 'string' || !input.title.trim()) return 'A routine needs a name.';
  if (input.title.length > 100) return 'The name is longer than 100 characters.';
  if (!(Number.isInteger(input.minutes) && input.minutes >= 5 && input.minutes <= 1440)) return 'minutes is 5 to 1440.';
  return null;
}

export const listTemplates = (db) => plain(db.prepare(`SELECT ${COLUMNS} FROM event_templates WHERE deleted_at IS NULL ORDER BY created_at, rowid`).all());
const rowOf = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM event_templates WHERE id = ?`).get(id);
export const getTemplate = (db, id) => { const r = rowOf(db, id); return r && !r.deleted_at ? { ...r } : null; };

export function createTemplate(db, { title, minutes }) {
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO event_templates (id, created_at, updated_at, title, minutes) VALUES (?, ?, ?, ?, ?)').run(id, time, time, title.trim(), minutes);
  return getTemplate(db, id);
}
export function removeTemplate(db, id) {
  if (!getTemplate(db, id)) return null;
  db.prepare('UPDATE event_templates SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return { ...rowOf(db, id) };
}
export function restoreTemplate(db, id) {
  if (!rowOf(db, id)) return null;
  db.prepare('UPDATE event_templates SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return getTemplate(db, id);
}

// A routine dropped into a day: one task row, its words and length from the template, placed in the day (the same kind of row
// a placed task has). It never writes an event.
export function placeTemplate(db, id, { due, plan_part, plan_at = '' }) {
  const template = getTemplate(db, id);
  if (!template) throw fail(404, 'No such routine.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw fail(400, 'due is a day (YYYY-MM-DD).');
  if (!['morning', 'afternoon'].includes(plan_part)) throw fail(400, 'plan_part is morning or afternoon.');
  const task = insertTask(db, { text: template.title, due, estimate: template.minutes });
  db.prepare('UPDATE tasks SET template_id = ? WHERE id = ?').run(id, task.id);
  return changeTask(db, task.id, { due, plan_part, plan_at, block_id: null });
}
