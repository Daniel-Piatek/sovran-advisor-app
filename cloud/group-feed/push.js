// Waking a phone (alerts on the phone, cloud/group-push.sql). Plain JavaScript with only the Web Crypto API, so the
// same file runs in the Supabase web function (Deno) and in the app's own tests (Node).
//
// A wake is an empty Web Push message (RFC 8030) signed with VAPID (RFC 8292): no words go through Apple's or Google's
// servers, so nothing needs encrypting. The phone fetches what waits for it with its own key.

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0));

// A new key pair: { public_key (base64url of the raw point, what the phone needs), private_jwk }.
export async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { public_key: b64url(raw), private_jwk: jwk };
}

// The Authorization header for one push service: "vapid t=<signed token>, k=<public key>".
// subject: a page of the sender's (Apple wants an https address or a mailto).
export async function vapidHeader(endpoint, vapid, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: nowSec + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', vapid.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)); // r||s, as JWS wants
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.public_key}`;
}

// Wakes one phone. Returns 'sent', 'gone' (the address is no more: forget it) or 'failed'.
export async function wake(endpoint, vapid, subject, fetcher = fetch) {
  try {
    const res = await fetcher(endpoint, { method: 'POST', headers: { authorization: await vapidHeader(endpoint, vapid, subject), ttl: '86400', urgency: 'normal', 'content-length': '0' } });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}

export { b64url, fromB64url };
