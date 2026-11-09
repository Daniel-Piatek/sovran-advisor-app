import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';

test('the welcome: not seen in a new install; a name and seen are kept; the assistant check runs the command', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-'));
  // `node --version` stands in for `claude --version`: it is there, so the assistant is ready.
  const app = await startServer({ port: 0, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, assistantCommand: [process.execPath] });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const send = async (method, body) => {
    const res = await fetch(`${app.url}/api/welcome`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  assert.deepEqual((await send('GET')).body, { seen: false, name: '', assistant_ready: true });
  assert.deepEqual((await send('PATCH', { name: '  Ana  ' })).body, { seen: false, name: 'Ana', assistant_ready: true });
  assert.deepEqual((await send('PATCH', { seen: true })).body, { seen: true, name: 'Ana', assistant_ready: true });
  for (const bad of [[], { name: 3 }, { name: 'x'.repeat(81) }, { seen: 'yes' }]) assert.equal((await send('PATCH', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await send('DELETE')).status, 405);
});
