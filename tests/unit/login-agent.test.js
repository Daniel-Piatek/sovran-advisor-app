import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentPlist, agentFile, otherAgent, ensureAgent, AGENT_LABEL, RESTART_CODE } from '../../scripts/login-agent.js';
import { ensureAgentServer } from '../../scripts/desktop-server.js';
import { startServer } from '../../server.js';

const quiet = { port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, mailSyncEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0 };
const scratchHome = (t) => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-')); t.after(() => fs.rmSync(home, { recursive: true, force: true })); return home; };
const root = '/Users/ana/Sovran Central';

// A stand-in for launchctl: remembers what was asked, and what is loaded.
function fakeLaunchctl() {
  const calls = [];
  let loaded = false;
  const run = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'print') return { code: loaded ? 0 : 113, out: '' };
    if (args[0] === 'bootstrap') { loaded = true; return { code: 0, out: '' }; }
    if (args[0] === 'bootout') { loaded = false; return { code: 0, out: '' }; }
    return { code: 0, out: '' };
  };
  return { run, calls };
}

test('the login agent starts the app at log-in, starts it again only after a crash or a restart, and runs this folder', () => {
  const text = agentPlist({ root, node: '/opt/homebrew/bin/node', home: '/Users/ana', pathList: '/opt/homebrew/bin:/usr/bin' });
  assert.match(text, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(text, /<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/><\/dict>/);
  assert.match(text, /<string>\/opt\/homebrew\/bin\/node<\/string><string>\/Users\/ana\/Sovran Central\/server.js<\/string>/);
  assert.match(text, /<key>PORT<\/key><string>3300<\/string>/);
  assert.match(text, /<key>DATA_DIR<\/key><string>\/Users\/ana\/Sovran Central\/data<\/string>/);
  assert.match(text, new RegExp(`<key>SOVRAN_AGENT</key><string>${AGENT_LABEL}</string>`));
  assert.match(text, /<key>AssociatedBundleIdentifiers<\/key><string>com.sovran.advisor<\/string>/);
  assert.notEqual(RESTART_CODE, 0);
});

test('an agent someone already made for this folder is left alone, and none is added beside it', async (t) => {
  const home = scratchHome(t);
  const dir = path.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(dir, { recursive: true });
  // APP Daniel's own agent and a demo folder are not this app.
  fs.writeFileSync(path.join(dir, 'com.daniel.app.plist'), '<string>/Users/ana/APP Daniel/server.js</string>');
  fs.writeFileSync(path.join(dir, 'com.other.demo.plist'), '<string>/Users/ana/Sovran Central Demo/server.js</string>');
  assert.equal(otherAgent({ root, home }), null);
  fs.writeFileSync(path.join(dir, 'com.ana.sovran.plist'), '<string>/Users/ana/Sovran Central/server.js</string>');
  assert.equal(otherAgent({ root, home }), 'com.ana.sovran.plist');
  const { run, calls } = fakeLaunchctl();
  assert.deepEqual(await ensureAgent({ root, node: '/n', home, uid: 501, pathList: '/usr/bin', run }), { other: 'com.ana.sovran.plist' });
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(agentFile(home)), false);
});

test('the agent is written and loaded once; a click with nothing changed touches nothing; a new Node.js reloads it', async (t) => {
  const home = scratchHome(t);
  const { run, calls } = fakeLaunchctl();
  const args = { root, node: '/opt/homebrew/bin/node', home, uid: 501, pathList: '/usr/bin', run };
  assert.deepEqual(await ensureAgent(args), { label: AGENT_LABEL, changed: true });
  assert.ok(fs.readFileSync(agentFile(home), 'utf8').includes('/opt/homebrew/bin/node'));
  assert.deepEqual(calls, [`print gui/501/${AGENT_LABEL}`, `bootstrap gui/501 ${agentFile(home)}`]);
  calls.length = 0;
  assert.deepEqual(await ensureAgent(args), { label: AGENT_LABEL, changed: false });
  assert.deepEqual(calls, [`print gui/501/${AGENT_LABEL}`]);
  calls.length = 0;
  await ensureAgent({ ...args, node: '/usr/local/bin/node' });
  assert.deepEqual(calls, [`print gui/501/${AGENT_LABEL}`, `bootout gui/501/${AGENT_LABEL}`, `bootstrap gui/501 ${agentFile(home)}`]);
});

test('if the Mac refuses to load it (switched off in Login Items), the icon is told, so it can start the app as before', async (t) => {
  const home = scratchHome(t);
  const run = async (args) => ({ code: args[0] === 'print' ? 113 : 5, out: 'Bootstrap failed: 5: Input/output error' });
  await assert.rejects(ensureAgent({ root, node: '/n', home, uid: 501, pathList: '/usr/bin', run }), /would not start Sovran Central by itself/);
});

test('the app says in its health which agent started it, and only then', async (t) => {
  const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'agent-health-')), fs.mkdtempSync(path.join(os.tmpdir(), 'plain-health-'))];
  const managed = await startServer({ ...quiet, dataDir: dirs[0], agent: AGENT_LABEL });
  const plain = await startServer({ ...quiet, dataDir: dirs[1] });
  t.after(async () => { await managed.close(); await plain.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  assert.deepEqual(await (await fetch(`${managed.url}/api/health`)).json(), { ok: true, agent: AGENT_LABEL });
  assert.deepEqual(await (await fetch(`${plain.url}/api/health`)).json(), { ok: true });
});

// The student's morning: an app left running from last night (not started by the Mac) answers, but can't see Claude.
test('the Dock icon stops an app left over from before and lets the Mac start a fresh one', async (t) => {
  const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'old-app-')), fs.mkdtempSync(path.join(os.tmpdir(), 'new-app-'))];
  t.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  let fresh = null;
  let old = null;
  old = await startServer({ ...quiet, dataDir: dirs[0], onQuit: () => { const o = old; old = null; o.close(); } });
  const port = new URL(old.url).port;
  t.after(async () => { if (old) await old.close(); if (fresh) await fresh.close(); });
  const result = await ensureAgentServer({ url: old.url, label: AGENT_LABEL, start: async () => {
    fresh = await startServer({ ...quiet, port: Number(port), dataDir: dirs[1], agent: AGENT_LABEL });
  } });
  assert.equal(result, 'replaced');
  assert.equal(old, null);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(), { ok: true, agent: AGENT_LABEL });
});

test('the Dock icon reuses an app the Mac started, without stopping it', async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, agent: AGENT_LABEL })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await ensureAgentServer({ url: `http://127.0.0.1:${server.address().port}`, label: AGENT_LABEL, start: () => assert.fail('already running') }), 'running');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the agent runs Homebrew’s own link to Node.js, which survives a brew upgrade', async () => {
  const { steadyNode } = await import('../../scripts/login-agent.js');
  const cellar = '/opt/homebrew/Cellar/node/22.13.0/bin/node';
  const real = (p) => (p === '/opt/homebrew/bin/node' ? cellar : p);
  assert.equal(steadyNode(cellar, (p) => p === '/opt/homebrew/bin/node', real), '/opt/homebrew/bin/node');
  assert.equal(steadyNode(cellar, () => false, real), cellar);
  assert.equal(steadyNode('/usr/local/bin/node'), '/usr/local/bin/node');
});
