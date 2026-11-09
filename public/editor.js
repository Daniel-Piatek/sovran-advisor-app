// The note editor: formatting shows as you type, like Heptabase. The text is kept as
// Markdown, so what is saved stays plain, readable text.
//   **bold** or Cmd-B      *italic* or Cmd-I
//   # , ## , ###  at the start of a line: a heading
//   - or *  at the start of a line: a bullet list      1.  a numbered list
//   >  a quote          Backspace right after: takes the formatting back
//   /  opens the slash menu of formatting (public/slash-menu.js)
//   [[ links to a note, an entry, a day, a person, a company or a My Life item (public/link-menu.js)
//   @  mentions a person, @@ a company (the same list, narrowed)
// Built on ProseMirror (public/vendor/, copied there by `npm run vendor`).

import {
  schema as markdownSchema, defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer,
} from '/vendor/prosemirror-markdown/dist/index.js';
import { Schema, Fragment } from '/vendor/prosemirror-model/dist/index.js';
import { EditorState, Plugin, PluginKey, TextSelection } from '/vendor/prosemirror-state/dist/index.js';
import { EditorView, Decoration, DecorationSet } from '/vendor/prosemirror-view/dist/index.js';
import { keymap } from '/vendor/prosemirror-keymap/dist/index.js';
import { baseKeymap, toggleMark, chainCommands, exitCode } from '/vendor/prosemirror-commands/dist/index.js';
import { history, undo, redo } from '/vendor/prosemirror-history/dist/index.js';
import {
  inputRules, InputRule, wrappingInputRule, textblockTypeInputRule, undoInputRule,
} from '/vendor/prosemirror-inputrules/dist/index.js';
import { outlinePlugins } from './outline.js';
import { commentPlugin } from './comment-marks.js';
import { mountBoard } from './board.js';
import { moduleOn } from './modules.js';
import { splitListItem, liftListItem, sinkListItem } from '/vendor/prosemirror-schema-list/dist/index.js';
import { findWrapping } from '/vendor/prosemirror-transform/dist/index.js';
import markdownit from '/vendor/markdown-it/index.mjs';
import { slashMenu } from './slash-menu.js';
import { linkMenu } from './link-menu.js';
import { api, icon } from './ui.js';
import { parseDue, dueLabel } from './due.js';

// The kinds of thing a note's text can hold: Markdown's, plus a file card. A file card
// is a kept file that isn't a picture (a PDF, a zip…), shown as a card with its name,
// size and Open. In the Markdown it is a link to the file on a line of its own.
const isFileHref = (href) => /^\/files\/[0-9a-f]{64}$/.test(href ?? '');

// A link to another page of the app (pkm/1): a note, a journal entry or a journal day.
// In the Markdown it is [words](/notes/<id>), [words](/journal/entries/<id>) or
// [words](/journal/YYYY-MM-DD); in the editor it is one piece that shows the page's
// current name.
export function pageOf(href) {
  const match = /^\/(?:notes\/([0-9a-f-]{36})|journal\/entries\/([0-9a-f-]{36})|journal\/(\d{4}-\d{2}-\d{2})|people\/([0-9a-f-]{36})|companies\/([0-9a-f-]{36})|life\/([0-9a-f-]{36})|calendar\/events\/([0-9a-f-]{36}))$/.exec(href ?? '');
  if (!match) return null;
  const [, note, entry, day, person, company, life, event] = match;
  if (note) return { kind: 'note', id: note };
  if (entry) return { kind: 'entry', id: entry };
  if (day) return { kind: 'day', id: day };
  if (life) return { kind: 'life', id: life };
  if (event) return { kind: 'event', id: event };
  return person ? { kind: 'person', id: person } : { kind: 'company', id: company };
}
const PAGE_PATHS = { note: '/notes/', entry: '/journal/entries/', day: '/journal/', person: '/people/', company: '/companies/', life: '/life/', event: '/calendar/events/' };
export const hrefOf = ({ kind, id }) => `${PAGE_PATHS[kind]}${id}`;

// The small shape in front of a link: what it points at, told apart by shape.
//   ▭ a note   31 the journal   ◷ an event   initials in a circle: a person   a letter in a square: a company
//   a My Life item: its kind's shape (a pillar, a target, a flag, a #), once known
export function linkShape(kind, name = '', lifeKind = null) {
  const shape = make('span', `page-link-kind page-link-${kind}`);
  shape.setAttribute('aria-hidden', 'true');
  if (kind === 'life') {
    if (lifeKind) shape.append(icon(lifeKind));
    return shape;
  }
  const words = name.trim().split(/\s+/);
  shape.textContent = kind === 'note' ? '▭' : kind === 'event' ? '◷' : kind === 'person' ? words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
    : kind === 'company' ? (name.trim()[0] ?? '?').toUpperCase() : '31';
  return shape;
}

export const schema = new Schema({
  nodes: markdownSchema.spec.nodes
    // A list item can be a task (tasks/1): checked is false (open) or true (done), and
    // null for a plain item. In the Markdown: - [ ] words, or - [x] words.
    .update('list_item', {
      ...markdownSchema.spec.nodes.get('list_item'),
      // folded: its bullets under it are put away (Writing and thinking). It is never written to the Markdown, so folding is not an edit.
      attrs: { checked: { default: null }, folded: { default: false } },
      parseDOM: [{
        tag: 'li',
        getAttrs: (dom) => ({ checked: dom.hasAttribute('data-checked') ? dom.getAttribute('data-checked') === 'true' : null }),
      }],
      toDOM: (node) => ['li', node.attrs.checked === null ? {} : { class: 'task-line', 'data-checked': String(node.attrs.checked) }, 0],
    })
    // A board of the note (Writing and thinking): in the Markdown a line that is a link to /boards/<id>.
    .addBefore('image', 'board_block', {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { id: {}, title: { default: 'Board' } },
      toDOM: (node) => ['div', { class: 'board-block', 'data-board': node.attrs.id }, node.attrs.title],
      parseDOM: [{ tag: 'div.board-block[data-board]', getAttrs: (dom) => ({ id: dom.getAttribute('data-board'), title: dom.textContent }) }],
    })
    .addBefore('image', 'file_card', {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { href: {}, name: { default: 'file' } },
      toDOM: (node) => ['div', { class: 'file-card', 'data-href': node.attrs.href }, node.attrs.name],
      parseDOM: [{ tag: 'div.file-card', getAttrs: (dom) => ({ href: dom.getAttribute('data-href'), name: dom.textContent }) }],
    })
    // A task's due date (tasks/1): @2026-10-30 in the Markdown, a chip in the editor.
    .addBefore('image', 'due_date', {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      attrs: { day: {} },
      toDOM: (node) => ['span', { class: 'due-chip', 'data-day': node.attrs.day }, node.attrs.day],
      parseDOM: [{ tag: 'span.due-chip[data-day]', getAttrs: (dom) => ({ day: dom.getAttribute('data-day') }) }],
    })
    // A link to one bullet of a note (Writing and thinking): ((bullet id)). It shows the bullet's words, live; alone in its line it shows
    // the bullet with its bullets under it, framed (an embed).
    .addBefore('image', 'block_ref', {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      attrs: { id: {} },
      toDOM: (node) => ['span', { class: 'block-ref', 'data-block': node.attrs.id }, '((…))'],
      parseDOM: [{ tag: 'span.block-ref[data-block]', getAttrs: (dom) => ({ id: dom.getAttribute('data-block') }) }],
    })
    .addBefore('image', 'page_link', {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: true,
      attrs: { kind: {}, id: {}, label: { default: '' } },
      toDOM: (node) => ['a', { class: 'page-link', href: hrefOf(node.attrs) }, node.attrs.label],
      parseDOM: [{
        tag: 'a.page-link[href]',
        getAttrs: (dom) => {
          const page = pageOf(dom.getAttribute('href'));
          return page ? { ...page, label: dom.textContent } : false;
        },
      }],
    }),
  marks: markdownSchema.spec.marks,
});

// A line break inside a paragraph stays a line break (notes typed before the editor
// were plain text, one thought per line).
const parser = new MarkdownParser(schema, markdownit('commonmark', { html: false }), {
  ...defaultMarkdownParser.tokens,
  softbreak: { node: 'hard_break' },
});

const serializer = new MarkdownSerializer({
  ...defaultMarkdownSerializer.nodes,
  bullet_list(state, node) {
    // A list whose items are single lines (with lists under them) is written tight: a plain indented list, with no blank lines.
    let plain = true;
    node.forEach((item) => item.forEach((child, _o, i) => { if (i > 0 && !['bullet_list', 'ordered_list'].includes(child.type.name)) plain = false; }));
    state.renderList(plain ? node.type.create({ ...node.attrs, tight: true }, node.content) : node, '  ', () => (node.firstChild?.attrs.checked !== null ? '- ' : '* '));
  },
  list_item(state, node) {
    if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  file_card(state, node) {
    state.write(`[${state.esc(node.attrs.name)}](${node.attrs.href})`);
    state.closeBlock(node);
  },
  page_link(state, node) {
    state.write(`[${state.esc(node.attrs.label || 'link')}](${hrefOf(node.attrs)})`);
  },
  due_date(state, node) {
    state.write(`@${node.attrs.day}`);
  },
  block_ref(state, node) {
    state.write(`((${node.attrs.id}))`);
  },
  board_block(state, node) {
    state.write(`[${state.esc(node.attrs.title || 'Board')}](/boards/${node.attrs.id})`);
    state.closeBlock(node);
  },
}, defaultMarkdownSerializer.marks);

// Links read from Markdown become what the editor shows: a line that is nothing but a
// link to a kept file becomes a file card, and a link to a page of the app becomes a
// page link.
function withFileCards(node) {
  if (node.type === schema.nodes.paragraph && node.childCount === 1) {
    const only = node.firstChild;
    const link = only.isText && only.marks.find((mark) => mark.type === schema.marks.link);
    if (link && isFileHref(link.attrs.href)) return schema.nodes.file_card.create({ href: link.attrs.href, name: only.text });
    const board = link && /^\/boards\/([0-9a-f-]{36})$/.exec(link.attrs.href ?? '');
    if (board && moduleOn('writing')) return schema.nodes.board_block.create({ id: board[1], title: only.text });
  }
  if (node.isLeaf) return node;
  if (node.isTextblock) return moduleOn('writing') ? withBlockRefs(withPageLinks(node)) : withPageLinks(node);
  const children = [];
  node.forEach((child) => children.push(withFileCards(child)));
  const copy = node.copy(Fragment.fromArray(children));
  return copy.type === schema.nodes.list_item ? asTask(copy) : copy;
}

// A list item whose words start with [ ] or [x] is a task: the signs become its checkbox.
const TASK_START = /^\[( |x|X)\](?: |$)/;
function asTask(item) {
  const paragraph = item.firstChild;
  const first = paragraph?.type === schema.nodes.paragraph ? paragraph.firstChild : null;
  const match = first?.isText ? TASK_START.exec(first.text) : null;
  if (!match) return item;
  const rest = first.text.slice(match[0].length);
  const words = rest ? paragraph.content.replaceChild(0, schema.text(rest, first.marks)) : paragraph.content.cut(first.nodeSize);
  return item.type.create({ checked: match[1] !== ' ' }, item.content.replaceChild(0, withDueDates(paragraph.copy(words))));
}

// In a task's words, @2026-10-30 is its due date: a chip.
const DUE_IN_TEXT = /(^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/g;
function withDueDates(block) {
  const children = [];
  block.forEach((child) => {
    if (!child.isText) { children.push(child); return; }
    let at = 0;
    for (const match of child.text.matchAll(DUE_IN_TEXT)) {
      const start = match.index + match[1].length;
      if (start > at) children.push(schema.text(child.text.slice(at, start), child.marks));
      children.push(schema.nodes.due_date.create({ day: match[2] }));
      at = start + match[2].length + 1;
    }
    if (at < child.text.length) children.push(at ? schema.text(child.text.slice(at), child.marks) : child);
  });
  return block.copy(Fragment.fromArray(children));
}

// Whether the cursor is in a task's words.
function inTaskLine(state) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === schema.nodes.list_item) return node.attrs.checked !== null;
  }
  return false;
}

// In a task, @ and a date with a space after it (@friday , @12 oct ) becomes its due date.
const dueRule = new InputRule(/(?:^|\s)@([a-zA-Z0-9 -]{1,24})\s$/, (state, match, start, end) => {
  if (!inTaskLine(state)) return null;
  const day = parseDue(match[1]);
  if (!day) return null;
  const at = start + match[0].indexOf('@');
  return state.tr.replaceWith(at, end, [schema.nodes.due_date.create({ day }), schema.text(' ')]);
});

// In the words, ((bullet id)) is a link to a bullet.
const BLOCK_REF_IN_TEXT = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/g;
function withBlockRefs(block) {
  const children = [];
  block.forEach((child) => {
    if (!child.isText || !BLOCK_REF_IN_TEXT.test(child.text)) { BLOCK_REF_IN_TEXT.lastIndex = 0; children.push(child); return; }
    BLOCK_REF_IN_TEXT.lastIndex = 0;
    let at = 0;
    for (const match of child.text.matchAll(BLOCK_REF_IN_TEXT)) {
      if (match.index > at) children.push(schema.text(child.text.slice(at, match.index), child.marks));
      children.push(schema.nodes.block_ref.create({ id: match[1] }));
      at = match.index + match[0].length;
    }
    if (at < child.text.length) children.push(schema.text(child.text.slice(at), child.marks));
  });
  return block.copy(Fragment.fromArray(children));
}

function withPageLinks(block) {
  const children = [];
  let open = null; // a page link being gathered from text pieces that share its link
  block.forEach((child) => {
    const link = child.isText && child.marks.find((mark) => mark.type === schema.marks.link);
    const page = link && pageOf(link.attrs.href);
    if (page && open && open.href === link.attrs.href) { open.label += child.text; return; }
    if (open) { children.push(schema.nodes.page_link.create({ ...open.page, label: open.label })); open = null; }
    if (page) open = { href: link.attrs.href, page, label: child.text };
    else children.push(child);
  });
  if (open) children.push(schema.nodes.page_link.create({ ...open.page, label: open.label }));
  return block.copy(Fragment.fromArray(children));
}

export const toMarkdown = (doc) => serializer.serialize(doc);
// A file card can't hold the cursor, so the text never ends with one: there is always
// a line after it to go on writing.
const lineAfterLastCard = (doc) => (doc.lastChild?.type === schema.nodes.file_card
  ? doc.copy(doc.content.append(Fragment.from(schema.nodes.paragraph.create())))
  : doc);

export const fromMarkdown = (text) => lineAfterLastCard(withFileCards(parser.parse(text)));

// **text** and *text*: the signs go, the formatting stays.
function markRule(pattern, markType) {
  return new InputRule(pattern, (state, match, start, end) => {
    const tr = state.tr.replaceWith(start, end, schema.text(match[1], [...state.storedMarks ?? [], markType.create()]));
    return tr.removeStoredMark(markType);
  });
}

// Makes the line at `pos` a task: a list item gets a checkbox, any other line becomes a
// one-line task list. Returns the transaction, or null when it can't be done there.
function taskAt(tr, pos, checked = false) {
  const $pos = tr.doc.resolve(pos);
  const item = $pos.depth > 1 ? $pos.node(-1) : null;
  if (item?.type === schema.nodes.list_item && $pos.index(-1) === 0) {
    return tr.setNodeMarkup($pos.before(-1), null, { ...item.attrs, checked: item.attrs.checked ?? checked });
  }
  const range = $pos.blockRange();
  const wrapping = range && findWrapping(range, schema.nodes.bullet_list, { tight: true });
  if (!wrapping) return null;
  return tr.wrap(range, wrapping.map((w) => (w.type === schema.nodes.list_item ? { type: w.type, attrs: { checked } } : w)));
}

// The slash menu's Todo list.
export function makeTask(state, dispatch) {
  const tr = taskAt(state.tr, state.selection.from);
  if (!tr) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
}

// [] or [ ] (or [x]) and a space at the start of a line make it a task.
const taskRule = new InputRule(/^\s*\[( |x|X)?\]\s$/, (state, match, start, end) => taskAt(state.tr.delete(start, end), start, Boolean(match[1]?.trim())));

// Enter in a task starts a new open task (in a done one too); in a plain list, a plain item.
function splitItem(state, dispatch) {
  const { $from } = state.selection;
  let item = null;
  for (let depth = $from.depth; depth > 0 && !item; depth--) if ($from.node(depth).type === schema.nodes.list_item) item = $from.node(depth);
  return splitListItem(schema.nodes.list_item, item && item.attrs.checked !== null ? { checked: false } : undefined)(state, dispatch);
}

// Backspace at the very start of a task takes its checkbox away (the line stays).
function uncheckAtStart(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false;
  const item = $from.node(-1);
  if (item.type !== schema.nodes.list_item || item.attrs.checked === null || $from.index(-1) !== 0) return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(-1), null, { ...item.attrs, checked: null }));
  return true;
}

const baseRules = [
    textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (match) => ({ level: match[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + node.attrs.order === Number(match[1])),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    markRule(/(?:\*\*|__)([^*_\s](?:[^*_]*[^*_\s])?)(?:\*\*|__)$/, schema.marks.strong),
    markRule(/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, schema.marks.em),
    markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, schema.marks.em),
];

const keys = keymap({
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  'Mod-b': toggleMark(schema.marks.strong),
  'Mod-i': toggleMark(schema.marks.em),
  Backspace: chainCommands(undoInputRule, uncheckAtStart),
  Enter: splitItem,
  Tab: sinkListItem(schema.nodes.list_item),
  'Shift-Tab': liftListItem(schema.nodes.list_item),
  'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  }),
});

// "Start writing" while the note has no text.
const placeholder = new Plugin({
  props: {
    attributes: (state) => (state.doc.textContent === '' && state.doc.childCount <= 1 && state.doc.firstChild?.type === schema.nodes.paragraph
      ? { class: 'is-empty' } : {}),
  },
});

// Files pasted, dropped or picked into the text: each is sent to the server (which keeps
// it once, by its fingerprint) and then put where it was dropped, as a picture for images
// and a file card for anything else. The spot is followed while the file is on its way, so
// typing meanwhile doesn't move it to the wrong place. With no spot (a file let go
// outside the text), it goes at the end.
const filesKey = new PluginKey('files');
let nextFile = 0;

const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

function insertFiles(view, files, pos) {
  const { onProblem } = filesKey.get(view.state).spec;
  for (const file of files) {
    const id = nextFile++;
    view.dispatch(view.state.tr.setMeta(filesKey, { add: id, pos }));
    api.uploadFile(file).then((kept) => {
      if (view.isDestroyed) return;
      const at = filesKey.getState(view.state).get(id);
      const picture = kept.type.startsWith('image/');
      const node = picture
        ? schema.nodes.image.create({ src: kept.url, alt: kept.name, title: kept.name })
        : schema.nodes.file_card.create({ href: kept.url, name: kept.name });
      const end = view.state.doc.content.size;
      const atEnd = () => view.state.tr.insert(end, picture ? schema.nodes.paragraph.create(null, node) : node);
      let tr;
      try {
        if (at === null) tr = atEnd();
        else tr = picture ? view.state.tr.insert(at, node) : view.state.tr.replaceRangeWith(at, at, node);
      } catch {
        tr = atEnd();
      }
      if (tr.doc.lastChild?.type === schema.nodes.file_card) {
        tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
      }
      // Writing goes on right after what was added.
      const after = tr.mapping.map(at ?? end, 1);
      try { tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + (picture ? 0 : 1), tr.doc.content.size)))); } catch { /* keep the cursor */ }
      view.dispatch(tr.setMeta(filesKey, { remove: id }));
    }).catch((err) => {
      if (view.isDestroyed) return;
      view.dispatch(view.state.tr.setMeta(filesKey, { remove: id }));
      onProblem?.(`“${file.name}” couldn't be added: ${err.message}`);
    });
  }
}

// Opens the computer's file picker (the slash menu's Image, File and PDF) and puts what
// is picked where the cursor is.
export function pickFiles(view, accept = '') {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  input.addEventListener('change', () => {
    if (input.files.length) insertFiles(view, [...input.files], view.state.selection.from);
  });
  input.click();
}

// A file let go anywhere on the page, outside any editor, goes into this editor at the
// end (a note's or an entry's text, the journal's write box). Returns how to stop.
// Files from elsewhere (dropped on a journal day, then opened in a new entry) go at the end.
export const addFiles = (view, files) => insertFiles(view, files, null);

export function catchPageDrops(view) {
  const over = (event) => {
    if (!hasFiles(event) || event.target.closest?.('.ProseMirror')) return;
    event.preventDefault();
    view.dom.classList.add('is-drop-target');
  };
  const leave = (event) => { if (!event.relatedTarget) view.dom.classList.remove('is-drop-target'); };
  const drop = (event) => {
    view.dom.classList.remove('is-drop-target');
    if (!hasFiles(event) || event.target.closest?.('.ProseMirror')) return;
    event.preventDefault();
    insertFiles(view, [...event.dataTransfer.files], null);
  };
  document.addEventListener('dragover', over);
  document.addEventListener('dragleave', leave);
  document.addEventListener('drop', drop);
  return () => {
    document.removeEventListener('dragover', over);
    document.removeEventListener('dragleave', leave);
    document.removeEventListener('drop', drop);
  };
}

function filesPlugin(onProblem) {
  return new Plugin({
    key: filesKey,
    onProblem,
    state: {
      init: () => new Map(),
      apply(tr, spots) {
        const meta = tr.getMeta(filesKey);
        // -1: words typed right at the spot go after it, so the file stays where it was dropped.
        const moved = new Map([...spots].map(([id, pos]) => [id, pos === null ? null : tr.mapping.map(pos, -1)]));
        if (meta?.add !== undefined) moved.set(meta.add, meta.pos);
        if (meta?.remove !== undefined) moved.delete(meta.remove);
        return moved;
      },
    },
    props: {
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault();
        insertFiles(view, files, view.state.selection.from);
        return true;
      },
      // Handled before the editor's own drop, which ignores a file let go in the empty
      // space below the text (the browser would then open the file instead).
      handleDOMEvents: {
        dragover(view, event) {
          if (!hasFiles(event)) return false;
          event.preventDefault();
          view.dom.classList.add('is-drop-target');
          return true;
        },
        dragleave(view, event) {
          if (!view.dom.contains(event.relatedTarget)) view.dom.classList.remove('is-drop-target');
          return false;
        },
        drop(view, event) {
          view.dom.classList.remove('is-drop-target');
          const files = [...(event.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
          insertFiles(view, files, at);
          return true;
        },
      },
    },
  });
}

// ---- How pictures and file cards look in the text ----

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// The kind shown on a file card: PDF, ZIP, DOCX… from the type or the name's ending.
export function fileKind(name, type = '') {
  if (type === 'application/pdf') return 'PDF';
  const ending = /\.([a-z0-9]{1,4})$/i.exec(name ?? '');
  return ending ? ending[1].toUpperCase() : 'FILE';
}

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// A picture: as wide as the text allows and at most a set height, its name under it.
// Clicking it opens it full size in a new tab.
function pictureView(node) {
  const dom = make('span', 'note-picture');
  dom.contentEditable = 'false';
  const img = make('img');
  img.src = node.attrs.src;
  img.alt = node.attrs.alt ?? '';
  img.title = 'Click to see it full size';
  const caption = make('span', 'note-picture-name', node.attrs.alt || node.attrs.title || '');
  dom.append(img, caption);
  img.addEventListener('click', () => window.open(node.attrs.src, '_blank', 'noopener'));
  return { dom, ignoreMutation: () => true };
}

// A link to a page: a small shape for what it points at (▭ a note, 31 the journal) and
// the page's current name, so a renamed note shows its new name everywhere. Clicking it
// opens the page; ⌘-click opens it in a new tab.
const pageNames = new Map(); // what each link shows, asked of the server once per page

const shortDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// A bullet link (Writing 2): the bullet's words as they are now, underlined, opening its note at that bullet; a bullet that is gone reads
// "Removed passage". A link alone in its line is an embed: the bullet and what is under it, in a frame with the note's name. Both are
// drawn from the bullet's row every time the text is shown, never from a copy.
const bulletCache = new Map(); // id → { at, promise }
export function bulletOf(id, { fresh = false } = {}) {
  const hit = bulletCache.get(id);
  if (hit && !fresh && Date.now() - hit.at < 4000) return hit.promise;
  const promise = fetch(`/api/bullets/${id}`).then((res) => (res.ok ? res.json() : undefined)).then((b) => (b && b.removed ? null : b)).catch(() => undefined);
  bulletCache.set(id, { at: Date.now(), promise });
  return promise;
}
const hrefOfBullet = (b) => `/notes/${b.note_id}?bullet=${b.id}`;

function blockRefView(node, view, getPos) {
  const id = node.attrs.id;
  const dom = make('span', 'block-ref');
  dom.contentEditable = 'false';
  let embed = false;
  const open = (href) => (event) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
    else document.dispatchEvent(new CustomEvent('app-navigate', { detail: href }));
  };
  const draw = async () => {
    dom.classList.toggle('is-embed', embed);
    dom.replaceChildren(make('span', 'block-ref-words', '…'));
    const b = await bulletOf(id);
    if (b === undefined) return; // not reachable now: it stays as it was
    if (!b) {
      dom.classList.add('is-missing');
      dom.replaceChildren(make('span', 'block-ref-words', 'Removed passage'));
      return;
    }
    dom.classList.remove('is-missing');
    if (!embed) {
      const link = make('a', 'block-ref-link', b.text || 'Untitled bullet');
      link.href = hrefOfBullet(b);
      link.title = `In ${b.note_title}`;
      link.addEventListener('click', open(link.getAttribute('href')));
      dom.replaceChildren(link);
      return;
    }
    const frame = make('span', 'block-embed');
    frame.append(make('span', 'block-embed-words', b.text));
    if (b.children.length) {
      const list = make('span', 'block-embed-children');
      for (const c of b.children) { const row = make('span', 'block-embed-child', c.text); row.style.marginLeft = `calc(${c.depth} * var(--space-4))`; list.append(row); }
      frame.append(list);
    }
    const from = make('a', 'block-embed-from', `From ${b.note_title}`);
    from.href = hrefOfBullet(b);
    from.addEventListener('click', open(from.getAttribute('href')));
    frame.append(from);
    dom.replaceChildren(frame);
  };
  const lone = (decorations) => decorations.some((d) => String(d.type.attrs?.class ?? '').includes('block-embed-slot'));
  try { const parent = view.state.doc.resolve(getPos()).parent; embed = parent.type === schema.nodes.paragraph && parent.childCount === 1; } catch { embed = false; }
  void draw();
  return {
    dom,
    ignoreMutation: () => true,
    stopEvent: (event) => event.type === 'click' || event.type === 'mousedown',
    update(next, decorations) {
      if (next.type !== node.type || next.attrs.id !== id) return false;
      const now = lone(decorations);
      if (now !== embed) { embed = now; void draw(); }
      return true;
    },
  };
}

// Marks a link that stands alone in its line, so it is drawn as an embed.
const blockRefPlugin = () => new Plugin({
  props: {
    decorations(state) {
      const decorations = [];
      state.doc.descendants((node, pos) => {
        if (node.type === schema.nodes.paragraph && node.childCount === 1 && node.firstChild.type === schema.nodes.block_ref) {
          decorations.push(Decoration.node(pos + 1, pos + 2, { class: 'block-embed-slot' }));
        }
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

// A board in the note: the canvas, drawn from the board's rows. Everything inside it is the board's own (pressing, dragging, typing).
function boardBlockView(node) {
  const dom = make('div', 'board-block');
  dom.contentEditable = 'false';
  const host = make('div', 'board-host');
  dom.append(host);
  let mounted = null;
  mountBoard(host, node.attrs.id, { onOpen: (board) => document.dispatchEvent(new CustomEvent('app-navigate', { detail: `/boards/${board.id}` })) }).then((m) => { mounted = m; });
  return {
    dom,
    stopEvent: () => true,
    ignoreMutation: () => true,
    update: (next) => next.type === node.type && next.attrs.id === node.attrs.id,
    destroy() { mounted?.destroy(); },
  };
}

// "Whiteboard" in the slash menu: a new board for this note, put under the line. Made on the server first, so it is there when it shows.
const makeBoardCommand = (boards) => (state, dispatch, view) => {
  void (async () => {
    let board;
    try { board = await boards.create(); } catch { return; }
    const { $from } = view.state.selection;
    const at = $from.depth > 0 ? $from.after() : $from.pos;
    const nodes = [schema.nodes.board_block.create({ id: board.id, title: board.title || 'Board' })];
    if (at >= view.state.doc.content.size) nodes.push(schema.nodes.paragraph.create());
    view.dispatch(view.state.tr.insert(at, nodes).scrollIntoView());
  })();
  return true;
};

function pageLinkView(node) {
  const { kind, id, label } = node.attrs;
  const href = hrefOf(node.attrs);
  const dom = make('a', 'page-link');
  dom.href = href;
  dom.contentEditable = 'false';
  let shape = linkShape(kind, label);
  const words = make('span', 'page-link-words', label || (kind === 'day' ? shortDay(id) : '…'));
  dom.append(shape, words);
  const key = `${kind}:${id}`;
  if (!pageNames.has(key)) pageNames.set(key, fetch(`/api/links/target?kind=${kind}&id=${id}`).then((res) => res.json()).catch(() => null));
  pageNames.get(key).then((target) => {
    if (!target) return;
    if (!target.exists) {
      dom.classList.add('is-missing');
      dom.title = 'This page was deleted. It can be brought back from Recently deleted.';
      return;
    }
    words.textContent = kind === 'day' ? shortDay(id) : target.title;
    if (kind === 'person' || kind === 'company' || kind === 'life') {
      const fresh = linkShape(kind, target.title, target.life_kind);
      shape.replaceWith(fresh);
      shape = fresh;
    }
  });
  dom.addEventListener('click', (event) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
    else document.dispatchEvent(new CustomEvent('app-navigate', { detail: href }));
  });
  return { dom, ignoreMutation: () => true, stopEvent: (event) => event.type === 'click' };
}

// A due date in a task: a chip that says the day (Today, Tomorrow, Fri, Oct 30).
function dueDateView(node) {
  const dom = make('span', 'due-chip', dueLabel(node.attrs.day));
  dom.contentEditable = 'false';
  dom.title = `Due ${node.attrs.day}`;
  return { dom, ignoreMutation: () => true };
}

// A task in the text: a checkbox in front of its words. Clicking the box ticks it (or
// takes the tick away); the line is saved like any change.
function listItemView(node, view, getPos) {
  if (node.attrs.checked === null) {
    const li = document.createElement('li');
    li.classList.toggle('is-folded', Boolean(node.attrs.folded));
    return {
      dom: li,
      contentDOM: li,
      ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === li && mutation.attributeName === 'class', // a mark from outside (the one found) is not an edit
      update(next) {
        if (next.type !== node.type || next.attrs.checked !== null) return false;
        li.classList.toggle('is-folded', Boolean(next.attrs.folded));
        return true;
      },
    };
  }
  const li = make('li', 'task-line');
  const box = make('button', 'task-box');
  box.type = 'button';
  box.contentEditable = 'false';
  box.setAttribute('role', 'checkbox');
  box.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const words = make('div', 'task-words');
  li.append(box, words);
  const draw = () => {
    li.dataset.checked = String(node.attrs.checked);
    box.setAttribute('aria-checked', String(node.attrs.checked));
    box.setAttribute('aria-label', node.attrs.checked ? 'Done. Untick' : 'Tick when done');
  };
  draw();
  box.addEventListener('mousedown', (event) => event.preventDefault());
  box.addEventListener('click', () => {
    const pos = getPos();
    const current = view.state.doc.nodeAt(pos);
    if (current) view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...current.attrs, checked: !current.attrs.checked }));
  });
  return {
    dom: li,
    contentDOM: words,
    update(next) {
      if (next.type !== node.type || next.attrs.checked === null) return false;
      node = next;
      draw();
      return true;
    },
    stopEvent: (event) => box.contains(event.target),
    // The box, and marks on the line itself (a task opened from the Tasks page), are not the text.
    ignoreMutation: (mutation) => box.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === li),
  };
}

// Names change: the next link drawn asks again.
export const forgetPageNames = () => pageNames.clear();

// A file that isn't a picture: a card with a page-shaped icon showing its kind, its name,
// kind and size, and Open (a PDF opens in a new tab; other kinds are downloaded).
function fileCardView(node) {
  const { href, name } = node.attrs;
  const dom = make('div', 'file-card');
  dom.contentEditable = 'false';
  const kind = make('span', 'file-card-kind', fileKind(name));
  const text = make('span', 'file-card-text');
  const meta = make('span', 'file-card-meta', '…');
  text.append(make('span', 'file-card-name', name), meta);
  const open = make('a', 'button file-card-open', 'Open');
  open.href = href;
  open.target = '_blank';
  open.rel = 'noopener';
  dom.append(kind, text, open);
  fetch(`/api${href}`).then((res) => (res.ok ? res.json() : Promise.reject(res))).then((file) => {
    kind.textContent = fileKind(file.name, file.type);
    meta.textContent = `${fileKind(file.name, file.type)} · ${fileSize(file.size)}`;
  }).catch(() => { meta.textContent = 'This file is missing'; });
  return {
    dom,
    ignoreMutation: () => true,
    // The Open button is a real link: the browser follows it, not the editor.
    stopEvent: (event) => Boolean(event.target.closest?.('a')),
  };
}

// Puts an editor in `place`, holding `markdown`. `onChange(markdown, text)` runs after
// every change. With `onSubmit`, Enter (or Cmd-Enter) hands the text over instead of
// starting a new line, as in the journal's write box; Shift-Enter still breaks the line.
// With `tasks: false` (My Life's thinking space, which never asks for action), [] stays
// plain text and the slash menu has no Todo list. Returns the view.
export function createEditor(place, markdown, {
  onChange, onSubmit, onFileProblem, label = 'Text', placeholderText = 'Start writing', className = 'note-body', tasks = true, outline = null, comments = null, boards = null,
} = {}) {
  const rules = inputRules({ rules: [...baseRules, ...(tasks ? [taskRule, dueRule] : [])] });
  const submit = onSubmit && keymap({
    Enter: () => { onSubmit(); return true; },
    'Mod-Enter': () => { onSubmit(); return true; },
  });
  const view = new EditorView(place, {
    // The slash menu goes first, so that while it is open its keys (arrows, Enter, Escape)
    // win over the editor's own.
    state: EditorState.create({
      doc: fromMarkdown(markdown),
      plugins: [slashMenu(schema, { pickFiles, makeTask: tasks ? makeTask : null, makeBoard: boards ? makeBoardCommand(boards) : null }), ...linkMenu(schema), ...(submit ? [submit] : []), ...(outline ? outlinePlugins(outline) : []), ...(comments ? [commentPlugin(comments)] : []), blockRefPlugin(), rules, keys, keymap(baseKeymap), history(), placeholder, filesPlugin(onFileProblem)],
    }),
    attributes: {
      class: className, role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, 'data-placeholder': placeholderText,
    },
    nodeViews: { image: pictureView, file_card: fileCardView, page_link: pageLinkView, block_ref: blockRefView, board_block: boardBlockView, list_item: listItemView, due_date: dueDateView },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged && !tr.getMeta('fold')) onChange?.(toMarkdown(view.state.doc), view.state.doc.textBetween(0, view.state.doc.content.size, ' ', ' '));
    },
  });
  return view;
}

// Opened from the Tasks page (?task=N): shows the page's Nth task, marked for a moment.
export function showTaskAt(view) {
  const n = Number.parseInt(new URLSearchParams(location.search).get('task') ?? '', 10);
  const line = Number.isNaN(n) ? null : view.dom.querySelectorAll('.task-line')[n];
  if (!line) return;
  line.scrollIntoView({ block: 'center' });
  line.classList.add('is-found');
  setTimeout(() => line.classList.remove('is-found'), 2500);
}

// Puts the cursor at the end of the words and focuses the editor (the Inbox's Edit).
export function focusAtEnd(view) {
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  view.focus();
}

// What an editor holds, as Markdown; and emptying it (the write box, after adding).
export const markdownOf = (view) => toMarkdown(view.state.doc);
export const isEmpty = (view) => view.state.doc.textContent.trim() === '' && view.state.doc.childCount <= 1;
export function clearEditor(view) {
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.nodes.paragraph.create()));
}
export function setMarkdown(view, markdown) {
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, fromMarkdown(markdown).content));
}

// The words of a note without the Markdown signs, for cards, rows and counting.
export function plainText(markdown) {
  return markdown
    .replace(/\\\n/g, ' ')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\[( |x|X)\](?: |$)/gm, '')
    .replace(DUE_IN_TEXT, (_, before, day) => `${before}${dueLabel(day)}`)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)(?=\S)([^*_`]*?\S)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1');
}
