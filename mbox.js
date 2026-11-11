// Reading a mailbox file (the Mail module, advanced/mail/2): the .mbox that Google Takeout gives, read one
// message at a time so a file of many gigabytes never fills the memory, and each message read into its
// parts: who, to whom, when, the subject, Gmail's labels and thread, the text and the names of attachments.
// Nothing here touches a file or the database: it works on text, so it can be tried on any text.
//
// Text is handled as "latin1": one character per byte, so no byte is lost until a part says which
// character set it is in (a header may say =?UTF-8?B?...?=, a body Content-Type says charset=...).

// ---- Splitting a file into messages ----

// A message starts at a line "From <id> <date>", as Google writes it (and ">From" inside a text).
const FROM_LINE = /^From \S+\s+[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}/;

export class MboxSplitter {
  // onMessage({ fromLine, raw }) is called once for every message, as soon as the next one begins.
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.carry = '';
    this.fromLine = null;
    this.lines = [];
  }

  push(chunk) {
    const parts = (this.carry + (typeof chunk === 'string' ? chunk : chunk.toString('latin1'))).split('\n');
    this.carry = parts.pop();
    for (const line of parts) this.#line(line);
  }

  end() {
    if (this.carry) this.#line(this.carry);
    this.carry = '';
    this.#flush();
  }

  #line(line) {
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (bare.startsWith('From ') && FROM_LINE.test(bare)) {
      this.#flush();
      this.fromLine = bare;
      return;
    }
    if (this.fromLine !== null) this.lines.push(line);
  }

  #flush() {
    if (this.fromLine === null) return;
    const { lines } = this;
    if (lines.length && lines[lines.length - 1].replace(/\r$/, '') === '') lines.pop(); // the blank line before the next message
    const message = { fromLine: this.fromLine, raw: lines.join('\n') };
    this.fromLine = null;
    this.lines = [];
    this.onMessage(message);
  }
}

// ---- Text, bytes and character sets ----

const bytesOf = (text) => Buffer.from(text, 'latin1');

// Bytes in a named character set. A set this computer does not know is read as UTF-8.
export function decodeBytes(buffer, charset = 'utf-8') {
  const label = String(charset || 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!label || label === 'us-ascii' || label === 'ascii' || label === 'utf-8' || label === 'utf8') {
    const text = buffer.toString('utf8');
    // Something that says it is plain but is not UTF-8 is nearly always Windows-1252.
    return text.includes('�') && label !== 'utf-8' && label !== 'utf8' ? new TextDecoder('windows-1252').decode(buffer) : text;
  }
  try { return new TextDecoder(label).decode(buffer); } catch { return buffer.toString('utf8'); }
}

export function decodeQuotedPrintable(text) {
  const source = text.replace(/=\r?\n/g, '');
  const out = Buffer.alloc(source.length);
  let n = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === 61 /* = */ && i + 2 < source.length && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      out[n++] = parseInt(source.slice(i + 1, i + 3), 16);
      i += 2;
    } else out[n++] = c & 0xff;
  }
  return out.subarray(0, n);
}

// A header may hold 8-bit text that is really UTF-8 (a few programs do that).
function headerText(value) {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(value)) return value;
  const text = bytesOf(value).toString('utf8');
  return text.includes('�') ? value : text;
}

// =?UTF-8?B?...?= and =?ISO-8859-1?Q?...?= words, as in a Subject or a name.
export function decodeWords(value) {
  const text = headerText(String(value ?? ''));
  return text
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset, how, data) => {
      try {
        const buffer = how.toLowerCase() === 'b'
          ? Buffer.from(data, 'base64')
          : decodeQuotedPrintable(data.replace(/_/g, ' '));
        return decodeBytes(buffer, charset.replace(/\*.*$/, ''));
      } catch { return whole; }
    });
}

// ---- Headers ----

function splitHeadBody(text) {
  const m = /\r?\n\r?\n/.exec(text);
  if (m) return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
  return /^[\w-]+:/.test(text) ? [text, ''] : ['', text];
}

// name (lower case) → list of values, folded lines joined.
export function parseHeaders(head) {
  const headers = new Map();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(m[2].trim());
  }
  return headers;
}

// "a; b=c; d="e f"; name*=utf-8''x%20y" → { b, d, name }
function parseParams(rest) {
  const found = new Map();
  for (const m of rest.matchAll(/;\s*([^=;\s]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g)) {
    let value = m[2].trim();
    if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    const key = m[1].toLowerCase();
    const base = key.replace(/\*\d*\*?$/, '');
    const index = /\*(\d+)\*?$/.exec(key)?.[1];
    if (!found.has(base)) found.set(base, []);
    found.get(base).push({ index: index === undefined ? 0 : Number(index), encoded: key.endsWith('*'), value });
  }
  const params = {};
  for (const [name, parts] of found) {
    parts.sort((a, b) => a.index - b.index);
    let charset = '';
    let bytes = [];
    let plain = '';
    for (const [i, part] of parts.entries()) {
      if (part.encoded) {
        let data = part.value;
        if (i === 0) { const m = /^([^']*)'[^']*'(.*)$/.exec(data); if (m) { charset = m[1]; data = m[2]; } }
        bytes.push(...Buffer.from(data.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'));
      } else plain += part.value;
    }
    params[name] = bytes.length ? plain + decodeBytes(Buffer.from(bytes), charset || 'utf-8') : decodeWords(plain);
  }
  return params;
}

function parseTyped(value, fallback) {
  const text = value || fallback;
  const m = /^\s*([^\s;]+)\s*(;.*)?$/s.exec(text);
  const type = (m?.[1] ?? fallback).toLowerCase();
  return { type, main: type.split('/')[0], params: parseParams(m?.[2] ?? '') };
}

// ---- Addresses ----

function splitList(value) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let comment = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') { i++; continue; }
    if (quoted) { if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '(') comment++;
    else if (c === ')' && comment) comment--;
    else if (!comment && c === '<') depth++;
    else if (!comment && c === '>' && depth) depth--;
    else if (!comment && !depth && (c === ',' || c === ';')) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// "Lena Fischer <lena@nordlicht.example>, jonas@hafen.example" → [{ name, email }]
export function parseAddresses(value) {
  const people = [];
  for (const part of splitList(headerText(String(value ?? '')))) {
    const angle = /<([^<>]*)>/.exec(part);
    const email = (angle ? angle[1] : /[^\s<>"(),;:]+@[^\s<>"(),;:]+/.exec(part)?.[0] ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    let name = angle ? part.slice(0, angle.index) : /\(([^)]*)\)/.exec(part)?.[1] ?? '';
    name = decodeWords(name.trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1')).replace(/\s+/g, ' ').trim();
    if (name.toLowerCase() === email) name = '';
    people.push({ name, email });
  }
  return people;
}

// ---- Dates, ids and labels ----

export function parseDate(value, fallback = '') {
  for (const text of [value, fallback]) {
    if (!text) continue;
    const date = new Date(String(text).replace(/\([^)]*\)\s*$/, '').trim());
    if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 1970 && date.getFullYear() <= 2100) return date.toISOString();
  }
  return null;
}

// The date at the end of the "From <id> <date>" line.
const fromLineDate = (fromLine) => /^From \S+\s+(.*)$/.exec(fromLine)?.[1] ?? '';

// Google writes a message's number and its thread's number in decimal; the Gmail API uses them in hex.
const toHex = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{10,}$/.test(text)) { try { return BigInt(text).toString(16); } catch { return ''; } }
  return /^[0-9a-f]{8,}$/i.test(text) ? text.toLowerCase() : '';
};

const bracketed = (value) => [...String(value ?? '').matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);

export function parseLabels(value) {
  const labels = [];
  let word = '';
  let quoted = false;
  for (const c of headerText(String(value ?? ''))) {
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { labels.push(word); word = ''; } else word += c;
  }
  labels.push(word);
  return [...new Set(labels.map((l) => decodeWords(l).trim()).filter(Boolean))];
}

const SYSTEM = new Set(['inbox', 'sent', 'drafts', 'spam', 'trash', 'starred', 'important', 'unread', 'opened', 'chat', 'archived', 'scheduled', 'snoozed']);
export const labelKind = (name) => (/^category /i.test(name) ? 'category' : SYSTEM.has(name.toLowerCase()) ? 'system' : 'user');

// ---- The text ----

// The named letters and signs of Latin-1 (codes 160 to 255), in order, for &eacute; and the like.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo '
  + 'frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml '
  + 'times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde '
  + 'ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', middot: '·', bull: '•' };

export function htmlToText(html) {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|tr|h[1-6]|table|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
      }
      const letter = LATIN1.indexOf(code);
      return letter >= 0 ? String.fromCharCode(160 + letter) : ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBody(body, headers, charset) {
  const how = (headers.get('content-transfer-encoding')?.[0] ?? '').trim().toLowerCase();
  const buffer = how === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
    : how === 'quoted-printable' ? decodeQuotedPrintable(body)
      : bytesOf(body);
  return decodeBytes(buffer, charset);
}

function splitMultipart(body, boundary) {
  const open = `--${boundary}`;
  const parts = [];
  let current = null;
  for (const line of body.split('\n')) {
    const bare = line.replace(/\s+$/, '');
    if (bare === `${open}--`) { if (current) parts.push(current.join('\n')); return parts; }
    if (bare === open) { if (current) parts.push(current.join('\n')); current = []; continue; }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join('\n'));
  return parts;
}

// One part of a message (or the message itself): its text, its html and the attachments in it.
function readPart(text, depth, budget) {
  const [head, body] = splitHeadBody(text);
  const headers = parseHeaders(head);
  const type = parseTyped(headers.get('content-type')?.[0], 'text/plain');
  const disposition = parseTyped(headers.get('content-disposition')?.[0], 'inline');
  const filename = disposition.params.filename || type.params.name || '';
  const result = { plain: '', html: '', attachments: [], invite: false, calendar: '' };
  if (--budget.parts < 0) return result;
  if (type.type === 'text/calendar' || type.type === 'application/ics' || /\.ics$/i.test(filename)) { // an invitation, and its own calendar file (Mail 12)
    result.invite = true;
    result.calendar = decodeBody(body, headers, type.params.charset);
  }

  if (type.main === 'multipart' && type.params.boundary && depth < 8) {
    const children = splitMultipart(body, type.params.boundary).map((part) => readPart(part, depth + 1, budget));
    result.attachments = children.flatMap((c) => c.attachments);
    result.invite = children.some((c) => c.invite);
    result.calendar = children.map((c) => c.calendar).find(Boolean) ?? '';
    if (type.type === 'multipart/alternative') {
      result.plain = children.map((c) => c.plain).find(Boolean) ?? '';
      result.html = children.map((c) => c.html).find(Boolean) ?? '';
    } else {
      result.plain = children.map((c) => c.plain).filter(Boolean).join('\n\n');
      result.html = children.map((c) => c.html).filter(Boolean).join('\n\n');
    }
    return result;
  }
  if (type.type === 'message/rfc822' || type.type === 'message/delivery-status') {
    result.attachments.push({ name: filename || 'Forwarded message', type: type.type, skip: true });
    return result;
  }
  if (disposition.type === 'attachment' || filename) {
    result.attachments.push({ name: filename || type.type, type: type.type, encoding: (headers.get('content-transfer-encoding')?.[0] ?? '').trim().toLowerCase(), body });
    return result;
  }
  if (type.type === 'text/plain') result.plain = decodeBody(body, headers, type.params.charset);
  else if (type.type === 'text/html') result.html = decodeBody(body, headers, type.params.charset);
  return result;
}

const MAX_TEXT = 500_000;
const MAX_HTML = 400_000;
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

// A first line or two for a list: the text without quoted replies.
export function snippetOf(text) {
  const own = text.split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
  return collapse(own || text).slice(0, 200);
}

export const plainSubject = (subject) => subject.replace(/^\s*(?:(?:re|fwd?|aw|wg|sv|antw|vs|r)\s*:\s*)+/i, '').trim();

// ---- A whole message ----

// An attachment's bytes, as the part said they were written.
function attachmentBytes(a) {
  if (a.encoding === 'base64') return Buffer.from(a.body.replace(/\s+/g, ''), 'base64');
  if (a.encoding === 'quoted-printable') return decodeQuotedPrintable(a.body);
  return bytesOf(a.body);
}

// keepData: also hand back each attachment's bytes (`files`), for a caller that keeps them (mail.js). Names alone are always read.
export function parseMessage(raw, fromLine = '', { keepData = false } = {}) {
  const [head] = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const one = (name) => headers.get(name)?.[0] ?? '';
  const part = readPart(raw, 0, { parts: 400 });
  const text = (part.plain.trim() || htmlToText(part.html)).replace(/\r\n?/g, '\n').slice(0, MAX_TEXT);
  const from = parseAddresses(one('from'))[0] ?? { name: '', email: '' };
  const idFromLine = /^From (\S+?)(?:@\S*)?\s/.exec(`${fromLine} `)?.[1] ?? '';
  const references = bracketed(one('references'));
  return {
    gmailId: toHex(idFromLine) || toHex(one('x-gm-msgid')),
    gmailThreadId: toHex(one('x-gm-thrid')),
    messageId: bracketed(one('message-id'))[0] ?? '',
    inReplyTo: bracketed(one('in-reply-to'))[0] ?? '',
    references,
    subject: collapse(decodeWords(one('subject'))),
    from,
    to: parseAddresses(headers.get('to')?.join(', ')),
    cc: parseAddresses(headers.get('cc')?.join(', ')),
    sentAt: parseDate(one('date'), fromLineDate(fromLine)),
    labels: parseLabels(headers.get('x-gmail-labels')?.join(',')),
    text,
    html: part.html.trim().length > MAX_HTML ? '' : part.html.trim(), // the mail's own html, to be shown in a sealed frame; one too large is left to its text
    snippet: snippetOf(text),
    attachments: [...new Set(part.attachments.map((a) => a.name))],
    // What the rules of the Mail app's splits read (Mail 5): an unsubscribe link, a bulk sender, an invitation.
    listUnsubscribe: headers.has('list-unsubscribe'),
    bulk: headers.has('list-unsubscribe') || headers.has('list-id') || /^(bulk|list|junk)$/i.test(one('precedence')) || /auto-(generated|replied)/i.test(one('auto-submitted')),
    hasInvite: part.invite,
    calendar: part.calendar.length > 50_000 ? '' : part.calendar,
    files: keepData ? part.attachments.filter((a) => !a.skip).map((a) => ({ name: a.name, type: a.type, data: attachmentBytes(a) })) : [],
    size: raw.length,
  };
}
