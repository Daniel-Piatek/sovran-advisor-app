// The Home chip (pkm/4), in the head of a note: the note's one home in My Life, or "No
// home yet". The name opens the home; the arrow (or the whole chip, without a home)
// opens a picker of the active My Life items: Projects first, then Goals, Key Elements
// and Topics. Typing filters it, the arrows move, Enter or a click chooses, Escape
// closes it.

import { api, el, icon } from './ui.js';

const ORDER = ['project', 'goal', 'habit', 'key_element', 'topic'];
const KIND_WORDS = { key_element: 'Key Element', goal: 'goal', project: 'project', topic: 'topic', habit: 'habit' };

const fits = (title, typed) => typed.toLowerCase().split(/\s+/).filter(Boolean)
  .every((word) => title.toLowerCase().includes(word));

// home: { id, title, kind } or null. choose(home or null) saves the choice. compact: no
// "Home" label, and "Home…" for none (inside the Tasks app's add bar). dropdown: the whole
// chip is one box with a house, the home's name (or "No home yet") and a chevron, that opens
// the picker; its name is not a link (the Inbox's top bar, which has its own arrow that
// opens the home).
export function homeChip(home, choose, { compact = false, dropdown = false } = {}) {
  const place = el('div', { class: compact ? 'home home-compact' : 'home' });
  let picker = null;

  function draw() {
    const open = el('button', {
      type: 'button', class: home ? 'home-change' : 'home-chip home-chip-none',
      'aria-label': home ? 'Change the home' : 'Give it a home', 'aria-expanded': 'false', 'aria-haspopup': 'listbox',
      onclick: () => (picker ? close() : showPicker(open)),
    }, ...(home ? [icon('down')] : [icon('plus'), el('span', {}, compact ? 'Home…' : 'No home yet')]));
    if (dropdown) {
      const whole = el('button', {
        type: 'button', class: `home-dropdown${home ? '' : ' is-none'}`, 'aria-label': home ? `Home: ${home.title}. Change it` : 'Give it a home',
        'aria-expanded': 'false', 'aria-haspopup': 'listbox', onclick: () => (picker ? close() : showPicker(whole)),
      }, icon('house'), el('span', { class: 'home-dropdown-name' }, home ? home.title : 'No home yet'), icon('down'));
      place.replaceChildren(whole);
      return;
    }
    place.replaceChildren(
      ...(compact ? [] : [el('span', { class: 'home-label' }, 'Home')]),
      home
        ? el('span', { class: 'home-chip' },
          el('a', { class: 'home-name', href: `/life/${home.id}` }, icon(home.kind), el('span', {}, home.title)), open)
        : open,
    );
  }

  function close({ focus = true } = {}) {
    if (!picker) return;
    picker.remove();
    picker = null;
    document.removeEventListener('pointerdown', outside, true);
    const button = place.querySelector('[aria-haspopup]');
    button?.setAttribute('aria-expanded', 'false');
    if (focus) button?.focus();
  }
  const outside = (event) => { if (!place.contains(event.target)) close({ focus: false }); };

  async function showPicker(button) {
    button.setAttribute('aria-expanded', 'true');
    const search = el('input', { class: 'search-input', placeholder: 'Find a home', 'aria-label': 'Find a home', autocomplete: 'off' });
    const list = el('div', { class: 'home-options', role: 'listbox', 'aria-label': 'Homes' });
    picker = el('div', { class: 'slash-menu home-picker' }, el('label', { class: 'search' }, icon('search'), search), list);
    place.append(picker);
    document.addEventListener('pointerdown', outside, true);
    search.focus({ preventScroll: true });
    // All of it on screen: moved left if it would run off the right edge, and scrolled to
    // above a phone's bar.
    const over = picker.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) picker.style.left = `${-over}px`;
    picker.scrollIntoView({ block: 'nearest' });

    let items = [];
    try {
      items = (await api.listLife()).filter((item) => item.state === 'active')
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    } catch {
      list.replaceChildren(el('div', { class: 'slash-menu-empty' }, "My Life couldn't be loaded."));
      return;
    }
    let shown = [];
    let index = 0;
    const pick = async (item) => {
      close();
      home = item ? { id: item.id, title: item.title, kind: item.kind } : null;
      draw();
      choose(home);
    };
    const paint = () => {
      list.replaceChildren(...(shown.length ? shown.map((item, i) => {
        const row = el('div', {
          class: 'slash-menu-item', role: 'option', 'aria-selected': String(i === index),
          onmousemove: () => { if (index !== i) { index = i; paint(); } },
          onclick: () => pick(item.none ? null : item),
        }, el('span', { class: 'slash-menu-icon home-option-shape', 'aria-hidden': 'true' }, icon(item.none ? 'close' : item.kind)),
        el('span', { class: 'slash-menu-label' }, item.none ? 'No home' : item.title),
        el('span', { class: 'slash-menu-later' }, item.none ? '' : item.id === home?.id ? 'its home' : KIND_WORDS[item.kind]));
        return row;
      }) : [el('div', { class: 'slash-menu-empty' }, items.length
        ? 'Nothing in My Life matches.' : 'My Life is empty. Add a Key Element, Goal, Project or Topic there first.')]));
      list.children[index]?.scrollIntoView?.({ block: 'nearest' });
    };
    const filter = () => {
      shown = [...items.filter((item) => fits(item.title, search.value)), ...(home && !search.value.trim() ? [{ none: true }] : [])];
      index = 0;
      paint();
    };
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!shown.length) return;
        index = (index + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
        paint();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = shown[index];
        if (item) pick(item.none ? null : item);
      }
    });
    filter();
  }

  draw();
  return {
    element: place,
    close: () => close({ focus: false }),
    set: (next) => { home = next; draw(); }, // shows another home, without saving it
  };
}
