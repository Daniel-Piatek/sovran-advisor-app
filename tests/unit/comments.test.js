// Comments on a passage (comments.js, advanced/writing/3): anchors, threads, the choice per comment, and the assistant's two tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase, openDatabase, SCHEMA_VERSION } from '../../db.js';
import { createNote, getNote } from '../../notes.js';
import { createConversation } from '../../assistant.js';
import { runTool, offeredTools } from '../../assistant-tools.js';
import { setModule } from '../../modules.js';
import { createComment, replyTo, listThreads, changeComment, deleteComment, laterComments, askText, getComment } from '../../comments.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));
const BODY = '* Price it as a fixed package\n* Two quiet mornings';

test('a comment keeps the quoted words and which occurrence of them; the note is not touched', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Proposal', body: BODY });
  const c = createComment(db, note.id, { anchor: 'fixed package', occurrence: 0, body: 'Is this price too low?' });
  assert.deepEqual([c.anchor, c.occurrence, c.body, c.author, c.ask, c.resolved], ['fixed package', 0, 'Is this price too low?', 'me', '', false]);
  assert.equal(getNote(db, note.id).body, BODY);
  assert.throws(() => createComment(db, note.id, { anchor: '', body: 'x' }), /Select the words/);
  assert.throws(() => createComment(db, note.id, { anchor: 'x', body: '  ' }), /Write the comment/);
  assert.throws(() => createComment(db, note.id, { anchor: 'x'.repeat(501), body: 'x' }), /at most 500/);
  assert.throws(() => createComment(db, '00000000-0000-4000-8000-000000000000', { anchor: 'x', body: 'x' }), (e) => e.status === 404);
});

test('threads: replies hang on the first comment, yours and your assistant’s; the assistant’s answers it', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Proposal', body: BODY });
  const c = createComment(db, note.id, { anchor: 'fixed package', body: 'Too low?' });
  replyTo(db, c.id, { body: 'Thinking about it.' });
  assert.equal(getComment(db, c.id).ask, '', 'your own reply is not an answer');
  const answer = replyTo(db, c.id, { body: 'Not too low with prep included.', author: 'assistant' });
  const [thread] = listThreads(db, note.id);
  assert.deepEqual(thread.replies.map((r) => [r.author, r.body]), [['me', 'Thinking about it.'], ['assistant', 'Not too low with prep included.']]);
  assert.equal(thread.ask, 'answered');
  assert.equal(answer.parent_id, c.id);
  assert.equal(db.prepare('SELECT origin FROM comments WHERE id = ?').get(answer.id).origin, 'assistant');
  const reply = replyTo(db, answer.id, { body: 'Thanks' }); // a reply to a reply goes in the same thread
  assert.equal(reply.parent_id, c.id);
  assert.throws(() => replyTo(db, c.id, { body: ' ' }), /Write the reply/);
});

test('resolve and reopen; later puts it on the list; delete takes the thread away but keeps the rows', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Proposal', body: BODY });
  const c = createComment(db, note.id, { anchor: 'fixed package', body: 'Too low?' });
  assert.equal(changeComment(db, c.id, { resolved: true }).resolved, true);
  assert.equal(changeComment(db, c.id, { resolved: false }).resolved, false);
  changeComment(db, c.id, { ask: 'later' });
  assert.deepEqual(laterComments(db).map((l) => [l.comment_id, l.passage, l.comment, l.note_title]), [[c.id, 'fixed package', 'Too low?', 'Proposal']]);
  assert.throws(() => changeComment(db, c.id, { ask: 'now' }), /later, asked or answered/);
  changeComment(db, c.id, { resolved: true });
  assert.deepEqual(laterComments(db), [], 'a resolved comment is not for your assistant');
  deleteComment(db, c.id);
  assert.deepEqual(listThreads(db, note.id), []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM comments').get().n, 1, 'marked deleted, not removed');
  assert.match(askText(db, createComment(db, note.id, { anchor: 'two', body: 'hm' }).id), /The passage I mean: “two”/);
});

test('your assistant lists the later comments and answers them in their threads; only while the module is on', () => {
  const db = emptyDb();
  const note = createNote(db, { title: 'Proposal', body: BODY });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
  const run = { conversationId: createConversation(db, dir).id, messageId: null, card: () => {} };
  assert.equal(runTool(db, 'list_comments', {}, run), 'No comments are waiting for you.');
  const c = createComment(db, note.id, { anchor: 'fixed package', body: 'Too low?' });
  changeComment(db, c.id, { ask: 'later' });
  const [item] = JSON.parse(runTool(db, 'list_comments', {}, run));
  assert.equal(item.comment_id, c.id);
  JSON.parse(runTool(db, 'reply_to_comment', { comment_id: c.id, text: 'Fine as it is.' }, run));
  assert.deepEqual(listThreads(db, note.id)[0].replies.map((r) => [r.author, r.body]), [['assistant', 'Fine as it is.']]);
  assert.equal(listThreads(db, note.id)[0].ask, 'answered');
  assert.throws(() => runTool(db, 'reply_to_comment', { comment_id: '00000000-0000-4000-8000-000000000000', text: 'x' }, run), (e) => e.status === 404);
  assert.deepEqual(offeredTools(db).map((t) => t.name).filter((n) => n.endsWith('_comment') || n.endsWith('_comments')), ['list_comments', 'reply_to_comment']);
  setModule(db, 'writing', false);
  assert.deepEqual(offeredTools(db).map((t) => t.name).filter((n) => n.endsWith('_comment') || n.endsWith('_comments')), []);
});

test('schema 52 moves an older database: the comments table is new, every note is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-old-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO notes (id, created_at, updated_at, title, body) VALUES ('n1', 'a', 'a', 'Keep me', 'x')");
  db.exec('DROP TABLE comments; PRAGMA user_version = 51;');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM comments').get().n, 0);
  assert.equal(db.prepare("SELECT title FROM notes WHERE id = 'n1'").get().title, 'Keep me');
  db.close();
});
