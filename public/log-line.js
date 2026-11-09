// The log line (People in depth, advanced/people/4): at the top of a person's and a company's
// Timeline tab. What happened outside the app, in a line: a kind (call, meeting, coffee,
// message, other), a day (today unless you change it) and one sentence; Log puts it on their
// Timeline and on the Timeline page at once. Looks like the Tasks page's add bar.

import { el, icon, request, today, undoBar } from './ui.js';

const KINDS = [['call', 'Call'], ['meeting', 'Meeting'], ['coffee', 'Coffee'], ['message', 'Message'], ['other', 'Other']];
const PHRASE = { call: 'a call', meeting: 'a meeting', coffee: 'a coffee', message: 'a message', other: 'something' };

// about: { kind: 'person' | 'company', id }, name: theirs; onLogged() runs after a line is logged or taken back.
// `accent` makes Log the screen's one accent (on the Timeline tab); the Library shows it plain.
export function logLine({ about, name, onLogged = () => {}, accent = true }) {
  const kind = el('select', { class: 'detail-input quick-flag', 'aria-label': 'Kind' }, ...KINDS.map(([value, label]) => el('option', { value }, label)));
  const day = el('input', { type: 'date', class: 'detail-input quick-day', 'aria-label': 'Day', value: today(), max: today() });
  const sentence = el('input', {
    class: 'search-input', 'aria-label': 'What happened', placeholder: `What happened with ${name}`, autocomplete: 'off', maxlength: 500,
    onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); log(); } },
  });
  const message = el('p', { class: 'capture-hint quick-message', role: 'status' });
  const undoPlace = el('div', {});
  const button = el('button', { type: 'button', class: accent ? 'button button-primary' : 'button', onclick: () => log() }, icon('plus'), 'Log');

  async function log() {
    if (!sentence.value.trim()) { message.textContent = 'A log line needs a sentence.'; sentence.focus(); return; }
    button.disabled = true;
    try {
      const made = await request('POST', '/api/interactions', { about, kind: kind.value, note: sentence.value, when: day.value || '' });
      message.textContent = '';
      sentence.value = '';
      day.value = today();
      undoPlace.replaceChildren(undoBar(`Logged ${PHRASE[made.kind]} with ${name}.`, async () => {
        await request('DELETE', `/api/interactions/${made.id}`);
        onLogged();
      }));
      onLogged();
    } catch (err) {
      message.textContent = `That couldn't be logged: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }

  const element = el('div', { class: 'quick-add log-line' },
    el('div', { class: 'quick-row' }, el('label', { class: 'quick-words' }, icon('log'), sentence), kind, day, button),
    message, undoPlace);
  return { element, focus: () => sentence.focus() };
}
