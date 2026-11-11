// Weekly and Daily Planning (time/3): a rhythm on top of the Planner.
//   The week board   a column per day: its load against the budget (amber when over), a
//                    slot for that day's Weekly Goal, its events and tasks. Drag a task
//                    onto a day to give it that day; a day's name opens it.
//   The panel        p (or Plan my week / Plan my day) opens a slim panel beside the board,
//                    never a wizard that hides it. Five steps, each with its end state in
//                    one line and what the week (or day) says now; each can be done or
//                    skipped, and the flow resumes where it was left.
//   The review       ⇧R (or Weekly Review on the week): a look back on the week on screen
//                    (planned against done, the Highlights, the Weekly Goals that kept
//                    moving, the lines of its closed days) and one line for its wins.
//                    Closing the week keeps that look back as it was; Plan next week
//                    then opens Weekly Planning on the week after (time/4).

import { api, el, icon, request, wantsCursor } from './ui.js';
import { dueLabel } from './due.js';
import { dayLoad, duration } from './planner.js';
import { flagChip, starButton } from './quick-add.js';
import { eventLine } from './calendar.js';

const flowApi = {
  get: (kind, period) => request('GET', `/api/planning/${kind}/${period}`),
  set: (kind, period, step, state) => request('PATCH', `/api/planning/${kind}/${period}`, { step, state }),
};
const time = (at) => new Date(`${at}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const weekday = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const names = (days) => days.map((d) => new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })).join(', ');

// ---- The week board ----

export function weekBoard(week, ctx) {
  const goals = week.week_goals;
  const goalsLine = el('section', { class: 'week-goals', 'aria-label': 'This week’s goals' },
    el('h2', { class: 'week-goals-title' }, `This week’s goals · ${goals.length} of ${week.weekly_goals_max}`),
    ...goals.map((t) => el('span', { class: t.done ? 'week-goal is-done' : 'week-goal' }, `★ ${t.text}`,
      el('span', { class: 'week-goal-day' }, ` · ${/^\d{4}-/.test(t.due) ? dueLabel(t.due) : 'no day'}`))),
    ...(goals.length > week.weekly_goals_max ? [el('span', { class: 'plan-warning' }, `${goals.length} Weekly Goals: five keep a week clear`)] : []),
    ...(goals.length ? [] : [el('span', { class: 'plan-empty' }, 'No Weekly Goals yet: ☆ on a task makes one.')]));

  const columns = week.days.map((d) => {
    const load = dayLoad(d, d.day, week.settings);
    const goal = d.tasks.find((t) => t.goal_week === week.week && t.id === d.highlight_id) ?? d.tasks.find((t) => t.goal_week === week.week);
    const rest = d.tasks.filter((t) => t !== goal);
    const goalSlot = goal
      ? el('div', { class: 'week-goal-slot has-goal' }, `★ ${goal.text}`)
      : el('div', { class: 'week-goal-slot' }, '+ Weekly Goal');
    // A task let go on the goal slot becomes that day's Weekly Goal.
    ctx.dropTarget(goalSlot, (task) => ctx.change(task, { due: d.day, plan_part: '', block_id: null, goal_week: week.week }));
    const column = el('section', { class: `week-column${d.day === week.today ? ' is-today' : ''}`, 'aria-label': weekday(d.day), 'data-day': d.day },
      el('button', { type: 'button', class: 'week-column-name', onclick: () => ctx.openDay(d.day) }, weekday(d.day)),
      el('div', { class: `load-bar${load.over > 0 ? ' is-over' : ''}`, title: `${duration(load.planned)} planned of ${duration(load.budget)}` },
        el('span', { class: 'load-fill', style: `width: ${Math.min(100, (load.planned / load.budget) * 100)}%` })),
      el('p', { class: load.over > 0 ? 'week-load is-over' : 'week-load' },
        load.over > 0 ? `Over by ${duration(load.over)}` : `${duration(load.planned)} of ${duration(load.budget)}`),
      goalSlot,
      ...d.events.filter((e) => !e.all_day).map((e) => el('div', { class: 'week-event', style: eventLine(e) },
        el('span', { class: 'week-event-time' }, time(e.starts_at.slice(0, 10) < d.day ? `${d.day}T00:00` : e.starts_at)), ` ${e.title}`)),
      ...rest.map((t) => {
        const row = el('div', { class: 'week-task', 'data-checked': String(t.done) }, ctx.box(t), starButton(t, () => ctx.reload()),
          t.flag ? flagChip(t.flag) : null, el('button', { type: 'button', class: 'week-task-text task-open', title: t.text, onclick: () => ctx.openTask(t) }, t.short_text || t.text), ctx.minutesChip(t));
        ctx.draggable(row, t);
        return row;
      }));
    ctx.dropTarget(column, (task) => ctx.change(task, { due: d.day, plan_part: '', block_id: null }));
    return column;
  });
  const review = el('button', { type: 'button', class: 'button button-quiet week-review-open', onclick: () => ctx.openReview() }, 'Weekly Review (⇧R)');
  return [goalsLine, el('div', { class: 'week-columns' }, ...columns), review];
}

// ---- The panel ----

// Each step: its name, its end state in one line, and what the week (or day) says now.
function weeklySteps(week, waiting) {
  const goals = week.week_goals;
  const loads = week.days.map((d) => ({ day: d.day, ...dayLoad(d, d.day, week.settings) }));
  const workdays = week.days.slice(0, 5);
  const noGoal = workdays.filter((d) => !d.tasks.some((t) => t.goal_week === week.week)).map((d) => d.day);
  const goalsWithoutDay = goals.filter((t) => !/^\d{4}-/.test(t.due));
  const over = loads.filter((l) => l.over > 0);
  return [
    { key: 'brain_zen', name: 'Brain Zen', end: 'Everything for this week is on the Tasks page.',
      now: waiting ? `${waiting} ${waiting === 1 ? 'capture waits' : 'captures wait'} in the Inbox.` : 'The Inbox is empty.' },
    { key: 'goal_alignment', name: 'Goal Alignment', end: 'Five Weekly Goals at most.',
      now: `${goals.length} Weekly ${goals.length === 1 ? 'Goal' : 'Goals'}${goals.length > 5 ? ': one too many is a lot' : ''}.` },
    { key: 'schedule', name: 'Schedule', end: 'Every task has a day, every day a Weekly Goal.',
      now: [goalsWithoutDay.length ? `${goalsWithoutDay.length} ${goalsWithoutDay.length === 1 ? 'goal has' : 'goals have'} no day` : 'Every goal has a day',
        noGoal.length ? `${names(noGoal)} ${noGoal.length === 1 ? 'has' : 'have'} no Weekly Goal` : 'every weekday has one'].join('; ') + '.' },
    { key: 'balance', name: 'Balance', end: 'No day over budget.',
      now: over.length ? over.map((l) => `${names([l.day])} is over by ${duration(l.over)}`).join(', ') + '.' : 'No day is over budget.' },
    { key: 'rebalance', name: 'Re-balance', end: 'Each day makes sense on its own.', now: 'Look at each day: would you do it as it is?' },
  ];
}

function dailySteps(plan) {
  const load = dayLoad(plan, plan.day, plan.settings);
  const open = plan.tasks.filter((t) => !t.done);
  const highlight = plan.tasks.find((t) => t.id === plan.highlight_id);
  const top = highlight ?? open[0];
  return [
    { key: 'review', name: 'Review the tasks', end: 'You know what is on today.',
      now: `${open.length} ${open.length === 1 ? 'task' : 'tasks'} planned${plan.tray.missed.length ? `, ${plan.tray.missed.length} missed from earlier days` : ''}.` },
    { key: 'assess', name: 'Assess feasibility', end: 'The day fits its budget.',
      now: load.over > 0 ? `The day is over budget by ${duration(load.over)}: move something out first.` : `It fits: ${duration(load.budget - load.planned)} to spare.` },
    { key: 'highlight', name: 'Identify the Highlight', end: 'One task the day is about.',
      now: highlight ? `The Highlight: ${highlight.text}.` : 'No Highlight yet: pick one.', pick: !highlight },
    { key: 'order', name: 'Order the tasks', end: 'The Highlight first, then Morning and Afternoon.',
      now: `${open.filter((t) => !t.plan_part && !t.block_id && t !== highlight).length} not in a part yet.` },
    { key: 'execute', name: 'Execute', end: 'You start the top task.', now: top ? `Start with: ${top.text}.` : 'Nothing to start.' },
  ];
}

// The panel's contents: the flow's steps with Done and Skip, and where it resumes.
export async function planningPanel(kind, ctx) {
  const period = kind === 'weekly' ? ctx.week.week : ctx.day;
  let flow = await flowApi.get(kind, period);
  let waiting = 0;
  if (kind === 'weekly') {
    try { waiting = (await api.captureCount()).waiting; } catch { waiting = 0; }
  }
  const steps = kind === 'weekly' ? weeklySteps(ctx.week, waiting) : dailySteps(ctx.plan);
  const doneCount = Object.keys(flow.steps).length;
  const mark = async (key, state) => {
    flow = await flowApi.set(kind, period, key, state);
    await ctx.reload();
  };
  return [
    el('div', { class: 'planning-head' },
      el('h2', { class: 'planning-title' }, kind === 'weekly' ? 'Weekly Planning' : 'Daily Planning'),
      el('span', { class: 'plan-free' }, `${doneCount} of ${steps.length}`),
      el('button', { type: 'button', class: 'plan-out', 'aria-label': 'Close the planning', onclick: () => ctx.close() }, '×')),
    el('ol', { class: 'planning-steps' }, ...steps.map((s) => {
      const state = flow.steps[s.key];
      const current = flow.next === s.key;
      return el('li', { class: `planning-step${current ? ' is-current' : ''}`, 'data-state': state ?? 'open', 'aria-current': current ? 'step' : false },
        el('span', { class: 'planning-mark', 'aria-hidden': 'true' }, state === 'done' ? '✓' : state === 'skipped' ? '–' : ''),
        el('div', { class: 'planning-body' },
          el('h3', { class: 'planning-name' }, s.name, state ? el('span', { class: 'plan-free' }, state === 'done' ? ' · done' : ' · skipped') : null),
          el('p', { class: 'planning-end' }, s.end),
          el('p', { class: 'planning-now' }, s.now),
          ...(s.pick && current ? [el('div', { class: 'planning-picks' }, ...ctx.plan.tasks.filter((t) => !t.done).slice(0, 6).map((t) => el('button', {
            type: 'button', class: 'button', onclick: () => ctx.makeHighlight(t),
          }, t.text)))] : []),
          el('div', { class: 'planning-actions' }, ...(state
            ? [el('button', { type: 'button', class: 'button button-quiet', onclick: () => mark(s.key, null) }, 'Undo')]
            : [el('button', { type: 'button', class: 'button', onclick: () => mark(s.key, 'done') }, 'Done'),
              el('button', { type: 'button', class: 'button button-quiet', onclick: () => mark(s.key, 'skipped') }, 'Skip')]))));
    })),
    flow.next ? null : el('p', { class: 'planning-end' }, kind === 'weekly' ? 'The week is planned.' : 'The day is planned. Start with the top task.'),
  ].filter(Boolean);
}


// ---- The Weekly Review ----

const reviewApi = {
  get: (day) => request('GET', `/api/reviews/week/${day}`),
  close: (day, wins) => request('PUT', `/api/reviews/week/${day}`, { wins }),
  reopen: (day) => request('DELETE', `/api/reviews/week/${day}`),
};
const OUTCOME = { not_done: 'not done', moved: 'moved' };
// The wins line being typed survives a redraw of the panel: week → words.
const winsDrafts = new Map();
let winsHadCursor = false; // the wins line had the cursor when the panel redrew
const shortDay = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short' });
const span = (monday) => {
  const date = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sunday = new Date(`${monday}T12:00`);
  sunday.setDate(sunday.getDate() + 6);
  return `${date(monday)} – ${sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};

export async function reviewPanel(ctx) {
  const review = await reviewApi.get(ctx.week.week);
  const back = review.look_back;
  const section = (title, ...rows) => el('section', { class: 'review-part', 'aria-label': title }, el('h3', { class: 'review-title' }, title), ...rows);
  const wins = el('input', {
    class: 'detail-input review-wins', 'aria-label': 'This week’s wins', placeholder: 'This week’s wins, in one line', maxlength: 300,
    value: winsDrafts.get(review.week) ?? review.wins, oninput: () => winsDrafts.set(review.week, wins.value),
    onfocus: () => { winsHadCursor = true; }, onblur: () => { if (wins.isConnected) winsHadCursor = false; },
  });
  if (winsHadCursor) wantsCursor(wins);
  const problem = el('p', { class: 'capture-problem', role: 'alert' });
  const act = (work) => async () => {
    try { await work(); await ctx.reload(); } catch (err) { problem.textContent = err.message; }
  };
  const closeWeek = act(async () => { await reviewApi.close(review.week, wins.value); winsDrafts.delete(review.week); });
  wins.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); closeWeek(); } };
  const withHighlight = back.days.filter((d) => d.highlight);
  const lines = back.days.filter((d) => d.line);
  return [
    el('div', { class: 'planning-head' },
      el('h2', { class: 'planning-title' }, 'Weekly Review'),
      review.closed ? el('span', { class: 'day-closed-chip' }, icon('moon'), 'Week closed') : el('span', { class: 'plan-free' }, span(review.week)),
      el('button', { type: 'button', class: 'plan-out', 'aria-label': 'Close the review', onclick: () => ctx.close() }, '×')),
    ...(review.closed ? [el('p', { class: 'planning-end' }, `${span(review.week)}, as it was when you closed it.`)] : []),
    section('Planned against done',
      el('div', { class: 'review-days' }, ...back.days.map((d) => el('span', { class: 'review-day', 'data-day': d.day },
        el('span', { class: 'review-day-name' }, shortDay(d.day)),
        el('b', {}, d.to_come || !d.planned ? '–' : `${d.done}/${d.planned}`)))),
      el('p', { class: 'planning-now' }, back.planned ? `${back.done} of ${back.planned} planned tasks done.` : 'Nothing was planned yet.')),
    section(`Highlights · ${back.highlights_hit} of ${back.highlights} hit`,
      ...(withHighlight.length ? withHighlight.map((d) => el('div', { class: 'review-row', 'data-checked': String(d.highlight.outcome === 'done') },
        el('span', { class: 'task-box', 'aria-hidden': 'true' }, d.highlight.outcome === 'done' ? '✓' : ''),
        el('span', { class: 'review-text' }, `${shortDay(d.day)} · ${d.highlight.text}`),
        ...(OUTCOME[d.highlight.outcome] ? [el('span', { class: 'plan-free' }, OUTCOME[d.highlight.outcome])] : [])))
        : [el('p', { class: 'planning-end' }, 'No Highlights this week.')])),
    section('Weekly Goals that kept moving',
      ...(back.kept_moving.length ? back.kept_moving.map((g) => el('div', { class: 'review-row' },
        el('span', { class: 'review-text' }, `★ ${g.text}`), el('span', { class: 'plan-free' }, `moved ${g.moves} times`)))
        : [el('p', { class: 'planning-end' }, back.goals.length ? 'None kept moving.' : 'No Weekly Goals this week.')])),
    section('Your lines this week',
      ...(lines.length ? lines.map((d) => el('p', { class: 'review-line' }, el('span', { class: 'plan-free' }, `${shortDay(d.day)} `), `“${d.line}”`))
        : [el('p', { class: 'planning-end' }, 'No day closed yet: Close the day (⇧X) writes one.')])),
    review.closed
      ? section('Wins', el('p', { class: 'review-line' }, review.wins ? `“${review.wins}”` : 'No wins line.'))
      : wins,
    problem,
    el('div', { class: 'planning-actions' },
      review.closed
        ? el('button', { type: 'button', class: 'button button-quiet', onclick: act(() => reviewApi.reopen(review.week)) }, 'Reopen the week')
        : el('button', { type: 'button', class: 'button', onclick: closeWeek }, 'Close the week'),
      el('button', { type: 'button', class: 'button', onclick: () => ctx.planNext() }, 'Plan next week', icon('right'))),
  ];
}
