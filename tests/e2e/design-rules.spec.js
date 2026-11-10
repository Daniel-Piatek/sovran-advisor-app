// Design rules that only the browser can see (the rules are in AGENTS.md, "Design rules").
// One accent colour, on at most one thing per screen.

import { test, expect } from './fixtures.js';

// Every screen of the app, with some test data, and what shows once it is drawn.
// Add each new screen here.
const screens = [
  { name: 'the notes list', ready: '.note-card', open: async (app) => { await app.createNote({ title: 'A note', body: 'Text' }); return '/'; } },
  { name: 'a note', ready: '.note-info', open: async (app) => `/notes/${(await app.createNote({ title: 'A note', body: 'Text' })).id}` },
  { name: 'the journal', ready: '.entry-list .entry-row', open: async (app) => {
    const add = (body) => fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    await add('{"body":"An entry"}');
    await add('{"body":"An earlier entry","day":"2020-01-01"}');
    return '/journal';
  } },
  { name: 'a journal entry', ready: '.note-info', open: async (app) => {
    const res = await fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"body":"An entry"}' });
    return `/journal/entries/${(await res.json()).id}`;
  } },
  { name: 'the Inbox', ready: '.inbox-item', open: async (app) => {
    await fetch(`${app.url}/api/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"body":"A thought"}' });
    return '/inbox';
  } },
  // On a phone the list comes first; ?c= opens the capture itself.
  { name: 'a capture in the Inbox', ready: '.inbox-choices', open: async (app) => {
    const res = await fetch(`${app.url}/api/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"body":"A thought"}' });
    return `/inbox?c=${(await res.json()).id}`;
  } },
  { name: 'People', ready: '.person-row', open: async (app) => {
    await fetch(`${app.url}/api/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Lena Fischer"}' });
    return '/people';
  } },
  { name: 'a person', ready: '.contact-details', open: async (app) => {
    const res = await fetch(`${app.url}/api/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Lena Fischer"}' });
    return `/people/${(await res.json()).id}`;
  } },
  { name: 'a company', ready: '.contact-details', open: async (app) => {
    const res = await fetch(`${app.url}/api/companies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Nordlicht"}' });
    return `/companies/${(await res.json()).id}`;
  } },
  { name: 'Tasks', ready: '.task-row', open: async (app) => {
    await app.createNote({ title: 'Plan', body: '- [ ] Call the bank @2020-01-01\n- [ ] Pay rent' });
    return '/tasks';
  } },
  { name: 'the Planner', ready: '.plan-slot', open: async (app) => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const planned = await (await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Planned', due: day, estimate: 30 }) })).json();
    await fetch(`${app.url}/api/tasks/${planned.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_part: 'morning', plan_at: '10:00' }) });
    await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Not placed yet', due: day }) });
    await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Waiting' }) });
    return '/planner';
  } },
  { name: 'the Planner’s week', ready: '.week-column', open: async () => '/planner?view=week' },
  { name: 'the Planner’s quarter', ready: '.quarter-week', open: async (app) => {
    await fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kind":"goal","title":"Launch the course","horizon":"quarter"}' });
    return '/planner?view=quarter';
  } },
  { name: 'the Calendar', ready: '.cal-event', open: async (app) => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Dentist', starts_at: `${day}T10:00`, ends_at: `${day}T11:00` }) });
    return '/calendar';
  } },
  { name: 'My Life', ready: '.life-card', open: async (app) => {
    const post = (body) => fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const health = await post({ kind: 'key_element', title: 'Health' });
    await post({ kind: 'project', title: 'Spring plan', home_id: health.id });
    return '/life';
  } },
  { name: 'a My Life item', ready: '.life-title', open: async (app) => {
    const res = await fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kind":"project","title":"Spring plan"}' });
    return `/life/${(await res.json()).id}`;
  } },
  { name: 'the Assistant', ready: '.chat-input', open: async () => '/assistant' },
  { name: 'Settings', ready: '.permission-row', open: async () => '/settings' },
  { name: 'the Library', ready: '.lib-swatch', open: async () => '/library' },
  { name: 'a conversation', ready: '.chat-bubble[data-state="done"]', open: async (app) => {
    const res = await fetch(`${app.url}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const { id } = await res.json();
    await (await fetch(`${app.url}/api/conversations/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"Please make a file a.txt"}' })).text();
    return `/assistant/${id}`;
  } },
  { name: 'Recently deleted', ready: '.deleted-row', open: async (app) => {
    const note = await app.createNote({ title: 'Gone' });
    await fetch(`${app.url}/api/notes/${note.id}`, { method: 'DELETE' });
    return '/deleted';
  } },
];

// The elements that show the accent, counted once each: as text colour (not counting
// children that only inherit it), background, border or outline.
async function accentElements(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();

    const found = [];
    for (const el of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      // Section headings are Crimson too (2026-11-09, the owner's wish): they name parts, they are not actions.
      const ownText = style.color === accent && getComputedStyle(el.parentElement).color !== accent && !el.matches('h1, h2, h3, h4, h5, h6');
      const borders = ['Top', 'Right', 'Bottom', 'Left']
        .some((side) => style[`border${side}Style`] !== 'none' && style[`border${side}Color`] === accent);
      const outline = style.outlineStyle !== 'none' && style.outlineColor === accent;
      if (ownText || style.backgroundColor === accent || borders || outline) {
        found.push(el.outerHTML.slice(0, 80));
      }
    }
    return found;
  });
}

for (const theme of ['light', 'dark']) {
  for (const screen of screens) {
    test(`at most one thing uses the accent on ${screen.name} (${theme})`, async ({ page, app }) => {
      await page.goto(app.url + await screen.open(app));
      await expect(page.locator(screen.ready).first()).toBeVisible();
      if (theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const found = await accentElements(page);
      expect(found.length, `accent used on:\n${found.join('\n')}`).toBeLessThanOrEqual(1);
    });
  }
}

// A slip in the code that draws a screen can show "null" or "undefined" as text.
for (const screen of screens) {
  test(`no stray "null" or "undefined" on ${screen.name}`, async ({ page, app }) => {
    await page.goto(app.url + await screen.open(app));
    await expect(page.locator(screen.ready).first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/\b(null|undefined|NaN|\[object Object\])\b/);
  });
}

test('the accent check counts a second accent', async ({ page, app }) => {
  await page.goto(app.url);
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
  const before = (await accentElements(page)).length;
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<button style="background: var(--color-accent)">Save</button><a style="color: var(--color-accent)">Open <b>this</b></a>');
  });
  expect(await accentElements(page)).toHaveLength(before + 2);
});
