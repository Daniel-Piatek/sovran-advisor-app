// A pasted link in a capture shows the page's title (assistant/3). After a capture is saved
// the server reads the first web address in its words, in the background: saving never waits
// for it, and a page that can't be read leaves the capture as it is. The app asks the page
// for nothing but its title: only http(s), never this computer or the local network, five
// seconds, the first 200 KB, no cookies.

import dns from 'node:dns/promises';
import net from 'node:net';

export const firstUrl = (text) => {
  const found = /https?:\/\/[^\s<>()\]"']+/i.exec(text ?? '');
  return found ? found[0].replace(/[.,;:!?]+$/, '') : null;
};

// The page's <title>, with its entities read and its spaces tidied; '' when there is none.
export function titleOfHtml(html) {
  const found = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!found) return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return found[1]
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      return named[code.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Not this computer, not the local network, not a name the world doesn't know.
export function isPrivateAddress(address) {
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    return a === '::1' || a === '::' || a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd')
      || (a.startsWith('::ffff:') && isPrivateAddress(a.slice(7)));
  }
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function fetchTitle(url) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(current.protocol)) return '';
    const host = current.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return '';
    const res = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { Accept: 'text/html', 'User-Agent': 'APP-Daniel-link-title' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return '';
    const reader = res.body.getReader();
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 200_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return titleOfHtml(html);
  }
  return '';
}

// Reads the first link of a capture and keeps its title on it. `fetcher` is for tests.
export async function readLink(db, id, { fetcher = fetchTitle } = {}) {
  const row = db.prepare('SELECT body, link_url FROM captures WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) return;
  const url = firstUrl(row.body);
  if (url === (row.link_url || null)) return;
  if (!url) {
    db.prepare("UPDATE captures SET link_url = NULL, link_title = NULL WHERE id = ?").run(id);
    return;
  }
  let title = '';
  try { title = await fetcher(url); } catch { /* an unreadable page leaves the capture as it is */ }
  db.prepare('UPDATE captures SET link_url = ?, link_title = ? WHERE id = ? AND deleted_at IS NULL').run(url, title || null, id);
}
