// Group Circle on go Sovran (2026-11-22, the owner's wish): the student's Quest group on their phone, the same as on
// their computer. Read Announcements and the Circle, like, tick homework done, comment and reply, and post, with a
// photo from the phone's camera.
//
// The phone has its own Group Circle key, made by the student's computer and left on the phone's sealed shelf
// (phone-shelf.js, item "group"). With it the Sovran cloud (cloud/group-feed.sql) lets this phone read and write Group
// Circle as that student, and nothing else. No key on the shelf (Group Circle switched off, or the computer hasn't
// been on since the update): the Group Circle choice doesn't show. Alerts on this phone: push.js and sw.js.

import { setupPush } from './push.js';

const $ = (id) => document.getElementById(id);
const SEEN = 'sovran.phone.group-seen'; // the newest post seen in each tab here, for the counts
const LONG_SIDE = 1600;
const TARGET_BYTES = 230_000;
const KINDS = { homework: 'Homework', reminder: 'Reminder', announcement: 'Announcement' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
const ago = (at) => {
  const min = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const dueWords = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

// A photo made smaller here before it leaves the phone: at most 1600 pixels on the long side, a JPEG of about 200 KB.
// Drawing it again also leaves behind what the camera wrote into it, such as where it was taken.
export async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.85;
  for (let tries = 0; tries < 6; tries++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const pen = canvas.getContext('2d');
    pen.fillStyle = '#ffffff';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && (blob.size <= TARGET_BYTES || tries === 5)) { bitmap.close?.(); return blob; }
    if (quality > 0.6) quality -= 0.1; else scale *= 0.8;
  }
  throw new Error('That photo could not be made smaller.');
}
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// openShelf(name): the sealed shelf item, opened (reports.js). show(id): the screen to show (phone.js).
export function setupGroup({ store, show, openShelf, refreshShelf, ios = false, installed = false }) {
  let access = null; // { key, url }
  let me = null;
  let tab = 'news';
  const pictures = new Map(); // path → object URL, fetched once while the page is open
  const readSeen = () => { try { return { news: 0, feed: 0, ...JSON.parse(store.get(SEEN) ?? '{}') }; } catch { return { news: 0, feed: 0 }; } };
  const keepSeen = (seen) => store.set(SEEN, JSON.stringify(seen));

  async function ask(body) {
    if (!access) throw new Error('Group Circle isn’t on this phone yet.');
    let res;
    try {
      res = await fetch(access.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch { throw new Error('No connection. Try again when you have signal.'); }
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(answer.error || 'That didn’t work.'), { code: answer.code });
    return answer;
  }

  // Is Group Circle on this phone? Shows the choice, with how many new posts wait.
  async function check() {
    const found = (await openShelf('group'))?.group;
    access = found?.key && found?.url ? found : null;
    $('group-circle').hidden = !access;
    if (!access) return;
    try {
      const latest = await ask({ action: 'latest' });
      const seen = readSeen();
      const newer = (ids, after) => (Array.isArray(ids) ? ids.filter((id) => Number(id) > after).length : 0);
      const waiting = newer(latest.news_new_ids, seen.news) + newer(latest.feed_new_ids, seen.feed);
      $('group-count').textContent = waiting ? String(waiting) : '';
      $('group-count').hidden = !waiting;
      // One short line on the tile: what is new, else the group's own name.
      $('group-line').textContent = waiting ? `${waiting} new` : (latest.me?.group_title || 'Announcements and the Circle');
    } catch { $('group-count').hidden = true; }
  }

  function picture(path) {
    const img = el('img', { class: 'g-picture', alt: 'A picture', loading: 'lazy' });
    const had = pictures.get(path);
    if (had) { img.src = had; return img; }
    fetch(`${access.url}/picture/${path}`, { headers: { Authorization: `Bearer ${access.key}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { const u = URL.createObjectURL(b); pictures.set(path, u); img.src = u; } }).catch(() => {});
    return img;
  }

  const say = (words) => { $('group-status').textContent = words; };

  function commentBox(post, replyTo, placeholder) {
    const text = el('textarea', { class: 'g-write g-write-small', rows: 1, maxlength: 2000, placeholder, 'aria-label': placeholder });
    const send = el('button', { type: 'button', class: 'g-send' }, 'Send');
    send.addEventListener('click', async () => {
      const body = text.value.trim();
      if (!body) { text.focus(); return; }
      send.disabled = true;
      try { await ask({ action: 'comment', post: post.id, body, reply_to: replyTo }); await draw(); } catch (err) { say(err.message); send.disabled = false; }
    });
    return el('div', { class: 'g-comment-box' }, text, send);
  }

  function comment(post, c, canWrite) {
    const row = el('div', { class: c.reply_to ? 'g-comment g-reply' : 'g-comment' },
      el('p', { class: 'g-bubble' }, el('strong', {}, c.author), c.by_guide ? el('span', { class: 'g-badge' }, 'Guide') : null, ' ', c.body),
      el('span', { class: 'g-when' }, ago(c.created_at)));
    if (canWrite && post.comments_on !== false) {
      const reply = el('button', { type: 'button', class: 'g-link' }, 'Reply');
      reply.addEventListener('click', () => { reply.replaceWith(commentBox(post, c.reply_to ?? c.id, `Reply to ${c.author}`)); row.querySelector('textarea')?.focus(); });
      row.append(reply);
    }
    return row;
  }

  function card(p, canWrite) {
    const like = el('button', { type: 'button', class: 'g-like', 'aria-pressed': String(Boolean(p.liked)) }, p.liked ? '♥' : '♡', ` ${p.likes || ''}`);
    like.addEventListener('click', async () => { like.disabled = true; try { await ask({ action: 'like', post: p.id, on: !p.liked }); await draw(); } catch (err) { say(err.message); like.disabled = false; } });
    const parts = [
      el('header', { class: 'g-by' }, el('strong', {}, p.author), p.by_guide ? el('span', { class: 'g-badge' }, 'Guide') : null, el('span', { class: 'g-when' }, ago(p.created_at))),
      p.tab === 'news' && KINDS[p.kind] ? el('span', { class: `g-kind g-kind-${p.kind}` }, KINDS[p.kind]) : null,
      p.body ? el('p', { class: 'g-body' }, p.body) : null,
      p.pictures?.length ? el('div', { class: 'g-pictures' }, ...p.pictures.map(picture)) : null,
      p.kind === 'homework' && p.due_on ? el('p', { class: 'g-due' }, `Due ${dueWords(p.due_on)}`) : null,
    ];
    const actions = el('div', { class: 'g-actions' }, like);
    if (p.kind === 'homework') {
      const done = el('input', { type: 'checkbox', id: `g-done-${p.id}`, checked: p.done ? true : null });
      done.addEventListener('change', async () => { try { await ask({ action: 'done', post: p.id, on: done.checked }); } catch (err) { say(err.message); done.checked = !done.checked; } });
      actions.append(el('label', { class: 'g-done', for: `g-done-${p.id}` }, done, ' Mark as done'));
    }
    parts.push(actions);
    const top = (p.comments ?? []).filter((c) => !c.reply_to);
    const thread = el('div', { class: 'g-comments' });
    for (const c of top) {
      thread.append(comment(p, c, canWrite));
      for (const r of p.comments.filter((x) => x.reply_to === c.id)) thread.append(comment(p, r, canWrite));
    }
    parts.push(thread);
    if (canWrite && p.comments_on !== false) parts.push(commentBox(p, null, p.tab === 'news' ? 'Ask a question' : 'Write a comment'));
    return el('article', { class: p.tab === 'news' ? 'g-post g-announcement' : 'g-post', 'data-post': p.id }, ...parts);
  }

  function composer() {
    const text = el('textarea', { class: 'g-write', rows: 3, maxlength: 5000, placeholder: 'Share something with your group', 'aria-label': 'Write a post' });
    const photo = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const chosen = [];
    const thumbs = el('div', { class: 'g-thumbs' });
    const add = el('button', { type: 'button', class: 'g-add' }, '+ Photo');
    const post = el('button', { type: 'button', class: 'keep g-post-button' }, 'Post');
    add.addEventListener('click', () => photo.click());
    photo.addEventListener('change', async () => {
      const file = photo.files?.[0];
      photo.value = '';
      if (!file) return;
      if (chosen.length >= 4) { say('A post can have at most 4 pictures.'); return; }
      say('Making it smaller on this phone…');
      try {
        const blob = await shrink(file);
        const { path } = await ask({ action: 'picture_put', jpeg: await toBase64(blob) });
        chosen.push(path);
        thumbs.append(el('img', { class: 'g-thumb', src: URL.createObjectURL(blob), alt: 'Your picture' }));
        say('');
      } catch (err) { say(err.message); }
    });
    post.addEventListener('click', async () => {
      const body = text.value.trim();
      if (!body && !chosen.length) { text.focus(); return; }
      post.disabled = true;
      try { await ask({ action: 'post', tab: 'feed', body, pictures: chosen }); await draw(); } catch (err) { say(err.message); post.disabled = false; }
    });
    return el('div', { class: 'g-composer' }, text, thumbs, el('div', { class: 'g-composer-row' }, add, post), photo);
  }

  function namePicker() {
    const input = el('input', { class: 'g-name', id: 'g-name', maxlength: 40, autocomplete: 'given-name', placeholder: 'Your first name is fine' });
    const go = el('button', { type: 'button', class: 'keep' }, 'Continue');
    go.addEventListener('click', async () => {
      try { await ask({ action: 'set_name', name: input.value.trim() }); await draw(); } catch (err) { say(err.message); }
    });
    $('group-list').replaceChildren(el('p', { class: 'g-note' }, 'Pick the name your group will see on what you post.'),
      el('label', { for: 'g-name', class: 'g-label' }, 'Your name in the group'), input, go);
  }

  async function draw() {
    say('');
    document.querySelectorAll('#group-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    let page;
    try { page = await ask({ action: 'read', tab, limit: 20 }); } catch (err) {
      $('group-list').replaceChildren(el('p', { class: 'g-note' }, err.code === 'nokey' ? 'You’re not in a group yet. Daniel adds you when your Quest begins.' : err.message));
      return;
    }
    me = page.me;
    if (!me?.name) { namePicker(); return; }
    const canWrite = !me.paused && !me.closed;
    const posts = page.posts ?? [];
    if (posts.length) { const seen = readSeen(); seen[tab] = Math.max(seen[tab], ...posts.map((p) => Number(p.id))); keepSeen(seen); }
    const notes = [];
    if (me.closed) notes.push(el('p', { class: 'g-note' }, 'This group has finished. You can still read everything.'));
    else if (me.paused) notes.push(el('p', { class: 'g-note' }, 'Posting is paused for you. Daniel can tell you more.'));
    else if (tab === 'news') notes.push(el('p', { class: 'g-note' }, 'Only Daniel posts here.'));
    $('group-list').replaceChildren(...notes, ...(tab === 'feed' && canWrite ? [composer()] : []),
      ...(posts.length ? posts.map((p) => card(p, canWrite)) : [el('p', { class: 'g-note' }, tab === 'news' ? 'Nothing from Daniel yet.' : 'Nothing here yet. Be the first to share something.')]));
  }

  // Opens Group Circle; from an alert, at its tab and post.
  async function open({ tab: wanted, post } = {}) {
    show('group');
    $('group-title').textContent = 'Group Circle';
    if (wanted === 'news' || wanted === 'feed') tab = wanted;
    await draw();
    if (post) {
      const card = document.querySelector(`#group-list [data-post="${Number(post)}"]`);
      if (card) { card.classList.add('g-asked'); card.scrollIntoView({ block: 'start' }); }
    }
    await push.draw();
  }
  const push = setupPush({ ask, access: () => access, ios, installed });

  document.querySelectorAll('#group-tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && $('group').hidden) { await refreshShelf(); await check(); } });

  return { check, open, available: () => Boolean(access) };
}
