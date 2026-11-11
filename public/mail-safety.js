// Reading a mail safely (Mail 7): what to check about a mail's own html before and while it is shown in the sealed frame.
// Plain functions on text, no page needed, so they are tried in tests. The frame itself is in mail-app.js.

// The policy a mail is shown under: no scripts, no fonts or styles from outside, no network; images only when you said so.
export const framePolicy = (images) => `default-src 'none'; style-src 'unsafe-inline'; img-src ${images ? 'https: data:' : 'data:'}`;

const decode = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Every link: the words it shows and where it goes.
export function findLinks(html) {
  const links = [];
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    const target = decode(href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
    if (/^https?:\/\//i.test(target)) links.push({ text: stripTags(m[2]), target });
  }
  return links;
}

export function hostOf(address) {
  try { return new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

const sameSite = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

// A link whose words name one address while it goes to another: marked before you click.
export function suspiciousLinks(html) {
  const marked = [];
  for (const link of findLinks(html)) {
    const named = [...link.text.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/\s]|$)/gi)].map((m) => hostOf(m[1]));
    const goesTo = hostOf(link.target);
    if (named.length && goesTo && !named.some((n) => sameSite(n, goesTo))) marked.push({ ...link, shown: named[0], goesTo });
  }
  return marked;
}

// The images a mail would fetch from the network: how many, and from where.
export function remoteImages(html) {
  const hosts = new Set();
  let count = 0;
  for (const m of String(html).matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const src = decode(m[1] ?? m[2] ?? m[3] ?? '');
    if (/^https?:\/\//i.test(src) || /^\/\//.test(src)) { count++; hosts.add(hostOf(src.replace(/^\/\//, 'https://'))); }
  }
  for (const m of String(html).matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+)/gi)) { count++; hosts.add(hostOf(m[1])); }
  return { count, hosts: [...hosts].filter(Boolean) };
}

// What goes into the frame: the mail's html with what must never run taken out (scripts, event handlers), and, while the sender's
// images are held back, every remote image taken out too, so the browser does not even ask for one. The frame's own policy is
// still there as the guarantee; this keeps the quiet case quiet.
export function cleanForFrame(html, { images = false } = {}) {
  let out = String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (!images) {
    out = out
      .replace(/(<img\b[^>]*?\s)src\s*=\s*(?:"(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*'|(?:https?:)?\/\/[^\s>]+)/gi, '$1src="data:,"')
      .replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
      .replace(/\sbackground\s*=\s*(?:"(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*')/gi, '')
      .replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^'")\s]*\1\s*\)/gi, 'url()');
  }
  return out;
}
