// Tags (tags.js): one list of tags shared by notes, journal entries, people, companies, tasks and the Inbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { createNote, updateNote, deleteNote } from '../../notes.js';
import { createEntry } from '../../entries.js';
import { createPerson } from '../../people.js';
import { createCapture, sortCapture } from '../../captures.js';
import { insertTask } from '../../tasks.js';
import { setModule } from '../../modules.js';
import { importObsidian, importDayOne } from '../../import-notes.js';
import { readAnswer } from '../../suggestions.js';
import {
  textTags, frontMatterTags, ensureTag, listTags, updateTag, deleteTag, restoreTag, joinTags, tagsOf, addItemTag, removeItemTag,
  itemsWithTags, tagOverview, createGroup, deleteGroup, restoreGroup, getTag, nameKey,
} from '../../tags.js';

// Tags is off in a new install (starter: false); these tests switch it on, as the student does in Settings › Modules.
const emptyDb = () => { const db = prepareDatabase(new DatabaseSync(':memory:')); setModule(db, 'tags', true); return db; };
const names = (tags) => tags.map((t) => t.name);

test('#words in a text are tags; headings, code, addresses and plain numbers are not', () => {
  assert.deepEqual(textTags('Venues for the #retreat and #Retreat again. #client-sessions, (#2027-plans)'), ['retreat', 'client-sessions', '2027-plans']);
  assert.deepEqual(textTags('# A heading\n## Another\nSee https://example.com/page#part and `#code` and #2027'), []);
  assert.deepEqual(textTags('```\n#inside a block\n```\n\\#escaped at the start'), ['escaped']);
  assert.deepEqual(textTags('[a link](/notes/x#y) then #medusa.'), ['medusa']);
  assert.deepEqual(textTags('Ελληνικά #ταξίδι'), ['ταξίδι']);
});

test('names that differ only in capitals or spaces are one tag', () => {
  const db = emptyDb();
  const a = ensureTag(db, 'Client sessions');
  const b = ensureTag(db, '  client   SESSIONS ');
  assert.equal(a.id, b.id);
  assert.equal(nameKey('#Retreat '), 'retreat');
  assert.throws(() => ensureTag(db, '   '), /needs a name/);
  assert.throws(() => updateTag(db, ensureTag(db, 'Other').id, { name: 'client sessions' }), (err) => err.status === 409);
});

test('typing #word puts the tag on, taking it out takes it off, and a tag from the row stays', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Venues', body: 'For the #retreat' });
  assert.deepEqual(names(tagsOf(db, 'note', note.id)), ['retreat']);
  addItemTag(db, 'note', note.id, { name: 'Workshop' });
  updateNote(db, note.id, { body: 'For the spring #Retreat and #2027-plans' });
  assert.deepEqual(names(tagsOf(db, 'note', note.id)), ['retreat', 'Workshop', '2027-plans']);
  updateNote(db, note.id, { body: 'No tags in the words now' });
  assert.deepEqual(names(tagsOf(db, 'note', note.id)), ['Workshop']);
  removeItemTag(db, 'note', note.id, getTag(db, tagsOf(db, 'note', note.id)[0].id).id);
  assert.deepEqual(tagsOf(db, 'note', note.id), []);
});

test('while Tags is off, #words put on no tag', () => {
  const db = emptyDb();
  setModule(db, 'tags', false);
  const note = createNote(db, { title: 'Off', body: '#retreat' });
  assert.deepEqual(tagsOf(db, 'note', note.id), []);
});

test('one tag finds every kind, newest two shown, deleted items left out, and a second tag narrows it', () => {
  const db = emptyDb();
  const tag = ensureTag(db, 'retreat');
  const notes = [1, 2, 3].map((n) => createNote(db, { title: `Note ${n}`, body: '#retreat' }));
  createEntry(db, { day: '2026-11-21', body: 'Felt the #retreat idea land' });
  const anna = createPerson(db, { name: 'Anna Kowalska' });
  addItemTag(db, 'person', anna.id, { tag_id: tag.id });
  const task = insertTask(db, { text: 'Ask Anna for March dates' });
  addItemTag(db, 'task', task.id, { tag_id: tag.id });
  createCapture(db, { body: 'Food ideas for day two #retreat' });
  deleteNote(db, notes[0].id);

  const page = tagOverview(db, tag.id);
  assert.equal(page.total, 6);
  assert.deepEqual(page.kinds.map((k) => [k.kind, k.count]), [['note', 2], ['entry', 1], ['person', 1], ['task', 1], ['capture', 1]]);
  assert.equal(page.kinds[0].newest.length, 2);
  assert.ok(page.kinds[0].newest.every((n) => n.path.startsWith('/notes/')));

  const y2027 = ensureTag(db, '2027');
  addItemTag(db, 'note', notes[2].id, { tag_id: y2027.id });
  const narrowed = tagOverview(db, tag.id, { and: [y2027.id] });
  assert.equal(narrowed.total, 1);
  assert.deepEqual(itemsWithTags(db, [tag.id, y2027.id], 'note').map((n) => n.id), [notes[2].id]);
  assert.equal(listTags(db).tags[0].name, 'retreat', 'most used first');
  assert.equal(listTags(db).tags[0].counts.note, 2);
});

test('removing a tag leaves the items, and Undo puts it back on exactly those', () => {
  const db = emptyDb();
  const a = createNote(db, { title: 'A', body: '#money' });
  const b = createNote(db, { title: 'B', body: '' });
  const money = tagsOf(db, 'note', a.id)[0];
  addItemTag(db, 'note', b.id, { tag_id: money.id });
  deleteTag(db, money.id);
  assert.deepEqual(tagsOf(db, 'note', a.id), []);
  assert.equal(listTags(db).tags.length, 0);
  restoreTag(db, money.id);
  assert.deepEqual(names(tagsOf(db, 'note', a.id)), ['money']);
  assert.deepEqual(names(tagsOf(db, 'note', b.id)), ['money']);
});

test('joining a tag into another moves its items once, and Undo gives them back', () => {
  const db = emptyDb();
  const both = createNote(db, { title: 'Both', body: '#retreat #retreats' });
  const one = createNote(db, { title: 'One', body: '#retreats' });
  const [retreat, retreats] = tagsOf(db, 'note', both.id);
  joinTags(db, retreats.id, retreat.id);
  assert.deepEqual(names(tagsOf(db, 'note', both.id)), ['retreat']);
  assert.deepEqual(names(tagsOf(db, 'note', one.id)), ['retreat']);
  restoreTag(db, retreats.id);
  assert.deepEqual(names(tagsOf(db, 'note', both.id)).sort(), ['retreat', 'retreats']);
  assert.deepEqual(names(tagsOf(db, 'note', one.id)), ['retreats']);
});

test('groups are the owner’s: any size, and removing one keeps its tags', () => {
  const db = emptyDb();
  const characters = createGroup(db, { name: 'Characters' });
  const medusa = ensureTag(db, 'Medusa', { group_id: characters.id });
  updateTag(db, medusa.id, { color: 'life', pinned: true });
  assert.equal(listTags(db).groups.length, 1);
  assert.equal(listTags(db).tags[0].group_id, characters.id);
  assert.equal(listTags(db).tags[0].pinned, true);
  deleteGroup(db, characters.id);
  assert.equal(listTags(db).tags[0].group_id, null);
  restoreGroup(db, characters.id);
  assert.equal(listTags(db).tags[0].group_id, characters.id);
  assert.throws(() => updateTag(db, medusa.id, { color: 'accent' }), /colour is one of/);
});

test('an Inbox item carries its tags into what it becomes', () => {
  const db = emptyDb();
  const capture = createCapture(db, { body: 'Book the hall' });
  addItemTag(db, 'capture', capture.id, { name: 'retreat' });
  const { made } = sortCapture(db, capture.id, { to: 'task', task: { text: 'Book the hall' } });
  assert.deepEqual(names(tagsOf(db, 'task', made.id)), ['retreat']);
});

test('imports keep their tags: Obsidian front matter and Day One', () => {
  assert.deepEqual(frontMatterTags({ tags: ['retreat', '#Workshop', 'retreat'] }), ['retreat', 'Workshop']);
  assert.deepEqual(frontMatterTags({ tags: 'money, 2027 plans' }), ['money', '2027', 'plans']);
  const db = emptyDb();
  importObsidian(db, [{ path: 'Venues.md', text: '---\ntags: [retreat, venues]\n---\nThe hall by the lake #lakeside' }]);
  importDayOne(db, { entries: [{ uuid: 'A1', creationDate: '2026-11-20T08:00:00Z', text: 'Morning pages', tags: ['Medusa'] }] });
  const { tags } = listTags(db);
  assert.deepEqual(names(tags).sort(), ['Medusa', 'lakeside', 'retreat', 'venues']);
});

test('your assistant only suggests tags: three at most, spelled as your own, and none while Tags is off', () => {
  const db = emptyDb();
  ensureTag(db, 'Retreat');
  const capture = createCapture(db, { body: 'Book the hall' });
  const read = readAnswer(db, '{"kind": "task", "tags": ["#retreat", "Venues", "retreat", "  money  ", "fourth", 7]}');
  assert.deepEqual(JSON.parse(read.tags), ['Retreat', 'Venues', 'money']);
  assert.deepEqual(tagsOf(db, 'capture', capture.id), [], 'nothing is put on by itself');
  assert.equal(listTags(db).tags.length, 1, 'no new tag is made by a suggestion');
  setModule(db, 'tags', false);
  assert.equal(readAnswer(db, '{"kind": "note", "tags": ["retreat"]}').tags, '[]');
});

test('Tags is off in a new install: #words put on no tag until it is switched on', () => {
  const db = prepareDatabase(new DatabaseSync(':memory:'));
  const before = createNote(db, { title: 'Off', body: '#retreat' });
  assert.deepEqual(tagsOf(db, 'note', before.id), []);
  setModule(db, 'tags', true);
  const after = createNote(db, { title: 'On', body: '#retreat' });
  assert.deepEqual(names(tagsOf(db, 'note', after.id)), ['retreat']);
});
