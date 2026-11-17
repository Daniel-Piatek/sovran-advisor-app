// Sealing a saved chat for one student's computer ("Keep this chat saved"). The computer makes a pair of keys:
// the private one never leaves it, the public one is registered in the Sovran drop box. The Sovran Library
// (library-mcp) seals each saved part to that public key, so what waits in the drop box can be opened only by
// that computer: not by the drop box, not by the library, not by the database.
// How: a one-time key pair for each part (ECDH on P-256), HKDF-SHA-256 to an AES-256-GCM key.
// Sealed text: base64url of [65 bytes one-time public key][12 random bytes][the scrambled words].
// Plain Web Crypto, the same code in the app (Node), the library's web function (Deno) and the tests.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode('sovran-keep-this-chat-saved-v1');
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64(text) {
  const t = String(text);
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// A public key as it is registered: base64url of the 65 raw bytes (87 characters).
export const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;

// The computer's pair: { public: '<87 characters>', private: <JWK, stays on the computer> }.
export async function makeSaveKeys() {
  const pair = await subtle.generateKey(CURVE, true, ['deriveBits']);
  return { public: toB64(new Uint8Array(await subtle.exportKey('raw', pair.publicKey))), private: await subtle.exportKey('jwk', pair.privateKey) };
}

async function aesKey(privateKey, publicKey, oneTimeRaw, ownRaw, use) {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const salt = new Uint8Array(130);
  salt.set(oneTimeRaw); salt.set(ownRaw, 65);
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
}

// note (any JSON) → sealed text that only the holder of the private key can open.
export async function sealTo(publicB64, note) {
  if (!PUBLIC_KEY.test(String(publicB64))) throw new Error('Not a public key.');
  const ownRaw = fromB64(publicB64);
  const their = await subtle.importKey('raw', ownRaw, CURVE, false, []);
  const once = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const onceRaw = new Uint8Array(await subtle.exportKey('raw', once.publicKey));
  const key = await aesKey(once.privateKey, their, onceRaw, ownRaw, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(note))));
  const all = new Uint8Array(77 + out.length);
  all.set(onceRaw); all.set(iv, 65); all.set(out, 77);
  return toB64(all);
}

// Sealed text → the note. Throws when it was not sealed to these keys, or was changed on the way.
export async function openSealed(keys, sealed) {
  const all = fromB64(sealed);
  if (all.length < 78 || all[0] !== 4) throw new Error('Not sealed to a public key.');
  const onceRaw = all.slice(0, 65);
  const mine = await subtle.importKey('jwk', keys.private, CURVE, false, ['deriveBits']);
  const once = await subtle.importKey('raw', onceRaw, CURVE, false, []);
  const key = await aesKey(mine, once, onceRaw, fromB64(keys.public), 'decrypt');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(65, 77) }, key, all.slice(77));
  return JSON.parse(dec.decode(plain));
}
