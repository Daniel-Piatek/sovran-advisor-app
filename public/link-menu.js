// [[ : links to another page. Type two square brackets and what follows finds people,
// companies, My Life items, notes, journal entries and days ("today", "yesterday", "tomorrow" or a
// date); the arrows move, Enter (or a click) puts the link in, Escape closes and keeps
// what was typed. "New note …" at the bottom makes a note with that title and links to it.
// @ does the same for people only, and @@ for companies (a mention), each with "New …".
// Looks and works like the slash menu (public/slash-menu.js).

import { Plugin, PluginKey } from '/vendor/prosemirror-state/dist/index.js';
import { api, icon as shapeOf } from './ui.js';
import { dueChoices, dueMonthDay } from './due.js';
import { moduleOn } from './modules.js';

// In a task's words, @ offers due dates first (tasks/1).
const inTask = (state, schema) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === schema.nodes.list_item) return node.attrs.checked !== null;
  }
  return false;
};

const linkKey = new PluginKey('link-menu');
const SUGGEST_AFTER_MS = 80;

// What opens the menu, and what it finds: [[ everything, @ people, @@ companies.
const TRIGGERS = { link: '[[', person: '@', company: '@@', block: '((' }; // (( finds a bullet of any note (Writing and thinking)

// Spots waiting for a page that is still being made ("New person …"): followed through
// any typing meanwhile, so the link lands where the name was and nothing typed since moves.
const pendingKey = new PluginKey('link-pending');
let nextPending = 0;
const pendingPlugin = () => new Plugin({
  key: pendingKey,
  state: {
    init: () => new Map(),
    apply(tr, spots) {
      const meta = tr.getMeta(pendingKey);
      // -1: words typed right at the spot go after it, so the link stays in front of them.
      const moved = new Map([...spots].map(([id, pos]) => [id, tr.mapping.map(pos, -1)]));
      if (meta?.add !== undefined) moved.set(meta.add, meta.pos);
      if (meta?.remove !== undefined) moved.delete(meta.remove);
      return moved;
    },
  },
});

// Where the menu is open: the position of its "[[" (or "@"), what it finds, or null.
function linkState() {
  return {
    init: () => null,
    apply(tr, open, oldState, state) {
      const meta = tr.getMeta(linkKey);
      if (meta === 'close') return null;
      if (meta && typeof meta.open === 'number') return { from: meta.open, mode: meta.mode };
      if (!open) return null;
      const from = tr.mapping.map(open.from);
      const trigger = TRIGGERS[open.mode];
      const { empty, $head } = state.selection;
      if (!empty || $head.pos < from + trigger.length || from < $head.start()) return null;
      if (state.doc.textBetween(from, from + trigger.length) !== trigger) return null;
      const query = state.doc.textBetween(from + trigger.length, $head.pos, '\n');
      if (/\n|\]\]|\)\)/.test(query) || query.length > 60) return null;
      if (open.mode !== 'link' && / {2}/.test(query)) return null; // a mention is a name
      return { from, mode: open.mode };
    },
  };
}

export function linkMenu(schema) {
  return [linkMenuPlugin(schema), pendingPlugin()];
}

function linkMenuPlugin(schema) {
  let menu = null;
  return new Plugin({
    key: linkKey,
    state: linkState(),
    props: {
      // The second "[" opens the menu; "@" at the start of a word opens it for people, and a
      // second "@" right after switches it to companies.
      handleTextInput(view, from, to, text) {
        const before = from > 0 ? view.state.doc.textBetween(from - 1, from) : '';
        if (text === '[' && before === '[') {
          view.dispatch(view.state.tr.insertText('[', from, to).setMeta(linkKey, { open: from - 1, mode: 'link' }));
          return true;
        }
        if (text === '(' && before === '(' && moduleOn('writing') && schema.nodes.block_ref) {
          view.dispatch(view.state.tr.insertText('(', from, to).setMeta(linkKey, { open: from - 1, mode: 'block' }));
          return true;
        }
        if (text !== '@') return false;
        if (!moduleOn('people-plus')) return false; // People in depth is off: @ is just a letter
        const open = linkKey.getState(view.state);
        if (open?.mode === 'person' && open.from === from - 1) {
          view.dispatch(view.state.tr.insertText('@', from, to).setMeta(linkKey, { open: from - 1, mode: 'company' }));
          return true;
        }
        const $from = view.state.doc.resolve(from);
        const lineBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
        if (lineBefore && !/\s$/.test(lineBefore)) return false; // an email address, not a mention
        view.dispatch(view.state.tr.insertText('@', from, to).setMeta(linkKey, { open: from, mode: 'person' }));
        return true;
      },
      handleKeyDown(view, event) {
        if (!linkKey.getState(view.state) || !menu) return false;
        if (event.key === 'ArrowDown') { menu.move(1); return true; }
        if (event.key === 'ArrowUp') { menu.move(-1); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') return menu.choose();
        if (event.key === 'Escape') { view.dispatch(view.state.tr.setMeta(linkKey, 'close')); return true; }
        return false;
      },
      handleDOMEvents: {
        blur(view) {
          if (linkKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(linkKey, 'close'));
          return false;
        },
      },
    },
    view(editorView) {
      const box = document.createElement('div');
      box.className = 'slash-menu link-menu';
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', 'Link to');
      box.hidden = true;
      box.addEventListener('mousedown', (event) => event.preventDefault());
      const host = editorView.dom.closest('dialog') ?? document.body;
      host.append(box);

      let shown = [];
      let index = 0;
      let lastQuery = null;
      let timer = null;
      let run = 0;

      const query = () => {
        const open = linkKey.getState(editorView.state);
        return open ? editorView.state.doc.textBetween(open.from + TRIGGERS[open.mode].length, editorView.state.selection.head, '\n') : '';
      };

      // Says at once whether it took the key; the link itself may need the server first.
      function choose(item = shown[index]) {
        if (!linkKey.getState(editorView.state)) return false;
        if (!item) {
          editorView.dispatch(editorView.state.tr.setMeta(linkKey, 'close'));
          return false;
        }
        insert(item);
        return true;
      }

      async function insert(item) {
        let page = item;
        if (item.kind === 'new') {
          // Take the typed name out now and keep its spot; the link goes there once made.
          const state = editorView.state;
          const open = linkKey.getState(state);
          if (!open) return;
          const typed = state.doc.textBetween(open.from, state.selection.head);
          const id = nextPending++;
          editorView.dispatch(state.tr.delete(open.from, state.selection.head)
            .setMeta(linkKey, 'close').setMeta(pendingKey, { add: id, pos: open.from }));
          try {
            if (item.makes === 'person') {
              const person = await api.createPerson({ name: item.title });
              page = { kind: 'person', id: person.id, label: person.name };
            } else if (item.makes === 'company') {
              const company = await api.createCompany({ name: item.title });
              page = { kind: 'company', id: company.id, label: company.name };
            } else {
              const note = await api.createNoteTitled(item.title);
              page = { kind: 'note', id: note.id, label: note.title };
            }
          } catch {
            // Not made: the typed words go back where they were.
            const at = pendingKey.getState(editorView.state).get(id);
            editorView.dispatch(editorView.state.tr.insertText(typed, at).setMeta(pendingKey, { remove: id }));
            return;
          }
          const at = pendingKey.getState(editorView.state).get(id);
          const node = schema.nodes.page_link.create({ kind: page.kind, id: page.id, label: page.label });
          editorView.dispatch(editorView.state.tr.insert(at, node).setMeta(pendingKey, { remove: id }));
          return;
        }
        const state = editorView.state;
        const now = linkKey.getState(state);
        if (!now) return;
        if (item.kind === 'date') {
          const due = [schema.nodes.due_date.create({ day: item.day }), schema.text(' ')];
          editorView.dispatch(state.tr.replaceWith(now.from, state.selection.head, due).setMeta(linkKey, 'close'));
          editorView.focus();
          return;
        }
        if (item.kind === 'block') {
          editorView.dispatch(state.tr.replaceWith(now.from, state.selection.head, schema.nodes.block_ref.create({ id: item.id })).setMeta(linkKey, 'close'));
          editorView.focus();
          return;
        }
        const node = schema.nodes.page_link.create({ kind: page.kind, id: page.id, label: page.label });
        editorView.dispatch(state.tr.replaceWith(now.from, state.selection.head, node).setMeta(linkKey, 'close'));
        editorView.focus();
      }

      function move(step) {
        if (!shown.length) return;
        index = (index + step + shown.length) % shown.length;
        paint();
        box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      }

      const LIFE_NAMES = { key_element: 'Key Element', goal: 'goal', project: 'project', topic: 'topic', habit: 'habit' };
      const subOf = (item) => (item.kind === 'block' ? item.note_title : item.kind === 'date' ? `${dueMonthDay(item.day)} · due` : item.kind === 'life' ? LIFE_NAMES[item.life_kind]
        : { note: 'note', day: 'journal day', entry: 'journal entry', person: 'person', company: 'company' }[item.kind] ?? '');

      function paint() {
        box.replaceChildren();
        if (!shown.length) {
          const none = document.createElement('div');
          none.className = 'slash-menu-empty';
          const mode = linkKey.getState(editorView.state)?.mode;
          none.textContent = { person: 'Type a name', company: 'Type a company’s name', block: 'Type some words of the bullet' }[mode] ?? 'Type to find a note, an entry, a day or a person';
          box.append(none);
          return;
        }
        shown.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'slash-menu-item';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(i === index));
          const icon = document.createElement('span');
          icon.className = `slash-menu-icon link-menu-${item.kind}`;
          icon.setAttribute('aria-hidden', 'true');
          const words = (item.label ?? '').trim().split(/\s+/);
          if (item.kind === 'life') icon.append(shapeOf(item.life_kind));
          else icon.textContent = { note: '▭', block: '•', new: '+', person: words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join(''), company: (words[0]?.[0] ?? '?').toUpperCase() }[item.kind] ?? '31';
          const label = document.createElement('span');
          label.className = 'slash-menu-label';
          label.textContent = item.kind === 'new'
            ? `New ${{ person: 'person', company: 'company' }[item.makes] ?? 'note'} “${item.title}”` : item.label;
          const sub = document.createElement('span');
          sub.className = 'slash-menu-later';
          sub.textContent = subOf(item);
          row.append(icon, label, sub);
          row.addEventListener('mousemove', () => { if (index !== i) { index = i; paint(); } });
          row.addEventListener('click', () => choose(item));
          box.append(row);
        });
      }

      function place() {
        const open = linkKey.getState(editorView.state);
        const at = editorView.coordsAtPos(open.from);
        const left = Math.max(8, Math.min(at.left, document.documentElement.clientWidth - box.offsetWidth - 8));
        if (host === document.body) {
          box.style.left = `${left + window.scrollX}px`;
          box.style.top = `${at.bottom + window.scrollY + 4}px`;
        } else {
          const frame = host.getBoundingClientRect();
          box.style.left = `${left - frame.left}px`;
          box.style.top = `${at.bottom - frame.top + 4}px`;
        }
      }

      async function suggest(text) {
        const mine = ++run;
        const mode = linkKey.getState(editorView.state)?.mode;
        const only = mode === 'link' ? undefined : mode;
        let found = [];
        try {
          found = mode === 'block' ? (await api.suggestBullets(text)).map((b) => ({ kind: 'block', id: b.id, label: b.text, note_title: b.note_title })) : await api.suggestLinks(text, only);
        } catch { /* nothing to suggest */ }
        if (mine !== run || !linkKey.getState(editorView.state)) return;
        if (mode === 'block') { shown = found; index = 0; paint(); place(); return; }
        const title = text.trim();
        const makes = only ?? 'note';
        const exact = found.some((item) => item.kind === makes && item.label.toLowerCase() === title.toLowerCase());
        const dates = mode === 'person' && inTask(editorView.state, schema)
          ? dueChoices(text).map((choice) => ({ kind: 'date', ...choice })) : [];
        shown = [...dates, ...found, ...(title && !exact ? [{ kind: 'new', makes, title }] : [])];
        index = 0;
        paint();
        place();
      }

      function update() {
        if (!linkKey.getState(editorView.state)) {
          box.hidden = true;
          lastQuery = null;
          clearTimeout(timer);
          return;
        }
        const q = query();
        box.hidden = false;
        if (q !== lastQuery) {
          lastQuery = q;
          clearTimeout(timer);
          timer = setTimeout(() => suggest(q), SUGGEST_AFTER_MS);
          if (shown.length === 0) paint();
        }
        place();
      }

      menu = { move, choose };
      return { update, destroy() { clearTimeout(timer); box.remove(); menu = null; } };
    },
  });
}
