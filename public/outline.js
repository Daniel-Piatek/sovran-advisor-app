// The outline (advanced/writing/1): a note's bullets fold, move and zoom. Nothing here changes the note's text, except moving a bullet.
//
//   Folding   the triangle in front of a bullet with children; kept on the list item as `folded` (never in the Markdown, so folding is
//             not an edit: the note's edited time stays) and, past a reload, on the bullet's row (blocks.folded) by the screen.
//   Moving    Alt+Up / Alt+Down: the bullet and everything under it swap places with the neighbour above or below.
//   Zoom      Cmd . (Ctrl . elsewhere) makes the bullet under the cursor the page; clicking the dot does the same. A path above leads back.
//             Zoom is a view of the same text: every other bullet is only hidden.

import { Plugin, PluginKey, TextSelection } from '/vendor/prosemirror-state/dist/index.js';
import { Decoration, DecorationSet } from '/vendor/prosemirror-view/dist/index.js';
import { keymap } from '/vendor/prosemirror-keymap/dist/index.js';

export const outlineKey = new PluginKey('outline');

const isList = (node) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
const hasChildren = (item) => { let found = false; item.forEach((child) => { if (isList(child)) found = true; }); return found; };

// Every list item of the text in reading order, with where it starts: the Nth item here is the Nth bullet row of the note.
export function itemsOf(doc) {
  const items = [];
  doc.descendants((node, pos) => { if (node.type.name === 'list_item') items.push({ node, pos }); });
  return items;
}

const firstWords = (item) => (item.firstChild?.textContent ?? '').trim() || 'Untitled';

// The list item at or around the cursor, deepest first: { depth, pos, node, index (among its siblings), list }.
function itemAround(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'list_item') return { depth, pos: $from.before(depth), node: $from.node(depth), index: $from.index(depth - 1), list: $from.node(depth - 1) };
  }
  return null;
}

// ---- Folding ----

// Fold or open the bullet starting at pos. No history step and no change event: it is not an edit.
export function toggleFold(view, pos, folded = null) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'list_item' || !hasChildren(node)) return null;
  const next = folded ?? !node.attrs.folded;
  if (next === Boolean(node.attrs.folded)) return next;
  const tr = view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, folded: next }).setMeta('addToHistory', false).setMeta('fold', true);
  // A cursor inside what is put away would be lost: it goes to the bullet's own words.
  const { from } = view.state.selection;
  if (next && from > pos + node.firstChild.nodeSize + 1 && from < pos + node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, pos + 1 + node.firstChild.nodeSize - 1));
  view.dispatch(tr);
  return next;
}

// From the server: the Nth bullet is folded or not. Applied without an edit.
export function applyFolds(view, flags) {
  const tr = view.state.tr;
  itemsOf(view.state.doc).forEach(({ node, pos }, i) => {
    const want = Boolean(flags[i]) && hasChildren(node);
    if (Boolean(node.attrs.folded) !== want) tr.setNodeMarkup(pos, null, { ...node.attrs, folded: want });
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false).setMeta('fold', true));
}

// ---- Moving ----

// Alt+Up (-1) and Alt+Down (1): the bullet with its children swaps with the neighbour. At the end of its list it stays (the key is still taken).
function moveItem(direction) {
  return (state, dispatch) => {
    const at = itemAround(state);
    if (!at) return false;
    const neighbour = at.index + direction;
    if (neighbour < 0 || neighbour >= at.list.childCount) return true;
    const other = at.list.child(neighbour);
    const from = direction < 0 ? at.pos - other.nodeSize : at.pos;
    const to = direction < 0 ? at.pos + at.node.nodeSize : at.pos + at.node.nodeSize + other.nodeSize;
    if (dispatch) {
      const tr = state.tr.replaceWith(from, to, direction < 0 ? [at.node, other] : [other, at.node]);
      const start = direction < 0 ? from : from + other.nodeSize;
      tr.setSelection(TextSelection.create(tr.doc, start + (state.selection.head - at.pos)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---- Zoom ----

// The zoomed bullet's position (mapped through every change) or null. The chain: the bullets from the outermost down to it.
const zoomState = (state) => outlineKey.getState(state)?.zoom ?? null;

export function zoomChain(state) {
  const zoom = zoomState(state);
  if (zoom === null) return [];
  const node = state.doc.nodeAt(zoom);
  if (!node || node.type.name !== 'list_item') return [];
  const $z = state.doc.resolve(zoom);
  const chain = [];
  for (let depth = 1; depth <= $z.depth; depth++) if ($z.node(depth).type.name === 'list_item') chain.push({ pos: $z.before(depth), text: firstWords($z.node(depth)) });
  chain.push({ pos: zoom, text: firstWords(node) });
  return chain;
}

// Zoom into the bullet at pos, or out (null). Depth n of the chain: zoomTo(view, chain[n].pos).
export function zoomTo(view, pos) {
  view.dispatch(view.state.tr.setMeta(outlineKey, { zoom: pos }).setMeta('addToHistory', false));
  if (pos !== null) view.focus();
}

function zoomIntoCursor(state, dispatch, view) {
  const at = itemAround(state);
  if (!at) return false;
  const current = zoomState(state);
  // Already looking at this bullet's page with the cursor in its own words: go one level further in if there is one; else stay.
  if (current === at.pos) return true;
  if (dispatch) view.dispatch(state.tr.setMeta(outlineKey, { zoom: at.pos }).setMeta('addToHistory', false));
  return true;
}

const zoomOutOne = (state, dispatch) => {
  const chain = zoomChain(state);
  if (!chain.length) return false;
  dispatch?.(state.tr.setMeta(outlineKey, { zoom: chain.length > 1 ? chain.at(-2).pos : null }).setMeta('addToHistory', false));
  return true;
};

// Only the path to the zoomed bullet and everything under it is shown; the rest is hidden, not removed.
function zoomDecorations(state) {
  const zoom = zoomState(state);
  if (zoom === null) return [];
  const target = state.doc.nodeAt(zoom);
  if (!target || target.type.name !== 'list_item') return [];
  const $z = state.doc.resolve(zoom);
  const decorations = [Decoration.node(zoom, zoom + target.nodeSize, { class: 'zoom-target' })];
  for (let depth = 0; depth <= $z.depth; depth++) {
    const node = $z.node(depth);
    const pathIndex = $z.index(depth); // the child that leads down
    const start = depth === 0 ? 0 : $z.start(depth);
    let offset = start;
    node.forEach((child, _o, i) => {
      if (i !== pathIndex) decorations.push(Decoration.node(offset, offset + child.nodeSize, { class: 'zoom-hidden' }));
      else if (depth < $z.depth) decorations.push(Decoration.node(offset, offset + child.nodeSize, { class: 'zoom-ancestor' }));
      else if (depth === $z.depth) { /* the target itself: marked above */ }
      offset += child.nodeSize;
    });
    if (node.type.name === 'list_item' && depth < $z.depth && node.firstChild && pathIndex !== 0) { /* its own words are hidden above */ }
  }
  return decorations;
}

// ---- The plugins ----

// From the server: how many places use the Nth bullet (link to it or show it). A bullet that is used says so, and the count opens the list.
export function setUsage(view, counts) {
  view.dispatch(view.state.tr.setMeta(outlineKey, { usage: counts }).setMeta('addToHistory', false));
}

// Scrolls to the Nth bullet and marks it for a moment (a link to a bullet opens its note here).
export function showBullet(view, ord) {
  const item = itemsOf(view.state.doc)[ord];
  if (!item) return;
  const dom = view.nodeDOM(item.pos);
  if (!(dom instanceof HTMLElement)) return;
  dom.scrollIntoView({ block: 'center' });
  dom.classList.add('is-found');
  setTimeout(() => dom.classList.remove('is-found'), 2500);
}

export function outlinePlugins({ onFold = () => {}, onZoom = () => {}, onUsed = () => {} } = {}) {
  const plugin = new Plugin({
    key: outlineKey,
    state: {
      init: () => ({ zoom: null, usage: [] }),
      apply(tr, value) {
        const meta = tr.getMeta(outlineKey);
        let zoom = meta && 'zoom' in meta ? meta.zoom : value.zoom;
        if (zoom !== null && !(meta && 'zoom' in meta)) zoom = tr.mapping.map(zoom, -1);
        return { zoom, usage: meta && 'usage' in meta ? meta.usage : value.usage };
      },
    },
    props: {
      decorations(state) {
        const decorations = zoomDecorations(state);
        const usage = outlineKey.getState(state)?.usage ?? [];
        let ord = -1;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'list_item') {
            ord += 1;
            const used = usage[ord];
            const words = node.firstChild;
            if (used > 0 && words?.type.name === 'paragraph') {
              const mine = ord;
              decorations.push(Decoration.widget(pos + 1 + words.nodeSize - 1, () => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'used-in';
                button.contentEditable = 'false';
                button.textContent = `Used in ${used} ${used === 1 ? 'place' : 'places'}`;
                button.addEventListener('mousedown', (event) => event.preventDefault());
                button.addEventListener('click', () => onUsed(mine, button));
                return button;
              }, { side: 1, key: `used-${mine}-${used}` }));
            }
          }
          if (node.type.name === 'list_item' && hasChildren(node)) {
            decorations.push(Decoration.widget(pos + 1, (view, getPos) => {
              const open = !node.attrs.folded;
              const button = document.createElement('button');
              button.type = 'button';
              button.className = `fold-toggle${open ? ' is-open' : ''}`;
              button.contentEditable = 'false';
              button.setAttribute('aria-label', open ? 'Fold: put its bullets away' : 'Open: show its bullets');
              button.setAttribute('aria-expanded', String(open));
              button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l6 5-6 5"/></svg>';
              button.addEventListener('mousedown', (event) => event.preventDefault());
              button.addEventListener('click', () => {
                const at = getPos() - 1;
                const index = itemsOf(view.state.doc).findIndex((item) => item.pos === at);
                const next = toggleFold(view, at);
                if (next !== null) onFold(index, next);
              });
              return button;
            }, { side: -1, key: `fold-${node.attrs.folded ? 'closed' : 'open'}` }));
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
      // The dot in front of a bullet is the list's own marker: a click on the item itself, left of its words, zooms into it.
      handleDOMEvents: {
        click(view, event) {
          const li = event.target instanceof HTMLElement && event.target.tagName === 'LI' ? event.target : null;
          if (!li || li.classList.contains('task-line')) return false;
          const inside = view.posAtDOM(li, 0);
          const pos = inside - 1;
          if (view.state.doc.nodeAt(pos)?.type.name !== 'list_item') return false;
          event.preventDefault();
          zoomTo(view, pos);
          return true;
        },
      },
    },
    view() {
      let last = null;
      return {
        update(view) {
          const zoom = zoomState(view.state);
          if (zoom === last) return;
          last = zoom;
          onZoom(zoomChain(view.state).map((c) => ({ pos: c.pos, text: c.text })));
        },
      };
    },
    // A cursor left in what is hidden goes to the zoomed bullet's own words.
    appendTransaction(trs, _old, state) {
      const zoom = zoomState(state);
      if (zoom === null || !trs.some((t) => t.getMeta(outlineKey))) return null;
      const target = state.doc.nodeAt(zoom);
      if (!target) return null;
      const { from } = state.selection;
      if (from > zoom && from < zoom + target.nodeSize) return null;
      return state.tr.setSelection(TextSelection.create(state.doc, zoom + 2)).setMeta('addToHistory', false);
    },
  });
  const keys = keymap({
    'Alt-ArrowUp': moveItem(-1),
    'Alt-ArrowDown': moveItem(1),
    'Mod-.': (state, dispatch, view) => zoomIntoCursor(state, dispatch, view),
    'Shift-Mod-.': zoomOutOne,
  });
  return [plugin, keys];
}
