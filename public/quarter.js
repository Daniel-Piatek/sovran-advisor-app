// The quarterly review (time/4): Quarter beside Day and Week on the Planner. The quarter's
// weeks in one view (Weekly Goals done, Highlights hit, the wins lines), its Goals (My Life
// Goals with the Quarter horizon), each marked reached, let go or still in play (reached and
// let go archive it in My Life), loose ends as items, never badges, and two or three Goals
// for the next quarter. Closing the quarter keeps it as it was.

import { el, icon, request, wantsCursor } from './ui.js';
import { choices } from './shutdown.js';

export const quarterApi = {
  get: (day) => request('GET', `/api/reviews/quarter/${day}`),
  close: (day, wins) => request('PUT', `/api/reviews/quarter/${day}`, { wins }),
  reopen: (day) => request('DELETE', `/api/reviews/quarter/${day}`),
  mark: (day, id, mark) => request('PUT', `/api/reviews/quarter/${day}/goals/${id}`, { mark }),
  next: (day, title) => request('POST', `/api/reviews/quarter/${day}/next`, { title }),
  closeWeek: (day) => request('PUT', `/api/reviews/week/${day}`, { wins: '' }),
};

const pad = (n) => String(n).padStart(2, '0');
// The first day of the quarter a day is in, or of the one n quarters on.
export function quarterOf(day, n = 0) {
  const [year, month] = day.split('-').map(Number);
  const index = Math.floor((month - 1) / 3) + n;
  return `${year + Math.floor(index / 4)}-${pad((((index % 4) + 4) % 4) * 3 + 1)}-01`;
}
const monthDay = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const month = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short' });
export const quarterLabel = (back) => `${back.name} · ${month(back.quarter)} – ${month(back.ends)}`;

const MARKS = { reached: 'Reached', let_go: 'Let go', in_play: 'In play' };

// What you are typing survives a redraw (a mark saved, a Goal added): quarter → { wins, next,
// focus }. The box you were typing in gets the cursor back, at the end of your words.
const drafts = new Map();
const draft = (day) => drafts.get(day) ?? drafts.set(day, {}).get(day);
function keepTyping(input, typed, key) {
  input.addEventListener('focus', () => { typed.focus = key; });
  input.addEventListener('blur', () => { if (input.isConnected && typed.focus === key) typed.focus = null; });
  if (typed.focus === key) wantsCursor(input);
}

export function quarterBoard(review, ctx) {
  const back = review.look_back;
  const day = review.quarter;
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const act = (work) => async () => {
    try { await work(); await ctx.reload(); } catch (err) { problem.textContent = err.message; }
  };
  const section = (title, ...rows) => el('section', { class: 'quarter-part', 'aria-label': title }, el('h2', { class: 'quarter-title' }, title), ...rows);

  const summary = el('p', { class: 'quarter-summary' },
    review.closed ? el('span', { class: 'day-closed-chip' }, icon('moon'), 'Quarter closed') : null,
    `★ ${back.goals_done} of ${back.goals} Weekly Goals done · Highlights ${back.highlights_hit} of ${back.highlights} hit · ${back.done} of ${back.planned} planned tasks done`);

  const weeks = section('Weeks', ...back.weeks.map((w) => el('div', { class: 'quarter-week', 'data-week': w.week },
    el('button', { type: 'button', class: 'week-column-name quarter-week-name', onclick: () => ctx.openWeek(w.week) }, monthDay(w.week)),
    el('span', { class: 'quarter-week-counts' }, w.to_come ? 'to come' : `★ ${w.goals_done} of ${w.goals} · Highlights ${w.highlights_hit} of ${w.highlights}`),
    el('span', { class: 'quarter-week-wins' }, w.wins ? `“${w.wins}”` : w.closed ? 'closed' : w.to_come ? '' : 'open'))));

  const goals = section('Goals for this quarter',
    ...(back.quarter_goals.length ? back.quarter_goals.map((g) => el('div', { class: 'quarter-goal' },
      icon('goal'),
      el('a', { class: 'quarter-goal-name', href: `/life/${g.id}` }, g.title),
      review.closed
        ? el('span', { class: 'plan-free' }, MARKS[g.mark] ?? 'no mark')
        : choices(MARKS, g.mark, `What became of “${g.title}”`, (mark) => act(() => quarterApi.mark(day, g.id, mark))()).group))
      : [el('p', { class: 'plan-empty' }, 'No Goals with the Quarter horizon yet: add one for the next quarter below, or in My Life.')]));

  const loose = review.loose_ends.length ? [section('Loose ends', ...review.loose_ends.map((l) => (l.kind === 'week'
    ? el('div', { class: 'quarter-loose' }, el('span', {}, `The week of ${monthDay(l.week)} was never closed.`),
      el('button', { type: 'button', class: 'button button-quiet', onclick: act(() => quarterApi.closeWeek(l.week)) }, 'Close it'))
    : el('div', { class: 'quarter-loose' }, el('span', {}, `“${l.title}” has no mark yet.`)))))] : [];

  const typed = draft(day);
  const wins = el('input', {
    class: 'detail-input quarter-wins', 'aria-label': 'The quarter in one line', placeholder: 'The quarter in one line', maxlength: 300,
    value: typed.wins ?? review.wins, oninput: () => { typed.wins = wins.value; },
  });
  keepTyping(wins, typed, 'wins');
  const closeIt = act(async () => { await quarterApi.close(day, wins.value); delete typed.wins; });
  wins.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); closeIt(); } };
  const ending = section('The quarter in one line',
    ...(review.closed
      ? [el('p', { class: 'review-line' }, review.wins ? `“${review.wins}”` : 'No line.'),
        el('button', { type: 'button', class: 'button button-quiet', onclick: act(() => quarterApi.reopen(day)) }, 'Reopen the quarter')]
      : [wins, el('button', { type: 'button', class: 'button', onclick: closeIt }, 'Close the quarter')]));

  const nextName = review.next.name;
  const nextInput = el('input', {
    class: 'detail-input', 'aria-label': `A Goal for ${nextName}`, placeholder: `A Goal for ${nextName}`, maxlength: 200,
    value: typed.next ?? '', oninput: () => { typed.next = nextInput.value; },
  });
  keepTyping(nextInput, typed, 'next');
  const add = act(async () => { if (nextInput.value.trim()) await quarterApi.next(day, nextInput.value); delete typed.next; });
  nextInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  const next = section(`Goals for ${nextName}`,
    ...review.next.goals.map((g) => el('div', { class: 'quarter-goal' }, icon('goal'), el('a', { class: 'quarter-goal-name', href: `/life/${g.id}` }, g.title))),
    ...(review.next.goals.length > review.next_goals_max ? [el('p', { class: 'plan-warning' }, `${review.next.goals.length} Goals: two or three keep a quarter clear`)] : []),
    el('div', { class: 'quarter-add' }, nextInput, el('button', { type: 'button', class: 'button', onclick: add }, 'Add')));

  return [summary, weeks, goals, ...loose, ending, next, problem];
}
