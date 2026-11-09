// Quick capture: ⌘K (Ctrl-K) or the Capture button opens a small box over whatever you
// are doing. Enter (or ⌘-Enter) keeps what you typed as a capture and closes the box, and
// you are back where you were. Escape closes it without saving; what you had typed stays
// in the box for the next time it opens, so a slip of the finger loses nothing. A capture
// asks nothing else: it waits in the Inbox.

import { createEditor, markdownOf, isEmpty } from './editor.js';
import { api, el, icon } from './ui.js';

let dialog = null;
let editor = null;
let draft = '';
let world = 'inner'; // Inner World (your own thought) or Outer World (something someone else made); Alt+1 / Alt+2
let cameFrom = null;
let cameFromSelection = null;
let onCaptured = () => {};

export function whenCaptured(callback) { onCaptured = callback; }

export const isCaptureOpen = () => Boolean(dialog?.open);

function close({ keep }) {
  draft = keep && editor && !isEmpty(editor) ? markdownOf(editor) : '';
  editor?.destroy();
  editor = null;
  if (dialog?.open) dialog.close();
  // Back to what you were doing, with the cursor exactly where it was.
  cameFrom?.focus?.({ preventScroll: true });
  if (cameFromSelection) {
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(cameFromSelection);
  }
  cameFrom = null;
  cameFromSelection = null;
}

async function save() {
  if (!editor) return;
  if (isEmpty(editor)) { close({ keep: false }); return; }
  const body = markdownOf(editor);
  try {
    await api.createCapture(body, world);
  } catch {
    problem.textContent = "That couldn't be kept. Is the app still running? Your text is still here.";
    return;
  }
  close({ keep: false });
  chooseWorld('inner');
  onCaptured();
}

const place = el('div', { class: 'capture-text' });
const worldButtons = ['inner', 'outer'].map((name) => el('button', {
  type: 'button', class: 'chip', 'aria-pressed': String(name === world), 'aria-keyshortcuts': name === 'inner' ? 'Alt+1' : 'Alt+2',
  title: name === 'inner' ? 'Inner World: my own thought (Alt+1)' : 'Outer World: something someone else made (Alt+2)',
  onclick: () => { chooseWorld(name); editor?.focus(); },
}, icon(`world_${name}`), name === 'inner' ? 'Inner' : 'Outer'));
function chooseWorld(name) {
  world = name;
  worldButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(['inner', 'outer'][i] === world)));
}
const problem = el('p', { class: 'capture-problem', role: 'alert' });

function build() {
  dialog = el('dialog', { class: 'capture-box', 'aria-label': 'Quick capture' },
    place,
    el('div', { class: 'capture-foot' },
      el('span', { class: 'capture-worlds', role: 'group', 'aria-label': 'World' }, ...worldButtons),
      el('span', { class: 'capture-hint' }, 'Enter saves · Shift-Enter new line · Esc closes'),
      el('button', { type: 'button', class: 'button button-primary', onclick: () => save() }, 'Save')),
    problem);
  // Escape: closes, and keeps the text for next time. It is caught before the editor,
  // which would otherwise use Escape itself; only while the slash menu is open does
  // Escape go to the editor, to close the menu.
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close({ keep: true }); });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey && (event.code === 'Digit1' || event.code === 'Digit2')) { event.preventDefault(); chooseWorld(event.code === 'Digit1' ? 'inner' : 'outer'); return; }
    if (event.key !== 'Escape' || dialog.querySelector('.slash-menu:not([hidden])')) return;
    event.preventDefault();
    event.stopPropagation();
    close({ keep: true });
  }, true);
  // A click outside the box (on the page behind) closes it the same way.
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close({ keep: true }); });
  document.body.append(dialog);
}

export function openCapture() {
  if (isCaptureOpen()) { editor?.focus(); return; }
  if (!dialog) build();
  cameFrom = document.activeElement;
  const selection = document.getSelection();
  cameFromSelection = selection.rangeCount && cameFrom?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
  problem.textContent = '';
  dialog.showModal();
  editor = createEditor(place, draft, {
    onSubmit: save,
    onFileProblem: (message) => { problem.textContent = message; },
    label: 'Capture',
    placeholderText: 'What’s on your mind?',
    className: 'note-body capture-body',
  });
  editor.focus();
}

// ⌘K (Ctrl-K on other computers) from anywhere in the app, even while writing.
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCapture();
  }
}, true);
