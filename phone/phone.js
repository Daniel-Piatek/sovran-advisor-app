// Sovran Go, the phone page (module phone-drop), served from GitHub Pages and put on the phone's home screen with the
// crown icon. Its link carries, after "#", this phone's own drop box, its token and the key (a browser never sends
// that part anywhere). The first screen asks what you would like to do: Ask my AI opens your AI's own app; a journal
// entry, your own thought or something from someone else is written here, sealed (seal.js) and left in the Sovran
// drop box. The person's own computer collects it (a journal entry into the Journal, a thought into the Inbox) and
// the box forgets it. Without signal, the words wait on this phone and go later.

import { seal, readLinkPart } from './seal.js';

export const DROP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const LINK = 'sovran.phone.link';
const WAITING = 'sovran.phone.waiting';
const SEEN_SETUP = 'sovran.phone.setup-seen';
const AI = 'sovran.phone.ai';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing: nothing kept */ } },
};
const $ = (id) => document.getElementById(id);
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// The AI that Ask my AI opens. Claude unless this phone was told otherwise (the address once carried ?ai=chatgpt).
const AIS = {
  claude: { href: 'https://claude.ai/new', line: 'Ask Claude about your reports and the teaching' },
  chatgpt: { href: 'https://chatgpt.com/', line: 'Ask ChatGPT about your reports and the teaching' },
};
const asked = new URLSearchParams(location.search).get('ai');
if (asked && AIS[asked]) store.set(AI, asked);
const ai = AIS[store.get(AI)] ?? AIS.claude;

// What can be written here. A journal entry goes to the Journal; the other two to the Inbox, as before.
const KINDS = {
  journal: { title: 'Journal entry', keep: 'Add to my Journal', done: 'Added', place: 'Journal', world: 'inner' },
  inner: { title: 'My own thought', keep: 'Keep in Inbox', done: 'Kept', place: 'Inbox', world: 'inner' },
  outer: { title: 'From someone else', keep: 'Keep in Inbox', done: 'Kept', place: 'Inbox', world: 'outer' },
};
const two = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

// The link: from the address (and remembered), else the one remembered. An installed Android app opens without the
// "#" part (its manifest starts at ./) and finds it here; an iPhone keeps the whole address on the home screen.
let link = readLinkPart(location.hash);
if (link) store.set(LINK, location.hash.replace(/^#/, ''));
else link = readLinkPart(store.get(LINK));
// The key leaves the address bar, except in Safari before Add to Home Screen: an iPhone's home-screen icon keeps its
// own storage, so it needs the whole address to find its box.
if (link && location.hash && (!ios || installed)) history.replaceState(null, '', location.pathname);

// Android (Chrome, Samsung Internet…) installs from a manifest; an iPhone uses the apple-touch-icon and keeps the "#".
if (!ios) {
  const m = document.createElement('link');
  m.rel = 'manifest'; m.href = 'capture.webmanifest';
  document.head.append(m);
}

const waiting = () => { try { return JSON.parse(store.get(WAITING) ?? '[]'); } catch { return []; } };
const keepWaiting = (list) => store.set(WAITING, JSON.stringify(list));
const say = (words) => { $('status').textContent = words; };
const waits = (n) => `${n} ${n === 1 ? 'waits' : 'wait'} on this phone for signal.`;

function show(name) {
  for (const id of ['choose', 'form', 'done', 'setup', 'nolink']) $(id).hidden = id !== name;
  document.body.classList.toggle('choosing', name === 'choose');
  scrollTo(0, 0);
}

async function send(item) {
  const sealed = await seal(link.key, item);
  let res;
  try {
    res = await fetch(DROP_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'drop', box: link.box, drop: link.drop, sealed }), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('No connection.'); }
  if (res.ok) return;
  const error = (await res.json().catch(() => ({}))).error ?? 'Not kept.';
  throw Object.assign(new Error(error), { refused: res.status === 404 || res.status === 400, full: res.status === 429 });
}

async function flush() {
  let list = waiting();
  while (list.length) {
    try { await send(list[0]); } catch (err) { if (!err.refused) break; }
    list = list.slice(1);
    keepWaiting(list);
  }
  return list.length;
}

function start() {
  const text = $('text');
  const drafts = {}; // what was written and not kept yet, by kind: Back loses nothing
  let kind = 'inner';

  $('ask').href = ai.href;
  $('ask-line').textContent = ai.line;

  const choose = () => {
    const left = waiting().length;
    $('waiting-line').textContent = left ? waits(left) : '';
    show('choose');
  };
  const write = (next) => {
    kind = next;
    const k = KINDS[kind];
    $('form').dataset.kind = kind;
    $('form-disc').replaceChildren(document.querySelector(`.choice[data-kind="${kind}"] svg`).cloneNode(true));
    $('form-title').textContent = k.title;
    $('form-day').hidden = kind !== 'journal';
    $('form-day').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    $('keep').textContent = k.keep;
    text.value = drafts[kind] ?? '';
    say('');
    show('form');
    text.focus();
  };
  const done = (title, words) => {
    const k = KINDS[kind];
    $('done-title').textContent = title;
    $('done-tag').textContent = k.title;
    $('done-tag').dataset.kind = kind;
    $('done-words').textContent = words;
    show('done');
  };

  // The phone's own Back goes from writing to the choices, as ‹ Back does.
  document.querySelectorAll('.choice[data-kind]').forEach((b) => b.addEventListener('click', () => { history.pushState({ writing: true }, ''); write(b.dataset.kind); }));
  $('back').addEventListener('click', () => history.back());
  addEventListener('popstate', () => { if (!$('form').hidden) drafts[kind] = text.value; choose(); });
  $('another').addEventListener('click', () => write(kind));

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = text.value.trim();
    if (!body) { text.focus(); return; }
    const k = KINDS[kind];
    const at = new Date();
    const item = { body, world: k.world, at: at.toISOString(), ...(kind === 'journal' ? { kind: 'journal', day: localDay(at) } : {}) };
    $('keep').disabled = true;
    say('');
    try {
      await send(item);
      const left = await flush();
      drafts[kind] = '';
      done(k.done, `It will be in your ${k.place} when your computer is on.${left ? ` ${left} more ${left === 1 ? 'waits' : 'wait'} on this phone.` : ''}`);
    } catch (err) {
      if (err.refused) say(err.message); // the words stay in the box
      else {
        keepWaiting([...waiting(), item]);
        drafts[kind] = '';
        done('Saved', err.full ? err.message : 'No connection. Saved on this phone; it goes as soon as there is signal.');
      }
    }
    $('keep').disabled = false;
  });

  const retry = async () => {
    const before = waiting().length;
    if (!before) return;
    const left = await flush();
    const line = left < before
      ? (left ? `${before - left} sent; ${left} still ${left === 1 ? 'waits' : 'wait'} on this phone.` : `${before} saved earlier ${before === 1 ? 'is' : 'are'} sent.`)
      : waits(left);
    $('waiting-line').textContent = line;
    if (!$('form').hidden) say(line);
  };
  addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  choose();
  retry();
}

// First visit in the browser: how to put it on the home screen (once; "Use it here for now" goes straight on).
function showSetup() {
  show('setup');
  $(ios ? 'steps-ios' : 'steps-android').hidden = false;
  let prompt = null;
  addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); prompt = event; $('install').hidden = false; });
  $('install').addEventListener('click', async () => { if (prompt) { prompt.prompt(); await prompt.userChoice.catch(() => {}); prompt = null; $('install').hidden = true; } });
  $('use-here').addEventListener('click', (event) => { event.preventDefault(); store.set(SEEN_SETUP, '1'); start(); });
}

if (!link) show('nolink');
else if (installed || store.get(SEEN_SETUP)) start();
else showSetup();
