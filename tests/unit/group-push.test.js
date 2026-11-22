// Waking a phone (cloud/group-feed/push.js): the VAPID header a push service checks, and what a wake does with its
// answers. The same file runs in the Supabase web function; here it runs in Node with Node's own Web Crypto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVapid, vapidHeader, wake, fromB64url } from '../../cloud/group-feed/push.js';

test('a new key pair: the public key is the raw P-256 point a phone needs (65 bytes, starting 0x04)', async () => {
  const v = await makeVapid();
  const raw = fromB64url(v.public_key);
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  assert.equal(v.private_jwk.kty, 'EC');
  assert.ok(v.private_jwk.d);
});

test('the header is a token signed with that key, for the push service’s own address, with the public key', async () => {
  const v = await makeVapid();
  const now = 1_800_000_000;
  const header = await vapidHeader('https://web.push.apple.com/QGuQ-made-up', v, 'https://daniel-piatek.github.io/sovran-advisor-app/', now);
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, header);
  const read = (part) => JSON.parse(new TextDecoder().decode(fromB64url(part)));
  assert.deepEqual(read(m[1]), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(read(m[2]), { aud: 'https://web.push.apple.com', exp: now + 12 * 3600, sub: 'https://daniel-piatek.github.io/sovran-advisor-app/' });
  assert.equal(m[4], v.public_key);
  const pub = await crypto.subtle.importKey('raw', fromB64url(v.public_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sig = fromB64url(m[3]);
  assert.equal(sig.length, 64); // r and s, as JWS wants (not DER)
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, new TextEncoder().encode(`${m[1]}.${m[2]}`)));
});

test('a wake sends nothing but the header, and says sent, gone or failed', async () => {
  const v = await makeVapid();
  const asked = [];
  const answering = (status) => async (url, init) => { asked.push({ url, init }); return new Response(null, { status }); };
  assert.equal(await wake('https://fcm.googleapis.com/fcm/send/x', v, 'https://x.test/', answering(201)), 'sent');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.body, undefined); // no words: the phone fetches them with its own key
  assert.match(asked[0].init.headers.authorization, /^vapid t=/);
  assert.equal(asked[0].init.headers.ttl, '86400');
  assert.equal(await wake('https://fcm.googleapis.com/fcm/send/x', v, 'https://x.test/', answering(410)), 'gone');
  assert.equal(await wake('https://fcm.googleapis.com/fcm/send/x', v, 'https://x.test/', answering(404)), 'gone');
  assert.equal(await wake('https://fcm.googleapis.com/fcm/send/x', v, 'https://x.test/', answering(429)), 'failed');
  assert.equal(await wake('https://fcm.googleapis.com/fcm/send/x', v, 'https://x.test/', async () => { throw new Error('offline'); }), 'failed');
});
