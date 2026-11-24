// Tell Daniel (module tell, 2026-11-19, the owner's wish): a button beside Share to Group Circle on a Sovran Advisor answer,
// a note, a journal entry, a report passage, and on Help. It opens a small window: what kind of thing is it (Something
// isn't working, Something seems off here, I have a question about this, Other), a box to say why, and the words that go
// with it, shown in full before anything is sent. The server (tell-daniel.js) sends it to the Sovran cloud with the
// library key, adding this app's version.
//
//   tellDanielButton({ place, items, label? })   items: () => [{ key, label, value }] (or a promise of them): what goes
//                                                with it, read when pressed

import { el, request } from './ui.js';
import { moduleOn } from './modules.js';

const KINDS = [
  ['broken', 'Something isn’t working', 'The app did something wrong, or didn’t do what you asked.'],
  ['off', 'Something seems off here', 'The words don’t sound right, or don’t fit you or your report.'],
  ['question', 'I have a question about this', 'You’d like Daniel to explain something.'],
  ['other', 'Other', 'Anything else. Say what it is below.'],
];

export function tellDanielButton({ place, items, label = 'Tell Daniel' }) {
  if (!moduleOn('tell')) return null;
  return el('button', { type: 'button', class: 'button button-quiet tell-daniel', title: 'Let Daniel know about a problem or a question here',
    onclick: async () => openTellDaniel({ place, items: await items() }) }, label);
}

export async function openTellDaniel({ place, items }) {
  document.querySelector('dialog.tell-dialog')?.remove();
  const shown = items.filter((item) => item.value != null && String(item.value).trim() !== '' && !(Array.isArray(item.value) && !item.value.length));
  const finish = () => { dialog.close(); dialog.remove(); };
  const why = el('textarea', { class: 'tell-why', rows: 4, maxlength: 4000, 'aria-label': 'Tell Daniel why', placeholder: 'What happened, or what you’d like to know…' });
  const status = el('p', { class: 'tell-status', role: 'status' });
  const send = el('button', { type: 'submit', class: 'button button-primary', disabled: true }, 'Send to Daniel');
  const choices = el('fieldset', { class: 'tell-kinds' }, el('legend', {}, 'What is it?'),
    ...KINDS.map(([value, words, hint]) => el('label', { class: 'tell-kind' },
      el('input', { type: 'radio', name: 'tell-kind', value, onchange: () => { send.disabled = false; why.placeholder = value === 'other' ? 'Say what it’s about (needed for Other)…' : 'What happened, or what you’d like to know…'; } }),
      el('span', {}, el('strong', {}, words), el('span', { class: 'tell-hint' }, hint)))));
  const version = el('dd', {}, '…');
  request('GET', '/api/tell/version').then((r) => { version.textContent = r.version; }).catch(() => { version.textContent = 'this app’s version'; });
  const preview = el('details', { class: 'tell-preview', open: shown.length <= 2 },
    el('summary', {}, 'What goes with it'),
    el('dl', {}, ...shown.flatMap((item) => [el('dt', {}, item.label), el('dd', {}, Array.isArray(item.value) ? item.value.join('\n') : String(item.value))]),
      el('dt', {}, 'This app'), version));
  const form = el('form', { class: 'tell-form', onsubmit: async (event) => {
    event.preventDefault();
    const kind = form.querySelector('input[name="tell-kind"]:checked')?.value;
    if (!kind) { status.textContent = 'Pick what kind of thing this is.'; return; }
    if (kind === 'other' && !why.value.trim()) { status.textContent = 'Say what it’s about first.'; why.focus(); return; }
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      await request('POST', '/api/tell', { kind, why: why.value, place, context: Object.fromEntries(shown.map((item) => [item.key, item.value])) });
      form.replaceChildren(el('h2', { class: 'event-read-title' }, 'Sent to Daniel'),
        el('p', { class: 'tell-done' }, 'Thank you. Daniel reads every one of these. His reply comes as an alert, and on Help, in your sidebar.'),
        el('div', { class: 'capture-foot' }, el('span'), el('button', { type: 'button', class: 'button button-primary', onclick: finish }, 'Done')));
    } catch (err) { status.textContent = err.message; send.disabled = false; }
  } },
  el('h2', { class: 'event-read-title' }, 'Tell Daniel'),
  choices,
  el('label', { class: 'tell-why-label' }, 'Why? ', el('span', { class: 'tell-hint' }, 'A few words are enough.'), why),
  preview, status,
  el('div', { class: 'capture-foot' }, el('span'),
    el('span', { class: 'event-actions' }, el('button', { type: 'button', class: 'button button-quiet', onclick: finish }, 'Cancel'), send)));
  const dialog = el('dialog', { class: 'capture-box event-dialog tell-dialog', 'aria-label': 'Tell Daniel',
    oncancel: (event) => { event.preventDefault(); finish(); },
    onclick: (event) => { if (event.target === dialog) finish(); } }, form);
  document.body.append(dialog);
  dialog.showModal();
  choices.querySelector('input').focus();
}
