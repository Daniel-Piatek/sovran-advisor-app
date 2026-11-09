// Google (Settings › Google, advanced/mail/1): the owner's own Google client, one row per signed-in
// account and a switch per permission (Read your mail, Send mail as you). A switch that Google has
// not allowed yet takes you to Google's page, once; what was allowed before stays allowed. No token
// is ever sent to this page: they stay in the system's key store on the server.

import { el, icon, request, timeAgo } from './ui.js';
import { face } from './people.js';

const HEALTH_WORDS = {
  ok: (a) => `Connected · last checked ${timeAgo(a.health_checked_at)}`,
  needs_signin: () => 'Google no longer lets the app in.',
  unreachable: (a) => `Google could not be reached · last tried ${timeAgo(a.health_checked_at)}`,
  unchecked: () => 'Not checked yet.',
};

// The Google account row: a letter in a square, the address, one health line and a switch per permission.
export function googleAccountRow(account, { onSwitch = () => {}, onCheck = null, onSignInAgain = null, onDisconnect = null } = {}) {
  return el('div', { class: 'google-account', 'data-health': account.health, 'data-email': account.email },
    el('div', { class: 'google-account-head' },
      face('company', account.email),
      el('div', { class: 'google-account-who' },
        el('strong', { class: 'google-account-email' }, account.email),
        el('span', { class: 'google-health', role: 'status' }, (HEALTH_WORDS[account.health] ?? HEALTH_WORDS.unchecked)(account))),
      ...(account.health === 'needs_signin' && onSignInAgain ? [el('button', { type: 'button', class: 'button', onclick: onSignInAgain }, 'Sign in again')] : []),
      ...(onCheck ? [el('button', { type: 'button', class: 'button button-quiet', onclick: onCheck }, 'Check now')] : []),
      ...(onDisconnect ? [el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Disconnect ${account.email}`, onclick: onDisconnect }, 'Disconnect')] : [])),
    ...account.permissions.map((p) => el('div', { class: 'permission-row', 'data-permission': p.id },
      el('span', { class: 'permission-name' }, p.name,
        el('span', { class: 'permission-what' }, p.on ? 'On.' : p.granted ? 'Off. Google has allowed it, so switching it on asks nothing.' : 'Off. Switching it on asks Google, for this permission only.')),
      el('div', { class: 'switch', role: 'group', 'aria-label': `${p.name} for ${account.email}` },
        ...[[true, 'On'], [false, 'Off']].map(([on, label]) => el('button', {
          type: 'button', class: 'switch-button switch-button-text', 'aria-pressed': String(p.on === on), onclick: () => onSwitch(p, on),
        }, label))))));
}

export function googleSection() {
  const body = el('div', { class: 'google-body' });
  const note = el('p', { class: 'empty', role: 'status' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  let state = null;

  const goToGoogle = (url) => { location.assign(url); };
  const clientId = el('input', { type: 'text', class: 'detail-input', 'aria-label': 'Google client ID', placeholder: 'Client ID (ends in .apps.googleusercontent.com)', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' });
  const clientSecret = el('input', {
    // Not a password field: a password manager would offer to save it as a login. The dots are drawn by the style.
    type: 'text', class: 'detail-input secret-input', 'aria-label': 'Google client secret', placeholder: 'Client secret', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
    'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other',
    onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); saveClient(); } },
  });

  async function saveClient() {
    try {
      draw(await request('PUT', '/api/google/client', { client_id: clientId.value, client_secret: clientSecret.value }));
      clientId.value = '';
      clientSecret.value = '';
      problem.textContent = '';
    } catch (err) { problem.textContent = err.message; }
  }

  async function act(fn) {
    try { problem.textContent = ''; await fn(); } catch (err) { problem.textContent = err.message; }
  }

  async function connect(extra = {}) {
    const { url } = await request('POST', '/api/google/connect', extra);
    goToGoogle(url);
  }

  function drawAccount(account) {
    return googleAccountRow(account, {
      onSwitch: (p, on) => act(async () => {
        const answer = await request('PATCH', `/api/google/accounts/${account.id}`, { permission: p.id, on });
        if (answer.url) goToGoogle(answer.url); else load();
      }),
      onCheck: () => act(async () => { await request('POST', `/api/google/accounts/${account.id}/check`, {}); await load(); }),
      onSignInAgain: () => act(() => connect({ account_id: account.id })),
      onDisconnect: () => act(async () => { draw(await request('DELETE', `/api/google/accounts/${account.id}`)); }),
    });
  }

  function draw(s) {
    state = s;
    setTimeout(() => document.dispatchEvent(new CustomEvent('google-changed')), 0); // the Google Calendar part reads its own state again
    if (s.problem) problem.textContent = s.problem;
    if (!s.configured) {
      body.replaceChildren(
        el('ol', { class: 'google-steps' },
          el('li', {}, 'In your Google Cloud project, turn on the Gmail API.'),
          el('li', {}, 'Set up the consent screen. A Workspace account can choose Internal; otherwise choose External and publish it (In production), so the sign-in does not end after seven days.'),
          el('li', {}, 'Create an OAuth client of the type Desktop app, and paste its ID and secret here. The secret goes to the key store on this computer and is never shown again.')),
        el('div', { class: 'dictation-key' }, clientId, clientSecret, el('button', { type: 'button', class: 'button', onclick: saveClient }, 'Save client')));
      return;
    }
    body.replaceChildren(
      el('p', { class: 'empty' }, `Your client ${s.client_id}. Its secret and every sign-in are kept in ${s.key_store}, never in the app’s data.`),
      ...(s.accounts.length ? s.accounts.map(drawAccount) : [el('p', { class: 'empty' }, 'No Google account yet.')]),
      el('div', { class: 'google-actions' },
        el('button', { type: 'button', class: 'button', onclick: () => act(() => connect()) }, icon('plus'), 'Add a Google account'),
        el('button', { type: 'button', class: 'button button-quiet', onclick: () => act(async () => { draw(await request('DELETE', '/api/google/client')); }) }, 'Remove client')),
      el('p', { class: 'empty' }, 'Your mail comes in under ', el('a', { href: '/mail/import' }, 'Mail › Import and sync'), ': bring your Takeout history in there.'),
      el('h3', { class: 'settings-title' }, 'Every use'),
      el('ol', { class: 'activity-log', 'aria-label': 'Google activity' }, ...(s.log.length ? s.log.map((l) => el('li', { class: 'activity-row' },
        el('span', { class: 'activity-when' }, timeAgo(l.created_at)), el('span', { class: 'activity-what' }, l.what))) : [el('li', { class: 'empty' }, 'Nothing yet.')])));
  }

  // Health is asked of Google when the page opens, for accounts not checked in the last five minutes.
  async function load() {
    try { draw(await request('GET', '/api/google')); } catch { body.replaceChildren(el('p', { class: 'empty' }, "Google's settings couldn't be loaded. Is the app still running?")); return; }
    const stale = state.accounts.filter((a) => !a.health_checked_at || Date.now() - new Date(a.health_checked_at) > 5 * 60_000);
    if (stale.length) {
      await Promise.all(stale.map((a) => request('POST', `/api/google/accounts/${a.id}/check`, {}).catch(() => {})));
      try { draw(await request('GET', '/api/google')); } catch { /* the page stays as it was */ }
    }
  }

  const back = new URLSearchParams(location.search).get('google');
  if (back === 'ok') note.textContent = 'Signed in with Google.';
  if (back) history.replaceState(null, '', location.pathname);
  load();
  return el('section', { class: 'settings-part', 'aria-label': 'Google' },
    el('h2', { class: 'settings-title' }, 'Google'),
    el('p', { class: 'empty' }, 'One sign-in per Google account, made with your own Google client, so nothing sits between this app and Google. Each permission is a switch, and Google is asked for it only on the day you switch it on.'),
    note, problem, body);
}

// Google Calendar in Settings (Calendar in depth 7): for each account with “Read your calendar” on, when its calendar was last read,
// how many events are kept, what went wrong, and Read now. The first time a switch is on and nothing was read, it reads at once.
export function googleCalendarSection() {
  const rows = el('div', { class: 'google-calendar-rows' });
  // What may change (Calendar in depth 8): the three guards. The first and third are rules of the app; the second you set, field by field.
  const guardsPart = el('div', { class: 'google-guards', 'aria-label': 'What may change in Google' });
  async function drawGuards() {
    let guards = null;
    try { guards = await request('GET', '/api/gcal/guards'); } catch { /* waits for the next visit */ }
    if (!guards) return;
    guardsPart.replaceChildren(
      el('h3', { class: 'shutdown-title' }, 'What may change in Google'),
      el('p', { class: 'permission-what' }, guards.rules[0]),
      el('div', { class: 'guard-fields', role: 'group', 'aria-label': 'Fields that may change' },
        ...guards.fields.map((f) => el('label', { class: 'guard-field' },
          el('input', { type: 'checkbox', checked: f.on, 'aria-label': f.name, onchange: async (e) => {
            const on = guards.fields.filter((x) => (x.id === f.id ? e.target.checked : x.on)).map((x) => x.id);
            try { guards = await request('PATCH', '/api/gcal/guards', { fields: on }); } catch { /* the box goes back on the next look */ }
            drawGuards();
          } }), f.name))),
      el('p', { class: 'permission-what' }, guards.rules[1]),
      el('p', { class: 'permission-what' }, guards.rules[2]));
  }
  const section = el('section', { class: 'settings-part', 'aria-label': 'Google Calendar' },
    el('h2', { class: 'settings-title' }, 'Google Calendar'),
    el('p', { class: 'empty' }, 'Your Google events on your days, with a small G, read again every minute while the app is open. Switch “Read your calendar” on under Google above; changes need “Change your calendar” too.'),
    rows, guardsPart);
  async function draw() {
    let accounts = [];
    try { accounts = await request('GET', '/api/gcal'); } catch { /* the list waits for the next visit */ }
    const on = accounts.filter((a) => a.on);
    rows.replaceChildren(...(on.length ? on.map((a) => el('div', { class: 'google-calendar-row', 'data-gcal': a.email },
      el('strong', {}, a.email),
      el('span', { class: 'permission-what', role: 'status' }, a.problem || (a.read_at ? `Read ${timeAgo(a.read_at)} · ${a.events} ${a.events === 1 ? 'event' : 'events'}` : 'Not read yet.')),
      el('button', { type: 'button', class: 'button button-quiet', onclick: async () => { await read(a); } }, 'Read now')))
      : [el('p', { class: 'empty' }, 'Nothing is read: “Read your calendar” is off for every account.')]));
    for (const a of on.filter((x) => !x.read_at && !x.problem)) read(a); // the first time: at once
  }
  async function read(account) {
    try { await request('POST', '/api/gcal/read', { account_id: account.account_id }); } catch { /* said on the account */ }
    await draw();
  }
  let attached = false; // taken off the page later (another screen): the listener goes with it
  const again = () => {
    if (section.isConnected) attached = true;
    else if (attached) { document.removeEventListener('google-changed', again); return; }
    draw();
  };
  document.addEventListener('google-changed', again);
  draw();
  drawGuards();
  return section;
}
