import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';

const quiet = { port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0 };

test('POST /api/restart answers and then runs the restart; without a restart handler the route does not exist', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-'));
  let restarted = 0;
  const app = await startServer({ ...quiet, dataDir, onRestart: () => { restarted++; } });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const get = await fetch(`${app.url}/api/restart`);
  assert.equal(get.status, 405);
  const res = await fetch(`${app.url}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { restarting: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(restarted, 1);

  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-plain-'));
  const plain = await startServer({ ...quiet, dataDir: plainDir });
  t.after(async () => { await plain.close(); fs.rmSync(plainDir, { recursive: true, force: true }); });
  const none = await fetch(`${plain.url}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.notEqual(none.status, 200);
});
