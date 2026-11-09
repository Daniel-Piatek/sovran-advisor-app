// The slash menu, like Heptabase's: type / at the start of a line or after a space and a
// menu of formatting opens under the cursor. Typing filters it, the arrow keys move,
// Enter (or a click) chooses, Escape closes and keeps what was typed.
// Options the app can't do yet are shown in grey with "later", and can't be chosen.

import { Plugin, PluginKey, TextSelection } from '/vendor/prosemirror-state/dist/index.js';
import { setBlockType, wrapIn } from '/vendor/prosemirror-commands/dist/index.js';
import { wrapInList } from '/vendor/prosemirror-schema-list/dist/index.js';

const slashKey = new PluginKey('slash-menu');

// Inserts text where the cursor is.
const insertText = (text) => (state, dispatch) => {
  dispatch?.(state.tr.insertText(text).scrollIntoView());
  return true;
};

// A divider: on an empty line it takes the line's place, otherwise it goes below it.
// Either way, writing carries on in a new line under it.
const insertDivider = (schema) => (state, dispatch) => {
  const { $from } = state.selection;
  const block = $from.parent;
  const nodes = [schema.nodes.horizontal_rule.create(), schema.nodes.paragraph.create()];
  const tr = block.content.size === 0
    ? state.tr.replaceWith($from.before(), $from.after(), nodes)
    : state.tr.insert($from.after(), nodes);
  const after = (block.content.size === 0 ? $from.before() : $from.after()) + nodes[0].nodeSize + 1;
  dispatch?.(tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView());
  return true;
};

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const now = () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// In Heptabase's order. `run` is missing for options that come later.
export function menuItems(schema, { pickFiles, makeTask, makeBoard } = {}) {
  const { nodes } = schema;
  // Opens the file picker; what is picked goes where the cursor is.
  const pick = (accept) => (state, dispatch, view) => { pickFiles?.(view, accept); return true; };
  return [
    { label: 'Text', icon: 'Aa', keys: 'paragraph plain normal', run: setBlockType(nodes.paragraph) },
    { label: 'Heading 1', icon: 'H1', keys: 'h1 title big', run: setBlockType(nodes.heading, { level: 1 }) },
    { label: 'Heading 2', icon: 'H2', keys: 'h2 subtitle', run: setBlockType(nodes.heading, { level: 2 }) },
    { label: 'Heading 3', icon: 'H3', keys: 'h3', run: setBlockType(nodes.heading, { level: 3 }) },
    { label: 'Card', icon: '▭', keys: 'link note', later: true },
    makeBoard ? { label: 'Whiteboard', icon: '▦', keys: 'board canvas', run: makeBoard } : { label: 'Whiteboard', icon: '▦', keys: 'board canvas', later: true },
    { label: 'Highlight', icon: '✎', keys: 'mark colour color', later: true },
    { label: 'Date', icon: '31', keys: 'today day', run: (state, dispatch) => insertText(today())(state, dispatch) },
    { label: 'Now', icon: '◷', keys: 'time clock', run: (state, dispatch) => insertText(now())(state, dispatch) },
    ...(makeTask ? [{ label: 'Todo list', icon: '☐', keys: 'task checkbox to-do', run: makeTask }] : []),
    { label: 'Bullet list', icon: '•', keys: 'ul unordered list', run: wrapInList(nodes.bullet_list) },
    { label: 'Number list', icon: '1.', keys: 'ol ordered numbered list', run: wrapInList(nodes.ordered_list) },
    { label: 'Toggle list', icon: '▸', keys: 'collapse fold', later: true },
    { label: 'Table', icon: '▤', keys: 'grid', later: true },
    { label: 'Image', icon: '▣', keys: 'picture photo upload', run: pick('image/*') },
    { label: 'Video', icon: '▶', keys: 'movie', later: true },
    { label: 'Audio', icon: '♪', keys: 'sound voice', later: true },
    { label: 'File', icon: '⎘', keys: 'attachment upload', run: pick('') },
    { label: 'PDF', icon: 'PDF', keys: 'document upload', run: pick('application/pdf,.pdf') },
    { label: 'Divider', icon: '—', keys: 'line hr rule separator', run: insertDivider(schema) },
    { label: 'Quote', icon: '❝', keys: 'blockquote citation', run: wrapIn(nodes.blockquote) },
    { label: 'Code block', icon: '</>', keys: 'pre monospace', run: setBlockType(nodes.code_block) },
    { label: 'Math block', icon: '∑', keys: 'latex formula', later: true },
    { label: 'Inline math', icon: 'x²', keys: 'latex formula', later: true },
    { label: 'Toggle heading 1', icon: '▸H1', keys: 'collapse fold', later: true },
    { label: 'Toggle heading 2', icon: '▸H2', keys: 'collapse fold', later: true },
    { label: 'Toggle heading 3', icon: '▸H3', keys: 'collapse fold', later: true },
    { label: 'Template', icon: '⧉', keys: 'snippet', later: true },
  ];
}

// Each word typed must be the start of a word of the option ("li" finds lists, not
// "Highlight"; "head 2" finds "Heading 2").
export function matches(item, query) {
  const typed = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const words = `${item.label} ${item.keys}`.toLowerCase().split(/[\s-]+/);
  return typed.every((part) => words.some((word) => word.startsWith(part)));
}

// Where the menu is open: the position of its "/", or null when it is closed.
function slashState() {
  return {
    init: () => null,
    apply(tr, open, oldState, state) {
      const meta = tr.getMeta(slashKey);
      if (meta === 'close') return null;
      if (meta && typeof meta.open === 'number') return { from: meta.open };
      if (!open) return null;
      const from = tr.mapping.map(open.from);
      const { empty, $head } = state.selection;
      if (!empty || $head.pos <= from || from < $head.start()) return null; // the cursor left the "/…"
      if (state.doc.textBetween(from, from + 1) !== '/') return null;     // the "/" was deleted
      const query = state.doc.textBetween(from + 1, $head.pos, '\n');
      if (/\n| {2}/.test(query) || query.length > 40) return null;         // clearly just writing on
      return { from };
    },
  };
}

export function slashMenu(schema, options) {
  const items = menuItems(schema, options);
  let menu = null; // the open menu's controls, while the editor exists

  return new Plugin({
    key: slashKey,
    state: slashState(),
    props: {
      // "/" at the start of a line or after a space opens the menu.
      handleTextInput(view, from, to, text) {
        if (text !== '/') return false;
        const $from = view.state.doc.resolve(from);
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
        if (before && !/\s$/.test(before)) return false;
        view.dispatch(view.state.tr.insertText('/', from, to).setMeta(slashKey, { open: from }));
        return true;
      },
      handleKeyDown(view, event) {
        if (!slashKey.getState(view.state) || !menu) return false;
        if (event.key === 'ArrowDown') { menu.move(1); return true; }
        if (event.key === 'ArrowUp') { menu.move(-1); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') return menu.choose();
        if (event.key === 'Escape') { view.dispatch(view.state.tr.setMeta(slashKey, 'close')); return true; }
        return false;
      },
      handleDOMEvents: {
        blur(view) {
          if (slashKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(slashKey, 'close'));
          return false;
        },
      },
    },
    view(editorView) {
      const box = document.createElement('div');
      box.className = 'slash-menu';
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', 'Formatting');
      box.hidden = true;
      // Clicking the menu must not take the cursor out of the note.
      box.addEventListener('mousedown', (event) => event.preventDefault());
      // Inside a dialog (the capture box) the menu must be in the dialog too, or it would
      // sit behind it.
      const host = editorView.dom.closest('dialog') ?? document.body;
      host.append(box);

      let shown = [];
      let index = -1;
      let lastQuery = null;

      const query = () => {
        const open = slashKey.getState(editorView.state);
        return open ? editorView.state.doc.textBetween(open.from + 1, editorView.state.selection.head, '\n') : '';
      };

      function choose(item = shown[index]) {
        const open = slashKey.getState(editorView.state);
        if (!open) return false;
        if (!item) {
          // Nothing matches: close the menu and let the key do what it normally does.
          editorView.dispatch(editorView.state.tr.setMeta(slashKey, 'close'));
          return false;
        }
        if (item.later) return true;
        // Take the "/…" away, then apply the choice to the line it was on.
        editorView.dispatch(editorView.state.tr.delete(open.from, editorView.state.selection.head).setMeta(slashKey, 'close'));
        item.run(editorView.state, editorView.dispatch, editorView);
        editorView.focus();
        return true;
      }

      function move(step) {
        const usable = shown.map((item, i) => (item.later ? -1 : i)).filter((i) => i >= 0);
        if (!usable.length) return;
        const at = usable.indexOf(index);
        index = usable[(at + step + usable.length) % usable.length];
        paint();
        box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      }

      function paint() {
        box.replaceChildren();
        if (!shown.length) {
          const none = document.createElement('div');
          none.className = 'slash-menu-empty';
          none.textContent = 'No options';
          box.append(none);
          return;
        }
        shown.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = item.later ? 'slash-menu-item is-later' : 'slash-menu-item';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(i === index));
          if (item.later) row.setAttribute('aria-disabled', 'true');
          const icon = document.createElement('span');
          icon.className = 'slash-menu-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = item.icon;
          const label = document.createElement('span');
          label.className = 'slash-menu-label';
          label.textContent = item.label;
          row.append(icon, label);
          if (item.later) {
            const later = document.createElement('span');
            later.className = 'slash-menu-later';
            later.textContent = 'later';
            row.append(later);
          } else {
            // Only a moving mouse picks an option, not one that the menu opened under.
            row.addEventListener('mousemove', () => { if (index !== i) { index = i; paint(); } });
            row.addEventListener('click', () => choose(item));
          }
          box.append(row);
        });
      }

      // Under the "/", kept inside the window.
      function place() {
        const open = slashKey.getState(editorView.state);
        const at = editorView.coordsAtPos(open.from);
        const width = box.offsetWidth;
        const left = Math.max(8, Math.min(at.left, document.documentElement.clientWidth - width - 8));
        if (host === document.body) {
          box.style.left = `${left + window.scrollX}px`;
          box.style.top = `${at.bottom + window.scrollY + 4}px`;
        } else {
          const frame = host.getBoundingClientRect();
          box.style.left = `${left - frame.left}px`;
          box.style.top = `${at.bottom - frame.top + 4}px`;
        }
      }

      function update() {
        if (!slashKey.getState(editorView.state)) {
          box.hidden = true;
          lastQuery = null;
          return;
        }
        const q = query();
        if (q !== lastQuery) {
          shown = items.filter((item) => matches(item, q));
          index = shown.findIndex((item) => !item.later);
          lastQuery = q;
          paint();
        }
        box.hidden = false;
        place();
      }

      menu = { move, choose };
      update();
      return {
        update,
        destroy() { box.remove(); menu = null; },
      };
    },
  });
}
