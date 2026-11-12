// Settings › Phone, backups and moving (module everywhere; myICOR advanced/everywhere 3, 8 and 11, the Sovran Advisor way:
// no cloud account, nothing to pay). Three parts:
//   On your phone      the Capture icon for the home screen (/quick), and where the phone finds it
//   Daily backups      the copies the app keeps, each checked when it was made, and Check them now
//   A new computer     a moving file with everything in it, and bringing one in (it waits for your yes)

import { el, request, clockTime, shortDate } from './ui.js';
import { fold } from './fold.js';

const number = (n) => n.toLocaleString();
const ONE = { notes: 'note', 'journal entries': 'journal entry', people: 'person', tasks: 'task', 'Inbox items': 'Inbox item', 'assistant chats': 'assistant chat', 'pictures and files': 'picture or file' };
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function phonePart() {
  const where = el('div', {});
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const show = ({ addresses }) => {
    const list = local ? addresses : [`${location.origin}/quick`];
    where.replaceChildren(...(list.length
      ? [el('p', { class: 'empty' }, 'On your phone, open this address in Safari or Chrome, then Share › Add to Home Screen:'),
        ...list.map((a) => el('p', { class: 'phone-address' }, a))]
      : [el('p', { class: 'empty' }, 'Your phone can’t reach this computer yet. Ask Claude: “set up Sovran Advisor on my phone”. When that is done, the address for your phone shows here.')]));
  };
  request('GET', '/api/phone').then(show).catch(() => show({ addresses: [] }));
  return el('div', { class: 'settings-subpart', 'aria-label': 'On your phone' },
    el('h3', { class: 'settings-subtitle' }, 'On your phone'),
    el('p', { class: 'empty' }, 'A Capture icon on your phone’s home screen: tap it, type, tap Keep. The thought waits in your Inbox here. If your computer is asleep, the words stay on the phone and arrive when it wakes.'),
    where,
    el('p', {}, el('a', { class: 'quick-open', href: '/quick', target: '_blank', rel: 'noopener' }, 'See the Capture page')));
}

function backupsPart() {
  const list = el('ul', { class: 'backup-list', 'aria-label': 'Daily backups' });
  const folded = fold('backups', 'Your copies', list);
  const status = el('p', { class: 'empty', role: 'status' });
  const checkWords = (c) => {
    if (!c) return 'Not checked yet';
    if (!c.ok) return `Problem: ${c.problem}`;
    return `Checked ${shortDate(c.checked_at)} ${clockTime(c.checked_at)}: complete${c.compared ? ', the same as the app' : ''}`;
  };
  const draw = (backups) => {
    const bad = backups.filter((b) => b.check && !b.check.ok).length;
    folded.say(backups.length, ['copy', 'copies'], [backups[0] ? `newest ${backups[0].day}` : '', bad ? `${bad} with a problem` : ''].filter(Boolean).join(' · '));
    list.replaceChildren(...(backups.length ? backups.map((b) => el('li', { class: 'backup-row', 'data-day': b.day },
      el('span', { class: 'backup-day' }, b.day),
      el('span', { class: 'backup-check', 'data-ok': String(b.check?.ok ?? true) }, `${checkWords(b.check)} · ${size(b.bytes)}`)))
      : [el('li', { class: 'empty' }, 'No backup yet. The first is made within the hour.')]));
  };
  const button = el('button', { type: 'button', class: 'button' }, 'Check them now');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Checking…';
    try {
      const backups = await request('POST', '/api/backups/check', {});
      draw(backups);
      const bad = backups.filter((b) => !b.check?.ok).length;
      status.textContent = bad ? `${bad} of ${backups.length} ${backups.length === 1 ? 'copy has' : 'copies have'} a problem. Ask Claude for help.` : `All ${backups.length} ${backups.length === 1 ? 'copy is' : 'copies are'} complete.`;
    } catch (err) { status.textContent = err.message; }
    button.disabled = false;
  });
  request('GET', '/api/backups').then(draw).catch(() => { status.textContent = 'The backups couldn’t be loaded.'; });
  return el('div', { class: 'settings-subpart', 'aria-label': 'Daily backups' },
    el('h3', { class: 'settings-subtitle' }, 'Daily backups'),
    el('p', { class: 'empty' }, 'Each day the app keeps a whole copy of your data in its own folder (data/backups), the newest 14. Each copy is opened and checked as soon as it is made.'),
    folded, el('div', { class: 'move-actions' }, button), status);
}

function movePart() {
  const status = el('p', { class: 'empty', role: 'status' });
  const waitingPlace = el('div', {});
  const lastPlace = el('div', {});
  const picker = el('input', { type: 'file', accept: '.gz,.tgz,application/gzip', 'aria-label': 'Moving file', hidden: true });
  const bring = el('button', { type: 'button', class: 'button' }, 'Bring in a moving file');
  bring.addEventListener('click', () => picker.click());

  const waitForRestart = async () => {
    const alive = async () => { try { await fetch('/api/health', { signal: AbortSignal.timeout(800) }); return true; } catch { return false; } };
    for (let i = 0; i < 40 && await alive(); i++) await new Promise((resolve) => setTimeout(resolve, 250));
    for (let i = 0; i < 120; i++) {
      if (await alive()) { location.reload(); return; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    status.textContent = 'It did not come back. Open the app from its icon; the move finishes as it starts.';
  };

  const show = (state) => {
    lastPlace.replaceChildren(...(state.last ? [el('p', { class: 'empty' },
      `Brought in ${shortDate(state.last.at)} ${clockTime(state.last.at)}${state.last.made_at ? ` from a moving file made ${shortDate(state.last.made_at)}` : ''}. What was here before is kept in the app’s folder: data/${state.last.kept_at}.`)] : []));
    if (!state.waiting) { waitingPlace.replaceChildren(); return; }
    const counts = Object.entries(state.counts ?? {}).filter(([, n]) => n > 0).map(([what, n]) => `${number(n)} ${n === 1 ? (ONE[what] ?? what) : what}`).join(', ');
    const go = el('button', { type: 'button', class: 'button' }, 'Replace everything here with it');
    const away = el('button', { type: 'button', class: 'button button-quiet' }, 'Put it away');
    go.addEventListener('click', async () => {
      go.disabled = true; away.disabled = true;
      try {
        const answer = await request('POST', '/api/move/confirm', {});
        if (answer.restarting) { status.textContent = 'Bringing it in: the app restarts…'; await waitForRestart(); }
        else status.textContent = 'Close the app and open it again: the move finishes as it starts.';
      } catch (err) { status.textContent = err.message; go.disabled = false; away.disabled = false; }
    });
    away.addEventListener('click', async () => {
      try { show(await request('DELETE', '/api/move')); status.textContent = 'Put away. Nothing was changed.'; } catch (err) { status.textContent = err.message; }
    });
    waitingPlace.replaceChildren(el('div', { class: 'move-summary', role: 'group', 'aria-label': 'The moving file' },
      el('span', {}, el('b', {}, 'A moving file waits'), state.made_at ? ` (made ${shortDate(state.made_at)} ${clockTime(state.made_at)})` : ''),
      el('span', {}, counts ? `It holds ${counts}.` : 'It holds an empty app.'),
      el('span', {}, 'Bringing it in replaces everything in this app. What is here now is kept, whole, in the app’s folder.'),
      state.confirmed ? el('span', {}, 'You said yes: it is brought in when the app next starts.') : el('div', { class: 'move-actions' }, go, away)));
  };

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    status.textContent = `Reading ${file.name}…`;
    bring.disabled = true;
    try {
      const res = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/x-sovran-move' }, body: file });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.error ?? 'The moving file could not be read.');
      status.textContent = 'Read and checked. Nothing has changed yet.';
      show(await request('GET', '/api/move'));
    } catch (err) { status.textContent = err.message; }
    bring.disabled = false;
  });

  request('GET', '/api/move').then(show).catch(() => {});
  return el('div', { class: 'settings-subpart', 'aria-label': 'A new computer' },
    el('h3', { class: 'settings-subtitle' }, 'A new computer'),
    el('p', { class: 'empty' }, 'Make a moving file here: one file with everything you wrote, and your pictures and files. Copy it to the new computer (a USB stick, AirDrop, or your cloud drive). There, install Sovran Advisor, switch on this module, and choose Bring in a moving file.'),
    el('p', { class: 'empty' }, 'Not in the file: your Dictation key, the link to your phone, and capture devices. Set those again on the new computer.'),
    el('div', { class: 'move-actions' },
      el('a', { class: 'button', href: '/api/move/file', download: '' }, 'Make a moving file'),
      bring, picker),
    waitingPlace, lastPlace, status);
}

export function everywhereSection() {
  return el('section', { class: 'settings-part', 'aria-label': 'Phone, backups and moving' },
    el('h2', { class: 'settings-title' }, 'Phone, backups and moving'),
    phonePart(), backupsPart(), movePart());
}
