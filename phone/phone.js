// go Sovran (once Sovran Go), the phone page (module phone-drop), served from GitHub Pages and put on the phone's home
// screen with the crown icon. Its link carries, after "#", this phone's own drop box, its token and the key (a browser
// never sends that part anywhere). The first screen is the writing box (2026-11-22, the owner's design): what is on
// your mind, which kind it is (From Me, From Other, Journal) and Save; under it Ask my Sovran Advisor opens your AI's
// own app. What is written is sealed (seal.js) and left in the Sovran drop box. The person's own computer collects it (a journal entry into the Journal, a thought into the Inbox) and
// the box forgets it. Without signal, the words wait on this phone and go later. My reports (reports.js) reads the
// sealed copies of the person's reports that their computer puts on the box's shelf. Group Circle (group.js) uses the
// phone's own Group Circle key, which the computer also leaves on the shelf.

import { seal, readLinkPart } from './seal.js';
import { setupReports } from './reports.js';
import { setupGroup } from './group.js';
import { setupQuest } from './quest.js';
import { setupQuestNew } from './quest-new.js';

export const DROP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const LINK = 'sovran.phone.link';
const WAITING = 'sovran.phone.waiting';
const SEEN_SETUP = 'sovran.phone.setup-seen';
const AI = 'sovran.phone.ai';
const QUEST_NEW = 'sovran.phone.quest-new'; // this phone shows the new Quest (quest-new.js) before everyone does
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing: nothing kept */ } },
};
const $ = (id) => document.getElementById(id);
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// The AI that Ask my Sovran Advisor opens. Claude unless this phone was told otherwise (the address once carried ?ai=chatgpt).
const AIS = {
  // fill: an address that opens the AI's app with words already in its box (tried on a real Android phone with the Claude app).
  claude: { name: 'Claude', href: 'https://claude.ai/new', fill: 'https://claude.ai/new?q=', line: 'Ask for insight from your reports, your charts and the Sovran Library' },
  // ask: a line added to the copied words. ChatGPT answers a pasted passage by itself and never opens the Sovran Library,
  // so it never meets the offer to keep the chat (seen with a student's phone, 18 Nov 2026). The line asks for both.
  chatgpt: { name: 'ChatGPT', href: 'https://chatgpt.com/', line: 'Ask for insight from your reports, your charts and the Sovran Library',
    ask: 'Please use my Sovran Library to answer. After your answer, ask me if I would like this chat kept in my Sovran Central.' },
};
const asked = new URLSearchParams(location.search).get('ai');
if (asked && AIS[asked]) store.set(AI, asked);
const ai = AIS[store.get(AI)] ?? AIS.claude;

// What can be written here. A journal entry goes to the Journal; the other two to the Inbox, as before.
const KINDS = {
  journal: { title: 'Journal entry', where: 'Goes into today’s Journal', done: 'Added', place: 'Journal', world: 'inner' },
  inner: { title: 'From Me', where: 'Goes to your Inbox – Inner World', done: 'Kept', place: 'Inbox', world: 'inner' },
  outer: { title: 'From Other', where: 'Goes to your Inbox – Outer World', done: 'Kept', place: 'Inbox', world: 'outer' },
};
const two = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

// The link: from the address (and remembered), else the one remembered. An installed Android app opens without the
// "#" part (its manifest starts at ./) and finds it here; an iPhone keeps the whole address on the home screen.
let link = readLinkPart(location.hash);
if (link) store.set(LINK, location.hash.replace(/^#/, ''));
// ?quest=new: this phone shows the new Quest (read before the address is tidied below).
if (new URLSearchParams(location.search).get('quest') === 'new') store.set(QUEST_NEW, '1');
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
  for (const id of ['choose', 'done', 'setup', 'nolink', 'reports', 'report', 'group', 'quest', 'quest-write', 'quest-transcript', 'qn']) $(id).hidden = id !== name;
  if (name !== 'qn') document.body.classList.remove('in-qn');
  document.body.classList.toggle('choosing', name === 'choose');
  document.body.classList.toggle('with-foot', name === 'setup' || name === 'nolink'); // the privacy line is read once, while linking
  document.body.classList.toggle('in-group', name === 'group');
  scrollTo(0, 0);
}

// One call to the drop box. Throws with refused (the box said no for good) or full; else there was no connection.
async function call(body, wait = 10000) {
  let res;
  try {
    res = await fetch(DROP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: AbortSignal.timeout(wait) });
  } catch { throw new Error('No connection.'); }
  if (res.ok) return res.json().catch(() => ({}));
  const error = (await res.json().catch(() => ({}))).error ?? 'Not kept.';
  throw Object.assign(new Error(error), { refused: res.status === 404 || res.status === 400, full: res.status === 429 });
}
const send = async (item) => { await call({ action: 'drop', box: link.box, drop: link.drop, sealed: await seal(link.key, item) }); };

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
  let kind = 'inner';

  $('ask').href = ai.href;
  $('ask-line').textContent = ai.line;

  // The box grows with the words, and Save wakes once there are some.
  const fit = () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; $('keep').disabled = !text.value.trim(); };
  // Which kind: the chip, where it goes, and for a journal entry its day. The words stay as they are.
  const pick = (next) => {
    kind = next;
    const k = KINDS[kind];
    $('form').dataset.kind = kind;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.kind === kind)));
    $('where').textContent = k.where;
    $('form-day').hidden = kind !== 'journal';
    $('form-day').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const choose = () => {
    const left = waiting().length;
    $('waiting-line').textContent = left ? waits(left) : '';
    show('choose');
    fit();
  };
  const done = (title, words) => {
    const k = KINDS[kind];
    $('done-title').textContent = title;
    $('done-tag').textContent = k.title;
    $('done-tag').dataset.kind = kind;
    $('done-words').textContent = words;
    show('done');
  };
  const clear = () => { text.value = ''; say(''); pick('inner'); };

  // My reports (reports.js). A highlight or comment made there goes the same way as a thought: sealed, into the drop
  // box, or kept on this phone until there is signal.
  const leave = async (note) => { try { await send(note); await flush(); } catch (err) { if (!err.refused) keepWaiting([...waiting(), note]); } };
  const reports = setupReports({ link, store, show, ai, call: (body) => call(body, 20000), leave });
  $('my-reports').addEventListener('click', () => { history.pushState({ view: 'reports' }, ''); reports.showList(); });
  $('reports-back').addEventListener('click', () => history.back());
  // Group Circle (group.js): with the phone's own key, from the shelf. The choice shows once the key is there.
  const group = setupGroup({ store, show, openShelf: reports.open, refreshShelf: reports.refresh, ios, installed });
  $('group-circle').addEventListener('click', () => { history.pushState({ view: 'group' }, ''); group.open(); });
  $('group-back').addEventListener('click', () => history.back());
  // Sovran Quest (quest.js): the group's weeks with the same key as Group Circle; Done and journal entries go to the computer.
  let saying = 0;
  const toast = (words) => { $('toast').textContent = words; $('toast').hidden = false; clearTimeout(saying); saying = setTimeout(() => { $('toast').hidden = true; }, 6000); };
  const quest = setupQuest({ store, show, ask: group.ask, available: group.available, isGuide: group.isGuide, openShelf: reports.open, leave, ai, say: toast });
  // The new Quest (quest-new.js, the owner's design of 28 Nov 2026): Daniel tries it on his own go Sovran first (the
  // guide's key, or ?quest=new on this phone); students keep the Quest above until he says it is really ready. With it,
  // Stuck? Ask Daniel moves to this first screen, apart from the Quest.
  const questNew = setupQuestNew({ store, show, ask: group.ask, available: group.available, isGuide: group.isGuide, openShelf: reports.open, leave, ai, say: toast });
  const newQuest = () => group.isGuide() || store.get(QUEST_NEW) === '1';
  const checkQuest = async () => { await quest.check(); if (newQuest()) await questNew.check(); $('ask-daniel').hidden = !(newQuest() && group.available() && !group.isGuide()); };
  $('ask-daniel').addEventListener('click', () => questNew.openStuck());
  $('quest-tile').addEventListener('click', () => { if (newQuest()) { questNew.open(); return; } history.pushState({ view: 'quest' }, ''); quest.open(); });
  for (const id of ['quest-back', 'quest-write-back', 'quest-tr-back']) $(id).addEventListener('click', () => history.back());
  // From an alert (sw.js): ?open=group&tab=…&post=… opens Group Circle at that post once the key is known.
  const asked = new URLSearchParams(location.search);
  const fromAlert = asked.get('open') === 'group' ? { tab: asked.get('tab'), post: asked.get('post') } : null;
  if (fromAlert) history.replaceState(null, '', location.pathname);
  const openFromAlert = () => { if (fromAlert && group.available() && $('group').hidden) { history.pushState({ view: 'group' }, ''); group.open(fromAlert); } };
  group.check().then(async () => { openFromAlert(); await checkQuest(); if (await reports.refresh()) { await group.check(); openFromAlert(); await checkQuest(); } });
  $('report-back').addEventListener('click', () => history.back());

  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { pick(c.dataset.kind); text.focus(); }));
  text.addEventListener('input', () => { fit(); say(''); });
  addEventListener('popstate', () => {
    const to = history.state;
    if (to?.view !== 'qn') questNew.leaving();
    if (to?.view === 'qn') questNew.render(to);
    else if (to?.view === 'group') group.open();
    else if (to?.view === 'quest') quest.open();
    else if (to?.view === 'quest-write') quest.drawWriting();
    else if (to?.view === 'quest-transcript') quest.drawTranscript(to.week);
    else if (to?.view === 'report') reports.showReport(to.report);
    else if (to?.view === 'reports') reports.showList();
    else { reports.leaveReports(); choose(); group.check().then(() => checkQuest()); }
  });
  $('another').addEventListener('click', choose); // Continue: back to the first screen, the box empty

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
      done(k.done, `It will be in your ${k.place} when your computer is on.${left ? ` ${left} more ${left === 1 ? 'waits' : 'wait'} on this phone.` : ''}`);
    } catch (err) {
      if (err.refused) say(err.message); // the words stay in the box
      else {
        keepWaiting([...waiting(), item]);
        done('Saved', err.full ? err.message : 'No connection. Saved on this phone; it goes as soon as there is signal.');
      }
    }
    if ($('choose').hidden) clear(); // kept or saved: the box is empty for the next one
    fit();
  });

  const retry = async () => {
    const before = waiting().length;
    if (!before) return;
    const left = await flush();
    const line = left < before
      ? (left ? `${before - left} sent; ${left} still ${left === 1 ? 'waits' : 'wait'} on this phone.` : `${before} saved earlier ${before === 1 ? 'is' : 'are'} sent.`)
      : waits(left);
    $('waiting-line').textContent = line;
  };
  addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  pick('inner');
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
