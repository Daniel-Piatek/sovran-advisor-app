// A stand-in for Google's sign-in, token and revoke endpoints (advanced/mail/1): no test talks to
// the real Google or holds a real client. Its sign-in page answers at once as if "Allow" was clicked.

import http from 'node:http';
import crypto from 'node:crypto';

export const FAKE_CLIENT_ID = 'test-client-123456.apps.googleusercontent.com';
export const FAKE_CLIENT_SECRET = 'GOCSPX-test-secret-value';
export const SCOPES = { read: 'https://www.googleapis.com/auth/gmail.readonly', send: 'https://www.googleapis.com/auth/gmail.send', modify: 'https://www.googleapis.com/auth/gmail.modify', calendarRead: 'https://www.googleapis.com/auth/calendar.readonly', calendarModify: 'https://www.googleapis.com/auth/calendar.events' };

const b64url = (text) => Buffer.from(text).toString('base64url');

export async function startFakeGoogle() {
  const codes = new Map(); // code → { scope, email, challenge }
  const granted = new Map(); // email → Set of scopes given so far
  const refreshes = new Map(); // refresh token → email
  const fake = {
    email: 'work@mypractice.com', // who "signs in" when the request names nobody
    deny: false, // the sign-in page answers "no"
    offline: false, // every call fails like a lost connection
    revoked: new Set(), // refresh tokens Google no longer accepts
    seen: [], // { path, params } of every call
    secrets: { refresh: [], access: [] }, // every token handed out, so a test can look for it on disk
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (fake.offline) return req.socket.destroy();
    const body = await new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString())); });
    const params = url.pathname === '/auth' ? url.searchParams : new URLSearchParams(body);
    fake.seen.push({ path: url.pathname, params: Object.fromEntries(params) });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    if (url.pathname === '/auth') {
      const target = new URL(params.get('redirect_uri'));
      if (fake.deny) target.searchParams.set('error', 'access_denied');
      else {
        const code = `code-${crypto.randomUUID()}`;
        const email = params.get('login_hint') || fake.email;
        codes.set(code, { scope: params.get('scope'), email, challenge: params.get('code_challenge') });
        target.searchParams.set('code', code);
      }
      target.searchParams.set('state', params.get('state'));
      res.writeHead(302, { Location: target.href });
      return res.end();
    }
    if (url.pathname === '/revoke') {
      fake.revoked.add(params.get('token'));
      return json(200, {});
    }
    if (url.pathname === '/token') {
      if (params.get('client_id') !== FAKE_CLIENT_ID || params.get('client_secret') !== FAKE_CLIENT_SECRET) return json(401, { error: 'invalid_client' });
      if (params.get('grant_type') === 'authorization_code') {
        const entry = codes.get(params.get('code'));
        codes.delete(params.get('code'));
        const proof = crypto.createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url');
        if (!entry || proof !== entry.challenge) return json(400, { error: 'invalid_grant' });
        const have = granted.get(entry.email) ?? new Set();
        for (const s of entry.scope.split(' ')) have.add(s);
        granted.set(entry.email, have);
        const refresh = `refresh-${crypto.randomUUID()}`;
        const access = `access-${crypto.randomUUID()}`;
        refreshes.set(refresh, entry.email);
        fake.secrets.refresh.push(refresh);
        fake.secrets.access.push(access);
        return json(200, {
          access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: [...have].join(' '),
          id_token: `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ email: entry.email, email_verified: true }))}.x`,
        });
      }
      if (params.get('grant_type') === 'refresh_token') {
        const refresh = params.get('refresh_token');
        if (!refreshes.has(refresh) || fake.revoked.has(refresh)) return json(400, { error: 'invalid_grant' });
        const access = `access-${crypto.randomUUID()}`;
        fake.secrets.access.push(access);
        return json(200, { access_token: access, expires_in: 3600, token_type: 'Bearer' });
      }
    }
    return json(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fake.env = { GOOGLE_AUTH_URL: `${base}/auth`, GOOGLE_TOKEN_URL: `${base}/token`, GOOGLE_REVOKE_URL: `${base}/revoke` };
  return fake;
}
