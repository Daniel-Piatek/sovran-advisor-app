// Settings, folded (2026-11-16, the owner's wish): at first you see only the name of each part, with an arrow to its left and,
// where the name alone doesn't say it, one short line on what is inside. Click the name and the part opens. Open or closed is
// remembered in this browser, part by part. A part that appears later (a module switched on) folds the same way.

import { icon } from './ui.js';

// One short line under a name that doesn't explain itself (by the part's aria-label).
const HINTS = {
  'Which AI': 'The AI that answers you: Claude or ChatGPT.',
  Updates: 'Get the newest version of Sovran Advisor.',
  'Sovran Library': 'Your key to the Sovran teaching, your decodes and your reports.',
  Course: 'The link to your course page.',
  'Your assistant': 'What your assistant does by itself, and what it asks you first.',
  Modules: 'Switch parts of the app on or off.',
  'Background jobs': 'What the app does by itself, and when it last did.',
  'Calendar timings': 'How quickly the Calendar and the Planner answer.',
  'Capture from anywhere': 'Send a thought to your Inbox from your browser or another app.',
  'Phone capture': 'A Capture app on your phone that lands in your Inbox.',
  'Phone, backups and moving': 'Your daily backups, and moving to a new computer.',
  Import: 'Bring in notes and contacts you already have.',
  Google: 'Your Google sign-in, and what the app may use there.',
  'Google Calendar': 'Your Google events on your days.',
  Dictation: 'Speak instead of typing.',
  Glossary: 'Names and words your dictation should get right.',
  Voice: 'Talking with your assistant out loud.',
  'Voice log': 'When a part of a call failed.',
  Restart: 'Stop the app and start it again.',
  'Always allowed': 'Steps your assistant no longer asks about.',
  Activity: 'Everything that was switched or done, newest first.',
  'Your assistant and mail': 'What your assistant may do with your mail.',
};

const key = (name) => `settings-section:${name}`;
function remembered(name) {
  try { return localStorage.getItem('settings-sections') === 'open' || localStorage.getItem(key(name)) === 'open'; } catch { return false; }
}
function remember(name, open) {
  try { if (open) localStorage.setItem(key(name), 'open'); else localStorage.removeItem(key(name)); } catch { /* it opens closed next time */ }
}

// Folds one part: its first heading becomes the button that opens it.
function foldPart(part) {
  if (part.dataset.folded) return;
  const title = part.querySelector(':scope > h2.settings-title');
  if (!title) return;
  part.dataset.folded = 'yes';
  const name = part.getAttribute('aria-label') ?? title.textContent;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'settings-toggle';
  toggle.append(icon('chevron'), ...title.childNodes);
  title.append(toggle);
  const hint = HINTS[name] ? Object.assign(document.createElement('p'), { className: 'settings-hint', textContent: HINTS[name] }) : null;
  if (hint) title.after(hint);
  const set = (open) => {
    part.classList.toggle('is-closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  set(remembered(name));
  toggle.addEventListener('click', () => { const open = part.classList.contains('is-closed'); set(open); remember(name, open); });
  part.open = () => { set(true); remember(name, true); };
}

const topParts = (root) => [...root.querySelectorAll('section.settings-part')].filter((p) => !p.parentElement.closest('section.settings-part'));

// Folds every part on the Settings screen now and as parts come; returns what stops it (for onLeave).
export function foldSettings(root) {
  topParts(root).forEach(foldPart);
  const watch = new MutationObserver(() => topParts(root).forEach(foldPart));
  watch.observe(root, { childList: true, subtree: true });
  return () => watch.disconnect();
}
