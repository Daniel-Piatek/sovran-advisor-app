// The whole copies made before a database move (app.db.before-v<N>.bak, db.js): only the 3 newest stay, so they never fill the disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneUpgradeCopies } from '../../db.js';

test('only the 3 highest app.db.before-v*.bak stay; other .bak files are left alone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const n of [1, 2, 9, 10, 58, 70]) fs.writeFileSync(path.join(dir, `app.db.before-v${n}.bak`), 'x');
  for (const name of ['app.db.before-restart-2026-10-26.bak', 'other.db.before-v1.bak', 'app.db']) fs.writeFileSync(path.join(dir, name), 'x');
  const removed = pruneUpgradeCopies(dir);
  assert.deepEqual(removed.sort(), ['app.db.before-v1.bak', 'app.db.before-v2.bak', 'app.db.before-v9.bak']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['app.db', 'app.db.before-restart-2026-10-26.bak', 'app.db.before-v10.bak', 'app.db.before-v58.bak', 'app.db.before-v70.bak', 'other.db.before-v1.bak']);
  assert.deepEqual(pruneUpgradeCopies(dir), [], 'a second run removes nothing');
});
