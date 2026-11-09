// Your assistant proposes, you confirm (Calendar in depth 10). The assistant is tests/fake-claude.js: no real model.
import { test, expect } from './fixtures.js';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);
const events = (app) => fetch(`${app.url}/api/events?from=2000-01-01&to=2100-01-01`).then((r) => r.json());

async function ask(page, app, words) {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(words);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
}

// The next weekday that is not today or tomorrow, so a free afternoon exists whatever day the test runs.
async function aBusyWeek(app) {
  await send(app, 'PATCH', '/api/settings', { day_start: '09:00', split: '13:00', day_end: '18:00' });
  // Every day this week has its afternoon taken until 17:30 except one, so the one hour is found there and says why.
  const free = new Date(); free.setDate(free.getDate() + 2);
  while ([0, 6].includes(free.getDay())) free.setDate(free.getDate() + 1);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(); d.setDate(d.getDate() + i);
    if (localDay(d) === localDay(free)) {
      await send(app, 'POST', '/api/events', { title: 'Call with Lena', starts_at: `${localDay(d)}T10:00`, ends_at: `${localDay(d)}T10:30` });
      continue;
    }
    await send(app, 'POST', '/api/events', { title: `Busy ${i}`, starts_at: `${localDay(d)}T09:00`, ends_at: `${localDay(d)}T17:30` });
  }
  return free;
}

test('“Find an hour for the workshop dry run this week”: a card says what and when and why; nothing is in your calendar until Approve; Approve puts it there; Undo takes it back', async ({ page, app }) => {
  const free = await aBusyWeek(app);
  await ask(page, app, 'Find an hour for the workshop dry run this week');
  const weekday = free.toLocaleDateString('en-US', { weekday: 'long' });
  await expect(bubbles(page, 'assistant').last()).toContainText(`${weekday} at 14:00 is free in your calendar and your plan`);
  const card = page.locator('.action-card[data-kind="calendar_propose"]');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await expect(card).toContainText(`Add “Workshop dry run” ${localDay(free)} 14:00–15:00`);
  await expect(card).toContainText(`${weekday} at 14:00: free in your calendar and your plan`);
  await expect(card).toContainText('Nothing exists until you approve');
  expect(await events(app)).toHaveLength(7); // the busy week only: nothing was added

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  const made = (await events(app)).find((e) => e.title === 'Workshop dry run');
  expect([made.starts_at, made.ends_at]).toEqual([`${localDay(free)}T14:00`, `${localDay(free)}T15:00`]);
  // It is on the Calendar (opened beside the chat).
  const calendar = await page.context().newPage();
  await calendar.goto(`${app.url}/calendar/${localDay(free)}?view=day`);
  await expect(calendar.getByRole('button', { name: /^Workshop dry run, / })).toBeVisible();
  await calendar.close();

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.action-card[data-kind="calendar_propose"]')).toHaveAttribute('data-state', 'undone');
  expect((await events(app)).find((e) => e.title === 'Workshop dry run')).toBeUndefined();
});

test('Not now makes nothing; even with “Does it alone” a meeting waits for your yes', async ({ page, app }) => {
  await aBusyWeek(app);
  const set = await send(app, 'PUT', '/api/assistant/permissions', { key: 'change', mode: 'alone' }); // the switch that lets other changes through
  expect(JSON.stringify(set)).toContain('alone');
  await ask(page, app, 'Find an hour for the pricing review this week');
  const card = page.locator('.action-card[data-kind="calendar_propose"]');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  const before = (await events(app)).length;
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveAttribute('data-state', 'dismissed');
  expect((await events(app)).length).toBe(before);
});

test('switch Calendar in depth off in Settings › Modules and your assistant cannot see or propose calendar events', async ({ page, app }) => {
  await aBusyWeek(app);
  await send(app, 'PATCH', '/api/modules', { id: 'calendar-plus', on: false });
  await ask(page, app, 'Find an hour for the workshop dry run this week');
  await expect(page.locator('.action-card[data-kind="calendar_propose"]')).toHaveCount(0);
  await expect(bubbles(page, 'assistant').last()).toContainText('I have no way to look at your calendar');
});
