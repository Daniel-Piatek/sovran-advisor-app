// A stand-in for Gmail's own API (messages, labels, profile), made from a made-up mailbox (scripts/demo-mail.js): no test
// talks to the real Gmail. It answers only to a bearer token, like the real one, and notes every call.

import http from 'node:http';
import { MboxSplitter, parseMessage } from '../mbox.js';

const SYSTEM = new Set(['Inbox', 'Sent', 'Drafts', 'Spam', 'Trash', 'Starred', 'Important', 'Unread', 'Chat']);
const idOf = (name) => (SYSTEM.has(name) || /^Category /.test(name) ? name.toUpperCase().replace(/ /g, '_') : null);

// The messages of a mailbox text, each with what Gmail's API would say: id, thread, labels, date and the raw message
// (without the headers only a Takeout file has).
export function messagesOf(text) {
  const out = [];
  const splitter = new MboxSplitter(({ fromLine, raw }) => {
    const m = parseMessage(raw, fromLine);
    out.push({
      fromLine, rawWithHeaders: raw, id: m.gmailId, threadId: m.gmailThreadId, labels: m.labels, sentAt: m.sentAt,
      raw: raw.split('\n').filter((line) => !/^(X-Gmail-Labels|X-GM-THRID):/i.test(line)).join('\n'),
    });
  });
  splitter.push(Buffer.from(text, 'utf8'));
  splitter.end();
  return out;
}

// A mailbox text of just these messages (the export Google Takeout would have made).
export const mailboxOf = (messages) => `${messages.map((m) => `${m.fromLine}\n${m.rawWithHeaders}\n`).join('\n')}`;

export async function startFakeGmail({ messages = [], pageSize = 7, email = 'demo@example.com' } = {}) {
  const fake = {
    messages, // what is in Gmail now: { id, threadId, labels: [names], sentAt, raw }
    email,
    offline: false,
    seen: [], // every call: { path, query, auth, method }
    outgoing: [], // every mail the app sent: { id, threadId, raw }
    sent: [], // every change the app sent: { id, add: [label names], remove: [label names] }
    trashed: [], // every trash or untrash the app asked for: { id, action }
    historyId: 1000, // Gmail's history: one entry for every change, newest last
    history: [],
    historyGone: false, // the history is too old: Gmail answers 404
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
  const labelRows = () => {
    const names = [...new Set([...fake.messages.flatMap((m) => m.labels), ...(fake.extraLabels ?? [])])];
    return names.map((name, i) => ({ id: idOf(name) ?? `Label_${i + 1}`, name: idOf(name) ? idOf(name) : name, type: idOf(name) ? 'system' : 'user', display: name }));
  };
  const idFor = (name) => labelRows().find((l) => l.display === name)?.id;
  const note = (entry) => { fake.historyId += 1; fake.history.push({ id: String(fake.historyId), ...entry }); };
  // Changes made "in Gmail" (on a phone, say): each is one history entry, as Gmail records them.
  fake.receive = (message) => { fake.messages.push(message); note({ messagesAdded: [{ message: { id: message.id, threadId: message.threadId, labelIds: message.labels.map(idFor) } }] }); };
  fake.addLabel = (id, name) => { const m = fake.messages.find((x) => x.id === id); if (!m.labels.includes(name)) m.labels.push(name); note({ labelsAdded: [{ message: { id }, labelIds: [idFor(name)] }] }); };
  fake.removeLabel = (id, name) => { const m = fake.messages.find((x) => x.id === id); m.labels = m.labels.filter((l) => l !== name); note({ labelsRemoved: [{ message: { id }, labelIds: [idFor(name)] }] }); };
  fake.delete = (id) => { fake.messages = fake.messages.filter((m) => m.id !== id); note({ messagesDeleted: [{ message: { id } }] }); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    fake.seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? '' });
    if (fake.offline) return req.socket.destroy();
    const body = await new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString())); });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (!/^Bearer access-/.test(req.headers.authorization ?? '')) return json(401, { error: 'no token' });
    const path = url.pathname.replace(/^\/users\/me/, '');
    if (path === '/profile') return json(200, { emailAddress: fake.email, messagesTotal: fake.messages.length, historyId: String(fake.historyId) });
    if (path === '/history') {
      if (fake.historyGone) return json(404, { error: 'history too old' });
      const from = Number(url.searchParams.get('startHistoryId'));
      return json(200, { history: fake.history.filter((h) => Number(h.id) > from), historyId: String(fake.historyId) });
    }
    if (path === '/labels') return json(200, { labels: labelRows().map(({ id, name, type }) => ({ id, name, type })) });
    const label = path.match(/^\/labels\/(.+)$/);
    if (label) {
      const found = labelRows().find((l) => l.id === decodeURIComponent(label[1]));
      if (!found) return json(404, { error: 'no such label' });
      return json(200, { id: found.id, name: found.name, type: found.type, messagesTotal: fake.messages.filter((m) => m.labels.includes(found.display)).length });
    }
    if (path === '/messages') {
      const after = /^after:(\d+)$/.exec(url.searchParams.get('q') ?? '')?.[1];
      const all = [...fake.messages].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).filter((m) => !after || new Date(m.sentAt).getTime() >= Number(after) * 1000);
      const start = Number(url.searchParams.get('pageToken') || 0);
      const page = all.slice(start, start + pageSize);
      return json(200, { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
    }
    if (path === '/messages/send' && req.method === 'POST') {
      const input = JSON.parse(body || '{}');
      const raw = Buffer.from(input.raw ?? '', 'base64url').toString('utf8');
      const id = `5${String(fake.outgoing.length + 1).padStart(15, '0')}`;
      fake.outgoing.push({ id, threadId: input.threadId ?? '', raw });
      return json(200, { id, threadId: input.threadId || `6${id.slice(1)}`, labelIds: ['SENT'] });
    }
    const modify = path.match(/^\/messages\/([0-9a-f]+)\/modify$/);
    if (modify && req.method === 'POST') {
      const m = fake.messages.find((x) => x.id === modify[1]);
      if (!m) return json(404, { error: 'no such message' });
      const input = JSON.parse(body || '{}');
      const nameOf = (id) => labelRows().find((l) => l.id === id)?.display;
      const add = (input.addLabelIds ?? []).map(nameOf).filter(Boolean);
      const remove = (input.removeLabelIds ?? []).map(nameOf).filter(Boolean);
      fake.sent.push({ id: m.id, add, remove });
      for (const name of add) if (!m.labels.includes(name)) m.labels.push(name);
      m.labels = m.labels.filter((l) => !remove.includes(l));
      if (add.length) note({ labelsAdded: [{ message: { id: m.id }, labelIds: add.map(idFor) }] });
      if (remove.length) note({ labelsRemoved: [{ message: { id: m.id }, labelIds: remove.map(idFor) }] });
      return json(200, { id: m.id, threadId: m.threadId, labelIds: m.labels.map(idFor) });
    }
    // Trash and untrash, as Gmail's own: TRASH added or taken away (nothing is deleted for good).
    const bin = path.match(/^\/messages\/([0-9a-f]+)\/(trash|untrash)$/);
    if (bin && req.method === 'POST') {
      const m = fake.messages.find((x) => x.id === bin[1]);
      if (!m) return json(404, { error: 'no such message' });
      fake.trashed.push({ id: m.id, action: bin[2] });
      if (bin[2] === 'trash' && !m.labels.includes('Trash')) { m.labels.push('Trash'); note({ labelsAdded: [{ message: { id: m.id }, labelIds: ['TRASH'] }] }); }
      if (bin[2] === 'untrash' && m.labels.includes('Trash')) { m.labels = m.labels.filter((l) => l !== 'Trash'); note({ labelsRemoved: [{ message: { id: m.id }, labelIds: ['TRASH'] }] }); }
      return json(200, { id: m.id, threadId: m.threadId, labelIds: m.labels.map(idFor) });
    }
    const one = path.match(/^\/messages\/([0-9a-f]+)$/);
    if (one) {
      const m = fake.messages.find((x) => x.id === one[1]);
      if (!m) return json(404, { error: 'no such message' });
      return json(200, { id: m.id, threadId: m.threadId, labelIds: m.labels.map(idFor), internalDate: String(new Date(m.sentAt).getTime()), raw: Buffer.from(m.raw, 'latin1').toString('base64url') });
    }
    return json(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.env = { GMAIL_API_URL: `http://127.0.0.1:${server.address().port}` };
  return fake;
}
