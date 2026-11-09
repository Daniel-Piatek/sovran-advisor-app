// Comments on a passage (advanced/writing/3): a Comment button beside the words you select, and the note's threads below the text. Under
// every open comment one decision: ask your assistant now (its answer lands in the thread, signed) or leave it for later (its list).

import { el, request, timeAgo } from './ui.js';

export const AUTHORS = { me: 'You', assistant: 'Your assistant' };

// One comment thread: the quoted words, the comment, the replies, and what can be done with it.
export function commentThread(thread, { onReply = () => {}, onAsk = () => {}, onLater = () => {}, onResolve = () => {}, onDelete = () => {}, asking = false, chat = '' } = {}) {
  const open = !thread.resolved;
  const decision = open && thread.ask !== 'answered' ? [
    el('button', { type: 'button', class: 'button', disabled: asking || thread.ask === 'asked', onclick: onAsk }, asking || thread.ask === 'asked' ? 'Asking your assistant…' : 'Ask my assistant now'),
    el('button', { type: 'button', class: 'button button-quiet', 'aria-pressed': String(thread.ask === 'later'), disabled: thread.ask === 'later' || asking, onclick: onLater }, thread.ask === 'later' ? 'Later: on your assistant’s list' : 'Later'),
  ] : [];
  const replyInput = el('input', { class: 'search-input', 'aria-label': 'Reply', placeholder: 'Reply', autocomplete: 'off' });
  return el('article', { class: `comment-thread${open ? '' : ' is-resolved'}`, 'data-comment': thread.id, 'data-ask': thread.ask, 'aria-label': `Comment on “${thread.anchor}”` },
    el('blockquote', { class: 'comment-quote' }, thread.anchor),
    el('p', { class: 'comment-body' }, el('strong', {}, `${AUTHORS[thread.author]} `), thread.body, el('span', { class: 'comment-when' }, ` · ${timeAgo(thread.created_at)}`)),
    ...thread.replies.map((r) => el('p', { class: 'comment-reply', 'data-author': r.author }, el('strong', {}, `${AUTHORS[r.author]} `), r.body, el('span', { class: 'comment-when' }, ` · ${timeAgo(r.created_at)}`))),
    ...(chat ? [el('a', { class: 'comment-chat', href: `/assistant/${chat}` }, 'See the turn in the Assistant')] : []),
    ...(decision.length ? [el('div', { class: 'comment-decision', role: 'group', 'aria-label': 'What to do with this comment' }, ...decision)] : []),
    ...(open ? [el('form', { class: 'comment-reply-form', onsubmit: (event) => { event.preventDefault(); if (replyInput.value.trim()) onReply(replyInput.value.trim()); } }, replyInput,
      el('button', { type: 'submit', class: 'button button-quiet' }, 'Reply'))] : []),
    el('div', { class: 'comment-actions' },
      el('button', { type: 'button', class: 'button button-quiet', onclick: onResolve }, open ? 'Resolve' : 'Reopen'),
      el('button', { type: 'button', class: 'button button-quiet', onclick: onDelete }, 'Delete')));
}

// The pane under a note's text, and the Comment button beside a selection. setThreads(threads) tells the editor's underlines.
export function commentsPane({ noteId, setThreads = () => {} }) {
  const list = el('div', { class: 'comment-list' });
  const draftPlace = el('div', { class: 'comment-draft-place' });
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const heading = el('h2', { class: 'comments-title' }, 'Comments');
  const pane = el('section', { class: 'comments-pane', 'aria-label': 'Comments', hidden: true }, heading, draftPlace, list, problem);
  const button = el('button', { type: 'button', class: 'button comment-button', hidden: true, 'aria-label': 'Comment on the selected words' }, 'Comment');
  button.addEventListener('mousedown', (event) => event.preventDefault()); // the selection stays while it is pressed
  document.body.append(button);
  let selected = null;
  let threads = [];
  const asking = new Set();
  const chats = new Map(); // comment → the chat turn that answered it (until the page is left)

  const say = (message) => { problem.textContent = message ?? ''; };
  const guard = (fn) => async (...args) => { try { say(''); await fn(...args); } catch (err) { say(err.message || "That didn't go through."); } };

  function draw() {
    pane.hidden = threads.length === 0 && !draftPlace.childElementCount;
    list.replaceChildren(...threads.map((t) => commentThread(t, {
      asking: asking.has(t.id), chat: chats.get(t.id) ?? '',
      onReply: guard(async (body) => { await request('POST', `/api/comments/${t.id}/replies`, { body }); await refresh(); }),
      onAsk: guard(async () => {
        asking.add(t.id); draw();
        try {
          const done = await request('POST', `/api/comments/${t.id}/ask`, {});
          say('');
          chats.set(t.id, done.conversation_id);
        } finally { asking.delete(t.id); await refresh(); }
      }),
      onLater: guard(async () => { await request('PATCH', `/api/comments/${t.id}`, { ask: 'later' }); await refresh(); }),
      onResolve: guard(async () => { await request('PATCH', `/api/comments/${t.id}`, { resolved: !t.resolved }); await refresh(); }),
      onDelete: guard(async () => { await request('DELETE', `/api/comments/${t.id}`); await refresh(); }),
    })));
  }

  async function refresh() {
    try { threads = await request('GET', `/api/notes/${noteId}/comments`); } catch { return; }
    setThreads(threads);
    draw();
  }

  // Selecting words offers Comment; pressing it opens a small form in the pane with the words quoted.
  function select(info) {
    selected = info;
    if (!info) { button.hidden = true; return; }
    button.hidden = false;
    button.style.left = `${Math.max(8, Math.min(info.rect.left, document.documentElement.clientWidth - 100))}px`;
    button.style.top = `${info.rect.bottom + 6}px`;
  }
  button.addEventListener('click', () => {
    if (!selected) return;
    const quote = selected;
    button.hidden = true;
    const words = el('textarea', { class: 'detail-input', rows: 3, 'aria-label': 'Your comment', placeholder: 'Your comment' });
    const form = el('form', { class: 'comment-draft', 'aria-label': 'New comment', onsubmit: guard(async (event) => {
      event.preventDefault();
      if (!words.value.trim()) return;
      await request('POST', `/api/notes/${noteId}/comments`, { anchor: quote.anchor, occurrence: quote.occurrence, body: words.value.trim() });
      draftPlace.replaceChildren();
      await refresh();
    }) },
    el('blockquote', { class: 'comment-quote' }, quote.anchor), words,
    el('div', { class: 'comment-actions' }, el('button', { type: 'submit', class: 'button' }, 'Comment'), el('button', { type: 'button', class: 'button button-quiet', onclick: () => { draftPlace.replaceChildren(); draw(); } }, 'Cancel')));
    draftPlace.replaceChildren(form);
    pane.hidden = false;
    form.scrollIntoView({ block: 'nearest' });
    words.focus();
  });

  // A click on an underlined passage brings its thread into view.
  function show(id) {
    const thread = list.querySelector(`[data-comment="${id}"]`);
    if (!thread) return;
    thread.scrollIntoView({ block: 'center' });
    thread.classList.add('is-found');
    setTimeout(() => thread.classList.remove('is-found'), 2500);
  }

  return { element: pane, refresh, select, show, destroy: () => button.remove() };
}
