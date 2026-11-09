// Comments on a passage, in the editor (advanced/writing/3): the quoted words of a comment get a quiet dotted underline, found again by
// the words and which occurrence of them it is (so text added above never moves a comment), and selecting words offers to comment on them.
// The comments themselves are rows (comments.js); nothing here touches the note's text.

import { Plugin, PluginKey } from '/vendor/prosemirror-state/dist/index.js';
import { Decoration, DecorationSet } from '/vendor/prosemirror-view/dist/index.js';

export const commentKey = new PluginKey('comments');
const GAP = '\u0000';

// Each textblock's words with where every letter is in the document (anything that is not a letter, a picture or a link, is a gap).
function textblocks(doc) {
  const blocks = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const at = [];
    node.forEach((child, offset) => {
      if (child.isText) for (let i = 0; i < child.text.length; i++) { text += child.text[i]; at.push(pos + 1 + offset + i); }
      else { text += GAP; at.push(pos + 1 + offset); }
    });
    blocks.push({ text, at });
    return false;
  });
  return blocks;
}

// The occurrence-th place the words are found, as { from, to }, or null (the words are gone or changed).
export function findAnchor(doc, anchor, occurrence = 0) {
  if (!anchor) return null;
  let seen = 0;
  for (const { text, at } of textblocks(doc)) {
    let from = text.indexOf(anchor);
    while (from !== -1) {
      if (seen === occurrence) return { from: at[from], to: at[from + anchor.length - 1] + 1 };
      seen += 1;
      from = text.indexOf(anchor, from + anchor.length);
    }
  }
  return null;
}

// What a selection means for a comment: its words and which occurrence of them it is. null when it is not one line of words.
export function selectionAnchor(state) {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const $from = state.doc.resolve(from);
  if (!$from.sameParent(state.doc.resolve(to)) || !$from.parent.isTextblock) return null;
  const words = state.doc.textBetween(from, to, GAP, GAP);
  if (!words.trim() || words.includes(GAP) || words.length > 500) return null;
  let occurrence = 0;
  for (let n = 0; ; n++) {
    const found = findAnchor(state.doc, words, n);
    if (!found || found.from >= from) break;
    occurrence = n + 1;
  }
  return { anchor: words, occurrence, from, to };
}

export function setComments(view, threads) {
  view.dispatch(view.state.tr.setMeta(commentKey, { threads }).setMeta('addToHistory', false));
}

export function commentPlugin({ onSelect = () => {}, onClick = () => {} } = {}) {
  return new Plugin({
    key: commentKey,
    state: {
      init: () => ({ threads: [] }),
      apply(tr, value) { const meta = tr.getMeta(commentKey); return meta ? { threads: meta.threads } : value; },
    },
    props: {
      decorations(state) {
        const found = [];
        for (const t of commentKey.getState(state).threads) {
          if (t.resolved) continue;
          const at = findAnchor(state.doc, t.anchor, t.occurrence);
          if (at) found.push(Decoration.inline(at.from, at.to, { class: 'has-comment', 'data-comment': t.id }));
        }
        return DecorationSet.create(state.doc, found);
      },
      handleDOMEvents: {
        click(view, event) {
          const mark = event.target instanceof HTMLElement ? event.target.closest('.has-comment') : null;
          if (mark) onClick(mark.getAttribute('data-comment'));
          return false;
        },
      },
    },
    view() {
      let last = null;
      return {
        update(view, prev) {
          if (prev && prev.selection.eq(view.state.selection) && prev.doc.eq(view.state.doc)) return;
          const info = view.hasFocus() ? selectionAnchor(view.state) : null;
          const key = info ? `${info.from}-${info.to}` : null;
          if (key === last) return;
          last = key;
          onSelect(info ? { ...info, rect: view.coordsAtPos(info.to) } : null);
        },
      };
    },
  });
}
