// What you told Daniel (module tell, 2026-11-24, the owner's wish: replying back to a student). Every report you sent
// with Tell Daniel, newest first, with Daniel's replies under it and a box to answer him. Daniel's reply also comes as an
// alert ("Daniel replied") and a line in your Inbox. Opening one marks his reply read. Nothing is kept on this computer:
// it comes from the Sovran cloud with your library key (tell-daniel.js myTells, replyOnTell, seenTell).
//   /told-daniel              every report
//   /told-daniel#report-12    that one, in view, its answer box ready (from the alert)

import { el, icon, request, timeAgo } from './ui.js';
import { app, screen } from './shell.js';
import { moduleOn } from './modules.js';

const KINDS = { broken: 'Something isn’t working', off: 'Something seems off here', question: 'A question', other: 'Other' };
const PLACES = { assistant: 'a Sovran Advisor answer', note: 'a note', journal: 'a journal entry', report: 'a report', group: 'Group Circle', app: 'the app' };
const STATUS = { new: 'Sent', digging: 'Daniel is looking into it', done: 'Dealt with' };

export async function showToldDaniel() {
  app.className = 'page';
  const top = el('header', { class: 'top-bar' }, el('a', { class: 'back-link', href: '/help' }, icon('back'), ' Help'));
  if (!moduleOn('tell')) {
    screen.replaceChildren(top, el('h1', { class: 'help-page-title' }, 'What you told Daniel'),
      el('p', { class: 'empty' }, 'Tell Daniel is switched off. Switch it on in Settings › Modules.'));
    return;
  }
  const box = el('div', { class: 'told-daniel' }, el('p', { class: 'empty' }, 'Opening…'));
  screen.replaceChildren(top, el('h1', { class: 'help-page-title' }, 'What you told Daniel'),
    el('p', { class: 'told-daniel-intro' }, 'Everything you sent with Tell Daniel, with Daniel’s replies. You can answer him under each one.'), box);
  await draw(box);
}

async function draw(box) {
  const again = () => draw(box);
  let reports;
  try { ({ reports } = await request('GET', '/api/tell/mine')); } catch (err) {
    box.replaceChildren(el('div', { class: 'group-empty' }, el('p', {}, err.message), el('button', { type: 'button', class: 'button', onclick: again }, 'Try again')));
    return;
  }
  if (!reports.length) {
    box.replaceChildren(el('p', { class: 'empty' }, 'Nothing yet. When you press Tell Daniel somewhere in the app, it shows here, with his reply when it comes.'));
    return;
  }
  box.replaceChildren(...reports.map((r) => card(r, again)));
  const wanted = location.hash.match(/^#report-(\d+)$/)?.[1];
  const found = wanted ? box.querySelector(`[data-report="${wanted}"]`) : null;
  if (found) { found.scrollIntoView({ block: 'start' }); found.querySelector('.tell-reply-box')?.focus({ preventScroll: true }); }
  for (const r of reports) {
    if ((r.messages ?? []).some((m) => m.from_daniel && !m.read_at)) request('POST', `/api/tell/${r.id}/seen`).catch(() => {});
  }
}

function card(r, again) {
  const messages = r.messages ?? [];
  const unread = messages.some((m) => m.from_daniel && !m.read_at);
  const answer = el('textarea', { class: 'detail-input tell-reply-box', rows: 3, maxlength: 4000,
    placeholder: messages.some((m) => m.from_daniel) ? 'Answer Daniel…' : 'Add something for Daniel…', 'aria-label': `Your answer to Daniel on report ${r.id}` });
  const said = el('span', { class: 'group-status', role: 'status' });
  const send = el('button', { type: 'submit', class: 'button button-primary' }, 'Send to Daniel');
  return el('article', { class: `group-post told-daniel-report${unread ? ' told-daniel-unread' : ''}`, 'data-report': r.id, id: `report-${r.id}` },
    el('div', { class: 'group-post-head' },
      el('span', { class: `group-kind student-kind-${r.kind}` }, KINDS[r.kind] ?? r.kind),
      unread ? el('span', { class: 'group-tab-count' }, 'New reply') : null,
      el('span', { class: 'group-spacer' }),
      el('span', { class: 'group-when', title: new Date(r.created_at).toLocaleString() }, timeAgo(r.created_at))),
    el('p', { class: 'student-report-who' }, `On ${PLACES[r.place] ?? r.place} · ${STATUS[r.status] ?? ''}`),
    r.why ? el('div', { class: 'group-body' }, r.why) : null,
    messages.length ? el('ol', { class: 'tell-thread', 'aria-label': `Replies on report ${r.id}` }, ...messages.map((m) => el('li', { class: `tell-message${m.from_daniel ? '' : ' tell-message-mine'}` },
      el('p', { class: 'tell-message-head' }, el('strong', {}, m.from_daniel ? 'Daniel' : 'You'),
        el('span', { class: 'group-when', title: new Date(m.created_at).toLocaleString() }, ` · ${timeAgo(m.created_at)}`)),
      el('div', { class: 'tell-message-body' }, m.body)))) : el('p', { class: 'group-when' }, 'No reply yet. Daniel reads every one of these.'),
    el('form', { class: 'tell-reply', onsubmit: async (event) => {
      event.preventDefault();
      if (!answer.value.trim()) { said.textContent = 'Write something first.'; answer.focus(); return; }
      send.disabled = true; said.textContent = 'Sending…';
      try { await request('POST', `/api/tell/${r.id}/reply`, { body: answer.value }); again(); } catch (err) { said.textContent = err.message; send.disabled = false; }
    } }, answer, el('div', { class: 'group-actions' }, send, el('span', { class: 'group-spacer' }), said)));
}
