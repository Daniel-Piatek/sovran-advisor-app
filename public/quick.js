// The Capture page (Phone, backups and moving; myICOR advanced/everywhere/8). Put on a phone's home screen, it opens
// straight into one box: type, tap Keep, and the thought waits in the Inbox on your computer. Two taps from the home
// screen. If the computer can't be reached (asleep, or the phone has no signal), the words are kept on the phone and
// sent the next time this page can reach it: nothing typed here is ever lost.

const KEY = 'sovran.quick.waiting';
const form = document.getElementById('quick-form');
const text = document.getElementById('quick-text');
const status = document.getElementById('quick-status');
const worlds = [...document.querySelectorAll('[data-world]')];
let world = 'inner';

const waiting = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const keepWaiting = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private browsing: it stays in the box */ } };

async function send(item) {
  const res = await fetch('/api/captures', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: item.body, world: item.world }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok && res.status < 500) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? 'Not kept.'), { refused: true });
  if (!res.ok) throw new Error('The computer did not answer.');
}

// What waits on the phone goes, oldest first; what can't go yet stays.
async function flush() {
  let list = waiting();
  while (list.length) {
    try { await send(list[0]); } catch (err) { if (!err.refused) break; }
    list = list.slice(1);
    keepWaiting(list);
  }
  return list.length;
}

function say(words) { status.textContent = words; }

worlds.forEach((button) => button.addEventListener('click', () => {
  world = button.dataset.world;
  worlds.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  text.focus();
}));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = text.value.trim();
  if (!body) { text.focus(); return; }
  const item = { body, world, at: new Date().toISOString() };
  text.value = '';
  try {
    await send(item);
    const left = await flush();
    say(left ? `Kept in your Inbox. ${left} more ${left === 1 ? 'waits' : 'wait'} on this phone.` : 'Kept in your Inbox.');
  } catch (err) {
    if (err.refused) { text.value = body; say(err.message); return; }
    keepWaiting([...waiting(), item]);
    say('Saved on this phone. It goes to your Inbox as soon as your computer answers.');
  }
  text.focus();
});

async function start() {
  const before = waiting().length;
  if (!before) return;
  const left = await flush();
  if (left < before) say(left ? `${before - left} sent to your Inbox; ${left} still ${left === 1 ? 'waits' : 'wait'} on this phone.` : `${before} saved earlier ${before === 1 ? 'is' : 'are'} now in your Inbox.`);
  else say(`${left} ${left === 1 ? 'thought waits' : 'thoughts wait'} on this phone for your computer.`);
}
window.addEventListener('online', start);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') start(); });
start();
