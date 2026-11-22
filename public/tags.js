// Tags (module tags, 2026-11-22, the owner's wish): the pieces every screen shares.
//   tagChip      one tag: the tag shape and its name, which opens the tag's page
//   tagRow       the row of tags under an item's title, with "+ Tag": type to find a tag, or make a new one
//   tagFilter    the one "Tags" button under a list's search box: a short menu (find a tag, your most used, your groups,
//                all tags), never a wall of every tag. The tags picked show beside it; the list shows only what has them all.
// The server's part is tags.js. The picked tags are kept in the address (?tags=a,b), so coming back keeps them.

import { request, el, icon } from './ui.js';
import { moduleOn } from './modules.js';

export const tagsOn = () => moduleOn('tags');

const MOST_USED = 3;
let cache = null; // the tags and groups, read once per screen
export const loadTags = async ({ fresh = false } = {}) => {
  if (!cache || fresh) cache = request('GET', '/api/tags').catch((err) => { cache = null; throw err; });
  return cache;
};
export const forgetTags = () => { cache = null; };

const fits = (name, typed) => typed.toLowerCase().split(/\s+/).filter(Boolean).every((word) => name.toLowerCase().includes(word));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// ---- One tag ----

// Every tag looks the same: a small tag shape, no colour of its own (D, 2026-11-22), so a tag is known at a glance and
// never mistaken for a kind's colour.
export const tagMark = () => el('span', { class: 'tag-mark', 'aria-hidden': 'true' }, icon('tag'));

export function tagChip(tag, { onRemove = null, link = true } = {}) {
  const name = el(link ? 'a' : 'span', { class: 'tag-chip-name', ...(link ? { href: `/tags/${tag.id}` } : {}) },
    tagMark(), tag.name);
  return el('span', { class: 'tag-chip', 'data-tag-id': tag.id },
    name,
    ...(onRemove ? [el('button', { type: 'button', class: 'tag-chip-remove', 'aria-label': `Take off ${tag.name}`, title: `Take off ${tag.name}`, onclick: onRemove }, icon('close'))] : []));
}

// ---- The menu: find a tag, or make one ----

// A menu under `anchor` (inside `place`). choose(tag) is called with a tag of the list, or with { name } for a new one when
// allowNew. skip: ids not to offer (already on the item, or already picked). Groups and All tags open in place.
function openMenu(place, anchor, { choose, skip = new Set(), allowNew = false, placeholder = 'Find a tag', counts = 'all' }) {
  place.querySelector('.tag-menu')?.remove();
  const search = el('input', { class: 'search-input', placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: 'false' });
  const list = el('div', { class: 'tag-menu-list', role: 'listbox', 'aria-label': 'Tags' });
  const menu = el('div', { class: 'slash-menu tag-menu' }, el('label', { class: 'search' }, icon('search'), search), list);
  place.append(menu);
  anchor.setAttribute('aria-expanded', 'true');
  search.focus({ preventScroll: true });
  const over = menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
  if (over > 0) menu.style.left = `${-over}px`;
  menu.scrollIntoView({ block: 'nearest' });

  let data = { tags: [], groups: [] };
  let open = null; // a group id, or 'all'
  let options = [];
  let index = 0;
  const countOf = (t) => (counts === 'all' ? t.count : t.counts?.[counts] ?? 0);

  const close = ({ focus = true } = {}) => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) anchor.focus();
  };
  const outside = (event) => { if (!menu.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) close({ focus: false }); };
  document.addEventListener('pointerdown', outside, true);

  const pick = (option) => {
    if (option.group !== undefined) { open = open === option.group ? null : option.group; paint(); search.focus(); return; }
    close();
    choose(option.tag ?? { name: option.make });
  };
  const tagOption = (tag) => ({ tag, label: tag.name, note: String(countOf(tag)) });
  const paint = () => {
    const typed = search.value.trim();
    const offered = data.tags.filter((t) => !skip.has(t.id));
    options = [];
    const rows = [];
    const heading = (text) => rows.push(el('div', { class: 'tag-menu-heading' }, text));
    const add = (option) => { option.i = options.length; options.push(option); rows.push(null); };
    if (typed) {
      const found = offered.filter((t) => fits(t.name, typed));
      found.forEach((t) => add(tagOption(t)));
      if (allowNew && !data.tags.some((t) => t.name.toLowerCase() === typed.replace(/^#+/, '').toLowerCase())) add({ make: typed.replace(/^#+/, ''), label: `Make tag “${typed.replace(/^#+/, '')}”`, note: '' });
    } else {
      const most = offered.filter((t) => countOf(t) > 0).slice(0, MOST_USED);
      if (most.length) { heading('Used most'); most.forEach((t) => add(tagOption(t))); }
      if (data.groups.length) heading('Groups');
      for (const g of data.groups) {
        const inside = offered.filter((t) => t.group_id === g.id).sort(byName);
        add({ group: g.id, label: g.name, note: `${inside.length} ${inside.length === 1 ? 'tag' : 'tags'}`, opened: open === g.id });
        if (open === g.id) inside.forEach((t) => add({ ...tagOption(t), inner: true }));
      }
      if (offered.length) {
        add({ group: 'all', label: `All ${offered.length} ${offered.length === 1 ? 'tag' : 'tags'}`, note: '', opened: open === 'all' });
        if (open === 'all') [...offered].sort(byName).forEach((t) => add({ ...tagOption(t), inner: true }));
      }
    }
    if (index >= options.length) index = Math.max(0, options.length - 1);
    let n = 0;
    list.replaceChildren(...rows.map((row) => {
      if (row) return row;
      const option = options[n++];
      return el('div', {
        class: `slash-menu-item tag-menu-item${option.inner ? ' is-inner' : ''}${option.group !== undefined ? ' is-group' : ''}`,
        role: 'option', 'aria-selected': String(option.i === index), ...(option.group !== undefined ? { 'aria-expanded': String(Boolean(option.opened)) } : {}),
        onmousemove: () => { if (index !== option.i) { index = option.i; paint(); } },
        onclick: () => pick(option),
      },
      option.tag ? tagMark()
        : option.make ? el('span', { class: 'tag-menu-mark', 'aria-hidden': 'true' }, icon('plus'))
          : el('span', { class: 'tag-menu-mark', 'aria-hidden': 'true' }, icon(option.opened ? 'down' : 'right')),
      el('span', { class: 'slash-menu-label' }, option.label),
      el('span', { class: 'slash-menu-later' }, option.note));
    }), ...(options.length ? [] : [el('div', { class: 'slash-menu-empty' }, typed ? 'No tag has those letters.' : allowNew ? 'No tags yet. Type a name to make the first one.' : 'No tags yet.')]));
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  };
  search.addEventListener('input', () => { index = 0; paint(); });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      index = (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      paint();
    }
    if (event.key === 'Enter') { event.preventDefault(); if (options[index]) pick(options[index]); }
  });
  paint();
  loadTags().then((loaded) => { data = loaded; paint(); }).catch(() => list.replaceChildren(el('div', { class: 'slash-menu-empty' }, "Your tags couldn't be loaded.")));
  return { close };
}

// ---- The row of tags on an item ----

// kind: note, entry, person, company, task or capture. Answers { element, refresh, close, put, tags }; refresh reads the
// item's tags again (after its words were saved: a #word may have put one on); put({ name }) puts one on (a tag your
// assistant suggested, tapped); tags() is what it carries now. onChange is told after each change. Nothing shows while
// Tags is off.
export function tagRow(kind, id, { tags = null, onChange = () => {} } = {}) {
  const place = el('div', { class: 'tag-row', 'data-kind': kind });
  if (!tagsOn()) { place.hidden = true; return { element: place, refresh: async () => {}, close: () => {}, put: async () => {}, tags: () => [] }; }
  let current = tags ?? [];
  let menu = null;
  const add = el('button', { type: 'button', class: 'tag-add', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => {
    if (menu) { menu.close(); menu = null; return; }
    menu = openMenu(place, add, { allowNew: true, placeholder: 'Find or make a tag', skip: new Set(current.map((t) => t.id)), choose: async (chosen) => {
      menu = null;
      try {
        await put(chosen);
        add.focus();
      } catch (err) { say(err.message || "That tag couldn't be put on."); }
    } });
  } }, icon('plus'), 'Tag');
  const status = el('span', { class: 'tag-row-status', role: 'status' });
  const say = (text) => { status.textContent = text; };
  function draw() {
    place.replaceChildren(...current.map((tag) => tagChip(tag, { onRemove: async () => {
      try {
        current = await request('POST', '/api/item-tags/remove', { kind, id, tag_id: tag.id });
        forgetTags();
        draw();
        onChange(current);
        say(tag.from_text ? `Took off ${tag.name}. It comes back while #${tag.name} is in the words.` : '');
        add.focus();
      } catch { say("That tag couldn't be taken off."); }
    } })), add, status);
  }
  async function put(chosen) {
    current = await request('POST', '/api/item-tags', { kind, id, ...(chosen.id ? { tag_id: chosen.id } : { name: chosen.name }) });
    forgetTags();
    draw();
    onChange(current);
  }
  const refresh = async () => {
    try { current = await request('GET', `/api/item-tags?kind=${kind}&id=${id}`); draw(); onChange(current); } catch { /* keeps what it shows */ }
  };
  draw();
  if (!tags) void refresh();
  return { element: place, refresh, put, tags: () => current, close: () => { menu?.close({ focus: false }); menu = null; } };
}

// ---- The Tags button over a list ----

export const tagsInAddress = () => (new URLSearchParams(location.search).get('tags') ?? '').split(',').filter((t) => /^[0-9a-f-]{36}$/.test(t));

// kind: what the list holds (for the counts). onChange(ids) when the picked tags change; the address keeps them.
// Answers { element, picked, ids(kind) } where ids answers the set of items of that kind that carry every picked tag.
export function tagFilter(kind, onChange, { label = 'Tags', inAddress = true, also = [] } = {}) {
  const place = el('div', { class: 'tag-filter' });
  if (!tagsOn()) { place.hidden = true; return { element: place, picked: () => [], ids: async () => null }; }
  let picked = inAddress ? tagsInAddress() : [];
  let known = new Map();
  let menu = null;
  const button = el('button', { type: 'button', class: 'tag-filter-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => {
    if (menu) { menu.close(); menu = null; return; }
    menu = openMenu(place, button, { skip: new Set([...picked, ...also]), counts: kind, choose: (tag) => { menu = null; picked = [...picked, tag.id]; known.set(tag.id, tag); changed(); } });
  } }, icon(label === 'Tags' ? 'tag' : 'plus'), label, ...(label === 'Tags' ? [icon('down')] : []));
  const keep = () => {
    if (!inAddress) return;
    const params = new URLSearchParams(location.search);
    if (picked.length) params.set('tags', picked.join(',')); else params.delete('tags');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest.replace(/%2C/g, ',')}` : ''}`);
  };
  const changed = () => { keep(); draw(); onChange(picked); };
  function draw() {
    place.replaceChildren(button, ...picked.map((id) => {
      const tag = known.get(id) ?? { id, name: '…', color: 'plain' };
      return tagChip(tag, { link: false, onRemove: () => { picked = picked.filter((p) => p !== id); changed(); button.focus(); } });
    }));
    place.classList.toggle('is-filtering', picked.length > 0);
  }
  draw();
  if (picked.length) loadTags().then(({ tags }) => { known = new Map(tags.map((t) => [t.id, t])); picked = picked.filter((id) => known.has(id)); draw(); }).catch(() => {});
  return {
    element: place,
    picked: () => picked,
    set: (ids) => { picked = ids; changed(); }, // #word typed in a search box
    ids: async (of = kind) => (picked.length ? new Set((await request('GET', `/api/tags/items?kind=${of}&tags=${picked.join(',')}`)).map((r) => r.id)) : null),
  };
}

// "#retreat" typed in a search box: the tag of that name, if there is one (then the box is cleared and the tag picked).
export async function tagNamed(text) {
  const m = String(text).trim().match(/^#([^\s#]+)$/u);
  if (!m || !tagsOn()) return null;
  try {
    const { tags } = await loadTags();
    return tags.find((t) => t.name.toLowerCase() === m[1].toLowerCase()) ?? null;
  } catch { return null; }
}

// Items found by tag (GET /api/tags/items or a tag's page), one line each: what it is and when or what state. Each opens it.
const DETAIL = {
  entry: (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''),
  task: (d) => (d === 'done' ? 'Done' : d === 'someday' ? 'Someday' : /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''),
  capture: (d) => (d === 'waiting' ? 'In the Inbox' : d === 'done' ? 'Done' : 'Sorted'),
};
export function taggedRow(item) {
  const detail = DETAIL[item.kind]?.(item.detail ?? '') ?? '';
  return el('a', { class: 'tagged-row', href: item.path, 'data-kind': item.kind },
    el('span', { class: 'tagged-row-title' }, String(item.title ?? '').replace(/\s+/g, ' ').trim() || 'Untitled'),
    ...(detail ? [el('span', { class: 'tagged-row-detail' }, detail)] : []));
}
