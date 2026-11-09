import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';
import { ensureServer, launchers, launchPath } from '../../scripts/desktop-server.js';

test('Dock launcher waits for a cold app to start, using a scratch database', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dock-app-test-'));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let app;
  try {
    await ensureServer({ url: `http://127.0.0.1:${port}`, start: async () => {
      app = await startServer({ port, dataDir, readCaptures: false, writeTitles: false, readCalendarsEvery: 0 });
    } });
    assert.ok(app);
  } finally {
    if (app) await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('Dock launcher reuses the running app without starting a second server', async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await ensureServer({ url: `http://127.0.0.1:${server.address().port}`, start: () => assert.fail('already running') });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Dock launcher leaves an unrelated service alone', async () => {
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end('unrelated'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(ensureServer({ url: `http://127.0.0.1:${server.address().port}`, start: () => assert.fail('must not start') }), /Another service/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the two Dock launchers use different ports and folders, and the personal one is on 3300 with data/', () => {
  assert.equal(launchers.personal.port, '3300');
  assert.equal(launchers.personal.dataDir, 'data');
  assert.equal(launchers.demo.port, '3310');
  assert.equal(launchers.demo.dataDir, 'demo-data');
  assert.notEqual(launchers.demo.port, launchers.personal.port);
});

test('started from the Dock, the app finds the claude command where Claude Code and Homebrew install it', () => {
  const folders = launchPath('/Users/ana', '/opt/homebrew/bin/node').split(':');
  assert.equal(folders[0], '/opt/homebrew/bin');
  for (const where of ['/Users/ana/.local/bin', '/Users/ana/.claude/local', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) assert.ok(folders.includes(where), where);
});
