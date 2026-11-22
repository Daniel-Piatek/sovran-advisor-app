// Settings › Tags (module tags, 2026-11-22, the owner's wish): your tags and your groups, all in your hands.
//   Groups   make one, rename it, move it up or down, remove it (its tags stay, in no group; Undo puts them back)
//   Tags     rename one (a name another tag has offers to join the two), put it in a group, pin it to the sidebar, join it into another, or remove it (it comes
//            off every item, the items stay; Undo puts it back on exactly those), and give it a few words on what it is (2026-11-22)
//   Starter  one tap adds the Sovran tags: the 13 characters and the 5 Quests, each with its description and picture

import { el, icon, request, undoBar } from './ui.js';
import { fold } from './fold.js';
import { forgetTags, tagPicture } from './tags.js';
import { refreshSidebar } from './shell.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function tagsSection() {
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const undoPlace = el('div', {});
  const groupRows = el('div', { class: 'tag-settings-groups' });
  const tagRows = el('div', { class: 'tag-settings-list' });
  const find = el('input', { type: 'search', class: 'search-input', placeholder: 'Find a tag', 'aria-label': 'Find a tag in Settings', autocomplete: 'off', oninput: () => drawTags() });
  const tagFold = fold('tags-list', 'Your tags', el('label', { class: 'search tag-settings-find' }, icon('search'), find), tagRows);
  let data = { tags: [], groups: [] };

  // ---- The Sovran starter tags (2026-11-22, D's wish) ----
  const starter = el('div', { class: 'tag-settings-starter', hidden: true });
  async function drawStarter() {
    let state;
    try { state = await request('GET', '/api/tags/starter'); } catch { starter.hidden = true; return; }
    starter.hidden = state.there >= state.total;
    const missing = state.total - state.there;
    starter.replaceChildren(
      el('p', {}, state.there ? `${missing} of the Sovran starter tags aren't here yet.` : 'The Sovran starter tags: the 13 characters and the 5 Quests, each with a few words on what it is and its picture.'),
      el('button', { type: 'button', class: 'button', onclick: () => act(async () => { await request('POST', '/api/tags/starter', {}); await changed(); }) },
        state.there ? `Add the other ${missing}` : 'Add the Sovran starter tags'));
  }

  const changed = async () => { forgetTags(); await refreshSidebar(); await load(); };
  const act = async (work) => {
    problem.textContent = '';
    try { await work(); } catch (err) { problem.textContent = err.message || "That couldn't be done. Is the app still running?"; }
  };
  const offerUndo = (text, undo) => undoPlace.replaceChildren(undoBar(text, async () => { await undo(); undoPlace.replaceChildren(); await changed(); }));

  // ---- Groups ----
  const newGroup = el('input', { class: 'search-input', placeholder: 'New group, e.g. Characters', 'aria-label': 'New group’s name', maxlength: 60,
    onkeydown: (event) => { if (event.key === 'Enter' && newGroup.value.trim()) addGroup(); } });
  const addGroup = () => act(async () => { await request('POST', '/api/tag-groups', { name: newGroup.value }); newGroup.value = ''; await changed(); newGroup.focus(); });
  function drawGroups() {
    const groups = data.groups;
    groupRows.replaceChildren(...groups.map((g, i) => {
      const name = el('input', { class: 'detail-input tag-settings-name', value: g.name, 'aria-label': `Group name: ${g.name}`, maxlength: 60 });
      const save = () => { if (name.value.trim() && name.value.trim() !== g.name) act(async () => { await request('PATCH', `/api/tag-groups/${g.id}`, { name: name.value }); await changed(); }); };
      name.addEventListener('change', save);
      name.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } });
      const move = (by) => act(async () => {
        const order = [...groups];
        order.splice(i, 1);
        order.splice(i + by, 0, g);
        for (const [at, group] of order.entries()) if (group.position !== at + 1) await request('PATCH', `/api/tag-groups/${group.id}`, { position: at + 1 });
        await changed();
      });
      const count = data.tags.filter((t) => t.group_id === g.id).length;
      return el('div', { class: 'tag-settings-row', 'data-group-id': g.id },
        name,
        el('span', { class: 'tag-settings-count' }, `${count} ${count === 1 ? 'tag' : 'tags'}`),
        el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Move ${g.name} up`, title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Move ${g.name} down`, title: 'Move down', disabled: i === groups.length - 1, onclick: () => move(1) }, '↓'),
        el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Remove the group ${g.name}`, onclick: () => act(async () => {
          await request('DELETE', `/api/tag-groups/${g.id}`);
          offerUndo(`Group “${g.name}” removed. Its tags stay, in no group.`, () => request('POST', `/api/tag-groups/${g.id}/restore`, {}));
          await changed();
        }) }, icon('trash')));
    }), el('div', { class: 'tag-settings-row' }, el('label', { class: 'search' }, icon('plus'), newGroup),
      el('button', { type: 'button', class: 'button', onclick: () => { if (newGroup.value.trim()) addGroup(); } }, 'Add group')));
  }

  // ---- Tags ----
  function drawTags() {
    const typed = find.value.trim().toLowerCase();
    const tags = [...data.tags].sort(byName).filter((t) => !typed || t.name.toLowerCase().includes(typed));
    tagFold.say(data.tags.length, ['tag', 'tags']);
    tagRows.replaceChildren(...(tags.length ? tags.map((tag) => {
      const name = el('input', { class: 'detail-input tag-settings-name', value: tag.name, 'aria-label': `Tag name: ${tag.name}`, maxlength: 60 });
      const note = el('span', { class: 'tag-settings-note', role: 'status' });
      const rename = () => {
        if (!name.value.trim() || name.value.trim() === tag.name) return;
        act(async () => {
          try { await request('PATCH', `/api/tags/${tag.id}`, { name: name.value }); await changed(); } catch (err) {
            if (err.status !== 409) throw err;
            const other = data.tags.find((t) => t.name.toLowerCase() === name.value.trim().toLowerCase());
            note.replaceChildren(`There is a tag called “${name.value.trim()}” already.`, ...(other ? [' ', el('button', { type: 'button', class: 'button', onclick: () => join(tag, other) }, `Join into ${other.name}`)] : []));
          }
        });
      };
      name.addEventListener('change', rename);
      name.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } });
      const group = el('select', { class: 'detail-input', 'aria-label': `Group of ${tag.name}`, onchange: () => act(async () => { await request('PATCH', `/api/tags/${tag.id}`, { group_id: group.value || null }); await changed(); }) },
        el('option', { value: '' }, 'No group'), ...data.groups.map((g) => el('option', { value: g.id }, g.name)));
      group.value = tag.group_id ?? '';
      const into = el('select', { class: 'detail-input', 'aria-label': `Join ${tag.name} into another tag`, onchange: () => { const other = data.tags.find((t) => t.id === into.value); if (other) join(tag, other); } },
        el('option', { value: '' }, 'Join into…'), ...data.tags.filter((t) => t.id !== tag.id).sort(byName).map((t) => el('option', { value: t.id }, t.name)));
      const about = el('textarea', { class: 'detail-input tag-settings-description', rows: 1, maxlength: 1000, placeholder: 'A few words on what this tag is', 'aria-label': `Description of ${tag.name}` });
      about.value = tag.description ?? '';
      about.addEventListener('change', () => act(async () => { await request('PATCH', `/api/tags/${tag.id}`, { description: about.value }); forgetTags(); note.textContent = 'Description saved.'; }));
      return el('div', { class: 'tag-settings-row', 'data-tag-id': tag.id },
        tagPicture(tag, { small: true }),
        name,
        el('span', { class: 'tag-settings-count' }, `${tag.count} ${tag.count === 1 ? 'item' : 'items'}`),
        group,
        el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(tag.pinned), title: tag.pinned ? 'Pinned to the sidebar' : 'Pin to the sidebar',
          onclick: () => act(async () => { await request('PATCH', `/api/tags/${tag.id}`, { pinned: !tag.pinned }); await changed(); }) }, icon('pin'), tag.pinned ? 'Pinned' : 'Pin'),
        into,
        el('button', { type: 'button', class: 'button button-quiet', 'aria-label': `Remove the tag ${tag.name}`, onclick: () => act(async () => {
          await request('DELETE', `/api/tags/${tag.id}`);
          offerUndo(`Tag “${tag.name}” removed from ${tag.count} ${tag.count === 1 ? 'item' : 'items'}. The items are untouched.`, () => request('POST', `/api/tags/${tag.id}/restore`, {}));
          await changed();
        }) }, icon('trash')),
        about,
        note);
    }) : [el('p', { class: 'empty' }, data.tags.length ? 'No tag has those letters.' : 'No tags yet. Put one on a note with + Tag, or type #word in your writing.')]));
  }
  const join = (tag, other) => act(async () => {
    await request('POST', `/api/tags/${tag.id}/join`, { into: other.id });
    offerUndo(`“${tag.name}” joined into “${other.name}”.`, () => request('POST', `/api/tags/${tag.id}/restore`, {}));
    await changed();
  });

  async function load() {
    try { data = await request('GET', '/api/tags'); } catch { problem.textContent = "Your tags couldn't be loaded. Is the app still running?"; return; }
    drawGroups();
    drawTags();
    await drawStarter();
  }
  void load();

  return el('section', { class: 'settings-part', 'aria-label': 'Tags', id: 'tags' },
    el('h2', { class: 'settings-title' }, 'Tags'),
    el('p', { class: 'empty' }, 'Your groups and your tags. A group holds as many or as few tags as you like; a tag is in one group or none.'),
    starter,
    el('h3', { class: 'settings-subtitle' }, 'Groups'),
    groupRows,
    el('h3', { class: 'settings-subtitle' }, 'Tags'),
    tagFold,
    undoPlace,
    problem);
}
