import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const pad = (n) => String(n).padStart(2, '0');
const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const rows = (page) => page.locator('.timeline-row');

async function seed(app) {
  const note = await app.createNote({ title: 'Onboarding call with Lena', body: 'Lena starts on Monday.' });
  await send(app, 'POST', '/api/entries', { body: 'Morning pages about the proposal review.' });
  const task = await send(app, 'POST', '/api/tasks', { text: 'Send the proposal' });
  await send(app, 'PATCH', `/api/tasks/${task.id}`, { done: true });
  await send(app, 'POST', '/api/captures', { body: 'Ask Jonas about the venue' });
  // One event long past today's start and one still ahead tonight (the line at now sits between).
  await send(app, 'POST', '/api/events', { title: 'Late call with Jonas', starts_at: `${localDay()}T23:30`, ends_at: `${localDay()}T23:59` });
  return { note, task };
}

test('the Timeline: today on top with a line at now; every kind is a row that opens where it lives', async ({ page, app }) => {
  const { note } = await seed(app);
  await page.goto(`${app.url}/timeline`);
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const text = rows(page).locator('.timeline-text');
  await expect(text).toContainText(['Ask Jonas about the venue', 'Send the proposal', 'Morning pages about the proposal review.', 'Onboarding call with Lena'], { timeout: 5000 });
  await expect(rows(page).locator('.timeline-where').filter({ hasText: 'Task done' })).toHaveCount(1);
  // The kind is told by its shape and its word, and each row carries both.
  await expect(rows(page).first().locator('.timeline-shape svg')).toBeVisible();
  // The line at now: what is ahead (tonight's call) above it, what happened below it.
  await expect(page.getByRole('separator', { name: 'Now' })).toHaveCount(1);
  const order = await page.locator('.timeline-day').first().locator('.timeline-row, .timeline-now').evaluateAll((els) => els.map((e) => (e.classList.contains('timeline-now') ? 'NOW' : e.textContent)));
  const now = order.indexOf('NOW');
  const late = new Date().getHours() === 23 && new Date().getMinutes() >= 30; // after 23:30 the evening call is no longer ahead
  expect(order.slice(0, now).some((t) => t.includes('Late call with Jonas')) || late).toBe(true);
  expect(order.slice(now + 1).some((t) => t.includes('Send the proposal'))).toBe(true);

  // Each row opens its own thing.
  await rows(page).filter({ hasText: 'Onboarding call with Lena' }).click();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await page.goBack();
  await rows(page).filter({ hasText: 'Ask Jonas about the venue' }).click();
  await expect(page).toHaveURL(/\/inbox(\?c=[0-9a-f-]{36})?$/); // the Inbox opens its first capture
});

test('switch Captures off, then search a name: only the rows that hold it are left, and the address keeps both', async ({ page, app }) => {
  await seed(app);
  await send(app, 'POST', '/api/captures', { body: 'Lena asked about the budget' });
  await page.goto(`${app.url}/timeline`);
  await expect(rows(page).filter({ hasText: 'Lena asked about the budget' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Captures' }).click();
  await expect(page.getByRole('button', { name: 'Captures' })).toHaveAttribute('aria-pressed', 'false');
  await expect(rows(page).filter({ hasText: 'Lena asked about the budget' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Send the proposal' })).toHaveCount(1);
  await page.getByLabel('Search the Timeline').fill('lena');
  await expect(rows(page).locator('.timeline-text')).toHaveText(['Onboarding call with Lena']); // the body holds Lena, the note's title too
  await expect(page).toHaveURL(/q=lena/);
  await expect(page).toHaveURL(/kinds=note%2Centry%2Ctask%2Cevent/);
  // Reloaded, it is as it was left; Escape clears the search.
  await page.reload();
  await expect(page.getByLabel('Search the Timeline')).toHaveValue('lena');
  await expect(page.getByRole('button', { name: 'Captures' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Search the Timeline').press('Escape');
  await expect(rows(page).filter({ hasText: 'Send the proposal' })).toHaveCount(1);
  await page.getByLabel('Search the Timeline').fill('nothing of the sort');
  await expect(page.getByText('Nothing here matches.')).toBeVisible();
});

test('an empty app says what the Timeline is for, and a long stream continues with Earlier', async ({ page, app }) => {
  await page.goto(`${app.url}/timeline`);
  await expect(page.getByText('Nothing has happened yet.')).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Now' })).toHaveCount(1); // the line is on top even so
  for (let i = 0; i < 65; i++) await app.createNote({ title: `Note ${String(i).padStart(2, '0')}` });
  await page.reload();
  await expect(rows(page)).toHaveCount(60);
  await page.getByRole('button', { name: 'Earlier' }).click();
  await expect(rows(page)).toHaveCount(65);
  await expect(page.getByRole('button', { name: 'Earlier' })).toHaveCount(0);
});

test('Settings › Modules takes the Timeline away and brings it back', async ({ page, app, isMobile }) => {
  const link = () => (isMobile ? page.getByRole('menuitem', { name: 'Timeline' }) : page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Timeline' }));
  const open = async () => { if (isMobile) await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More' }).click(); };
  await page.goto(`${app.url}/`);
  await open();
  await expect(link()).toBeVisible();
  if (isMobile) await page.keyboard.press('Escape');
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await open();
  await expect(link()).toBeHidden();
  if (isMobile) await page.mouse.click(5, 5);
  await page.goto(`${app.url}/timeline`);
  await expect(page.getByText('The Timeline comes with People in depth, which is switched off.')).toBeVisible();
  await page.getByRole('link', { name: 'Switch it on in Settings.' }).click();
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'On' }).click();
  await open();
  await expect(link()).toBeVisible();
});
