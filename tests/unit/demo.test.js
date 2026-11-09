// The demo copy (scripts/demo.js) fills an empty database with made-up data of every kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { prepareDatabase } from '../../db.js';
import { fillDemo, DEMO_DIR } from '../../scripts/demo.js';

test('the demo fills every part of the app, and lives apart from data/', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  fillDemo(db, '2026-10-26');
  const count = (table) => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get().n;
  for (const table of ['notes', 'journal_entries', 'tasks', 'events', 'calendars', 'people', 'companies', 'life_items', 'captures', 'blocks', 'day_closes', 'reviews']) {
    assert.ok(count(table) > 0, `${table} has made-up rows`);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM tasks WHERE plan_at <> ''").get().n, 3);
  assert.notEqual(path.basename(DEMO_DIR), 'data');
});
