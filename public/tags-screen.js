// The Tags tab of Notes (module tags, 2026-11-22, the owner's wish).
//   /tags       every tag, in your groups (and the ones in no group), each with how many items carry it; a box finds one
//   /tags/:id   one tag, like a contents page: a heading per kind (Notes 34, Journal 120…) with only the newest two under
//               it. "Open all" opens that kind's own screen narrowed to the tag; "Narrow with another tag" cuts it further.
//               Pin to sidebar puts the tag under Notes in the sidebar.
// Renaming, joining and grouping tags is in Settings › Tags.

import { el, icon, request } from './ui.js';
import { app, screen, setFooterLink, refreshSidebar } from './shell.js';
import { notesTabs } from './notes-screens.js';
import { tagChip, tagFilter, taggedRow, loadTags, forgetTags, tagMark } from './tags.js';

// Where Open all goes: that kind's own screen, with the tags picked.
const SCREENS = { note: '/', entry: '/journal', person: '/people', company: '/companies', task: '/tasks', capture: '/inbox' };
const fits = (name, typed) => typed.toLowerCase().split(/\s+/).filter(Boolean).every((word) => name.toLowerCase().includes(word));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function showTags(id) {
  if (id) return showTag(id);
  document.title = 'Tags';
  app.className = 'page page-wide notes-page';
  const search = el('input', { type: 'search', class: 'search-input', placeholder: 'Find a tag', 'aria-label': 'Find a tag', autocomplete: 'off', oninput: () => draw() });
  const content = el('div', { class: 'tags-index' });
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Notes'), el('label', { class: 'search' }, icon('search'), search)),
    notesTabs('tags'),
    content,
  );
  setFooterLink(el('a', { class: 'footer-link', href: '/settings' }, 'Rename and group tags in Settings'));

  let data;
  try { data = await loadTags({ fresh: true }); } catch {
    content.replaceChildren(el('p', { class: 'empty' }, "Your tags couldn't be loaded. Is the app still running?"));
    return;
  }
  function draw() {
    const typed = search.value.trim();
    const shown = data.tags.filter((t) => !typed || fits(t.name, typed)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (!data.tags.length) {
      content.replaceChildren(el('p', { class: 'empty' }, 'No tags yet. Put one on a note, a journal entry or a person with + Tag, or type #word in your writing.'));
      return;
    }
    const line = (tag) => el('a', { class: 'tags-index-row', href: `/tags/${tag.id}` },
      tagMark(),
      el('span', { class: 'tags-index-name' }, tag.name),
      ...(tag.pinned ? [el('span', { class: 'tags-index-pinned', title: 'Pinned to the sidebar', 'aria-label': 'Pinned' }, icon('pin'))] : []),
      el('span', { class: 'tags-index-count' }, plural(tag.count, 'item', 'items')));
    const part = (title, tags, extra = '') => (tags.length ? [el('section', { class: 'tags-index-group', 'aria-label': title },
      el('h2', { class: 'tags-index-heading' }, title, el('span', { class: 'tags-index-heading-count' }, extra || plural(tags.length, 'tag', 'tags'))),
      el('div', { class: 'tags-index-list' }, ...tags.map(line)))] : []);
    const groups = data.groups.flatMap((g) => part(g.name, shown.filter((t) => t.group_id === g.id)));
    const loose = shown.filter((t) => !t.group_id);
    content.replaceChildren(...groups, ...part(data.groups.length ? 'Not in a group' : 'Every tag', loose),
      ...(shown.length ? [] : [el('p', { class: 'empty' }, `No tag has “${typed}”.`)]));
  }
  draw();
}

async function showTag(id) {
  document.title = 'Tag';
  app.className = 'page page-wide notes-page';
  const heading = el('div', { class: 'tag-page-head' });
  const content = el('div', { class: 'tag-page' });
  const status = el('p', { class: 'journal-tools-message', role: 'status' });
  const narrow = tagFilter('all', () => load(), { label: 'Narrow with another tag', inAddress: false, also: [id] });
  screen.replaceChildren(
    el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Notes')),
    notesTabs('tags'),
    heading,
    narrow.element,
    status,
    content,
  );
  setFooterLink(el('a', { class: 'footer-link', href: '/settings' }, 'Rename and group tags in Settings'));

  async function load() {
    let page;
    let groups = [];
    try {
      [page, { groups }] = await Promise.all([request('GET', `/api/tags/${id}${narrow.picked().length ? `?and=${narrow.picked().join(',')}` : ''}`), loadTags()]);
    } catch (err) {
      content.replaceChildren(el('p', { class: 'empty' }, err.status === 404 ? 'This tag was removed. It can be brought back in Settings › Tags with Undo, just after.' : "This tag couldn't be loaded. Is the app still running?"));
      return;
    }
    const { tag } = page;
    document.title = `Tag · ${tag.name}`;
    const group = groups.find((g) => g.id === tag.group_id);
    const pin = el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(tag.pinned), onclick: async () => {
      try {
        await request('PATCH', `/api/tags/${id}`, { pinned: !tag.pinned });
        forgetTags();
        refreshSidebar();
        await load();
      } catch { status.textContent = "That couldn't be changed. Is the app still running?"; }
    } }, icon('pin'), tag.pinned ? 'Pinned to the sidebar' : 'Pin to the sidebar');
    heading.replaceChildren(
      el('p', { class: 'tag-page-path' }, el('a', { href: '/tags' }, 'Tags'), ...(group ? [' › ', group.name] : []), ' › ', tag.name),
      el('h2', { class: 'tag-page-title' }, tagMark(), tag.name),
      el('p', { class: 'tag-page-count' }, plural(page.total, 'item', 'items'), ...(page.and.length ? [` with ${page.and.map((t) => t.name).join(' and ')} too`] : [])),
      pin);
    const tags = [id, ...narrow.picked()].join(',');
    content.replaceChildren(...(page.kinds.length ? page.kinds.map((k) => el('section', { class: 'tag-page-kind', 'aria-label': k.label },
      el('div', { class: 'tag-page-kind-head' },
        el('h3', { class: 'tag-page-kind-title' }, k.label, el('span', { class: 'tag-page-kind-count' }, String(k.count))),
        el('a', { class: 'tag-page-open', href: `${SCREENS[k.kind]}?tags=${tags}` }, k.count > k.newest.length ? `Open all ${k.count}` : 'Open', icon('right'))),
      el('div', { class: 'tagged-list' }, ...k.newest.map(taggedRow))))
      : [el('p', { class: 'empty' }, page.and.length ? 'Nothing carries all these tags.' : 'Nothing carries this tag now.')]));
  }
  await load();
}

// A tag pinned to the sidebar: its chip, for shell.js.
export const pinnedTagChip = (tag) => tagChip(tag);
