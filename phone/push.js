// Alerts on this phone (part 3 of the Group Circle alerts plan): the box at the foot of Group Circle in go Sovran.
// On "Allow alerts" the phone asks the person; on their yes it gets an address that wakes it (Apple's, Google's or
// Mozilla's push service) and Group Circle keeps it with the switches below (cloud/group-push.sql). The service worker
// (sw.js) does the rest. The phone's Group Circle key is handed to the service worker through IndexedDB.

const DB = 'sovran-go';
const KINDS = [
  { id: 'news', label: 'A new announcement from Daniel', on: true },
  { id: 'reply', label: 'Someone replied to your post or comment', on: true },
  { id: 'due', label: 'Homework is due tomorrow (if not ticked done)', on: true },
  { id: 'answer', label: 'Daniel replied to, or dealt with, something you told him', on: true },
  { id: 'feed', label: 'Any new post in the Circle', on: false },
];
const $ = (id) => document.getElementById(id);

function keep(name, value) {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      if (value == null) tx.objectStore('kv').delete(name); else tx.objectStore('kv').put(value, name);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    };
  });
}

const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)), (c) => c.charCodeAt(0));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  node.append(...children.filter((c) => c != null));
  return node;
}

// ask(body): Group Circle with the phone's key (group.js). access(): { key, url } or null. ios, installed: phone.js.
export function setupPush({ ask, access, ios, installed }) {
  const box = () => $('group-alerts');
  const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function registration() {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  }

  // What the box says now.
  async function draw() {
    const here = box();
    if (!here || !access()) return;
    const head = el('h2', { class: 'g-alerts-title' }, 'Alerts on this phone');
    if (!can) {
      here.replaceChildren(head, el('p', { class: 'g-note' }, ios && !installed
        ? 'To get alerts, add go Sovran to your Home Screen first, then open it from there. An iPhone needs iOS 16.4 or newer.'
        : 'This phone’s browser can’t show alerts from go Sovran.'));
      return;
    }
    if (Notification.permission === 'denied') {
      here.replaceChildren(head, el('p', { class: 'g-note' }, 'Alerts are switched off for go Sovran in this phone’s settings. Switch them on there to get them.'));
      return;
    }
    const reg = Notification.permission === 'granted' ? await registration().catch(() => null) : null;
    const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
    if (!sub) {
      const allow = el('button', { type: 'button', class: 'g-add g-allow' }, 'Allow alerts');
      allow.addEventListener('click', () => turnOn(allow));
      here.replaceChildren(head, el('p', { class: 'g-note' }, 'Hear about a new announcement or a reply even when go Sovran is closed. Nothing is sent without your yes.'), allow);
      return;
    }
    await keep('group', { ...access(), endpoint: sub.endpoint }); // the key can change: the service worker always has the latest
    let state;
    try { state = await ask({ action: 'push_state', endpoint: sub.endpoint }); } catch { state = null; }
    if (state && !state.on) { try { state = await ask({ action: 'push_sub', endpoint: sub.endpoint, kinds: KINDS.filter((k) => k.on).map((k) => k.id) }); } catch { /* next time */ } }
    const on = new Set(state?.kinds ?? KINDS.filter((k) => k.on).map((k) => k.id));
    const rows = KINDS.map((k) => {
      const input = el('input', { type: 'checkbox', id: `g-alert-${k.id}`, checked: on.has(k.id) });
      input.addEventListener('change', async () => {
        if (input.checked) on.add(k.id); else on.delete(k.id);
        try { await ask({ action: 'push_sub', endpoint: sub.endpoint, kinds: [...on] }); } catch (err) { input.checked = !input.checked; say(err.message); }
      });
      return el('label', { class: 'g-alert-row', for: `g-alert-${k.id}` }, input, ` ${k.label}`);
    });
    const stop = el('button', { type: 'button', class: 'g-link' }, 'Stop alerts on this phone');
    stop.addEventListener('click', async () => {
      try { await ask({ action: 'push_sub', endpoint: null, old: sub.endpoint, kinds: [] }); } catch { /* the cloud forgets it when it can't wake it */ }
      await sub.unsubscribe().catch(() => {});
      await keep('group', null);
      await draw();
    });
    here.replaceChildren(head, el('p', { class: 'g-note' }, 'Alerts are on. Choose which:'), ...rows, stop);
  }

  const say = (words) => { $('group-status').textContent = words; };

  async function turnOn(button) {
    button.disabled = true;
    try {
      if ((await Notification.requestPermission()) !== 'granted') { await draw(); return; }
      const reg = await registration();
      const { key } = await ask({ action: 'push_key' });
      const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) });
      await keep('group', { ...access(), endpoint: sub.endpoint });
      await ask({ action: 'push_sub', endpoint: sub.endpoint, kinds: KINDS.filter((k) => k.on).map((k) => k.id) });
      say('Alerts are on for this phone.');
    } catch (err) { say(err?.message && !/push service/i.test(err.message) ? err.message : 'Alerts couldn’t be switched on. Try again in a minute.'); }
    await draw();
  }

  return { draw };
}
