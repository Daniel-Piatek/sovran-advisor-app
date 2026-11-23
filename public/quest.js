// The Sovran Quest page (module quest, quest.js; 2026-11-23, the owner's wish and the sketch they approved). The weeks on
// the left, newest on top; on the right the week: Daily practice (a plain link to Xperiencify), This week's homework (each
// piece calm in two columns: what it is with one bar of Start, Stuck? Ask Daniel and Done; "Your work" on the right with
// where it stands and the links to the entries and chats started from it), and Weekly group call (the transcript to read
// and search, Sovran Advisor about it, and the replay in Google Drive).
//   /quest                     the newest week        /quest/week-<n>             that week
//   /quest/week-<n>/transcript its call's transcript  /quest/weeks                the guide's Quest weeks (APP Daniel)

import { el, icon, request } from './ui.js';
import { app, screen, navigate, openAssistantWith } from './shell.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (day) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return ''; const d = new Date(`${day}T12:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const weekName = (w) => `Week ${w.number}${w.title ? ` · ${w.title}` : ''}`;
const outside = (href, ...children) => el('a', { class: 'button quest-button', href, target: '_blank', rel: 'noopener' }, ...children, el('span', { 'aria-hidden': 'true' }, ' ↗'));

export async function showQuest(sub) {
  app.className = 'page page-wide quest-page';
  document.title = 'Sovran Quest';
  if (sub === 'weeks') { const { showQuestWeeks } = await import('./quest-weeks.js'); return showQuestWeeks(); }
  let page;
  let problem = '';
  try { page = await request('GET', '/api/quest'); } catch (err) { page = null; problem = err.message; }
  const top = el('header', { class: 'top-bar' }, el('h1', { class: 'top-bar-title quest-title' }, 'Sovran Quest'));
  const tabs = page?.guide ? guideTabs('page') : null;
  if (!page) { screen.replaceChildren(top, el('p', { class: 'empty' }, problem || 'The Quest could not be read just now.')); return; }
  if (!page.weeks.length) {
    screen.replaceChildren(top, ...(tabs ? [tabs] : []), el('p', { class: 'empty' }, page.guide
      ? 'No week is published yet. Open Quest weeks to check a week and publish it.'
      : 'Your Quest weeks appear here once Daniel publishes the first one.'));
    return;
  }
  const m = String(sub ?? '').match(/^week-(\d+)(\/transcript)?$/);
  const week = (m && page.weeks.find((w) => w.number === Number(m[1]))) || page.weeks[0];
  if (m?.[2]) return showTranscript(top, tabs, week);
  screen.replaceChildren(top, ...(tabs ? [tabs] : []), el('div', { class: 'quest-cols' }, weekList(page.weeks, week), drawWeek(week, page)));
}

// In APP Daniel: what the group sees, and Quest weeks, where a week is checked and published.
export function guideTabs(on) {
  return el('nav', { class: 'group-tabs quest-tabs', 'aria-label': 'Quest' },
    el('a', { class: 'group-tab', href: '/quest', 'aria-current': on === 'page' ? 'page' : 'false' }, 'What your group sees'),
    el('a', { class: 'group-tab', href: '/quest/weeks', 'aria-current': on === 'weeks' ? 'page' : 'false' }, 'Quest weeks'));
}

function weekList(weeks, on) {
  return el('nav', { class: 'quest-weeks', 'aria-label': 'Weeks' }, ...weeks.map((w, i) => el('a', {
    class: 'quest-week-link', href: `/quest/week-${w.number}`, 'aria-current': w.number === on.number ? 'page' : 'false',
  }, el('span', { class: 'quest-week-name' }, `Week ${w.number}`), el('small', {}, i === 0 ? 'This week' : w.call_on ? `Call ${shortDay(w.call_on).replace(/^\w+ /, '')}` : ''))));
}

function drawWeek(week, page) {
  return el('div', { class: 'quest-week' },
    el('h2', { class: 'quest-week-title' }, weekName(week)),
    el('section', { class: 'quest-card', 'aria-label': 'Daily practice' },
      el('h3', { class: 'quest-card-title' }, 'Daily practice'),
      el('div', { class: 'quest-row' },
        el('p', { class: 'quest-line' }, 'Your reminders and today’s practice are on Xperiencify.'),
        week.practice_url ? outside(week.practice_url, 'Open today’s practice')
          : el('span', { class: 'quest-faint' }, page.guide ? 'Add the address in Quest weeks.' : 'The link appears here soon.'))),
    homeworkCard(week, page),
    el('section', { class: 'quest-card', 'aria-label': 'Weekly group call' },
      el('h3', { class: 'quest-card-title' }, 'Weekly group call'),
      el('div', { class: 'quest-row' },
        week.has_transcript ? el('a', { class: 'button quest-button', href: `/quest/week-${week.number}/transcript` }, 'Read the transcript') : el('span', { class: 'quest-faint' }, 'The transcript comes after the call.'),
        el('button', { type: 'button', class: 'button quest-button', onclick: () => openAssistantWith(`About the Week ${week.number} group call: `) }, 'Ask Sovran Advisor about it'),
        week.replay_url ? outside(week.replay_url, 'Watch the replay') : null)));
}

const START = { journal: 'Start in my journal', advisor: 'Start with Sovran Advisor' };
function homeworkCard(week, page) {
  const rows = week.homework.map((h) => {
    const marker = el('span', { class: `quest-state quest-state-${h.state}` }, h.state === 'done' ? '✓ Done' : h.words);
    const box = el('span', { class: 'quest-box', 'aria-hidden': 'true' });
    const done = el('button', {
      type: 'button', class: 'quest-seg quest-done', 'aria-pressed': String(h.done),
      onclick: async () => {
        const on = done.getAttribute('aria-pressed') !== 'true';
        done.setAttribute('aria-pressed', String(on));
        try { await request('PUT', `/api/quest/weeks/${week.number}/homework/${h.piece}/done`, { on }); } catch { done.setAttribute('aria-pressed', String(!on)); return; }
        const fresh = await request('GET', '/api/quest').catch(() => null);
        const piece = fresh?.weeks.find((w) => w.number === week.number)?.homework[h.piece - 1];
        if (piece) { marker.className = `quest-state quest-state-${piece.state}`; marker.textContent = piece.state === 'done' ? '✓ Done' : piece.words; }
      },
    }, box, 'Done');
    const start = START[h.where] ? el('button', {
      type: 'button', class: 'quest-seg quest-start',
      onclick: async () => {
        const kind = h.where === 'journal' ? 'entry' : 'chat';
        const made = await request('POST', `/api/quest/weeks/${week.number}/homework/${h.piece}/start`, { kind });
        if (made.kind === 'chat') openAssistantWith(made.draft, made.id); else navigate(made.href);
      },
    }, START[h.where]) : null;
    return el('div', { class: 'quest-piece' },
      el('span', { class: 'quest-number' }, String(h.piece)),
      el('div', { class: 'quest-piece-main' },
        el('p', { class: 'quest-piece-text' }, h.text),
        el('div', { class: 'quest-bar', role: 'group', 'aria-label': `Homework ${h.piece}` }, start,
          el('button', { type: 'button', class: 'quest-seg quest-ask', onclick: () => askDaniel(week, h, page) }, 'Stuck? Ask Daniel'), done)),
      el('div', { class: 'quest-work' }, marker, ...h.work.map((w) => el('a', { class: 'quest-work-link', href: w.href }, w.label))));
  });
  return el('section', { class: 'quest-card quest-homework', 'aria-label': 'This week’s homework' },
    el('div', { class: 'quest-homework-head' }, el('h3', { class: 'quest-card-title' }, 'This week’s homework'), el('h3', { class: 'quest-card-title quest-work-head' }, 'Your work')),
    ...(rows.length ? rows : [el('p', { class: 'quest-line quest-none' }, 'No homework this week.')]));
}

// Stuck? Ask Daniel: their question goes with the week and the piece it's about, through Tell Daniel.
function askDaniel(week, h, page) {
  const label = h.label;
  const words = el('textarea', { class: 'quest-ask-words', rows: 4, 'aria-label': 'Your question', placeholder: 'What would you like to ask?' });
  const note = el('p', { class: 'quest-faint', role: 'status' });
  const close = () => dialog.remove();
  const send = el('button', {
    type: 'button', class: 'button button-primary', disabled: page.guide,
    onclick: async () => {
      if (!words.value.trim()) { note.textContent = 'Write your question first.'; return; }
      send.disabled = true;
      try {
        await request('POST', '/api/tell', { kind: 'question', why: words.value.trim(), place: 'app', context: { quest: label, week: weekName(week), homework: h.text } });
        note.textContent = 'Sent. Daniel sees it with the homework it’s about.';
        words.disabled = true;
      } catch (err) { note.textContent = err.message; send.disabled = false; }
    },
  }, 'Send to Daniel');
  const dialog = el('div', { class: 'quest-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ask Daniel', onclick: (e) => { if (e.target === dialog) close(); } },
    el('div', { class: 'quest-dialog-box' },
      el('h2', { class: 'quest-dialog-title' }, 'Ask Daniel'),
      el('p', { class: 'quest-context' }, el('b', {}, 'Goes with your question: '), label),
      words,
      page.guide ? el('p', { class: 'quest-faint' }, 'This is how it looks for your students. Their questions reach you in Group Circle › Reports.') : null,
      el('div', { class: 'quest-row' }, send, el('button', { type: 'button', class: 'button', onclick: close }, page.guide ? 'Close' : 'Cancel')),
      note));
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(dialog);
  words.focus();
}

// The transcript, with a search box: the lines that hold the words are marked, and the first is brought into view.
async function showTranscript(top, tabs, week) {
  document.title = `Week ${week.number} · Transcript`;
  const list = el('div', { class: 'quest-transcript' });
  const count = el('span', { class: 'quest-faint', role: 'status' });
  const search = el('input', { type: 'search', class: 'quest-search', 'aria-label': 'Search this transcript', placeholder: 'Search this transcript' });
  let timer = null;
  async function draw() {
    const t = await request('GET', `/api/quest/weeks/${week.number}/transcript?words=${encodeURIComponent(search.value.trim())}`);
    const look = search.value.trim().toLowerCase();
    const found = new Set(t.found);
    list.replaceChildren(...t.lines.map((l, i) => {
      const words = el('span', { class: 'quest-said' });
      if (found.has(i)) {
        const lower = l.text.toLowerCase();
        let at = 0;
        for (let hit = lower.indexOf(look); hit >= 0; hit = lower.indexOf(look, at)) {
          words.append(l.text.slice(at, hit), el('mark', {}, l.text.slice(hit, hit + look.length)));
          at = hit + look.length;
        }
        words.append(l.text.slice(at));
      } else words.textContent = l.text;
      return el('p', { class: 'quest-turn', 'data-found': found.has(i) ? 'true' : null }, el('span', { class: 'quest-at' }, l.at), el('span', { class: 'quest-who' }, l.who), words);
    }));
    count.textContent = look ? (t.found.length ? `${t.found.length} ${t.found.length === 1 ? 'place' : 'places'} found` : 'Not found') : '';
    list.querySelector('[data-found]')?.scrollIntoView({ block: 'center' });
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 250); });
  screen.replaceChildren(top, ...(tabs ? [tabs] : []),
    el('a', { class: 'back-link', href: `/quest/week-${week.number}` }, icon('back'), ` ${weekName(week)}`),
    el('h2', { class: 'quest-week-title' }, `Week ${week.number} · weekly group call`, week.call_on ? el('span', { class: 'quest-faint quest-when' }, shortDay(week.call_on)) : null),
    el('div', { class: 'quest-row' }, search, count,
      el('button', { type: 'button', class: 'button quest-button', onclick: () => openAssistantWith(`About the Week ${week.number} group call${search.value.trim() ? ` and “${search.value.trim()}”` : ''}: `) }, 'Ask Sovran Advisor about this')),
    list);
  await draw();
}

