import { test, expect } from './fixtures.js';

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return dayOf(d); };
const today = shift(0);
const yesterday = shift(-1);

async function addEntry(app, entry) {
  const res = await fetch(`${app.url}/api/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return res.json();
}
const week = (page) => page.getByRole('navigation', { name: 'Week' });
const month = (page) => page.getByRole('navigation', { name: 'Month' });
// The day's own entries: in their section, under the day's calendar.
const dayRows = (page) => page.locator('.journal-main .journal-section > .entry-list .entry-row');

test('the week strip shows the week, marks the day, and goes to another day', async ({ page, app }) => {
  await addEntry(app, { day: yesterday, body: 'Yesterday I wrote this' });
  await page.goto(`${app.url}/journal`);
  await expect(week(page).locator('.week-day')).toHaveCount(7);
  await expect(week(page).locator('.week-day[aria-current="date"]')).toHaveCount(1);
  await expect(week(page).locator('.week-day[aria-current="date"]')).toHaveAttribute('data-today', '');

  await page.goto(`${app.url}/journal/${yesterday}`);
  await expect(dayRows(page).locator('.entry-row-line')).toHaveText(['Yesterday I wrote this']);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.locator('.day-weekday')).toContainText('Today');

  await week(page).getByRole('link', { name: 'Week before' }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/${shift(-7)}$`));
  await week(page).getByRole('link', { name: 'Week after' }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/${today}$`));
});

test('the small month: a dot on days with entries, the count, and any day opens', async ({ page, app, isMobile }) => {
  await addEntry(app, { day: today, body: 'one' });
  await addEntry(app, { day: today, body: 'two' });
  await addEntry(app, { day: yesterday, body: 'yesterday' });
  await page.goto(`${app.url}/journal`);
  if (isMobile) await page.getByRole('button', { name: 'Show the month' }).click();

  const todayCell = month(page).locator('.mini-day[data-today]');
  await expect(todayCell).toHaveClass(/has-entries/);
  await expect(todayCell).toHaveAttribute('aria-label', /2 entries$/);
  await expect(month(page).locator('.mini-month-count')).toHaveText(/2 entries$/);

  await month(page).locator(`.mini-day[href="/journal/${yesterday}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/journal/${yesterday}$`));
  await expect(dayRows(page).locator('.entry-row-line')).toHaveText(['yesterday']);
  if (isMobile) await page.getByRole('button', { name: 'Show the month' }).click();
  await expect(month(page).locator('.mini-month-count')).toHaveText(/1 entry$/);
  await expect(month(page).locator('.mini-day[data-today]')).toHaveClass(/has-entries/);
});

test('the small month moves between months', async ({ page, app, isMobile }) => {
  await page.goto(`${app.url}/journal/2026-10-15`);
  if (isMobile) await page.getByRole('button', { name: 'Show the month' }).click();
  const name = month(page).locator('.mini-month-name');
  const october = await name.textContent();
  await month(page).getByRole('button', { name: 'Month after' }).click();
  await expect(name).not.toHaveText(october);
  await month(page).getByRole('button', { name: 'Month before' }).click();
  await expect(name).toHaveText(october);
});

test('the day page, in order: the date with New entry, its entries with the journal buttons, the day’s calendar, Linked from; no Earlier', async ({ page, app }) => {
  const health = await (await fetch(`${app.url}/api/journals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Health"}',
  })).json();
  await addEntry(app, { day: shift(-3), body: 'Three days ago' });
  await addEntry(app, { day: today, body: 'Today' });
  await addEntry(app, { day: today, journal_id: health.id, body: 'Slept well' });
  await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Gym', starts_at: `${today}T07:00`, ends_at: `${today}T08:00` }) });
  await page.goto(`${app.url}/journal`);
  const order = ['heading', 'entries', 'calendar', 'linked'];
  const tops = {
    heading: page.locator('.day-heading'),
    entries: page.getByRole('region', { name: 'Today’s entries' }),
    calendar: page.getByRole('region', { name: 'Today’s calendar' }),
    linked: page.getByRole('heading', { name: 'Linked from' }),
  };
  const y = [];
  for (const key of order) y.push((await tops[key].boundingBox()).y);
  expect([...y].sort((a, b) => a - b)).toEqual(y);
  await expect(tops.heading.getByRole('link', { name: 'New entry' })).toBeVisible();
  await expect(tops.calendar).toContainText('Gym');
  await expect(tops.entries.getByRole('group', { name: 'Journals' })).toBeVisible();
  await expect(dayRows(page).locator('.entry-row-line')).toHaveText(['Today', 'Slept well']);
  await expect(page.getByRole('region', { name: 'Earlier' })).toHaveCount(0);
  await expect(page.getByText('Three days ago')).toHaveCount(0); // another day: reached by its day in the strip or the month
  // The journal buttons narrow the day's entries.
  await tops.entries.getByRole('group', { name: 'Journals' }).getByRole('button', { name: 'Health' }).click();
  await expect(dayRows(page).locator('.entry-row-line')).toHaveText(['Slept well']);
});

test('on a phone the small month waits behind a button, and nothing spills sideways', async ({ page, app, isMobile }) => {
  await page.goto(`${app.url}/journal`);
  if (isMobile) {
    await expect(month(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show the month' }).click();
    await expect(month(page)).toBeVisible();
  } else {
    await expect(month(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show the month' })).toBeHidden();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
