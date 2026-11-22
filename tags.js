// Tags (2026-11-22, the owner's wish; module `tags`): one list of tags shared by everything. A tag such as "retreat" can
// sit on a note, a journal entry, a person, a company, an Inbox item and a task; opening it shows all of them together.
//   tags        the tags: a name (two that differ only in capitals or spaces are the same tag: name_key), a colour from
//               the kinds' colours (TAG_COLORS, never the accent), at most one group, and pinned (shown in the sidebar)
//   tag_groups  groups the owner makes, names and fills: any number, any size, one level (no groups inside groups)
//   item_tags   which item carries which tag. from_text: put there by typing #word in the item's words (notes, journal
//               entries, people's and companies' notes, Inbox items), so it goes again when the #word is taken out
// Nothing is really removed. Removing a tag marks it and its item_tags deleted at one time, so Undo brings back exactly
// those; the items themselves are never touched. Joining a tag into another moves its items over (moved_from keeps
// where each came from) and can be undone the same way.

import { randomUUID } from 'node:crypto';
import { moduleOn } from './modules.js';

const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = (rows) => rows.map((row) => ({ ...row }));

export const TAG_COLORS = ['plain', 'notes', 'journal', 'tasks', 'time', 'people', 'life', 'goal']; // the kinds' colours (tokens.css --kind-*)
export const MAX_TAG_NAME = 60;
export const MAX_GROUP_NAME = 60;
const NEWEST_SHOWN = 2; // a tag's page shows the newest two of each kind; Open all shows the rest on that kind's screen
const MAX_ITEMS = 2000;

// The kinds that can carry a tag: where each lives, what it is called and where it opens. order: newest first.
export const TAG_KINDS = {
  note: { table: 'notes', label: 'Notes', title: "CASE WHEN trim(x.title) = '' THEN 'Untitled' ELSE x.title END", detail: 'substr(x.body, 1, 160)', order: 'x.updated_at', path: (r) => `/notes/${r.id}` },
  entry: { table: 'journal_entries', label: 'Journal', title: "CASE WHEN trim(x.title) = '' THEN substr(x.body, 1, 80) ELSE x.title END", detail: 'x.day', order: 'x.day DESC, x.created_at', path: (r) => `/journal/entries/${r.id}` },
  person: { table: 'people', label: 'People', title: 'x.name', detail: "''", order: 'x.name COLLATE NOCASE', asc: true, path: (r) => `/people/${r.id}` },
  company: { table: 'companies', label: 'Companies', title: 'x.name', detail: "''", order: 'x.name COLLATE NOCASE', asc: true, path: (r) => `/companies/${r.id}` },
  task: { table: 'tasks', label: 'Tasks', title: 'x.text', detail: "CASE WHEN x.done = 1 THEN 'done' ELSE x.due END", order: 'x.updated_at', path: (r) => `/tasks?open=${r.id}` },
  capture: { table: 'captures', label: 'Inbox', title: 'substr(x.body, 1, 120)', detail: 'x.state', order: 'x.captured_at', where: "x.state = 'waiting'", path: (r) => `/inbox?c=${r.id}` }, // once sorted, what it became carries its tags
};
export const KIND_ORDER = ['note', 'entry', 'person', 'company', 'task', 'capture'];

// "Retreat ", "retreat" and "RETREAT" are one tag; a leading # is not part of the name.
export const cleanName = (name) => String(name ?? '').normalize('NFC').replace(/^#+/, '').replace(/\s+/g, ' ').trim();
export const nameKey = (name) => cleanName(name).toLowerCase();

export function checkTagName(name) {
  if (typeof name !== 'string') return 'A tag’s name is text.';
  const clean = cleanName(name);
  if (!clean) return 'A tag needs a name.';
  if (clean.length > MAX_TAG_NAME) return `A tag’s name is at most ${MAX_TAG_NAME} characters.`;
  return null;
}

// ---- #words in text ----

// Every #word in a text, as tag names, first spelling kept: #retreat, #client-sessions, #2027-plans (a word with at
// least one letter). Not a heading (# and a space), not inside `code` or a code block, not in the middle of a word or a
// web address (page#part), and not a colour like #fff... only when it has a letter, which a colour also has: #fff is a
// tag. Markdown may write a # at the start of a line as \#: that is still the word typed.
const TEXT_TAG = /(^|[\s([{>"'“‘*_~])\\?#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;
export function textTags(markdown) {
  const text = String(markdown ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\]\([^)]*\)/g, '] ');
  const found = new Map();
  for (const match of text.matchAll(TEXT_TAG)) {
    const name = match[2].replace(/[-/_]+$/, '');
    if (!/\p{L}/u.test(name) || name.length > MAX_TAG_NAME) continue;
    const key = nameKey(name);
    if (!found.has(key)) found.set(key, name);
  }
  return [...found.values()];
}

// ---- Tags ----

const TAG_COLUMNS = 't.id, t.name, t.color, t.group_id, t.pinned, t.description, t.picture, t.created_at, t.updated_at, t.deleted_at';
export const MAX_TAG_DESCRIPTION = 1000;

// A tag's picture (2026-11-22, D's wish): nothing, a picture kept in the app's files (its SHA-256), or one of the Sovran
// pictures of the starter tags ("sovran:medusa"), fetched once from the Sovran cloud with the library key (tag-pictures.js).
export const SOVRAN_PICTURES = ['medusa', 'gremlin', 'werewolf', 'mummy', 'zombie', 'tyrant', 'gollum', 'vampire', 'kraken', 'manticore', 'troll', 'gryphon', 'mystic',
  'hero', 'phoenix', 'quantum', 'sovran', 'destiny'];
export const pictureUrl = (picture) => (/^[0-9a-f]{64}$/.test(picture ?? '') ? `/files/${picture}`
  : /^sovran:[a-z]+$/.test(picture ?? '') ? `/api/tag-pictures/${picture.slice(7)}` : null);
const shown = (t) => ({ ...t, pinned: Boolean(t.pinned), picture_url: pictureUrl(t.picture) });

function liveGroup(db, id) {
  return id ? db.prepare('SELECT id FROM tag_groups WHERE id = ? AND deleted_at IS NULL').get(id) ?? null : null;
}

export function getTag(db, id, { deleted = false } = {}) {
  const tag = db.prepare(`SELECT ${TAG_COLUMNS} FROM tags t WHERE t.id = ? ${deleted ? '' : 'AND t.deleted_at IS NULL'}`).get(id);
  if (!tag) return null;
  return { ...shown(tag), group_id: liveGroup(db, tag.group_id)?.id ?? null };
}

const findByKey = (db, key) => db.prepare('SELECT id FROM tags WHERE name_key = ? AND deleted_at IS NULL').get(key)?.id ?? null;

// Every tag with how many items carry it (all and by kind), most used first, and the groups in their order. A tag in a
// group that was removed counts as in no group.
export function listTags(db) {
  const counts = db.prepare(`SELECT tag_id, item_kind, count(*) AS n FROM item_tags it
    WHERE it.deleted_at IS NULL AND ${KIND_ORDER.map((k) => `(it.item_kind = '${k}' AND EXISTS (SELECT 1 FROM ${TAG_KINDS[k].table} x WHERE x.id = it.item_id AND x.deleted_at IS NULL${TAG_KINDS[k].where ? ` AND ${TAG_KINDS[k].where}` : ''}))`).join(' OR ')}
    GROUP BY tag_id, item_kind`).all();
  const by = new Map();
  for (const c of counts) {
    const entry = by.get(c.tag_id) ?? { count: 0, counts: {} };
    entry.count += c.n;
    entry.counts[c.item_kind] = c.n;
    by.set(c.tag_id, entry);
  }
  const groups = plain(db.prepare('SELECT id, name, position, created_at, updated_at FROM tag_groups WHERE deleted_at IS NULL ORDER BY position, name COLLATE NOCASE').all());
  const groupIds = new Set(groups.map((g) => g.id));
  const tags = db.prepare(`SELECT ${TAG_COLUMNS} FROM tags t WHERE t.deleted_at IS NULL`).all()
    .map((t) => ({ ...shown(t), group_id: groupIds.has(t.group_id) ? t.group_id : null, count: by.get(t.id)?.count ?? 0, counts: by.get(t.id)?.counts ?? {} }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { tags, groups };
}

// Finds the tag with this name, or makes it. Returns the tag.
export function ensureTag(db, name, { origin = 'typed', color, group_id: groupId } = {}) {
  const problem = checkTagName(name);
  if (problem) throw fail(400, problem);
  const key = nameKey(name);
  const found = findByKey(db, key);
  if (found) return getTag(db, found);
  if (color !== undefined && !TAG_COLORS.includes(color)) throw fail(400, `A tag’s colour is one of ${TAG_COLORS.join(', ')}.`);
  if (groupId && !liveGroup(db, groupId)) throw fail(400, 'There is no such group.');
  const id = randomUUID();
  const time = now();
  db.prepare('INSERT INTO tags (id, created_at, updated_at, origin, name, name_key, color, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, time, time, origin, cleanName(name), key, color ?? 'plain', groupId || null);
  return getTag(db, id);
}

// Changes a tag's name, colour, group, pin, description or picture. A name another tag already has is refused (409): join them instead.
export function updateTag(db, id, input) {
  const tag = getTag(db, id);
  if (!tag) return null;
  const next = { name: tag.name, color: tag.color, group_id: tag.group_id, pinned: tag.pinned, description: tag.description, picture: tag.picture };
  if ('name' in input) {
    const problem = checkTagName(input.name);
    if (problem) throw fail(400, problem);
    const other = findByKey(db, nameKey(input.name));
    if (other && other !== id) throw Object.assign(fail(409, `There is a tag called “${cleanName(input.name)}” already. Join the two instead.`), { other });
    next.name = cleanName(input.name);
  }
  if ('color' in input) {
    if (!TAG_COLORS.includes(input.color)) throw fail(400, `A tag’s colour is one of ${TAG_COLORS.join(', ')}.`);
    next.color = input.color;
  }
  if ('group_id' in input) {
    if (input.group_id !== null && typeof input.group_id !== 'string') throw fail(400, 'group_id is a group’s id, or null.');
    if (input.group_id && !liveGroup(db, input.group_id)) throw fail(400, 'There is no such group.');
    next.group_id = input.group_id || null;
  }
  if ('pinned' in input) {
    if (typeof input.pinned !== 'boolean') throw fail(400, 'pinned is true or false.');
    next.pinned = input.pinned;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string') throw fail(400, 'description is words.');
    const words = input.description.replace(/\r\n?/g, '\n').trim();
    if (words.length > MAX_TAG_DESCRIPTION) throw fail(400, `A tag’s description is at most ${MAX_TAG_DESCRIPTION} characters.`);
    next.description = words;
  }
  if ('picture' in input) {
    const picture = input.picture ?? '';
    if (picture && !pictureUrl(picture)) throw fail(400, 'picture is a kept picture’s SHA-256, a Sovran picture, or nothing.');
    if (/^[0-9a-f]{64}$/.test(picture) && !db.prepare("SELECT 1 FROM files WHERE sha256 = ? AND type LIKE 'image/%'").get(picture)) throw fail(400, 'That picture isn’t kept here.');
    if (picture.startsWith('sovran:') && !SOVRAN_PICTURES.includes(picture.slice(7))) throw fail(400, 'There is no such Sovran picture.');
    next.picture = picture;
  }
  db.prepare('UPDATE tags SET name = ?, name_key = ?, color = ?, group_id = ?, pinned = ?, description = ?, picture = ?, updated_at = ? WHERE id = ?')
    .run(next.name, nameKey(next.name), next.color, next.group_id, next.pinned ? 1 : 0, next.description, next.picture, now(), id);
  return getTag(db, id);
}

// Removing a tag takes it off every item (the items stay as they are). Undo (restoreTag) puts it back on exactly those.
export function deleteTag(db, id) {
  const tag = getTag(db, id);
  if (!tag) return null;
  const time = now();
  db.prepare('UPDATE item_tags SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL').run(time, time, id);
  db.prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, id);
  return getTag(db, id, { deleted: true });
}

export function restoreTag(db, id) {
  const tag = getTag(db, id, { deleted: true });
  if (!tag) return null;
  if (!tag.deleted_at) return tag;
  if (findByKey(db, nameKey(tag.name))) throw fail(409, `There is a tag called “${tag.name}” again now. Join the two instead.`);
  const time = now();
  // Joined into another tag (joinTags): the items it gave away come back too.
  db.prepare('UPDATE item_tags SET tag_id = ?, moved_from = NULL, updated_at = ? WHERE moved_from = ? AND deleted_at IS NULL').run(id, time, id);
  db.prepare('UPDATE item_tags SET deleted_at = NULL, updated_at = ? WHERE tag_id = ? AND deleted_at = ?').run(time, id, tag.deleted_at);
  db.prepare('UPDATE tags SET deleted_at = NULL, merged_into = NULL, updated_at = ? WHERE id = ?').run(time, id);
  return getTag(db, id);
}

// Joins one tag into another: every item with `from` gets `into` instead (once), and `from` goes. Undo: restoreTag(from).
export function joinTags(db, fromId, intoId) {
  if (fromId === intoId) throw fail(400, 'Pick another tag to join it into.');
  const from = getTag(db, fromId);
  const into = getTag(db, intoId);
  if (!from || !into) throw fail(404, 'No such tag');
  const time = now();
  db.exec('SAVEPOINT join_tags');
  try {
    // An item that already has both keeps the one it has; its row of `from` goes with the tag (and comes back on Undo).
    db.prepare(`UPDATE item_tags SET tag_id = ?, moved_from = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM item_tags o WHERE o.tag_id = ? AND o.item_kind = item_tags.item_kind AND o.item_id = item_tags.item_id AND o.deleted_at IS NULL)`)
      .run(intoId, fromId, time, fromId, intoId);
    db.prepare('UPDATE item_tags SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL').run(time, time, fromId);
    db.prepare('UPDATE tags SET deleted_at = ?, merged_into = ?, updated_at = ? WHERE id = ?').run(time, intoId, time, fromId);
    db.exec('RELEASE join_tags');
  } catch (err) { db.exec('ROLLBACK TO join_tags'); db.exec('RELEASE join_tags'); throw err; }
  return { from: getTag(db, fromId, { deleted: true }), into: getTag(db, intoId) };
}

// ---- Groups ----

export function checkGroupName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'A group needs a name.';
  if (name.trim().length > MAX_GROUP_NAME) return `A group’s name is at most ${MAX_GROUP_NAME} characters.`;
  return null;
}

const getGroup = (db, id, { deleted = false } = {}) => {
  const row = db.prepare(`SELECT id, name, position, created_at, updated_at, deleted_at FROM tag_groups WHERE id = ? ${deleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
  return row ? { ...row } : null;
};

export function createGroup(db, { name }) {
  const problem = checkGroupName(name);
  if (problem) throw fail(400, problem);
  const id = randomUUID();
  const time = now();
  const { n } = db.prepare('SELECT coalesce(max(position), 0) + 1 AS n FROM tag_groups').get();
  db.prepare('INSERT INTO tag_groups (id, created_at, updated_at, name, position) VALUES (?, ?, ?, ?, ?)').run(id, time, time, name.trim(), n);
  return getGroup(db, id);
}

export function updateGroup(db, id, input) {
  const group = getGroup(db, id);
  if (!group) return null;
  const name = 'name' in input ? input.name : group.name;
  const problem = checkGroupName(name);
  if (problem) throw fail(400, problem);
  const position = 'position' in input ? input.position : group.position;
  if (!Number.isInteger(position)) throw fail(400, 'position is a whole number.');
  db.prepare('UPDATE tag_groups SET name = ?, position = ?, updated_at = ? WHERE id = ?').run(name.trim(), position, now(), id);
  return getGroup(db, id);
}

// Removing a group keeps its tags (they are in no group then); Undo puts them back in it.
export function deleteGroup(db, id) {
  const group = getGroup(db, id);
  if (!group) return null;
  db.prepare('UPDATE tag_groups SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return getGroup(db, id, { deleted: true });
}

export function restoreGroup(db, id) {
  const group = getGroup(db, id, { deleted: true });
  if (!group) return null;
  db.prepare('UPDATE tag_groups SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  return getGroup(db, id);
}

// ---- Starter tags (2026-11-22, D's list) ----

// The 13 characters and the 5 Quests, each in its group, with a few words and a Sovran picture. The characters' words are
// the brand's own (live-sovran-brand, BRAND.md, "Represents"); the Quests' come from D's teaching (The Quests, 2026-08-30).
// Added with one tap in Settings › Tags, never by themselves; a tag that is already there keeps its own words, picture and group.
export const STARTER_TAGS = [
  { group: 'Characters', tags: [
    ['Medusa', 'Fear, anxiety, worry; overwhelm, numbness, dissociation.'],
    ['Gremlin', 'Agitating thoughts, emotions, feelings and sensations: the mischievous troublemaker.'],
    ['Werewolf', 'Animalistic drives and desires.'],
    ['Mummy', 'Feeling stuck, trapped and hopeless.'],
    ['Zombie', 'Unresolved trauma from the past.'],
    ['Tyrant', 'The harsh critic, judge and executioner.'],
    ['Gollum', 'Shame, self-loathing and regret.'],
    ['Vampire', 'Predatory people and situations.'],
    ['Kraken', 'A persistent, soul-level theme that is pervasive.'],
    ['Manticore', 'Self-doubt, impostor syndrome, hesitation and unworthiness.'],
    ['Troll', 'The Voice of Autopilot: the incessant narrator and commentator.'],
    ['Gryphon', 'Protector and liberator of the Sovran Throne.'],
    ['Mystic', 'Complete trust in life: deep peace while fully engaging with life.'],
  ] },
  { group: 'Quests', tags: [
    ['Hero', 'The Hero Quest: 6 weeks. It teaches and trains STOP. Take command and come to your own rescue.'],
    ['Phoenix', 'The Phoenix Quest: 6 weeks. It teaches and trains Unraveling, building on STOP. A partner for life.'],
    ['Quantum', 'The Quantum Quest: 12 weeks. It teaches and trains Not-Knowing, building on STOP and Unraveling.'],
    ['Sovran', 'The Sovran Quest: 12 weeks. The Hero and Phoenix Quests, with more of its own. It initiates Sovran Vocation.'],
    ['Destiny', 'The Destiny Quest: 12 weeks. Actualize Sovran Vocation: creating your original offer.'],
  ] },
];

// Which starter tags are there already (by name), for Settings to say what one tap would add.
export function starterState(db) {
  const all = STARTER_TAGS.flatMap((g) => g.tags.map(([name]) => name));
  const there = all.filter((name) => findByKey(db, nameKey(name)));
  return { total: all.length, there: there.length };
}

export function addStarterTags(db) {
  let added = 0;
  db.exec('SAVEPOINT starter_tags');
  try {
    for (const { group, tags } of STARTER_TAGS) {
      const groupId = db.prepare('SELECT id FROM tag_groups WHERE lower(name) = lower(?) AND deleted_at IS NULL').get(group)?.id ?? createGroup(db, { name: group }).id;
      for (const [name, description] of tags) {
        const before = findByKey(db, nameKey(name));
        const tag = before ? getTag(db, before) : ensureTag(db, name, { group_id: groupId });
        if (!before) added += 1;
        updateTag(db, tag.id, {
          ...(tag.description ? {} : { description }),
          ...(tag.picture ? {} : { picture: `sovran:${name.toLowerCase()}` }),
          ...(tag.group_id ? {} : { group_id: groupId }),
        });
      }
    }
    db.exec('RELEASE starter_tags');
  } catch (err) { db.exec('ROLLBACK TO starter_tags'); db.exec('RELEASE starter_tags'); throw err; }
  return { added, ...starterState(db) };
}

// ---- Tags on items ----

export const checkItem = (kind, id) => (!TAG_KINDS[kind] ? 'kind is note, entry, person, company, task or capture.'
  : typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) ? 'id is the item’s id.' : null);

const itemExists = (db, kind, id) => Boolean(db.prepare(`SELECT 1 FROM ${TAG_KINDS[kind].table} WHERE id = ? AND deleted_at IS NULL`).get(id));

// An item's tags, in the order they were put on.
export function tagsOf(db, kind, id) {
  return db.prepare(`SELECT ${TAG_COLUMNS}, it.from_text FROM item_tags it JOIN tags t ON t.id = it.tag_id AND t.deleted_at IS NULL
    WHERE it.item_kind = ? AND it.item_id = ? AND it.deleted_at IS NULL ORDER BY it.created_at, it.rowid`).all(kind, id)
    .map((t) => ({ ...t, pinned: Boolean(t.pinned), from_text: Boolean(t.from_text) }));
}

function putOn(db, tagId, kind, id, { fromText = false, origin = 'typed' } = {}) {
  if (db.prepare('SELECT 1 FROM item_tags WHERE tag_id = ? AND item_kind = ? AND item_id = ? AND deleted_at IS NULL').get(tagId, kind, id)) return;
  const time = now();
  db.prepare('INSERT INTO item_tags (id, created_at, updated_at, origin, tag_id, item_kind, item_id, from_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), time, time, origin, tagId, kind, id, fromText ? 1 : 0);
}

// Puts a tag on an item: { tag_id } or { name } (a new name makes the tag). Answers the item's tags.
export function addItemTag(db, kind, id, { tag_id: tagId, name, origin = 'typed' }) {
  const problem = checkItem(kind, id);
  if (problem) throw fail(400, problem);
  if (!itemExists(db, kind, id)) throw fail(404, 'There is no such item.');
  const tag = tagId ? getTag(db, tagId) : ensureTag(db, name, { origin });
  if (!tag) throw fail(404, 'No such tag');
  putOn(db, tag.id, kind, id, { origin });
  return tagsOf(db, kind, id);
}

export function removeItemTag(db, kind, id, tagId) {
  const problem = checkItem(kind, id);
  if (problem) throw fail(400, problem);
  const time = now();
  db.prepare('UPDATE item_tags SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND item_kind = ? AND item_id = ? AND deleted_at IS NULL').run(time, time, tagId, kind, id);
  return tagsOf(db, kind, id);
}

// Makes an item's #word tags match its words: a #word typed puts its tag on (making the tag if it is new); a #word taken
// out takes off the tag it put on. A tag put on from the tag row is never taken off here. Nothing happens while Tags is off.
export function syncTextTags(db, kind, id, markdown) {
  if (!TAG_KINDS[kind] || !moduleOn(db, 'tags')) return;
  const wanted = new Map(textTags(markdown).map((name) => [nameKey(name), name]));
  const rows = db.prepare(`SELECT it.id, it.from_text, t.name_key FROM item_tags it JOIN tags t ON t.id = it.tag_id AND t.deleted_at IS NULL
    WHERE it.item_kind = ? AND it.item_id = ? AND it.deleted_at IS NULL`).all(kind, id);
  const has = new Set(rows.map((r) => r.name_key));
  const time = now();
  for (const row of rows) {
    if (row.from_text && !wanted.has(row.name_key)) db.prepare('UPDATE item_tags SET deleted_at = ?, updated_at = ? WHERE id = ?').run(time, time, row.id);
  }
  for (const [key, name] of wanted) if (!has.has(key)) putOn(db, ensureTag(db, name).id, kind, id, { fromText: true });
}

// What a capture was made into carries its tags (an Inbox item sorted into a note, an entry or a task).
export function copyItemTags(db, fromKind, fromId, toKind, toId) {
  if (!TAG_KINDS[toKind]) return;
  for (const tag of tagsOf(db, fromKind, fromId)) putOn(db, tag.id, toKind, toId);
}

// ---- Finding by tag ----

// The items that carry every one of these tags, of one kind, newest first (people and companies by name).
export function itemsWithTags(db, tagIds, kind, { limit = MAX_ITEMS } = {}) {
  const k = TAG_KINDS[kind];
  if (!k) throw fail(400, 'kind is note, entry, person, company, task or capture.');
  const ids = [...new Set(tagIds)].filter(Boolean);
  if (!ids.length) return [];
  const has = ids.map(() => 'EXISTS (SELECT 1 FROM item_tags it WHERE it.item_kind = ? AND it.item_id = x.id AND it.tag_id = ? AND it.deleted_at IS NULL)').join(' AND ');
  const params = ids.flatMap((tagId) => [kind, tagId]);
  const order = k.order.split(',').map((part) => (part.includes('DESC') ? part : `${part} ${k.asc ? 'ASC' : 'DESC'}`)).join(',');
  return db.prepare(`SELECT x.id, ${k.title} AS title, ${k.detail} AS detail FROM ${k.table} x
    WHERE x.deleted_at IS NULL ${k.where ? `AND ${k.where}` : ''} AND ${has} ORDER BY ${order} LIMIT ?`).all(...params, limit)
    .map((r) => ({ ...r, kind, path: k.path(r) }));
}

// A tag's page: for each kind that has any, how many and the newest two. With `and`, only items that carry those too.
export function tagOverview(db, id, { and = [] } = {}) {
  const tag = getTag(db, id);
  if (!tag) return null;
  const ids = [id, ...and.filter((other) => other !== id && getTag(db, other))];
  const kinds = KIND_ORDER.map((kind) => {
    const items = itemsWithTags(db, ids, kind);
    return { kind, label: TAG_KINDS[kind].label, count: items.length, newest: items.slice(0, NEWEST_SHOWN) };
  }).filter((k) => k.count > 0);
  return { tag, and: ids.slice(1).map((other) => getTag(db, other)), total: kinds.reduce((n, k) => n + k.count, 0), kinds };
}

// ---- Imports ----

// The tags an imported page names in its front matter (Obsidian: tags: [a, b], tags: a b, or a "- a" list; tag: too).
export function frontMatterTags(fm = {}) {
  const raw = [fm.tags, fm.tag].flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []));
  const seen = new Map();
  for (const name of raw.map((v) => cleanName(String(v).replace(/^["']|["']$/g, ''))).filter(Boolean)) {
    if (name.length <= MAX_TAG_NAME && !seen.has(nameKey(name))) seen.set(nameKey(name), name);
  }
  return [...seen.values()];
}

// Puts an imported item's tags on it (from front matter, or Day One's tags). Nothing happens while Tags is off.
export function addImportedTags(db, kind, id, names) {
  if (!TAG_KINDS[kind] || !moduleOn(db, 'tags')) return;
  for (const name of names) if (!checkTagName(name)) putOn(db, ensureTag(db, name, { origin: 'imported' }).id, kind, id, { origin: 'imported' });
}
