// Settings, folded (2026-11-16, the owner's wish): at first you see only the name of each part, with an arrow to its left and,
// where the name alone doesn't say it, one short line on what is inside. Click the name and the part opens. Open or closed is
// remembered in this browser, part by part. A part that appears later (a module switched on) folds the same way.
// "Open all" at the top (2026-11-17, the owner's wish) opens every part and every list inside it, so Cmd-F finds anything on
// the page; it then reads "Close all", which folds them all again. Open all lasts while you are on the page (next time
// Settings opens folded as before); Close all also forgets the parts you had left open.

import { icon } from './ui.js';

// One short line under a name that doesn't explain itself (by the part's aria-label).
const HINTS = {
  'Which AI': 'The AI that answers you: Claude or ChatGPT.',
  Updates: 'Get the newest version of Sovran Central.',
  'Sovran Library': 'Your key to the Sovran teaching, your decodes and your reports.',
  Course: 'The link to your course page.',
  'Sovran Advisor': 'What Sovran Advisor does by itself, and what it asks you first.',
  Modules: 'Switch parts of the app on or off.',
  Sidebar: 'Your own order of sections, with lines where you want them.',
  'Background jobs': 'What the app does by itself, and when it last did.',
  'Calendar timings': 'How quickly the Calendar and the Planner answer.',
  'Capture from anywhere': 'Send a thought to your Inbox from your browser or another app.',
  'go Sovran': 'Sovran Central on your phone: ask your AI, write, and read your reports.',
  'Phone, backups and moving': 'Your daily backups, and moving to a new computer.',
  Import: 'Bring in notes and contacts you already have.',
  Tags: 'Rename, join, group and pin your tags.',
  Alerts: 'What tells you when something new happens in Group Circle.',
  Google: 'Your Google sign-in, and what the app may use there.',
  'Google Calendar': 'Your Google events on your days.',
  Dictation: 'Speak instead of typing.',
  Glossary: 'Names and words your dictation should get right.',
  Voice: 'Talking with Sovran Advisor out loud.',
  'Voice log': 'When a part of a call failed.',
  Restart: 'Stop the app and start it again.',
  'Always allowed': 'Steps Sovran Advisor no longer asks about.',
  Activity: 'Everything that was switched or done, newest first.',
  'Sovran Advisor and mail': 'What Sovran Advisor may do with your mail.',
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
  const changed = () => part.dispatchEvent(new Event('settings-part-toggle', { bubbles: true }));
  set(remembered(name));
  toggle.addEventListener('click', () => { const open = part.classList.contains('is-closed'); set(open); remember(name, open); changed(); });
  part.open = () => { set(true); remember(name, true); changed(); };
  part.show = (open) => { set(open); if (!open) remember(name, false); }; // for Open all / Close all
}

const topParts = (root) => [...root.querySelectorAll('section.settings-part')].filter((p) => !p.parentElement.closest('section.settings-part'));

// Folds every part on the Settings screen now and as parts come; returns what stops it (for onLeave).
export function foldSettings(root) {
  let allOpen = false;
  let opened = false; // Open all was pressed (and nothing closed since)
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-quiet settings-all';
  // Every part, and every folded list inside the parts (public/fold.js), open or closed at once.
  let seen = new WeakSet(); // what Open all already opened: one you close again by hand stays closed
  const showAll = (open, onlyNew = false) => {
    if (!onlyNew) seen = new WeakSet();
    const fresh = (thing) => !seen.has(thing) && seen.add(thing);
    topParts(root).filter(fresh).forEach((part) => part.show?.(open));
    [...root.querySelectorAll('details.settings-fold')].filter(fresh).forEach((box) => {
      if (box.open === open) return;
      if (open) box.dataset.bulk = 'yes'; // not remembered (public/fold.js)
      box.open = open;
    });
  };
  const draw = () => {
    const parts = topParts(root);
    allOpen = parts.length > 0 && parts.every((part) => !part.classList.contains('is-closed'));
    if (!allOpen) opened = false;
    const words = allOpen ? 'Close all' : 'Open all';
    if (button.textContent !== words) button.textContent = words; // only on a change: the watch below sees every change
  };
  button.addEventListener('click', () => { opened = !allOpen; showAll(opened); draw(); });
  root.addEventListener('settings-part-toggle', draw);
  const place = () => {
    const bar = root.querySelector(':scope > .top-bar');
    if (bar && button.parentElement !== bar) bar.append(button);
  };
  const fold = () => {
    topParts(root).forEach(foldPart);
    if (opened) showAll(true, true); // a part or list that comes after Open all comes open
    place();
    draw();
  };
  fold();
  const watch = new MutationObserver(fold);
  watch.observe(root, { childList: true, subtree: true });
  return () => watch.disconnect();
}
