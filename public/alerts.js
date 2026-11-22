// Alerts (2026-11-22, the owner's wish): something new in Group Circle (an announcement, a reply to you, homework due
// tomorrow, Daniel dealing with what you told him; in APP Daniel a new student report or a flag) shows as a normal Mac or
// Windows alert while Sovran Advisor is open, and the count beside Group Circle goes up. Clicking it opens that post.
// The server (alerts.js) asks the Sovran cloud and says each one once; Settings › Alerts has a switch for each kind.
//
// The browser asks once whether this app may show alerts (Settings › Alerts › Allow alerts). Until then, or when the
// window is in front, the same words show inside the app instead, at the foot of the window in the Notice's look.

import { el, request } from './ui.js';
import { navigate, refreshGroupCount } from './shell.js';
import { moduleOn, onModulesChanged } from './modules.js';

const ASK_EVERY_MS = 60_000;
const NOTICE_MS = 12_000;
const ICON = '/icons/apple-touch-icon.png';

export const alertsAllowed = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission); // granted | denied | default
export async function askToAllowAlerts() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

function stack() {
  let s = document.querySelector('.notices');
  if (!s) { s = el('div', { class: 'notices', 'aria-live': 'assertive' }); document.body.append(s); }
  return s;
}

function open(path) {
  window.focus();
  if (path) navigate(path);
}

function inApp({ title, body, path }) {
  const close = () => box.remove();
  const box = el('div', { class: 'undo-bar notice alert-notice', role: 'status' },
    el('span', { class: 'notice-text' }, el('strong', {}, title), body ? el('span', { class: 'alert-notice-body' }, body) : null),
    el('span', { class: 'notice-actions' },
      path ? el('button', { type: 'button', class: 'button', onclick: () => { close(); open(path); } }, 'Open') : null,
      el('button', { type: 'button', class: 'button button-quiet', onclick: close }, 'Close')));
  stack().append(box);
  setTimeout(close, NOTICE_MS);
}

// One alert: the computer's own when it may and the window isn't in front, else inside the app.
export function sayAlert(alert) {
  const away = document.visibilityState !== 'visible' || !document.hasFocus();
  if (alertsAllowed() === 'granted' && away) {
    try {
      const shown = new Notification(alert.title, { body: alert.body || '', icon: ICON, tag: alert.id || undefined });
      shown.onclick = () => { shown.close(); open(alert.path); };
      return;
    } catch { /* some browsers only allow it from a service worker: say it inside the app */ }
  }
  inApp(alert);
}

let asking = false;
export async function askForAlerts() {
  if (asking || !moduleOn('group')) return;
  asking = true;
  try {
    const { items = [] } = await request('GET', '/api/alerts');
    for (const item of items) sayAlert(item);
    if (items.length) refreshGroupCount();
  } catch { /* the app isn't running, or the cloud can't be reached: ask again later */ }
  finally { asking = false; }
}

// "update": a new version is ready (public/update-nudge.js says it once per version), if its switch is on.
export async function sayUpdateAlert() {
  try {
    const { kinds = [] } = await request('GET', '/api/alerts/settings');
    if (!kinds.find((k) => k.id === 'update')?.on) return;
  } catch { return; }
  if (alertsAllowed() === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
    sayAlert({ id: 'update', title: 'A new version of Sovran Advisor is ready', body: 'Open Sovran Advisor to update.', path: '/settings' });
  }
}

setTimeout(askForAlerts, 4000);
setInterval(askForAlerts, ASK_EVERY_MS);
onModulesChanged(() => askForAlerts());
