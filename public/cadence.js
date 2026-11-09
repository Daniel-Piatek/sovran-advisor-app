// A reconnect rhythm (People in depth, advanced/people/5): the cadence chip under a person's
// name (how often you want to be in touch, with days left or overdue; pressing it changes it)
// and the Reconnect list at the top of People. Last in touch is never typed: the server works
// it out from the person's logged lines.

import { el, request } from './ui.js';

export const CADENCES = [[null, 'Off'], [7, 'Weekly'], [14, 'Every 2 weeks'], [21, 'Every 3 weeks'], [30, 'Monthly'], [90, 'Quarterly']];
const labelOf = (days) => CADENCES.find(([d]) => d === (days ?? null))?.[1] ?? 'Off';
const plural = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

// How long until they are due, in words.
export const dueWords = (left) => (left < 0 ? `${plural(-left)} overdue` : left === 0 ? 'due today' : `due in ${plural(left)}`);

// The chip's words: "Weekly · 2 days overdue", or "No rhythm" when it is Off.
export const chipWords = (person) => (person.cadence_days
  ? `${labelOf(person.cadence_days)} · ${dueWords(person.days_left)}${person.last_in_touch ? '' : ' · nothing logged yet'}` : 'No rhythm');

// The chip, and under it the choices when pressed. onChange(person) runs after a choice is saved.
export function cadenceChip(person, { onChange = () => {} } = {}) {
  let current = person;
  const choices = el('div', { class: 'journal-filters cadence-choices', role: 'group', 'aria-label': 'How often', hidden: true });
  const message = el('span', { class: 'journal-tools-message', role: 'alert' });
  const chip = el('button', {
    type: 'button', class: 'chip cadence-chip', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'How often you want to be in touch',
    onclick: () => { choices.hidden = !choices.hidden; chip.setAttribute('aria-expanded', String(!choices.hidden)); },
  });

  function draw() {
    chip.textContent = chipWords(current);
    chip.classList.toggle('chip-quiet', !current.cadence_days);
    chip.dataset.overdue = String(Boolean(current.cadence_days) && current.days_left < 0);
    choices.replaceChildren(...CADENCES.map(([days, label]) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String((current.cadence_days ?? null) === days),
      onclick: async () => {
        try {
          current = await request('PATCH', `/api/people/${current.id}`, { cadence_days: days });
          message.textContent = '';
          choices.hidden = true;
          chip.setAttribute('aria-expanded', 'false');
          draw();
          onChange(current);
        } catch (err) { message.textContent = err.message; }
      },
    }, label)));
  }
  draw();
  return { element: el('div', { class: 'cadence' }, chip, choices, message), refresh: (fresh) => { current = fresh; draw(); } };
}

// The Reconnect list: everyone with a rhythm, the most overdue first. Remind me (for the
// ones who are due) makes the task "Reconnect with <first name>" for tomorrow.
export async function reconnectSection() {
  const list = el('div', { class: 'reconnect-list' });
  const section = el('section', { class: 'reconnect', 'aria-label': 'Reconnect' }, el('h2', { class: 'contact-heading' }, 'Reconnect'), list);
  let people = [];
  try { people = await request('GET', '/api/reconnect'); } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Reconnect couldn't be loaded. Is the app still running?"));
    return section;
  }
  if (!people.length) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Nobody has a rhythm yet. Set one under a person’s name: weekly, monthly, quarterly…'));
    return section;
  }
  list.replaceChildren(...people.map((p) => {
    const message = el('span', { class: 'journal-tools-message', role: 'status' });
    const remind = p.days_left <= 0 ? el('button', {
      type: 'button', class: 'button', onclick: async () => {
        remind.disabled = true;
        try {
          const made = await request('POST', `/api/people/${p.id}/remind`, {});
          message.textContent = made.existing ? 'Already on your Tasks.' : `Added “Reconnect with ${p.name.trim().split(/\s+/)[0]}” for tomorrow.`;
          remind.textContent = 'Reminded';
        } catch (err) { message.textContent = err.message; remind.disabled = false; }
      },
    }, 'Remind me') : null;
    return el('div', { class: 'reconnect-row', 'data-due': String(p.days_left <= 0) },
      el('a', { class: 'person-row', href: `/people/${p.id}` },
        el('span', { class: 'face face-person face-small', 'aria-hidden': 'true' }, p.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'),
        el('span', { class: 'person-row-text' },
          el('span', { class: 'person-row-name' }, p.name),
          el('span', { class: 'person-row-sub' }, [p.cadence_label, p.last_in_touch ? `last in touch ${p.last_in_touch}` : 'nothing logged yet'].join(' · '))),
        el('span', { class: 'person-row-count reconnect-due' }, dueWords(p.days_left))),
      ...(remind ? [remind] : []), message);
  }));
  return section;
}
