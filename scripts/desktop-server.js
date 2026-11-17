// Start Sovran Advisor on demand. The Dock icon calls this without a Terminal. A first start makes an empty database.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../db.js';

// What the running app says about itself: null when nothing (of ours) answers.
export async function health(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = response.ok ? await response.json() : null;
    return body?.ok === true ? body : null;
  } catch { return null; }
}

export async function ensureServer({ url, start, timeout = 20000 }) {
  const ready = async () => Boolean(await health(url));
  if (await ready()) return;
  // An unrelated service on this port must never be replaced or opened as our app.
  const address = new URL(url);
  const occupied = await new Promise(resolve => {
    const socket = net.connect({ host: address.hostname, port: Number(address.port) });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
  if (occupied) throw new Error('Another service is using the app’s address. Nothing was stopped.');
  await start();
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ready()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The app did not finish starting. Please ask for help checking its startup.');
}

// On a Mac the Mac itself looks after the app (login-agent.js). An app still running that the Mac did not start
// this way is left over from before: possibly from an earlier log-in, when it can no longer read the Keychain and
// so can't see the Claude sign-in ("Not logged in"). It is asked to stop, and the Mac's own copy takes its place.
export async function ensureAgentServer({ url, label, start, timeout = 30000 }) {
  const now = await health(url);
  if (now && now.agent === label) return 'running';
  if (now) {
    await fetch(`${url}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }).catch(() => {});
    const end = Date.now() + 10000;
    while (await health(url)) {
      if (Date.now() > end) throw new Error('An older Sovran Advisor is still running and would not stop. Restart your computer, then open Sovran Advisor again.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  await start();
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const answer = await health(url);
    if (answer?.agent === label) return now ? 'replaced' : 'started';
    if (!answer) await new Promise(resolve => setTimeout(resolve, 250));
    else throw new Error('Another copy of Sovran Advisor started instead. Restart your computer, then open Sovran Advisor again.');
  }
  throw new Error('The app did not finish starting. Please ask for help checking its startup.');
}

// Where the app looks for programs when the Dock starts it (no Terminal, so no login shell's PATH):
// this Node's own folder, then where Claude Code's installer and Homebrew put the claude command
// (the assistant runs it), then the system's folders.
export const launchPath = (home = os.homedir(), node = process.execPath) => [
  path.dirname(node), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin',
  '/usr/bin', '/bin', '/usr/sbin', '/sbin',
].join(':');

// The two Dock launchers: the personal app (your data) and the Demo (made-up data).
export const launchers = {
  personal: { url: 'http://127.0.0.1:3300', port: '3300', dataDir: 'data' },
  demo: { url: 'http://127.0.0.1:3310', port: '3310', dataDir: 'demo-data' },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const demo = process.argv[2] === 'demo';
    const { url, port, dataDir } = launchers[demo ? 'demo' : 'personal'];
    // The personal app on a Mac: the Mac starts it and keeps it to this log-in (login-agent.js). If that can't be
    // set up (for example it was switched off in System Settings › Login Items), it starts as before.
    let agent = null;
    if (!demo && process.platform === 'darwin') {
      const { ensureAgent, startAgent, steadyNode } = await import('./login-agent.js');
      try {
        agent = await ensureAgent({ root, node: steadyNode(), pathList: launchPath() });
      } catch (error) { console.log(error.message); }
      if (agent?.label) {
        await ensureAgentServer({ url, label: agent.label, start: async () => {
          // The Mac may be starting it already (it was just loaded); a start while it runs changes nothing.
          if (!(await health(url))) await startAgent({ label: agent.label });
        } });
      }
    }
    if (!agent?.label) await ensureServer({ url, start: async () => {
      const file = path.join(root, dataDir, 'app.db');
      if (demo && !fs.existsSync(file)) throw new Error('There is no demo copy yet. Run npm run demo once.');
      if (!demo && fs.existsSync(file)) {
        // Read only, to look: an older database is upgraded by the app itself when it starts (a whole copy is kept first,
        // db.js); a database from a newer app than this one is never opened by it.
        const db = new DatabaseSync(file, { readOnly: true });
        const version = db.prepare('PRAGMA user_version').get().user_version;
        db.close();
        if (version > SCHEMA_VERSION) throw new Error('Your data was made by a newer Sovran Advisor. Ask Claude to update Sovran Advisor, then open it again.');
      }
      const env = { ...process.env, PATH: launchPath(), PORT: port, DATA_DIR: path.join(root, dataDir) };
      delete env.ASSISTANT_COMMAND;
      delete env.HOSTS;
      if (demo) env.READ_CALENDARS = 'off'; else delete env.READ_CALENDARS;
      const child = spawn(path.join(path.dirname(process.execPath), 'npm'), ['start'], { cwd: root, env, detached: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
