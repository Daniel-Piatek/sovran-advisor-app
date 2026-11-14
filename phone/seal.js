// Sealing a phone note (module phone-drop), shared by the phone page (phone/phone.js) and the app (phone-drop.js).
// AES-GCM with a 256-bit key that only the student's phone and computer have: it travels in the part of the link
// after "#", which a browser never sends to any server. What reaches the drop box is the sealed text alone:
// base64url of 12 random bytes followed by the scrambled words.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export const randomB64 = (n) => toB64(globalThis.crypto.getRandomValues(new Uint8Array(n)));

const keyOf = (key) => subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

// { body, world, at } → sealed text.
export async function seal(key, note) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(key), enc.encode(JSON.stringify(note))));
  const all = new Uint8Array(12 + out.length);
  all.set(iv); all.set(out, 12);
  return toB64(all);
}

// Sealed text → { body, world, at }. Throws when it was not sealed with this key, or was changed on the way.
export async function unseal(key, sealed) {
  const all = fromB64(sealed);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await keyOf(key), all.slice(12));
  return JSON.parse(dec.decode(plain));
}

// The link's part after "#": v1.<box>.<drop token>.<key>.
export const LINK_PART = /^v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
export function readLinkPart(hash) {
  const m = LINK_PART.exec(String(hash ?? '').replace(/^#/, ''));
  return m ? { box: m[1], drop: m[2], key: m[3] } : null;
}
