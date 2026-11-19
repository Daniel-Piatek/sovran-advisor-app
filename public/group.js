// Group Circle (module group, 2026-11-19, the owner's wish): your Quest group's shared space.
//   /group                 the Announcements tab if something new waits there, else the Circle
//   /group/announcements   from Daniel only: homework (with a due date and a Mark as done tick), reminders, news
//   /group/circle          everyone in the group: posts with words and up to four pictures, comments, likes
// The server is group-feed.js (GET /api/group, /api/group/:tab, …); the Sovran cloud keeps each group apart.
// Pictures are shrunk here, before anything leaves this computer: at most 1600 pixels on the long side, a JPEG of about
// 200 KB. Drawing the photo again also leaves behind what the camera wrote into it, such as where it was taken.
// Share to Group Circle (a note, a journal entry, an Assistant answer) leaves a draft in this browser (startGroupDraft)
// and opens the Circle with it filled in; nothing is posted until Post is pressed.

import { el, icon, request, timeAgo } from './ui.js';
import { app, screen, navigate, refreshGroupCount } from './shell.js';

const TABS = [
  { id: 'news', path: 'announcements', name: 'Announcements' },
  { id: 'feed', path: 'circle', name: 'Circle' },
];
const KINDS = { homework: 'Homework', reminder: 'Reminder', announcement: 'Announcement' };
const MAX_PICTURES = 4;
const LONG_SIDE = 1600;
const TARGET_BYTES = 230_000;
const DRAFT_KEY = 'group.draft';
// A person's circle takes one of the brand colours, always the same one for the same name (tokens.css).
const AVATAR_COLOURS = ['--kind-life', '--kind-notes', '--kind-tasks', '--color-accent', '--kind-time', '--kind-people', '--color-text-muted'];

// ---- Share to Group Circle, from anywhere ----
// from: where it came from, said back to the student ("This came from your Journal").
export function startGroupDraft(text, from) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: String(text ?? '').slice(0, 5000), from })); } catch { /* the Circle opens empty */ }
  return navigate('/group/circle');
}
function takeDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    sessionStorage.removeItem(DRAFT_KEY);
    return draft && typeof draft.text === 'string' ? draft : null;
  } catch { return null; }
}

// ---- Small pieces ----
const initial = (name) => (String(name ?? '').trim()[0] ?? '?').toUpperCase();
const colourOf = (name, byGuide) => {
  if (byGuide) return 'var(--color-text)';
  let n = 0;
  for (const ch of String(name ?? '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(${AVATAR_COLOURS[n % AVATAR_COLOURS.length]})`;
};
const avatar = (name, byGuide, small = false) => el('span', { class: small ? 'group-avatar group-avatar-small' : 'group-avatar', style: `background:${colourOf(name, byGuide)}`, 'aria-hidden': 'true' }, initial(name));
const dueWords = (day) => `Due ${new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`;
const pictureUrl = (path) => `/api/group/pictures/${path}`;
const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

// Words with their line breaks, and web addresses as links that open in a new tab. Never HTML.
function bodyText(text) {
  const out = el('div', { class: 'group-body' });
  const parts = String(text ?? '').split(/(https?:\/\/[^\s<>"]+)/g);
  for (const [i, part] of parts.entries()) {
    if (i % 2) out.append(el('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part));
    else out.append(document.createTextNode(part));
  }
  return out;
}

// A small menu under a ••• button. items: [{ label, danger?, run }]
function moreMenu(label, items) {
  if (!items.length) return null;
  const list = el('div', { class: 'group-menu', role: 'menu', hidden: true });
  const button = el('button', { type: 'button', class: 'button button-quiet group-more', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => { list.hidden = !list.hidden; button.setAttribute('aria-expanded', String(!list.hidden)); } }, '•••');
  for (const item of items) {
    list.append(el('button', { type: 'button', role: 'menuitem', class: item.danger ? 'group-menu-item group-menu-danger' : 'group-menu-item',
      onclick: () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); item.run(); } }, item.label));
  }
  const close = (event) => { if (!wrap.contains(event.target)) { list.hidden = true; button.setAttribute('aria-expanded', 'false'); } };
  const wrap = el('span', { class: 'group-more-wrap' }, button, list);
  document.addEventListener('pointerdown', close);
  return wrap;
}

// ---- Shrinking a picture, here, before it is sent ----
export async function shrinkPicture(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  for (let tries = 0; tries < 6; tries++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const pen = canvas.getContext('2d');
    pen.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-photo-ground').trim(); // a see-through picture gets a white ground
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && (blob.size <= TARGET_BYTES || tries === 5)) { bitmap.close?.(); return blob; }
    if (quality > 0.6) quality -= 0.1; else scale *= 0.8;
  }
  throw new Error('That picture could not be made smaller.');
}
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// ---- The page ----
export async function showGroup(tabPath) {
  app.className = 'page group-page';
  document.title = 'Group Circle';
  const top = el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title' }, 'Group Circle'));
  let state;
  try { state = await request('GET', '/api/group'); } catch (err) { state = { ready: false, why: 'offline', message: err.message }; }
  if (!state.ready) return showNotReady(top, state);
  if (!state.me.name) return showNamePicker(top, state, tabPath);
  const tab = TABS.find((t) => t.path === tabPath) ?? (state.counts.news > 0 ? TABS[0] : TABS[1]);
  if (!tabPath) history.replaceState({}, '', `/group/${tab.path}`);
  drawTab(top, state, tab);
}

function showNotReady(top, state) {
  const words = {
    nolibrary: [el('p', {}, 'Group Circle is where your Quest group shares, and where Daniel posts homework and reminders.'),
      el('p', {}, 'It needs your Sovran Library key. ', el('a', { href: '/settings#library' }, 'Add it in Settings › Sovran Library'), '.')],
    nogroup: [el('p', {}, 'You’re not in a group yet. Daniel adds you when your Quest begins, and this page fills in by itself.')],
    offline: [el('p', {}, state.message || 'Group Circle can’t be reached just now.'),
      el('button', { type: 'button', class: 'button', onclick: () => showGroup() }, 'Try again')],
  }[state.why] ?? [el('p', {}, 'Group Circle isn’t ready yet.')];
  screen.replaceChildren(top, el('div', { class: 'group-empty' }, ...words));
}

function showNamePicker(top, state, tabPath) {
  const input = el('input', { id: 'group-name', class: 'detail-input', maxlength: 40, autocomplete: 'given-name', placeholder: 'Your first name is fine' });
  const problem = el('p', { class: 'group-problem', role: 'alert' });
  const form = el('form', { class: 'group-name-form', onsubmit: async (event) => {
    event.preventDefault();
    try { await request('PUT', '/api/group/name', { name: input.value }); showGroup(tabPath); } catch (err) { problem.textContent = err.message; }
  } },
  el('h2', {}, `Welcome to ${state.me.group_title || state.me.group}`),
  el('p', {}, 'Pick the name your group will see on what you post. You can change it later by asking Daniel.'),
  el('label', { for: 'group-name' }, 'Your name in the group'), input, problem,
  el('button', { type: 'submit', class: 'button button-primary' }, 'Continue'));
  screen.replaceChildren(top, form);
  input.focus();
}

function drawTab(top, state, tab) {
  const me = state.me;
  const tabs = el('nav', { class: 'group-tabs', 'aria-label': 'Group Circle' }, ...TABS.map((t) => {
    const count = t.id === tab.id ? 0 : state.counts[t.id];
    return el('a', { class: 'group-tab', href: `/group/${t.path}`, 'aria-current': t.id === tab.id ? 'page' : 'false' },
      t.name, count ? el('span', { class: 'group-tab-count', 'aria-label': `${count} new` }, String(count)) : null);
  }));
  const head = el('div', { class: 'group-head' },
    el('span', { class: 'group-chip' }, me.group_title ? `${me.group} · ${me.group_title}` : me.group),
    el('span', { class: 'group-who' }, tab.id === 'news' ? 'Only Daniel posts here' : `Only ${me.group} sees these posts`));
  const notes = [];
  if (me.closed) notes.push(el('p', { class: 'group-note' }, 'This Quest has finished. Everything stays here to read; new posts and comments are closed.'));
  else if (me.paused) notes.push(el('p', { class: 'group-note' }, 'Posting is paused for you. You can still read everything. Daniel can tell you more.'));
  const list = el('div', { class: 'group-list' });
  const more = el('button', { type: 'button', class: 'button button-quiet group-load-more', hidden: true }, 'Show older posts');
  const canWrite = !me.closed && !me.paused;
  const composer = tab.id === 'feed' && canWrite ? makeComposer(me, () => load()) : null;
  screen.replaceChildren(top, head, tabs, ...notes, ...(composer ? [composer] : []), list, more);

  let oldest = null;
  async function load(older = false) {
    let page;
    try { page = await request('GET', `/api/group/${tab.id}${older && oldest ? `?before=${oldest}` : ''}`); }
    catch (err) { if (!older) list.replaceChildren(el('p', { class: 'empty' }, err.message)); return; }
    const cards = page.posts.map((p) => postCard(p, { me, canWrite, reload: () => load() }));
    if (older) list.append(...cards);
    else list.replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, tab.id === 'news'
      ? 'Nothing from Daniel yet. Homework, reminders and news will appear here.'
      : 'Nothing here yet. Be the first to share something with your group.')]));
    oldest = page.posts.length ? page.posts[page.posts.length - 1].id : oldest;
    more.hidden = page.posts.length < 20;
    if (!older) refreshGroupCount();
  }
  more.onclick = () => load(true);
  load();
}

// ---- Writing a post (the Circle), or changing one ----
function makeComposer(me, onPosted, editing = null) {
  const draft = editing ? null : takeDraft();
  const text = el('textarea', { id: editing ? `group-edit-${editing.id}` : 'group-new-post', class: 'group-text', rows: 3, maxlength: 5000,
    placeholder: `Share something with ${me.group}…`, 'aria-label': editing ? 'Change your post' : 'Write a post' });
  text.value = editing?.body ?? draft?.text ?? '';
  const pictures = editing ? editing.pictures.map((path) => ({ path, bytes: 0 })) : []; // { path, bytes } kept in the cloud already
  const thumbs = el('div', { class: 'group-thumbs' });
  const status = el('p', { class: 'group-status', role: 'status' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => addFiles([...fileInput.files]) });

  function drawThumbs() {
    thumbs.replaceChildren(...pictures.map((p, i) => el('figure', { class: 'group-thumb' },
      el('img', { src: p.preview ?? pictureUrl(p.path), alt: '' }),
      el('figcaption', {}, p.bytes ? kb(p.bytes) : ''),
      el('button', { type: 'button', class: 'group-thumb-remove', 'aria-label': 'Take this picture off', onclick: () => { pictures.splice(i, 1); drawThumbs(); } }, '×'))));
    thumbs.hidden = !pictures.length;
  }
  async function addFiles(files) {
    fileInput.value = '';
    const room = MAX_PICTURES - pictures.length;
    if (files.length > room) status.textContent = `A post can have ${MAX_PICTURES} pictures at most; the first ${room} were kept.`;
    let before = 0;
    let after = 0;
    for (const file of files.slice(0, room)) {
      status.textContent = 'Making the picture smaller…';
      try {
        const small = await shrinkPicture(file);
        const { path } = await request('POST', '/api/group/pictures', { jpeg: await toBase64(small) });
        pictures.push({ path, bytes: small.size, preview: URL.createObjectURL(small) });
        before += file.size; after += small.size;
        drawThumbs();
      } catch (err) { status.textContent = `That picture couldn’t be added: ${err.message}`; return; }
    }
    if (after) status.textContent = `Made smaller on this computer: ${(before / 1e6).toFixed(1)} MB down to ${(after / 1e6).toFixed(2)} MB, and location info removed.`;
  }

  const plusMenu = moreMenu('Add', [{ label: 'Add image', run: () => fileInput.click() }]);
  plusMenu.querySelector('.group-more').textContent = '+';
  plusMenu.querySelector('.group-more').classList.add('group-plus');
  const post = el('button', { type: 'submit', class: 'button button-primary' }, editing ? 'Save' : 'Post');
  const cancel = el('button', { type: 'button', class: 'button button-quiet', onclick: () => {
    if (editing) onPosted(); else { text.value = ''; pictures.length = 0; drawThumbs(); status.textContent = ''; fromLine?.remove(); }
  } }, 'Cancel');
  const fromLine = draft?.from ? el('p', { class: 'group-from' }, `This came from your ${draft.from}. Check it before posting: anything here will be seen by your group.`) : null;
  const form = el('form', { class: 'group-composer', onsubmit: async (event) => {
    event.preventDefault();
    post.disabled = true;
    try {
      const body = { body: text.value, pictures: pictures.map((p) => p.path) };
      if (editing) await request('PATCH', `/api/group/posts/${editing.id}`, body);
      else await request('POST', '/api/group/posts', body);
      text.value = ''; pictures.length = 0; drawThumbs(); status.textContent = ''; fromLine?.remove();
      onPosted();
    } catch (err) { status.textContent = err.message; }
    post.disabled = false;
  } },
  fromLine, text, thumbs, el('div', { class: 'group-composer-row' }, plusMenu, fileInput, el('span', { class: 'group-spacer' }), cancel, post), status);
  drawThumbs();
  if (draft) setTimeout(() => text.focus(), 0);
  return form;
}

// ---- One post ----
function postCard(p, { me, canWrite, reload }) {
  const card = el('article', { class: p.by_guide && p.tab === 'news' ? 'group-post group-announcement' : 'group-post', 'data-post': p.id });
  const when = el('span', { class: 'group-when', title: new Date(p.created_at).toLocaleString() }, timeAgo(p.created_at), p.edited_at ? ' · edited' : '');
  const menuItems = p.mine
    ? [{ label: 'Edit', run: () => card.replaceWith(makeComposer(me, reload, p)) },
      { label: 'Delete my post', danger: true, run: () => confirmThen(card, 'Delete this post for everyone?', async () => { await request('DELETE', `/api/group/posts/${p.id}`); reload(); }) }]
    : [{ label: p.flagged ? 'Daniel has been told' : 'Let Daniel know about this post', run: async () => {
      if (p.flagged) return;
      await request('POST', `/api/group/posts/${p.id}/flag`, {}).catch(() => {});
      p.flagged = 1; card.append(el('p', { class: 'group-status', role: 'status' }, 'Thank you. Daniel will take a look.'));
    } }];
  const header = p.tab === 'news'
    ? el('div', { class: 'group-post-head' },
      el('span', { class: `group-kind group-kind-${p.kind}` }, KINDS[p.kind] ?? 'Announcement'),
      p.kind === 'homework' && p.due_on ? el('span', { class: 'group-when' }, dueWords(p.due_on)) : null,
      el('span', { class: 'group-spacer' }), when, p.mine ? null : moreMenu('More', menuItems))
    : el('div', { class: 'group-post-head' },
      avatar(p.author, p.by_guide),
      el('span', { class: 'group-by' }, el('span', { class: 'group-name' }, p.author, p.by_guide ? el('span', { class: 'group-badge' }, 'Guide') : null), when),
      el('span', { class: 'group-spacer' }), moreMenu('More', menuItems));
  card.append(header);
  if (p.body) card.append(bodyText(p.body));
  if (p.pictures.length) {
    card.append(el('div', { class: `group-pictures group-pictures-${Math.min(p.pictures.length, 4)}` },
      ...p.pictures.map((path) => el('a', { href: pictureUrl(path), target: '_blank', rel: 'noopener' }, el('img', { src: pictureUrl(path), alt: 'A picture in the post', loading: 'lazy' })))));
  }
  // Like, comments, and for homework the tick
  const likeButton = el('button', { type: 'button', class: 'button button-quiet group-like', 'aria-pressed': String(Boolean(p.liked)), disabled: !canWrite,
    onclick: async () => {
      try {
        const r = await request('POST', `/api/group/posts/${p.id}/like`, { on: !p.liked });
        p.liked = r.liked; p.likes = r.likes;
        likeButton.setAttribute('aria-pressed', String(Boolean(p.liked)));
        likeButton.replaceChildren(p.liked ? '♥' : '♡', ` ${p.likes}`);
      } catch { /* left as it was */ }
    } }, p.liked ? '♥' : '♡', ` ${p.likes}`);
  const askWord = p.tab === 'news' ? ['question', 'questions'] : ['comment', 'comments'];
  const commentCount = el('span', { class: 'group-comment-count' }, p.comments.length ? `${p.comments.length} ${p.comments.length === 1 ? askWord[0] : askWord[1]}` : '');
  const doneBox = p.kind === 'homework' && typeof p.done === 'boolean'
    ? el('label', { class: 'group-done' }, el('input', { type: 'checkbox', checked: p.done, onchange: async (event) => {
      try { await request('POST', `/api/group/posts/${p.id}/done`, { on: event.target.checked }); } catch { event.target.checked = !event.target.checked; }
    } }), 'Mark as done')
    : null;
  card.append(el('div', { class: 'group-actions' }, doneBox, el('span', { class: 'group-spacer' }), likeButton, commentCount));
  // Comments (questions, under an announcement)
  const comments = el('div', { class: 'group-comments' }, ...p.comments.map((c) => commentRow(c, p, { reload })));
  if (canWrite && p.comments_on) {
    const box = el('input', { class: 'group-comment-input', maxlength: 2000, 'aria-label': p.tab === 'news' ? 'Ask a question' : 'Write a comment',
      placeholder: p.tab === 'news' ? 'Ask a question…' : 'Write a comment…' });
    const problem = el('span', { class: 'group-status', role: 'status' });
    comments.append(el('form', { class: 'group-comment-form', onsubmit: async (event) => {
      event.preventDefault();
      if (!box.value.trim()) return;
      try { await request('POST', `/api/group/posts/${p.id}/comments`, { body: box.value }); reload(); } catch (err) { problem.textContent = err.message; }
    } }, avatar(me.name, false, true), box, problem));
  }
  card.append(comments);
  return card;
}

function commentRow(c, p, { reload }) {
  const row = el('div', { class: 'group-comment' }, avatar(c.author, c.by_guide, true));
  const bubble = el('div', { class: 'group-bubble' }, el('span', { class: 'group-name' }, c.author, c.by_guide ? el('span', { class: 'group-badge' }, 'Guide') : null), ' ', bodyText(c.body));
  const items = c.mine
    ? [{ label: 'Delete my comment', danger: true, run: () => confirmThen(row, 'Delete this comment?', async () => { await request('DELETE', `/api/group/comments/${c.id}`); reload(); }) }]
    : [{ label: 'Let Daniel know about this comment', run: async () => {
      await request('POST', `/api/group/posts/${p.id}/flag`, { comment: c.id }).catch(() => {});
      row.append(el('span', { class: 'group-status', role: 'status' }, 'Thank you. Daniel will take a look.'));
    } }];
  row.append(bubble, moreMenu('More', items));
  return row;
}

// A yes/no inside the page (the browser's own confirm boxes aren't used in this app).
function confirmThen(after, question, yes) {
  const bar = el('div', { class: 'group-confirm', role: 'alert' }, question, ' ',
    el('button', { type: 'button', class: 'button group-danger', onclick: async () => { bar.remove(); try { await yes(); } catch (err) { after.append(el('p', { class: 'group-status' }, err.message)); } } }, 'Delete'),
    el('button', { type: 'button', class: 'button button-quiet', onclick: () => bar.remove() }, 'Keep it'));
  after.append(bar);
}
