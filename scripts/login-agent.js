// The Mac looks after Sovran Advisor (2026-11-17): a per-user launchd agent starts the app when the person logs in,
// ends it when they log out, and starts it again if it ever stops by itself. Why: an app left running after a
// log-out can no longer read the person's Keychain, so it can't see their Claude sign-in and the assistant says
// "Not logged in". An app the Mac started for this log-in never outlives it.
//
// The Dock icon (desktop-server.js) sets this up on every Mac; `npm run login-agent` does it by hand, and
// `npm run login-agent -- --remove` takes it away again. Windows is untouched.
//
// Stopping still works: `npm run stop` (or an update) ends the app with a clean exit, and the Mac leaves it
// stopped until the next log-in or click on the icon. A crash or a Settings › Restart ends it with another
// code, and the Mac starts it again.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_LABEL = 'com.livesovran.sovran-advisor';
// The exit code that asks the Mac to start the app again (Settings › Restart, after an update).
export const RESTART_CODE = 75;

const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const agentFile = (home = os.homedir(), label = AGENT_LABEL) => path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
export const logFile = (home = os.homedir()) => path.join(home, 'Library', 'Logs', 'Sovran Advisor.log');

// The agent's file. AssociatedBundleIdentifiers makes System Settings › Login Items show it as
// "Sovran Advisor" with its icon (the Dock icon's id), rather than as "node".
export function agentPlist({ root, node, home = os.homedir(), label = AGENT_LABEL, port = '3300', pathList }) {
  const dir = root.replace(/\/$/, '');
  const env = { PATH: pathList, PORT: port, DATA_DIR: path.join(dir, 'data'), SOVRAN_AGENT: label };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>AssociatedBundleIdentifiers</key><string>com.sovran.advisor</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(dir, 'server.js'))}</string></array>
<key>WorkingDirectory</key><string>${xml(dir)}</string>
<key>EnvironmentVariables</key><dict>
${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('\n')}
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(logFile(home))}</string>
<key>StandardErrorPath</key><string>${xml(logFile(home))}</string>
</dict></plist>
`;
}

// Another agent the person (or Claude, by hand) already made for this same folder: it is left exactly as it is,
// and this app makes none of its own beside it, so two never fight over one address.
export function otherAgent({ root, home = os.homedir(), label = AGENT_LABEL }) {
  const dir = path.join(home, 'Library', 'LaunchAgents');
  const mine = new RegExp(`${xml(root.replace(/\/$/, '')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[</"])`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith('.plist') || name === `${label}.plist`) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    if (mine.test(text)) return name;
  }
  return null;
}

// The Node.js the agent runs: Homebrew's own link rather than its versioned folder, which a `brew upgrade`
// removes (the agent would then not start at the next log-in).
export function steadyNode(node = process.execPath, exists = fs.existsSync, real = (p) => fs.realpathSync(p)) {
  if (!node.includes('/Cellar/')) return node;
  for (const link of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { if (exists(link) && real(link) === real(node)) return link; } catch { /* not this one */ }
  }
  return node;
}

// launchctl, as { code, out }; never a throw.
export const launchctl = (args) => new Promise((resolve) => {
  execFile('/bin/launchctl', args, { timeout: 15000 }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}` });
  });
});

// Makes sure the agent is there, up to date and loaded. → { label } when this app's own agent looks after it,
// { other: '<file>' } when another agent already does. Writing and loading only happen when something changed,
// so a click on the icon never stops an app that is running as it should.
export async function ensureAgent({ root, node, home = os.homedir(), uid = process.getuid(), label = AGENT_LABEL, pathList, run = launchctl }) {
  const other = otherAgent({ root, home, label });
  if (other) return { other };
  const file = agentFile(home, label);
  const want = agentPlist({ root, node, home, label, pathList });
  let have = null;
  try { have = fs.readFileSync(file, 'utf8'); } catch { /* not there yet */ }
  const target = `gui/${uid}/${label}`;
  const loaded = (await run(['print', target])).code === 0;
  if (have === want && loaded) return { label, changed: false };
  if (have !== want) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(path.dirname(logFile(home)), { recursive: true });
    fs.writeFileSync(file, want);
    if (loaded) await run(['bootout', target]);
  }
  const loading = await run(['bootstrap', `gui/${uid}`, file]);
  // Loaded already (a race with a log-in) counts as loaded.
  if (loading.code !== 0 && (await run(['print', target])).code !== 0) {
    throw new Error(`The Mac would not start Sovran Advisor by itself (${loading.out.trim() || `launchctl ${loading.code}`}).`);
  }
  return { label, changed: true };
}

export const startAgent = ({ uid = process.getuid(), label = AGENT_LABEL, run = launchctl } = {}) => run(['kickstart', `gui/${uid}/${label}`]);

export async function removeAgent({ home = os.homedir(), uid = process.getuid(), label = AGENT_LABEL, run = launchctl } = {}) {
  await run(['bootout', `gui/${uid}/${label}`]);
  fs.rmSync(agentFile(home, label), { force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') {
    console.log('This is for a Mac only. Nothing was changed.');
  } else {
    const { launchPath } = await import('./desktop-server.js');
    const root = fileURLToPath(new URL('../', import.meta.url));
    try {
      if (process.argv.includes('--remove')) {
        await removeAgent();
        console.log('Sovran Advisor no longer starts by itself when you log in. Open it from its icon.');
      } else {
        const done = await ensureAgent({ root, node: steadyNode(), pathList: launchPath() });
        console.log(done.other
          ? `Another login agent (${done.other}) already starts this copy of Sovran Advisor. It was left as it is.`
          : 'Sovran Advisor now starts when you log in, stops when you log out, and starts again if it ever stops.');
      }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
