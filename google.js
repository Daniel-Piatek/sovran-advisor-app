// Google (the Mail module, advanced/mail/1): one sign-in per Google account, made with the owner's own
// Google Cloud client, so nothing and nobody sits between this app and Google.
//   - The tokens that prove a sign-in live in the system's key store (the macOS Keychain), never in the
//     database, a file in data/, the browser, a prompt or a log. The client's secret does too.
//   - A permission is a switch (Read your mail, Send mail as you). Google is asked for it only when the
//     switch is first turned on, and what was allowed before is kept (incremental authorisation).
//   - Every account has a health: whether Google still lets the app in.
//   - Any part of the app that needs Google asks `accessToken`, which checks the switch and logs the use.

import { spawn } from 'node:child_process';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const now = () => new Date().toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export const PERMISSIONS = [
  { id: 'mail.read', name: 'Read your mail', scope: 'https://www.googleapis.com/auth/gmail.readonly' },
  { id: 'mail.send', name: 'Send mail as you', scope: 'https://www.googleapis.com/auth/gmail.send' },
  { id: 'mail.modify', name: 'Change your mail in Gmail', scope: 'https://www.googleapis.com/auth/gmail.modify' }, // archive, star, label: what you change here goes back (Mail 4)
  { id: 'calendar.read', name: 'Read your calendar', scope: 'https://www.googleapis.com/auth/calendar.readonly' }, // your Google events on your days (Calendar in depth 7)
  { id: 'calendar.modify', name: 'Change your calendar', scope: 'https://www.googleapis.com/auth/calendar.events' }, // off until a later lesson needs it (Calendar 8)
];
const permissionOf = (id) => PERMISSIONS.find((p) => p.id === id);
const IDENTITY = ['openid', 'email'];
const CLIENT_ID_SETTING = 'google.client_id';
const SERVICE = 'Sovran Advisor · Google';
const PENDING_MINUTES = 10;

const endpoints = (env = process.env) => ({
  auth: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revoke: env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
});

// ---- The key store ----
// A key store keeps small secrets by name: get(name) → string | null, set(name, value), remove(name).

// The macOS Keychain through its own `security` command. The secret is written on the command's standard
// input (`security -i`), never in its arguments, where another process could read it; it is kept as hex so
// no character needs quoting.
function runSecurity(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}
const quote = (text) => `"${String(text).replace(/(["\\])/g, '\\$1')}"`;

export function macKeyStore({ service = SERVICE } = {}) {
  return {
    name: 'the macOS Keychain',
    async get(name) {
      const { code, out } = await runSecurity(['find-generic-password', '-a', name, '-s', service, '-w']);
      if (code !== 0 || !out) return null;
      try { return Buffer.from(out, 'hex').toString('utf8'); } catch { return null; }
    },
    async set(name, value) {
      const hex = Buffer.from(String(value), 'utf8').toString('hex');
      const { code } = await runSecurity(['-i'], `add-generic-password -a ${quote(name)} -s ${quote(service)} -w ${hex} -U\n`);
      if (code !== 0) throw fail(500, 'The Keychain would not keep that. Is it locked?');
    },
    async remove(name) {
      await runSecurity(['delete-generic-password', '-a', name, '-s', service]);
    },
  };
}

// A stand-in for tests: a folder with a file per name (GOOGLE_KEY_STORE_DIR). Never chosen unless asked for.
export function fileKeyStore(dir) {
  const file = (name) => path.join(dir, `${crypto.createHash('sha256').update(name).digest('hex')}.secret`);
  return {
    name: 'a test key store',
    dir,
    async get(name) { try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; } },
    async set(name, value) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(name), String(value), { mode: 0o600 }); },
    async remove(name) { fs.rmSync(file(name), { force: true }); },
  };
}

export function defaultKeyStore(env = process.env, platform = process.platform, { service } = {}) {
  if (env.GOOGLE_KEY_STORE_DIR) return fileKeyStore(env.GOOGLE_KEY_STORE_DIR);
  if (platform === 'darwin') return macKeyStore(service ? { service } : {});
  const nope = async () => { throw fail(501, 'This computer has no key store the app can use yet; Google sign-in works on a Mac.'); };
  return { name: 'no key store', get: async () => null, set: nope, remove: async () => {} };
}

const secretName = 'client-secret';
const tokenName = (email) => `token:${email.toLowerCase()}`;

// ---- The log ----

export function logGoogle(db, accountId, what) {
  const time = now();
  db.prepare('INSERT INTO google_log (id, created_at, updated_at, account_id, what) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), time, time, accountId ?? null, what);
}
const recentLog = (db, limit = 15) => db.prepare(`SELECT l.created_at, l.what, a.email FROM google_log l
  LEFT JOIN google_accounts a ON a.id = l.account_id WHERE l.deleted_at IS NULL ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`).all(limit)
  .map((r) => ({ created_at: r.created_at, what: r.what, email: r.email ?? null }));

// ---- The accounts ----

const list = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
function accountOf(row) {
  const granted = list(row.granted);
  const enabled = list(row.enabled).filter((id) => granted.includes(id));
  return {
    id: row.id, email: row.email, health: row.health, health_checked_at: row.health_checked_at,
    permissions: PERMISSIONS.map((p) => ({ id: p.id, name: p.name, granted: granted.includes(p.id), on: enabled.includes(p.id) })),
  };
}
const rowById = (db, id) => db.prepare('SELECT * FROM google_accounts WHERE id = ? AND deleted_at IS NULL').get(id);
export const listAccounts = (db) => db.prepare('SELECT * FROM google_accounts WHERE deleted_at IS NULL ORDER BY created_at, rowid').all().map(accountOf);

function setAccount(db, id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE google_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), now(), id);
}

// ---- The client (the owner's own, from their Google Cloud project) ----

const clientId = (db) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(CLIENT_ID_SETTING);
  try { return JSON.parse(row?.value ?? 'null') || ''; } catch { return ''; }
};

export async function getGoogle(db, keyStore, { problem = '' } = {}) {
  const id = clientId(db);
  const secret = id ? await keyStore.get(secretName) : null;
  return {
    configured: Boolean(id && secret),
    client_id: id, // not a secret: it is in the address of Google's sign-in page
    key_store: keyStore.name,
    permissions: PERMISSIONS.map(({ id: pid, name }) => ({ id: pid, name })),
    accounts: listAccounts(db),
    log: recentLog(db),
    ...(problem ? { problem } : {}),
  };
}

export async function saveClient(db, keyStore, { client_id, client_secret }) {
  const id = String(client_id ?? '').trim();
  const secret = String(client_secret ?? '').trim();
  if (id.length < 10 || id.length > 300 || /\s/.test(id)) throw fail(400, 'That does not look like a client ID: it is one piece of text with no spaces.');
  if (secret.length < 8 || secret.length > 300 || /\s/.test(secret)) throw fail(400, 'That does not look like a client secret: it is one piece of text with no spaces.');
  await keyStore.set(secretName, secret);
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, CLIENT_ID_SETTING, JSON.stringify(id));
  logGoogle(db, null, 'Google client saved (the secret is in the key store).');
}

export async function removeClient(db, keyStore) {
  await keyStore.remove(secretName);
  db.prepare('UPDATE settings SET deleted_at = ?, updated_at = ? WHERE key = ? AND deleted_at IS NULL').run(now(), now(), CLIENT_ID_SETTING);
  logGoogle(db, null, 'Google client removed.');
}

// ---- Signing in (PKCE, back to this computer) ----

const b64url = (buf) => buf.toString('base64url');
const idTokenEmail = (idToken) => {
  try { return String(JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email ?? '').toLowerCase(); } catch { return ''; }
};

// The address of Google's own page. `pending` remembers the sign-ins under way (state → what is needed to finish).
// Only a path of this app is a place to come back to (never another address, never a line break).
export const safeReturn = (path) => (/^\/(?!\/)[A-Za-z0-9\/?=&%_.\-:]*$/.test(String(path)) ? String(path) : '');

// returnTo: a page of this app to come back to afterwards (a path like /mail?thread=…), instead of Settings.
export async function beginSignIn(db, keyStore, { pending, redirectUri, accountId = null, permission = null, returnTo = '', env = process.env }) {
  const id = clientId(db);
  if (!id || !(await keyStore.get(secretName))) throw fail(409, 'Add your Google client first (its ID and secret).', 'no_client');
  let account = null;
  if (accountId) {
    account = rowById(db, accountId);
    if (!account) throw fail(404, 'No such Google account.');
  }
  const perm = permission ? permissionOf(permission) : null;
  if (permission && !perm) throw fail(400, 'No such permission.');

  for (const [state, entry] of pending) if (Date.now() - entry.at > PENDING_MINUTES * 60_000) pending.delete(state);
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { verifier, redirectUri, accountId: account?.id ?? null, permission: perm?.id ?? null, returnTo: safeReturn(returnTo), at: Date.now() });

  // Only what this step needs: who you are, plus the one permission being switched on. Google adds what you
  // allowed before (include_granted_scopes).
  const params = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri, response_type: 'code',
    scope: [...IDENTITY, ...(perm ? [perm.scope] : [])].join(' '),
    state, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    ...(account ? { login_hint: account.email } : {}),
  });
  return { url: `${endpoints(env).auth}?${params}` };
}

async function tokenCall(body, { env, fetcher }) {
  let res;
  try {
    res = await fetcher(endpoints(env).token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  } catch {
    throw fail(502, 'Google could not be reached. Is this computer online?', 'unreachable');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error === 'invalid_grant' ? 'needs_signin' : 'refused';
    throw fail(res.status === 400 || res.status === 401 ? 400 : 502, `Google said no${data.error ? ` (${data.error})` : ''}.`, code);
  }
  return data;
}

const permissionsIn = (scopeText) => PERMISSIONS.filter((p) => String(scopeText ?? '').split(/\s+/).includes(p.scope)).map((p) => p.id);

// Google has sent the browser back with a code: swap it for tokens, keep them in the key store, note the account.
export async function finishSignIn(db, keyStore, { pending, state, code, env = process.env, fetcher = fetch }) {
  const entry = pending.get(state);
  if (!entry) throw fail(400, 'That sign-in was not started here, or it took too long. Start it again.');
  pending.delete(state);
  const secret = await keyStore.get(secretName);
  const data = await tokenCall({
    grant_type: 'authorization_code', code, client_id: clientId(db), client_secret: secret ?? '',
    redirect_uri: entry.redirectUri, code_verifier: entry.verifier,
  }, { env, fetcher });
  const email = idTokenEmail(data.id_token);
  if (!email) throw fail(502, 'Google did not say which account that was.');
  const before = entry.accountId ? rowById(db, entry.accountId) : db.prepare('SELECT * FROM google_accounts WHERE lower(email) = ? AND deleted_at IS NULL').get(email);
  if (before && before.email.toLowerCase() !== email) throw fail(400, `That was ${email}, not ${before.email}. Choose ${before.email} on Google's page.`);

  const old = JSON.parse((await keyStore.get(tokenName(email))) ?? 'null') ?? {};
  const refresh = data.refresh_token || old.refresh_token;
  if (!refresh) throw fail(502, 'Google gave no lasting sign-in. Remove this app in your Google account and try again.');
  await keyStore.set(tokenName(email), JSON.stringify({
    refresh_token: refresh, access_token: data.access_token ?? null,
    expires_at: Date.now() + (Number(data.expires_in) || 0) * 1000,
  }));

  const granted = [...new Set([...list(before?.granted), ...permissionsIn(data.scope)])];
  const enabled = new Set(list(before?.enabled));
  if (entry.permission && granted.includes(entry.permission)) enabled.add(entry.permission);
  const time = now();
  let id = before?.id;
  if (id) {
    setAccount(db, id, { granted: JSON.stringify(granted), enabled: JSON.stringify([...enabled]), health: 'ok', health_checked_at: time });
  } else {
    id = randomUUID();
    db.prepare('INSERT INTO google_accounts (id, created_at, updated_at, email, granted, enabled, health, health_checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, time, time, email, JSON.stringify(granted), JSON.stringify([...enabled]), 'ok', time);
  }
  logGoogle(db, id, entry.permission ? `${email} allowed “${permissionOf(entry.permission).name}”.` : `${email} signed in.`);
  return { ...accountOf(rowById(db, id)), return_to: entry.returnTo };
}

// ---- The switches ----
// On for a permission Google already gave: no question. Otherwise the answer is the address of Google's page.
export async function switchPermission(db, keyStore, { pending, redirectUri, id, permission, on, returnTo = '', env }) {
  const row = rowById(db, id);
  const perm = permissionOf(permission);
  if (!row) throw fail(404, 'No such Google account.');
  if (!perm) throw fail(400, 'No such permission.');
  if (typeof on !== 'boolean') throw fail(400, 'on is true or false.');
  const granted = list(row.granted);
  const enabled = new Set(list(row.enabled));
  if (on && !granted.includes(perm.id)) {
    return { url: (await beginSignIn(db, keyStore, { pending, redirectUri, accountId: id, permission: perm.id, returnTo, env })).url };
  }
  if (on) enabled.add(perm.id); else enabled.delete(perm.id);
  setAccount(db, id, { enabled: JSON.stringify([...enabled]) });
  logGoogle(db, id, `${row.email}: “${perm.name}” switched ${on ? 'on' : 'off'}.`);
  return { account: accountOf(rowById(db, id)) };
}

// ---- Using it, and its health ----

// A fresh access token for one account. `permission` is what the caller wants it for: it must be switched on.
export async function accessToken(db, keyStore, { id, permission, why = '' }, { env = process.env, fetcher = fetch } = {}) {
  const row = rowById(db, id);
  if (!row) throw fail(404, 'No such Google account.');
  if (permission) {
    const perm = permissionOf(permission);
    if (!perm || !list(row.enabled).includes(perm.id) || !list(row.granted).includes(perm.id)) {
      logGoogle(db, id, `Refused: ${why || 'a part of the app'} asked for “${perm?.name ?? permission}” on ${row.email}, which is off.`);
      throw fail(403, `“${perm?.name ?? permission}” is switched off for ${row.email}.`, 'switched_off');
    }
  }
  const kept = JSON.parse((await keyStore.get(tokenName(row.email))) ?? 'null');
  if (!kept?.refresh_token) {
    setAccount(db, id, { health: 'needs_signin', health_checked_at: now() });
    throw fail(409, `The sign-in for ${row.email} is gone from the key store. Sign in again.`, 'needs_signin');
  }
  let token = kept.access_token;
  if (!token || kept.expires_at < Date.now() + 60_000) {
    const data = await tokenCall({
      grant_type: 'refresh_token', refresh_token: kept.refresh_token, client_id: clientId(db), client_secret: (await keyStore.get(secretName)) ?? '',
    }, { env, fetcher });
    token = data.access_token;
    await keyStore.set(tokenName(row.email), JSON.stringify({ ...kept, access_token: token, expires_at: Date.now() + (Number(data.expires_in) || 0) * 1000 }));
  }
  if (permission) logGoogle(db, id, `${why || 'A part of the app'} used “${permissionOf(permission).name}” on ${row.email}.`);
  return token;
}

// Does Google still let the app in? Asks for a fresh token and notes the answer.
export async function checkHealth(db, keyStore, id, { env = process.env, fetcher = fetch } = {}) {
  const row = rowById(db, id);
  if (!row) throw fail(404, 'No such Google account.');
  let health = 'ok';
  try {
    const kept = JSON.parse((await keyStore.get(tokenName(row.email))) ?? 'null');
    if (!kept?.refresh_token) health = 'needs_signin';
    else {
      const data = await tokenCall({
        grant_type: 'refresh_token', refresh_token: kept.refresh_token, client_id: clientId(db), client_secret: (await keyStore.get(secretName)) ?? '',
      }, { env, fetcher });
      await keyStore.set(tokenName(row.email), JSON.stringify({ ...kept, access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) || 0) * 1000 }));
    }
  } catch (err) {
    if (err.code === 'unreachable') health = 'unreachable';
    else if (err.code === 'needs_signin' || err.code === 'refused') health = 'needs_signin';
    else throw err;
  }
  setAccount(db, id, { health, health_checked_at: now() });
  logGoogle(db, id, `Checked ${row.email}: ${{ ok: 'connected', needs_signin: 'Google no longer lets the app in', unreachable: 'Google could not be reached' }[health]}.`);
  return accountOf(rowById(db, id));
}

// Sign out: Google is told to forget the sign-in, the key store forgets the tokens, the row is marked deleted.
export async function disconnect(db, keyStore, id, { env = process.env, fetcher = fetch } = {}) {
  const row = rowById(db, id);
  if (!row) throw fail(404, 'No such Google account.');
  const kept = JSON.parse((await keyStore.get(tokenName(row.email))) ?? 'null');
  if (kept?.refresh_token) {
    try { await fetcher(endpoints(env).revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: kept.refresh_token }) }); } catch { /* offline: the key store still forgets it */ }
  }
  await keyStore.remove(tokenName(row.email));
  const time = now();
  db.prepare('UPDATE google_accounts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, id);
  logGoogle(db, id, `${row.email} disconnected.`);
}
