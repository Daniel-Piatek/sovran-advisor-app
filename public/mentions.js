// @ mentions in a plain text field (People in depth, advanced/people/1): a task's words in
// the add bar and in the edit strip. Typing @ and a few letters offers people, @@ companies;
// Enter, Tab or a click puts the name in the words and keeps who it is. The text stays
// plain words: the field keeps the list of who was mentioned, and the task keeps it as
// link rows. The menu is the editor's (public/link-menu.js); a task row draws a mention as
// the same piece as in a note: the face and the name, never the accent.

import { api, el } from './ui.js';
import { linkShape } from './editor.js';
import { moduleOn } from './modules.js';

const TRIGGER = /(^|\s)(@@?)([^@\n]{0,40})$/;
const SUGGEST_AFTER_MS = 80;

const hrefOf = (mention) => `${mention.kind === 'person' ? '/people/' : '/companies/'}${mention.id}`;

// A mention as a link: the face and the name.
export function mentionChip(mention, { link = true } = {}) {
  return el(link ? 'a' : 'span', { class: 'page-link mention-chip', ...(link ? { href: hrefOf(mention) } : {}) },
    linkShape(mention.kind, mention.name), el('span', { class: 'page-link-words' }, mention.name));
}

// A task's words with each mention drawn as a chip where its name stands (its first
// occurrence). With People in depth off, or nothing mentioned: the plain words.
export function wordsWithMentions(text, mentions = []) {
  if (!mentions.length || !moduleOn('people-plus')) return [text];
  const found = [];
  const lower = text.toLowerCase();
  for (const mention of mentions) {
    const at = lower.indexOf(mention.name.toLowerCase());
    if (at >= 0 && !found.some((f) => at < f.end && at + mention.name.length > f.at)) found.push({ at, end: at + mention.name.length, mention });
  }
  found.sort((a, b) => a.at - b.at);
  const parts = [];
  let from = 0;
  for (const { at, end, mention } of found) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(mentionChip({ ...mention, name: text.slice(at, end) }));
    from = end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

// Makes `input` take @ mentions. onChange() runs when the list of who is mentioned changes.
// Returns { mentions(), set(list), close() }.
export function mentionField(input, { onChange = () => {} } = {}) {
  let chosen = []; // { kind, id, name }
  let shown = [];
  let index = 0;
  let open = null; // { at, mode, query } where the @ stands
  let timer = null;
  let inflight = Promise.resolve();
  let run = 0;
  const box = el('div', { class: 'slash-menu link-menu', role: 'listbox', 'aria-label': 'Mention', hidden: true });
  box.addEventListener('mousedown', (event) => event.preventDefault());

  const stillThere = () => chosen.filter((m) => input.value.toLowerCase().includes(m.name.toLowerCase()));
  function sync() {
    const kept = stillThere();
    if (kept.length !== chosen.length) { chosen = kept; onChange(); }
  }

  function hide() {
    open = null;
    clearTimeout(timer);
    timer = null;
    box.hidden = true;
    shown = [];
  }

  function place() {
    const host = input.closest('dialog') ?? document.body;
    if (box.parentElement !== host) host.append(box);
    const at = input.getBoundingClientRect();
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

  function paint() {
    box.replaceChildren();
    if (!shown.length) {
      box.append(el('div', { class: 'slash-menu-empty' }, open?.mode === 'company' ? 'Type a company’s name' : 'Type a name'));
      return;
    }
    shown.forEach((item, i) => {
      const words = (item.label ?? item.title ?? '').trim().split(/\s+/);
      const face = item.kind === 'new' ? '+' : item.kind === 'person' ? words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') : (words[0]?.[0] ?? '?').toUpperCase();
      const row = el('div', { class: 'slash-menu-item', role: 'option', 'aria-selected': String(i === index) },
        el('span', { class: `slash-menu-icon link-menu-${item.kind === 'new' ? 'new' : item.kind}`, 'aria-hidden': 'true' }, face),
        el('span', { class: 'slash-menu-label' }, item.kind === 'new' ? `New ${item.makes} “${item.title}”` : item.label),
        el('span', { class: 'slash-menu-later' }, item.kind === 'new' ? '' : item.kind));
      row.addEventListener('mousemove', () => { if (index !== i) { index = i; paint(); } });
      row.addEventListener('click', () => choose(item));
      box.append(row);
    });
  }

  async function suggest(query, mode) {
    const mine = ++run;
    let found = [];
    try { found = await api.suggestLinks(query, mode); } catch { /* nothing to suggest */ }
    if (mine !== run || !open) return;
    const title = query.trim();
    const exact = found.some((item) => item.label.toLowerCase() === title.toLowerCase());
    shown = [...found, ...(title && !exact ? [{ kind: 'new', makes: mode, title }] : [])];
    index = 0;
    box.hidden = false;
    paint();
    place();
  }

  // Where the cursor is: right after an @ (or @@) at the start of a word.
  function look() {
    if (!moduleOn('people-plus')) { hide(); return; }
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const match = TRIGGER.exec(before);
    if (!match) { hide(); return; }
    const next = { at: before.length - match[2].length - match[3].length, mode: match[2] === '@@' ? 'company' : 'person', query: match[3] };
    if (open && open.at === next.at && open.mode === next.mode && open.query === next.query) return;
    open = next;
    clearTimeout(timer);
    if (!shown.length) { box.hidden = false; paint(); place(); }
    timer = setTimeout(() => { timer = null; inflight = suggest(next.query, next.mode); }, SUGGEST_AFTER_MS);
  }

  // What was typed last, found: Enter right after typing waits for it, never takes a stale choice.
  async function settled() {
    if (timer) { clearTimeout(timer); timer = null; inflight = suggest(open.query, open.mode); }
    await inflight;
  }

  async function choose(item = shown[index]) {
    if (!open) return;
    if (!item) { hide(); return; }
    const { at, mode } = open;
    const end = input.selectionStart ?? input.value.length;
    let target = item;
    if (item.kind === 'new') {
      try {
        const made = mode === 'company' ? await api.createCompany({ name: item.title }) : await api.createPerson({ name: item.title });
        target = { kind: mode, id: made.id, label: made.name };
      } catch { hide(); return; }
    }
    const name = target.label;
    const tail = input.value.slice(end);
    const text = `${input.value.slice(0, at)}${name}${tail.startsWith(' ') ? '' : ' '}${tail}`;
    input.value = text;
    const caret = at + name.length + 1;
    input.setSelectionRange(caret, caret);
    if (!chosen.some((m) => m.kind === target.kind && m.id === target.id)) chosen = [...chosen, { kind: target.kind, id: target.id, name }];
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    onChange();
    input.focus();
  }

  // Keys first: with the menu open, the arrows, Enter, Tab and Escape are the menu's, so
  // the field's own Enter (add the task, close the strip) doesn't also run.
  input.addEventListener('keydown', (event) => {
    if (!open || box.hidden) return;
    const take = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown.length) return;
      take();
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      paint();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      take();
      const asked = open;
      settled().then(() => { if (open === asked) { if (shown.length) choose(); else hide(); } });
    }
    else if (event.key === 'Escape') { take(); hide(); }
  }, true);
  input.addEventListener('input', () => { look(); sync(); });
  input.addEventListener('click', look);
  input.addEventListener('keyup', (event) => { if (event.key.startsWith('Arrow') && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') look(); });
  input.addEventListener('blur', () => setTimeout(hide, 100));

  return {
    mentions: () => stillThere().map(({ kind, id }) => ({ kind, id })),
    chosen: () => stillThere(),
    set(list) { chosen = list.map((m) => ({ kind: m.kind, id: m.id, name: m.name })); },
    clear() { chosen = []; },
    close: hide,
  };
}
