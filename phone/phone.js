// The phone Capture page (module phone-drop), served from GitHub Pages and put on the phone's home screen with the
// crown icon. Its link carries, after "#", this phone's own drop box, its token and the key (a browser never sends
// that part anywhere). A thought is sealed here (seal.js) and left in the Sovran drop box; the person's own computer
// collects it into the Inbox and the box forgets it. Without signal, the words wait on this phone and go later.

import { seal, readLinkPart } from './seal.js';

export const DROP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const LINK = 'sovran.phone.link';
const WAITING = 'sovran.phone.waiting';
const SEEN_SETUP = 'sovran.phone.setup-seen';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing: nothing kept */ } },
};
const $ = (id) => document.getElementById(id);
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

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

function showForm() {
  $('setup').hidden = true;
  $('form').hidden = false;
  const text = $('text');
  let world = 'inner';
  const worlds = [...document.querySelectorAll('[data-world]')];
  worlds.forEach((b) => b.addEventListener('click', () => {
    world = b.dataset.world;
    worlds.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    text.focus();
  }));
  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = text.value.trim();
    if (!body) { text.focus(); return; }
    const item = { body, world, at: new Date().toISOString() };
    const button = $('form').querySelector('.keep');
    button.disabled = true;
    text.value = '';
    try {
      await send(item);
      const left = await flush();
      say(left ? `Kept. It goes to your Inbox when your computer is on. ${left} more ${left === 1 ? 'waits' : 'wait'} on this phone.` : 'Kept. It goes to your Inbox when your computer is on.');
    } catch (err) {
      if (err.refused) { text.value = body; say(err.message); }
      else { keepWaiting([...waiting(), item]); say(err.full ? err.message : 'No connection. Saved on this phone; it goes as soon as there is signal.'); }
    }
    button.disabled = false;
  });
  const retry = async () => {
    const before = waiting().length;
    if (!before) return;
    const left = await flush();
    if (left < before) say(left ? `${before - left} sent; ${left} still ${left === 1 ? 'waits' : 'wait'} on this phone.` : `${before} saved earlier ${before === 1 ? 'is' : 'are'} sent.`);
    else say(`${left} ${left === 1 ? 'thought waits' : 'thoughts wait'} on this phone for signal.`);
  };
  addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  retry();
}

// First visit in the browser: how to put it on the home screen (once; "Use it here for now" goes straight on).
function showSetup() {
  $('setup').hidden = false;
  $(ios ? 'steps-ios' : 'steps-android').hidden = false;
  let prompt = null;
  addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); prompt = event; $('install').hidden = false; });
  $('install').addEventListener('click', async () => { if (prompt) { prompt.prompt(); await prompt.userChoice.catch(() => {}); prompt = null; $('install').hidden = true; } });
  $('use-here').addEventListener('click', (event) => { event.preventDefault(); store.set(SEEN_SETUP, '1'); showForm(); });
}

if (!link) $('nolink').hidden = false;
else if (installed || store.get(SEEN_SETUP)) showForm();
else showSetup();
