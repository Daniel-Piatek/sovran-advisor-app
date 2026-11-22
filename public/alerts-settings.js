// Settings › Alerts (public/alerts.js, alerts.js): whether this computer may show Mac or Windows alerts (the browser
// asks once), and an On · Off switch for each kind. There while Group Circle is on.

import { el, request } from './ui.js';
import { alertsAllowed, askToAllowAlerts, sayAlert } from './alerts.js';

const ALLOWED_WORDS = {
  granted: 'Alerts are allowed on this computer.',
  denied: 'This browser was told not to show alerts for Sovran Advisor. To change that, open the browser’s settings for this site (the icon to the left of the address) and allow Notifications. Until then, alerts show inside the app.',
  default: 'Your computer will ask once whether Sovran Advisor may show alerts. Until you allow them, alerts show inside the app.',
  unsupported: 'This browser can’t show alerts, so they show inside the app.',
};

export function alertsSection() {
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const allowed = el('div', { class: 'alerts-allowed' });
  const rows = el('div', {});

  function drawAllowed() {
    const state = alertsAllowed();
    const allow = el('button', { type: 'button', class: 'button button-primary', onclick: async () => { await askToAllowAlerts(); drawAllowed(); } }, 'Allow alerts');
    const tryIt = el('button', { type: 'button', class: 'button button-quiet', onclick: () => sayAlert({ id: 'try', title: 'This is how an alert looks', body: 'New from Daniel: this week’s homework is up.', path: null }) }, 'Show me one');
    allowed.replaceChildren(el('p', { class: 'empty' }, ALLOWED_WORDS[state] ?? ALLOWED_WORDS.default),
      el('div', { class: 'move-actions' }, ...(state === 'default' ? [allow] : []), tryIt));
  }

  async function drawRows(kinds) {
    if (!kinds) {
      try { ({ kinds } = await request('GET', '/api/alerts/settings')); } catch (err) { problem.textContent = err.message; return; }
    }
    rows.replaceChildren(...kinds.map((k) => el('div', { class: 'permission-row', 'data-alert': k.id },
      el('span', { class: 'permission-name' }, k.label),
      el('div', { class: 'switch', role: 'group', 'aria-label': k.label },
        ...[[true, 'On'], [false, 'Off']].map(([on, label]) => el('button', {
          type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(k.on === on),
          onclick: async () => {
            try { const answer = await request('PUT', '/api/alerts/settings', { id: k.id, on }); problem.textContent = ''; drawRows(answer.kinds); } catch (err) { problem.textContent = err.message; }
          },
        }, label))))));
  }

  drawAllowed();
  drawRows();
  return el('section', { class: 'settings-part', 'aria-label': 'Alerts', id: 'alerts' },
    el('h2', { class: 'settings-title' }, 'Alerts'),
    el('p', { class: 'empty' }, 'A Mac or Windows alert when something new happens, while Sovran Advisor is open. Click one to open it.'),
    allowed, rows, problem);
}
