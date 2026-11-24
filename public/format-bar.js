// How words look, Heptabase's way (2026-11-24, the owner's wish: "bold, italics, underline, colour… across the whole
// app"). Select some words and a small bar shows above them: Bold, Italic, Underline, Strikethrough, Link, Text colour
// and Highlight. Cmd-B, Cmd-I, Cmd-U and Cmd-Shift-S do the first four from the keyboard. The / menu stays for what a
// line is (a heading, a list…), and also offers Text colour and Highlight for what you type next.
// The colours are twelve named ones, each with a light-theme and a dark-theme shade in tokens.css (--fc-<name> for the
// words, --hl-<name> for a highlight behind them). In the Markdown they are kept as [words]{.c-red} and [words]{.hl-red}.

import { Plugin, PluginKey, TextSelection } from '/vendor/prosemirror-state/dist/index.js';
import { toggleMark } from '/vendor/prosemirror-commands/dist/index.js';
import { el, icon } from './ui.js';

import { COLOURS } from './markdown-spans.js';

export { COLOURS };
export const colourLabel = (name) => name[0].toUpperCase() + name.slice(1);

const barKey = new PluginKey('format-bar');

// Whether every piece of text in the selection has the mark (or, with nothing selected, whether typing would get it).
function hasMark(state, type) {
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

// The colour (or highlight) where the selection starts, or ''.
function colourAt(state, type) {
  const { empty, $from, from } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : (state.doc.nodeAt(from)?.marks ?? $from.marks());
  return type.isInSet(marks)?.attrs.name ?? '';
}

// Puts a colour (or highlight) on the selected words; with nothing selected, on what is typed next. '' takes it off.
export function setColour(type, name) {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    let tr = state.tr;
    if (empty) {
      tr = tr.removeStoredMark(type);
      if (name) tr = tr.addStoredMark(type.create({ name }));
    } else {
      tr = tr.removeMark(from, to, type);
      if (name) tr = tr.addMark(from, to, type.create({ name }));
    }
    dispatch(tr);
    return true;
  };
}

// The address as typed: "example.com" becomes https://example.com; an address in the app (/notes/…) stays as it is.
const addressOf = (typed) => {
  const text = typed.trim();
  if (!text) return '';
  if (/^(https?:|mailto:|\/)/i.test(text)) return text;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) return `mailto:${text}`;
  return `https://${text}`;
};

// The twelve colours, and No colour, as a small grid. `kind` is 'colour' (the words) or 'highlight' (behind them).
export function palette(kind, current, onPick) {
  const swatch = (name) => el('button', {
    type: 'button', class: `format-swatch format-swatch-${kind}${name === current ? ' is-on' : ''}`, 'data-name': name,
    'aria-label': colourLabel(name), title: colourLabel(name), 'aria-pressed': String(name === current),
    onclick: () => onPick(name),
  }, el('span', { class: kind === 'colour' ? `fc-${name}` : `hl-${name}`, 'aria-hidden': 'true' }, 'A'));
  return el('div', { class: 'format-palette', role: 'group', 'aria-label': kind === 'colour' ? 'Text colour' : 'Highlight' },
    el('div', { class: 'format-swatches' }, ...COLOURS.map(swatch)),
    el('button', { type: 'button', class: 'format-none', onclick: () => onPick('') }, kind === 'colour' ? 'No colour' : 'No highlight'));
}

// A palette on its own, under the cursor (the / menu's Text colour and Highlight). What is picked colours what is typed next.
export function openPalette(view, kind) {
  const type = view.state.schema.marks[kind];
  const host = view.dom.closest('dialog') ?? document.body;
  const box = el('div', { class: 'format-bar format-palette-only' });
  const close = () => { box.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', escape, true); };
  const away = (event) => { if (!box.contains(event.target)) close(); };
  const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); view.focus(); } };
  box.append(palette(kind, colourAt(view.state, type), (name) => {
    close();
    view.focus();
    setColour(type, name)(view.state, view.dispatch);
  }));
  box.addEventListener('mousedown', (event) => event.preventDefault());
  host.append(box);
  const at = view.coordsAtPos(view.state.selection.head);
  placeBox(box, host, at.left, at.bottom + 6);
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', escape, true);
  setTimeout(() => (box.querySelector('.format-swatch.is-on') ?? box.querySelector('.format-swatch'))?.focus()); // after the / menu gives the cursor back
}

// Puts a floating box at a spot on the screen, kept inside the window.
function placeBox(box, host, left, top) {
  const offset = host === document.body ? { left: -window.scrollX, top: -window.scrollY } : host.getBoundingClientRect();
  const width = box.offsetWidth;
  const x = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  box.style.left = `${x - offset.left}px`;
  box.style.top = `${Math.max(8, top) - offset.top}px`;
}

export function formatBar() {
  return new Plugin({
    key: barKey,
    view(view) {
      const { marks } = view.state.schema;
      const host = view.dom.closest('dialog') ?? document.body;
      const bar = el('div', { class: 'format-bar', role: 'toolbar', 'aria-label': 'How the words look', hidden: true });
      const extra = el('div', { class: 'format-extra' }); // a palette or the link box, under the buttons
      let open = ''; // which of colour, highlight or link is open under the bar
      const run = (command) => { command(view.state, view.dispatch); view.focus(); };
      const toggle = (label, keys, type, glyph) => el('button', {
        type: 'button', class: `format-button format-${type.name}`, 'aria-label': label, title: `${label} (${keys})`, 'data-mark': type.name,
        onclick: () => run(toggleMark(type)),
      }, glyph);
      const opener = (label, which, glyph) => el('button', {
        type: 'button', class: `format-button format-open-${which}`, 'aria-label': label, title: label, 'aria-expanded': 'false',
        onclick: () => { open = open === which ? '' : which; paint(); },
      }, glyph);
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? '⌘' : 'Ctrl+';
      bar.append(el('div', { class: 'format-row' },
        toggle('Bold', `${mod}B`, marks.strong, el('b', {}, 'B')),
        toggle('Italic', `${mod}I`, marks.em, el('i', {}, 'I')),
        toggle('Underline', `${mod}U`, marks.underline, el('u', {}, 'U')),
        toggle('Strikethrough', `${mod}${isMac ? '⇧' : 'Shift+'}S`, marks.strike, el('s', {}, 'S')),
        opener('Link', 'link', icon('link')),
        opener('Colour', 'colour', el('span', { class: 'format-colour-glyph' }, 'A')),
        opener('Highlight', 'highlight', el('span', { class: 'format-highlight-glyph' }, 'H'))),
        extra);
      // Clicking a button must not take the selection away (the link box's field is the one place that takes focus).
      bar.addEventListener('mousedown', (event) => { if (!event.target.closest('input')) event.preventDefault(); });
      // The bar is in the page only while it shows.

      function linkBox() {
        const current = view.state.doc.rangeHasMark(view.state.selection.from, view.state.selection.to, marks.link)
          ? (view.state.doc.nodeAt(view.state.selection.from)?.marks.find((m) => m.type === marks.link)?.attrs.href ?? '') : '';
        const field = el('input', { type: 'text', class: 'format-link-input', value: current, placeholder: 'Paste or type an address', 'aria-label': 'Link address' });
        const { from, to } = view.state.selection;
        const apply = () => {
          const href = addressOf(field.value);
          let tr = view.state.tr.removeMark(from, to, marks.link);
          if (href) tr = tr.addMark(from, to, marks.link.create({ href }));
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from, to)));
          open = '';
          view.focus();
        };
        field.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); apply(); }
          if (event.key === 'Escape') { event.preventDefault(); open = ''; view.focus(); paint(); }
        });
        setTimeout(() => field.focus());
        return el('div', { class: 'format-link' }, field,
          el('button', { type: 'button', class: 'button', onclick: apply }, 'Link'),
          current ? el('button', { type: 'button', class: 'button', onclick: () => { field.value = ''; apply(); } }, 'Remove link') : null);
      }

      function paint() {
        const { state } = view;
        for (const button of bar.querySelectorAll('[data-mark]')) button.setAttribute('aria-pressed', String(hasMark(state, marks[button.dataset.mark])));
        const colour = colourAt(state, marks.colour);
        const glow = colourAt(state, marks.highlight);
        bar.querySelector('.format-colour-glyph').className = `format-colour-glyph${colour ? ` fc-${colour}` : ''}`;
        bar.querySelector('.format-highlight-glyph').className = `format-highlight-glyph hl-${glow || COLOURS[5]}`; // with none yet, the yellow
        bar.querySelector('.format-open-link').setAttribute('aria-pressed', String(state.doc.rangeHasMark(state.selection.from, state.selection.to, marks.link)));
        for (const which of ['link', 'colour', 'highlight']) bar.querySelector(`.format-open-${which}`).setAttribute('aria-expanded', String(open === which));
        if (open === 'link') { if (!extra.querySelector('.format-link')) extra.replaceChildren(linkBox()); } else if (open) {
          const type = marks[open];
          extra.replaceChildren(palette(open, open === 'colour' ? colour : glow, (name) => { run(setColour(type, name)); open = ''; paint(); }));
        } else extra.replaceChildren();
        place();
      }

      function place() {
        const { from, to } = view.state.selection;
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        if (!bar.isConnected) host.append(bar);
        bar.hidden = false;
        const left = (start.left + (start.top === end.top ? end.left : start.left)) / 2 - bar.offsetWidth / 2;
        const above = start.top - bar.offsetHeight - 8;
        placeBox(bar, host, left, above < 8 ? end.bottom + 8 : above);
      }

      const wanted = () => {
        const { selection } = view.state;
        if (!(selection instanceof TextSelection) || selection.empty || !view.editable) return false;
        if (selection.$from.parent.type.spec.code || selection.$to.parent.type.spec.code) return false;
        return view.hasFocus() || bar.contains(document.activeElement);
      };
      const hide = () => { bar.hidden = true; open = ''; extra.replaceChildren(); bar.remove(); };
      const update = () => { if (wanted()) paint(); else if (!bar.hidden) hide(); };
      // Leaving the words hides the bar, unless the cursor went into the bar's own link box.
      const blur = (event) => { if (!bar.contains(event.relatedTarget)) setTimeout(() => { if (!bar.contains(document.activeElement) && !view.hasFocus()) hide(); }); };
      view.dom.addEventListener('blur', blur);
      view.dom.addEventListener('focus', () => update());
      bar.addEventListener('focusout', blur);
      const scrolled = () => { if (!bar.hidden) place(); };
      window.addEventListener('scroll', scrolled, true);
      window.addEventListener('resize', scrolled);
      return {
        update(_view, before) {
          if (before && before.doc.eq(view.state.doc) && before.selection.eq(view.state.selection) && !bar.hidden === wanted()) return;
          if (before && !before.selection.eq(view.state.selection) && open === 'link') open = '';
          update();
        },
        destroy() {
          bar.remove();
          view.dom.removeEventListener('blur', blur);
          window.removeEventListener('scroll', scrolled, true);
          window.removeEventListener('resize', scrolled);
        },
      };
    },
  });
}
