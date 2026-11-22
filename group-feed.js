// Group Circle (module group, 2026-11-19, the owner's wish): a shared space for each Quest group. Two tabs:
// Announcements, where only Daniel posts homework, reminders and news, and Circle, where everyone in the group posts
// words and pictures, comments and likes. Each student sees their own group only: the Sovran cloud finds the group from
// the student's Sovran Library key (cloud/group-feed.sql, cloud/group-feed/index.ts), never from what this app asks for.
//
// The key never reaches a page: the server asks the cloud and passes the answer on. Pictures are shrunk in the page
// (public/group.js) before they come here, and each one is kept in data/group-pictures once fetched, so it downloads
// only once. What this computer remembers: the newest post seen in each tab (settings group.seen), for the counts.
// Nothing else of the group is kept here.
//
// The same file runs in APP Daniel, where it asks with Daniel's guide key instead (useGroup({ keyOf: guideKey })): the
// cloud then lets it post announcements, see every group, hide, pause and read the flags (the guide's part, at the end).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { moduleOn } from './modules.js';
import { libraryKey } from './sovran-library.js';

export const GROUP_URL = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/group-feed';
export const TABS = ['news', 'feed']; // Announcements, Circle
export const MAX_PICTURE = 450_000; // the page sends about 200 KB
export const MAX_PICTURES = 4;
const PICTURE = /^([A-Z0-9-]{2,20})\/([A-Za-z0-9_-]{22})\.jpg$/;
const SEEN = 'group.seen';
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const now = () => new Date().toISOString();

// Where to ask, and where pictures are kept (server.js sets the folder at start; tests give their own).
const where = { url: process.env.SOVRAN_GROUP_URL || GROUP_URL, fetch: (...a) => fetch(...a), dir: '', keyOf: libraryKey, noKey: '' };
export const useGroup = (options) => Object.assign(where, options);
export const groupOn = (db) => moduleOn(db, 'group');
export const isGuideApp = () => Boolean(where.guideApp);
export const hasGroupKey = (db) => Boolean(where.keyOf(db)); // the library key here, the guide key in APP Daniel

const NO_KEY = 'Group Circle needs your Sovran Library key. Add it in Settings › Sovran Library.';

async function cloud(db, body) {
  const key = where.keyOf(db);
  if (!key) throw fail(409, where.noKey || NO_KEY, 'nolibrary');
  let res;
  try {
    res = await where.fetch(where.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw fail(502, 'Group Circle can’t be reached just now. Check this computer’s internet connection.', 'offline'); }
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(res.status >= 500 ? 502 : res.status, answer.error || 'Group Circle said no.', answer.code);
  return answer;
}

// For Tell Daniel (tell-daniel.js), which goes through the same door with the same key.
export const askCloud = (db, body) => cloud(db, body);

function readSeen(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(SEEN);
  try { return { news: 0, feed: 0, ...(row ? JSON.parse(row.value) : {}) }; } catch { return { news: 0, feed: 0 }; }
}
function writeSeen(db, seen) {
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, SEEN, JSON.stringify(seen));
}

// Who you are in the group and how much is new in each tab. Never throws for "not set up yet": it says why instead.
//   { ready, why?: 'nolibrary'|'nogroup'|'offline', me?: { group, group_title, closed, name, paused }, counts: { news, feed } }
export async function groupState(db) {
  if (where.guideApp) return { ...(await askState(db)), guide_app: true, fingerprint: guideFingerprint(db) };
  return askState(db);
}
async function askState(db) {
  const none = { news: 0, feed: 0 };
  let latest;
  try { latest = await cloud(db, { action: 'latest' }); } catch (err) {
    if (err.code === 'nolibrary') return { ready: false, why: 'nolibrary', counts: none };
    if (err.code === 'nokey') return { ready: false, why: 'nogroup', counts: none };
    return { ready: false, why: 'offline', message: err.message, counts: none };
  }
  if (latest.me?.guide) return { ready: true, me: latest.me, counts: { news: 0, feed: 0, flags: Number(latest.flags) || 0 } };
  const seen = readSeen(db);
  const newer = (ids, after) => (Array.isArray(ids) ? ids.filter((id) => Number(id) > after).length : 0);
  return { ready: true, me: latest.me, counts: { news: newer(latest.news_new_ids, seen.news), feed: newer(latest.feed_new_ids, seen.feed) } };
}

const GROUP = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const checkGroup = (group) => (group && GROUP.test(group) ? group : group === 'ALL' ? 'ALL' : null);
const checkTab = (tab) => { if (!TABS.includes(tab)) throw fail(404, 'There is no such tab.'); return tab; };
const postId = (id) => { const n = Number(id); if (!Number.isSafeInteger(n) || n <= 0) throw fail(404, 'There is no such post.'); return n; };
const words = (value, max, what) => {
  const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (text.length > max) throw fail(400, `${what} can be at most ${max.toLocaleString('en')} characters.`);
  return text;
};
const pictureList = (value) => {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_PICTURES) throw fail(400, `A post can have at most ${MAX_PICTURES} pictures.`);
  if (!list.every((p) => typeof p === 'string' && PICTURE.test(p))) throw fail(400, 'Those pictures aren’t right.');
  return list;
};

// One page of a tab, newest first. The first page marks the tab as seen.
// group: the guide's choice of group (a student always gets their own; the cloud ignores it for them).
export async function readTab(db, tab, before = null, group = null) {
  const answer = await cloud(db, { action: 'read', tab: checkTab(tab), before: before ? postId(before) : null, limit: 20, group: checkGroup(group) });
  const posts = answer.posts ?? [];
  if (!before && posts.length) {
    const seen = readSeen(db);
    seen[tab] = Math.max(seen[tab], ...posts.map((p) => Number(p.id)));
    writeSeen(db, seen);
  }
  return { me: answer.me, posts };
}

export async function setName(db, input) {
  const name = words(input?.name, 40, 'A name');
  if (!name) throw fail(400, 'Write the name your group will see.');
  return cloud(db, { action: 'set_name', name });
}

export async function addPost(db, input) {
  const body = words(input?.body, 5000, 'A post');
  const pictures = pictureList(input?.pictures);
  if (!body && !pictures.length) throw fail(400, 'Write something or add a picture first.');
  return cloud(db, { action: 'post', tab: 'feed', body, pictures });
}
export async function changePost(db, id, input) {
  const body = words(input?.body, 5000, 'A post');
  const pictures = pictureList(input?.pictures);
  if (!body && !pictures.length) throw fail(400, 'A post needs words or a picture.');
  return cloud(db, { action: 'edit_post', id: postId(id), body, pictures });
}
export const removePost = (db, id) => cloud(db, { action: 'delete_post', id: postId(id) });

export async function addComment(db, post, input) {
  const body = words(input?.body, 2000, 'A comment');
  if (!body) throw fail(400, 'Write your comment first.');
  return cloud(db, { action: 'comment', post: postId(post), body, reply_to: input?.reply_to ? postId(input.reply_to) : null });
}
export async function changeComment(db, id, input) {
  const body = words(input?.body, 2000, 'A comment');
  if (!body) throw fail(400, 'A comment needs words.');
  return cloud(db, { action: 'edit_comment', id: postId(id), body });
}
export const removeComment = (db, id) => cloud(db, { action: 'delete_comment', id: postId(id) });
export const likePost = (db, post, input) => cloud(db, { action: 'like', post: postId(post), on: input?.on !== false });
export const markDone = (db, post, input) => cloud(db, { action: 'done', post: postId(post), on: input?.on !== false });
export const flagPost = (db, post, input) => cloud(db, { action: 'flag', post: postId(post), comment: input?.comment ? postId(input.comment) : null });

// A picture the page already shrank (a JPEG of about 200 KB): kept in the cloud, and here, so it never downloads again.
// group: the guide's, for which group's folder (a student's always goes to their own).
export async function addPicture(db, bytes, group = null) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw fail(400, 'That isn’t a picture this app can send.');
  if (bytes.length > MAX_PICTURE) throw fail(413, 'That picture is too big. Try another one.');
  const answer = await cloud(db, { action: 'picture_put', jpeg: bytes.toString('base64'), group: checkGroup(group) });
  if (where.dir && PICTURE.test(answer.path ?? '')) keepPicture(answer.path, bytes);
  return { path: answer.path };
}

function keepPicture(name, bytes) {
  const file = path.join(where.dir, ...name.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, bytes);
  fs.renameSync(`${file}.part`, file);
}

// A picture's bytes: from this computer if it was fetched before, else from the cloud once (then kept).
export async function pictureBytes(db, name) {
  if (!PICTURE.test(name)) throw fail(404, 'There is no such picture.');
  const file = where.dir ? path.join(where.dir, ...name.split('/')) : '';
  if (file && fs.existsSync(file)) return fs.readFileSync(file);
  const key = where.keyOf(db);
  if (!key) throw fail(409, where.noKey || NO_KEY);
  let res;
  try {
    res = await where.fetch(`${where.url}/picture/${name}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  } catch { throw fail(502, 'Group Circle can’t be reached just now.'); }
  if (!res.ok) throw fail(404, 'There is no such picture.');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (file) keepPicture(name, bytes);
  return bytes;
}

// ---- The guide's part (APP Daniel only; the cloud refuses anyone without the guide key) ----
export const KINDS = ['homework', 'reminder', 'announcement'];

// A new announcement, or a post in one group's Circle. group: a group's code, or 'ALL' (announcements only).
export async function addGuidePost(db, input) {
  const tab = input?.tab === 'feed' ? 'feed' : 'news';
  const body = words(input?.body, 5000, 'A post');
  const pictures = pictureList(input?.pictures);
  if (!body && !pictures.length) throw fail(400, 'Write something or add a picture first.');
  const group = checkGroup(input?.group);
  if (!group || (tab === 'feed' && group === 'ALL')) throw fail(400, 'Pick a group.');
  const kind = tab === 'feed' ? 'post' : KINDS.includes(input?.kind) ? input.kind : 'announcement';
  const due = kind === 'homework' && /^\d{4}-\d{2}-\d{2}$/.test(input?.due_on ?? '') ? input.due_on : null;
  return cloud(db, { action: 'post', tab, kind, group, body, pictures, due_on: due, comments_on: input?.comments_on !== false });
}
export async function changeGuidePost(db, id, input) {
  const body = words(input?.body, 5000, 'A post');
  const pictures = pictureList(input?.pictures);
  if (!body && !pictures.length) throw fail(400, 'A post needs words or a picture.');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(input?.due_on ?? '') ? input.due_on : null;
  return cloud(db, { action: 'edit_post', id: postId(id), body, pictures, due_on: due, comments_on: typeof input?.comments_on === 'boolean' ? input.comments_on : null });
}
export const hideItem = (db, what, id, input) => cloud(db, { action: 'hide', what: what === 'comment' ? 'comment' : 'post', id: postId(id), on: input?.on !== false });
export const openFlags = (db) => cloud(db, { action: 'flags' });
export const clearFlags = (db, input) => cloud(db, { action: 'flags_clear', post: postId(input?.post), comment: input?.comment ? postId(input.comment) : null });
export const listGroups = (db) => cloud(db, { action: 'groups' });
const MANAGE = ['pause', 'unpause', 'name', 'move', 'leave', 'close', 'open', 'new_group', 'phone_off'];
export async function manage(db, input) {
  if (!MANAGE.includes(input?.what)) throw fail(400, 'There is no such change.');
  return cloud(db, { action: 'manage', what: input.what, student: typeof input.student === 'string' ? input.student.slice(0, 40) : null, value: typeof input.value === 'string' ? input.value.slice(0, 80) : null });
}

// ---- The guide key (APP Daniel): made on this computer once, kept in settings group.guide_key, never shown. ----
// The cloud knows only its fingerprint (SHA-256), which Daniel passes on once to be added to group_feed.guides.
const GUIDE_KEY = 'group.guide_key';
export function guideKey(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(GUIDE_KEY);
  return row?.value || '';
}
export function guideFingerprint(db) {
  const key = guideKey(db);
  return key ? createHash('sha256').update(key).digest('hex') : null;
}
export function makeGuideKey(db) {
  if (guideKey(db)) return { fingerprint: guideFingerprint(db) };
  const time = now();
  db.prepare(`INSERT INTO settings (id, created_at, updated_at, key, value) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`)
    .run(randomUUID(), time, time, GUIDE_KEY, `guide_${randomBytes(32).toString('base64url')}`);
  return { fingerprint: guideFingerprint(db) };
}
