// go Sovran's service worker: only for alerts on the phone (part 3 of the Group Circle alerts plan). It keeps no copy
// of the page, so go Sovran loads exactly as before.
//
// The cloud wakes this phone with an empty message (cloud/group-push.sql): no words go through Apple's or Google's
// servers. Woken, this asks Group Circle with the phone's own key what waits for it, and shows it. Tapping an alert
// opens go Sovran at that post. The key and the address come from the page (push.js), kept in IndexedDB.

const DB = 'sovran-go';

function kept(name) {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const get = open.result.transaction('kv').objectStore('kv').get(name);
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => resolve(null);
    };
  });
}

const short = (text) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > 120 ? `${t.slice(0, 119)}…` : t; };
const two = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

// The same words as on the computer (alerts.js alertWords).
function words(item) {
  const by = item.author || 'Someone';
  const open = item.post ? `./?open=group&tab=${item.tab === 'feed' ? 'feed' : 'news'}&post=${item.post}` : './?open=group';
  switch (item.kind) {
    case 'news': return { title: { homework: `New homework from ${by}`, reminder: `A reminder from ${by}` }[item.post_kind] ?? `New from ${by}`, body: short(item.text) || 'Open Group Circle to read it.', open };
    case 'feed': return { title: `${by} posted in the Circle`, body: short(item.text) || (item.pictures ? 'A picture' : ''), open };
    case 'reply': return { title: item.on_mine ? `${by} commented on your post` : `${by} replied to you`, body: short(item.text), open };
    case 'due': {
      const today = new Date();
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      return { title: item.due_on === dayOf(today) ? 'Homework due today' : item.due_on === dayOf(tomorrow) ? 'Homework due tomorrow' : 'Homework due soon', body: short(item.text), open };
    }
    case 'answer': return item.reply // Daniel's reply on something you told him (2026-11-24); read and answer it on your computer
      ? { title: 'Daniel replied', body: short(item.text), open: './' }
      : { title: 'Daniel has dealt with what you told him', body: short(item.text), open: './' };
    default: return null;
  }
}

async function arrived() {
  let items = [];
  try {
    const access = await kept('group');
    const sub = await self.registration.pushManager.getSubscription();
    const endpoint = sub?.endpoint ?? access?.endpoint;
    if (access?.key && access?.url && endpoint) {
      const res = await fetch(access.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.key}` },
        body: JSON.stringify({ action: 'push_take', endpoint }) });
      if (res.ok) items = (await res.json()).items ?? [];
    }
  } catch { /* no signal: say something new waits */ }
  const said = items.map((it, i) => ({ ...words(it), tag: `group-${it.kind}-${it.post ?? it.report ?? i}` })).filter((w) => w.title);
  // A phone must show something for every wake.
  if (!said.length) return self.registration.showNotification('Group Circle', { body: 'Something new is waiting for you.', tag: 'group', data: { open: './?open=group' } });
  if (said.length > 3) return self.registration.showNotification('Group Circle', { body: `${said.length} new things are waiting for you.`, tag: 'group', data: { open: './?open=group' } });
  for (const w of said) await self.registration.showNotification(w.title, { body: w.body, tag: w.tag, data: { open: w.open } });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => event.waitUntil(arrived()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.open ?? './', self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) { if ('navigate' in c) { await c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
