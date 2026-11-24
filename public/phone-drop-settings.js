// Settings › Phone capture (module phone-drop, phone-drop.js). The code for the phone's camera (and the same link to
// copy), the steps to put go Sovran on the home screen with the crown icon, when notes last came in, Check now, and
// A new link (the old link stops working at once: for a lost phone, or a link shared by mistake).

import { pageVideo } from './page-video.js';
import { el, request, clockTime, shortDate } from './ui.js';

export function phoneDropSection() {
  const status = el('p', { class: 'empty', role: 'status', 'aria-live': 'polite' });
  const body = el('div', { class: 'phone-drop' });
  const when = (at) => `${shortDate(at)} ${clockTime(at)}`;

  const draw = (state) => {
    if (!state.linked) {
      const make = el('button', { type: 'button', class: 'button button-primary' }, 'Make my phone link');
      make.addEventListener('click', () => link(false, make));
      body.replaceChildren(el('p', { class: 'empty' }, 'Your phone link couldn’t be made yet. This computer needs the internet for it.'), el('div', { class: 'move-actions' }, make));
      return;
    }
    const code = el('img', { class: 'phone-drop-code', src: `/api/phone-drop/qr.svg?at=${encodeURIComponent(state.made_at)}`, alt: 'Code for your phone’s camera', width: 220, height: 220 });
    const copy = el('button', { type: 'button', class: 'button button-quiet' }, 'Copy the link');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.link); status.textContent = 'Copied. Send it only to yourself: whoever has it can drop notes into your Inbox.'; } catch { status.textContent = state.link; }
    });
    const check = el('button', { type: 'button', class: 'button' }, 'Check now');
    check.addEventListener('click', async () => {
      check.disabled = true; status.textContent = 'Checking…';
      try {
        const answer = await request('POST', '/api/phone-drop/check', {});
        status.textContent = answer.collected ? `${answer.collected} new from your phone.` : 'Nothing waiting.';
        draw(answer);
      } catch (err) { status.textContent = err.message; }
      check.disabled = false;
    });
    const fresh = el('button', { type: 'button', class: 'button button-quiet' }, 'A new link');
    fresh.addEventListener('click', () => {
      if (fresh.dataset.sure !== 'yes') { // asked once, in place: the old link stops working at once
        fresh.dataset.sure = 'yes';
        fresh.textContent = 'Yes, make a new link';
        status.textContent = 'The old link stops working at once, and your phone needs the new code (on an iPhone, add it to the home screen again).';
        return;
      }
      link(true, fresh);
    });
    body.replaceChildren(
      el('div', { class: 'phone-drop-pair' },
        code,
        el('ol', { class: 'phone-drop-steps' },
          el('li', {}, 'Point your phone’s camera at the code and open the link. (iPhone: in Safari. Android: in Chrome.)'),
          el('li', {}, 'iPhone: Share › Add to Home Screen › Add. Android: Install, or ⋮ › Install app.'),
          el('li', {}, 'Open go Sovran from your home screen: the crown icon. Choose what you would like to do. To speak, tap the microphone on the keyboard.'))),
      el('p', { class: 'empty' }, state.problem ?? (state.last_collected_at
        ? `Last came in ${when(state.last_collected_at)} · ${state.collected} so far. This computer checks about once a minute while Sovran Central is open.`
        : 'Nothing has come in yet. This computer checks about once a minute while Sovran Central is open.')),
      ...(state.saves_chats ? [el('p', { class: 'empty phone-drop-chats' }, `Chats with your AI: ready. When ${state.ai ?? 'Claude'} offers to keep a chat saved and you say yes, it arrives in your Inbox as one item.`)] : []),
      ...(state.shelf ? [el('p', { class: 'empty phone-drop-reports' }, `My reports: ${state.shelf === 1 ? 'your report is' : `your ${state.shelf} reports are`} on your phone, in go Sovran, with your highlights and comments. A new link takes them off the old phone.`)] : []),
      el('div', { class: 'move-actions' }, check, copy, fresh));
  };

  async function link(isFresh, button) {
    button.disabled = true; status.textContent = isFresh ? 'Making a new link…' : 'Making your phone link…';
    try { draw(await request('POST', '/api/phone-drop/link', { fresh: isFresh })); status.textContent = isFresh ? 'New link made. Scan the new code with your phone.' : ''; } catch (err) { status.textContent = err.message; }
    button.disabled = false;
  }

  request('GET', '/api/phone-drop').then((state) => {
    if (state.linked) draw(state);
    else { draw(state); link(false, body.querySelector('button')); } // made by itself the first time
  }).catch((err) => { status.textContent = err.message; });

  return el('section', { class: 'settings-part', id: 'go-sovran', 'aria-label': 'go Sovran' },
    el('h2', { class: 'settings-title' }, 'go Sovran'),
    el('p', { class: 'empty' }, 'Sovran Central on your iPhone or Android phone, with the crown icon: ask your AI, write a journal entry for your Journal, or speak or type a thought anywhere, and it lands in your Inbox here.'),
    el('p', { class: 'settings-video' }, pageVideo('phone', 'go Sovran', '/settings#go-sovran')),
    body, status,
    el('p', { class: 'empty phone-drop-privacy' }, 'Private: your words are scrambled on your phone before they leave it. They wait, unreadable, in the Sovran drop box only until this computer collects them, then they are deleted. The key is only on your phone and this computer; nobody else, Sovran included, can read them.'));
}
