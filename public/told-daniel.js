// What you told Daniel (module tell, 2026-11-24, the owner's wish: replying back to a student). Every report you sent
// with Tell Daniel, newest first, with Daniel's replies under it and a box to answer him. Daniel's reply also comes as an
// alert ("Daniel replied") and a line in your Inbox. Opening one marks his reply read. Nothing is kept on this computer:
// it comes from the Sovran cloud with your library key (tell-daniel.js myTells, replyOnTell, seenTell).
// It sits at the top of Help, the sidebar line (the owner's pick, 2026-11-24: always there, whatever the Quest is doing),
// with a red number on Help while one of Daniel's replies is unread (public/shell.js refreshHelpCount):
//   /help              Tell Daniel and every report, then the help pages (public/help.js)
//   /help#report-12    that one, in view, its answer box ready (from the alert and the Inbox line)
//   /told-daniel       the first address; leads to /help

import { el, request, timeAgo } from './ui.js';
import { navigate, refreshHelpCount } from './shell.js';

const KINDS = { broken: 'Something isn’t working', off: 'Something seems off here', question: 'A question', other: 'Other' };
const PLACES = { assistant: 'a Sovran Advisor answer', note: 'a note', journal: 'a journal entry', report: 'a report', group: 'Group Circle', app: 'the app' };
const STATUS = { new: 'Sent', digging: 'Daniel is looking into it', done: 'Dealt with' };

// Help's Tell Daniel part (public/help.js): draws into its box.
export async function drawToldDaniel(box) {
  box.replaceChildren(el('p', { class: 'empty' }, 'Opening…'));
  await draw(box);
}

export const showToldDaniel = () => navigate(`/help${location.hash}`, { replace: true });

async function draw(box) {
  const again = () => draw(box);
  let reports, note;
  try { ({ reports, note } = await request('GET', '/api/tell/mine')); } catch (err) {
    box.replaceChildren(el('div', { class: 'group-empty' }, el('p', {}, err.message), el('button', { type: 'button', class: 'button', onclick: again }, 'Try again')));
    return;
  }
  if (!reports.length) {
    box.replaceChildren(el('p', { class: 'empty' }, note || 'Nothing yet. When you press Tell Daniel somewhere in the app, it shows here, with his reply when it comes.'));
    return;
  }
  box.replaceChildren(...reports.map((r) => card(r, again)));
  const wanted = location.hash.match(/^#report-(\d+)$/)?.[1];
  const found = wanted ? box.querySelector(`[data-report="${wanted}"]`) : null;
  if (found) { found.scrollIntoView({ block: 'start' }); found.querySelector('.tell-reply-box')?.focus({ preventScroll: true }); }
  const seen = [];
  for (const r of reports) {
    if ((r.messages ?? []).some((m) => m.from_daniel && !m.read_at)) seen.push(request('POST', `/api/tell/${r.id}/seen`).catch(() => {}));
  }
  if (seen.length) Promise.all(seen).then(refreshHelpCount); // the red number on Help goes
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
