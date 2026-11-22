// The update nudge (2026-11-15, the owner's wish): when the app's daily look has found a new version, the student sees it
// without opening Settings. Two things, both from GET /api/update (app-update.js), never installing anything by themselves:
//   the badge    "Update" beside Settings in the sidebar, there while a new version waits
//   the notice   once per new version, at the foot of the window in the Notice's look: "A new version of Sovran Central
//                is ready." Update now starts the same update as Settings › Updates (a whole copy of the notes first) and
//                opens Settings to follow it; Later hides it until the next new version. Not shown on Settings itself.

import { el, request } from './ui.js';
import { navigate } from './shell.js';
import { sayUpdateAlert } from './alerts.js';

const LOOK_EVERY_MS = 6 * 60 * 60 * 1000; // the server looks once a day; the page asks it a few times a day
const SEEN_KEY = 'update-nudge:seen';

const badge = el('span', { class: 'update-ready sidebar-update', hidden: true, title: 'A new version is ready: Settings › Updates' }, 'Update');
let box = null;
let current = '';
let alerted = '';

const seen = () => { try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; } };
const markSeen = (key) => { try { localStorage.setItem(SEEN_KEY, key); } catch { /* the notice may show again; no harm */ } };

function placeBadge() {
  const link = document.querySelector('.sidebar-link[data-section="Settings"]');
  if (link && !link.contains(badge)) link.append(badge);
}

function stack() {
  let s = document.querySelector('.notices');
  if (!s) { s = el('div', { class: 'notices', 'aria-live': 'assertive' }); document.body.append(s); }
  return s;
}

function hideNotice() { box?.remove(); box = null; }

function showNotice(key) {
  if (box || location.pathname === '/settings') return;
  const later = el('button', { type: 'button', class: 'button button-quiet', onclick: () => { markSeen(key); hideNotice(); } }, 'Later');
  const now = el('button', {
    type: 'button', class: 'button', onclick: async () => {
      markSeen(key);
      now.disabled = true; later.disabled = true;
      try { await request('POST', '/api/update', {}); } catch { /* Settings › Updates shows what it can do instead */ }
      hideNotice();
      navigate('/settings');
    },
  }, 'Update now');
  box = el('div', { class: 'undo-bar notice update-notice', role: 'status' },
    el('span', { class: 'notice-text' }, 'A new version of Sovran Central is ready.'),
    el('span', { class: 'notice-actions' }, now, later));
  stack().append(box);
}

export async function lookForUpdate() {
  let s;
  try { s = await request('GET', '/api/update'); } catch { return; }
  const ready = Boolean(s?.can && s.check?.behind > 0 && !s.progress?.running);
  placeBadge();
  badge.hidden = !ready;
  if (!ready) { hideNotice(); current = ''; return; }
  current = `${s.check.behind}:${s.check.news?.[0] ?? ''}`;
  if (seen() !== current) {
    showNotice(current);
    if (box && alerted !== current) { alerted = current; sayUpdateAlert(); } // the computer's own alert too, once a version
  }
}

// On Settings the notice is not needed: Settings › Updates says it there.
window.addEventListener('popstate', () => { if (location.pathname === '/settings') hideNotice(); });
document.addEventListener('click', (event) => {
  if (event.target.closest?.('a[href="/settings"]')) hideNotice();
}, true);

setTimeout(lookForUpdate, 1500);
setInterval(lookForUpdate, LOOK_EVERY_MS);
