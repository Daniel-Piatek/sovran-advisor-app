import { test, expect, tapAtEnd } from './fixtures.js';

// Today, as this computer's clock sees it (the app and the tests run on the same one).
const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const rows = (page) => page.locator('.entry-list .entry-row');
const text = (page) => page.getByLabel('Text');
const entriesOf = async (app, day = localDay()) => (await fetch(`${app.url}/api/entries?day=${day}`)).json();

test('the journal opens on today: Journal on top with New entry beside it, then the date, the entries; no calendar', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Journal' }).click();
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Journal');
  await expect(page.locator('.day-date')).toHaveText(
    await page.evaluate(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
  await expect(page.locator('.day-weekday')).toContainText('Today');
  await expect(page.getByText('Nothing written today yet.')).toBeVisible();
  // There is no write box: New entry sits on the title's line.
  await expect(page.locator('.journal-main .ProseMirror')).toHaveCount(0);
  const button = page.getByRole('link', { name: 'New entry' });
  const box = async (l) => l.evaluate((n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const [h, b] = [await box(heading), await box(button)];
  expect(b.top).toBeLessThan(h.bottom);
  expect(b.bottom).toBeGreaterThan(h.top);
  await expect(page.locator('.journal-main .journal-section')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Today’s entries' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Today’s entries' }).getByRole('group', { name: 'Journals' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Today’s calendar' })).toHaveCount(0);
});

test('New entry opens a page like a note’s; what is written there is an entry of the day', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/new\\?day=${localDay()}$`));
  await expect(page.getByLabel('Title')).toHaveAttribute('placeholder', 'Untitled');
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await expect(page.getByRole('region', { name: 'Info' })).toContainText('Written');
  await page.keyboard.type('Call with Z went **well**.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const [entry] = await entriesOf(app);
  // Once made, the address is the entry's own.
  await expect(page).toHaveURL(`${app.url}/journal/entries/${entry.id}`);
  expect(entry.preview).toBe('Call with Z went **well**.');
  await page.keyboard.type(' More later.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await entriesOf(app)).map((e) => e.preview)).toEqual(['Call with Z went **well**. More later.']);

  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Call with Z went well. More later.']);
  await expect(rows(page).first().locator('.entry-row-when')).toHaveText(/^\d{1,2}:\d{2}/);
  await rows(page).first().click();
  await expect(text(page).locator('strong')).toHaveText('well');
});

test('n opens a new entry; one given only a title is kept; one left empty makes nothing', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/journal\/new/);
  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(page.getByText('Nothing written today yet.')).toBeVisible();
  expect(await entriesOf(app)).toEqual([]);

  await page.getByRole('link', { name: 'New entry' }).click();
  await page.getByLabel('Title').fill('Just a title');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(rows(page).locator('.entry-row-title')).toHaveText(['Just a title']);
});

test('an entry page: give it a title, write more, and it saves', async ({ page, app }) => {
  const entry = await (await fetch(`${app.url}/api/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Budget is fixed.' }),
  })).json();
  await page.goto(`${app.url}/journal/entries/${entry.id}`);
  await expect(page.getByLabel('Title')).toHaveAttribute('placeholder', 'Untitled');
  await page.getByLabel('Title').fill('Call with Z');
  await page.keyboard.press('Enter');
  await tapAtEnd(text(page));
  await page.keyboard.type(' Timing matters.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('region', { name: 'Info' })).toContainText('Written');

  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(page).toHaveURL(`${app.url}/journal/${entry.day}`);
  await expect(rows(page).locator('.entry-row-title')).toHaveText(['Call with Z']);
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Budget is fixed. Timing matters.']);
});

test('Delete takes an entry off its day, and Undo brings it back', async ({ page, app }) => {
  for (const body of ['To be deleted', 'Stays']) {
    await fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  }
  await page.goto(`${app.url}/journal`);
  await rows(page).first().click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page).toHaveURL(new RegExp(`/journal/${localDay()}$`));
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Stays']);
  await expect(page.locator('.undo-bar')).toContainText('deleted');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['To be deleted', 'Stays']);
});

test('Delete on a new entry with nothing written goes back to the day, with nothing made', async ({ page, app }) => {
  await page.goto(`${app.url}/journal/new?day=${localDay()}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/${localDay()}$`));
  expect(await entriesOf(app)).toEqual([]);
});

test('typed in a new entry and left at once: it is kept', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('Half a thought');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Notes' }).click();
  await expect(page.getByText('No notes yet.')).toBeVisible();
  expect((await entriesOf(app)).map((e) => e.preview)).toEqual(['Half a thought']);
});

test('...and when the page is reloaded', async ({ page, app }) => {
  await page.goto(`${app.url}/journal/new?day=${localDay()}`);
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('Typed, then reloaded');
  await page.reload();
  await expect.poll(async () => (await entriesOf(app)).map((e) => e.preview)).toEqual(['Typed, then reloaded']);
});

test('any day has its own page, and a new entry from there is on that day', async ({ page, app }) => {
  await page.goto(`${app.url}/journal/2026-10-20`);
  await expect(page.locator('.day-date')).toHaveText(
    await page.evaluate(() => new Date(2026, 9, 20).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
  await expect(page.locator('.day-weekday')).not.toContainText('Today');
  await expect(page.getByText('Nothing written on this day.')).toBeVisible();
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page.getByRole('link', { name: 'Back to Journal' })).toContainText('Oct 20');
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('Written later for that day');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect((await entriesOf(app, '2026-10-20')).map((e) => e.preview)).toEqual(['Written later for that day']);
});

test('the slash menu works in a new entry', async ({ page, app }) => {
  await page.goto(`${app.url}/journal/new?day=${localDay()}`);
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('/quote');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Keep it small.');
  await expect(text(page).locator('blockquote')).toHaveText('Keep it small.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await entriesOf(app))[0].preview).toBe('> Keep it small.');
});

test('typing on while the new entry is first saved makes it once, with every word', async ({ page, app }) => {
  await page.goto(`${app.url}/journal/new?day=${localDay()}`);
  // Make the first save slow, so the typing goes on while it is under way.
  await page.route('**/api/entries', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('First words');
  await page.waitForTimeout(900); // the save has started
  await page.keyboard.type(', and then more');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect.poll(async () => (await entriesOf(app)).map((e) => e.preview)).toEqual(['First words, and then more']);
});

test.describe('when the app does not answer', () => {
  test.use({ expectedConsoleErrors: [/Failed to load resource/] });

  test('the words stay on the page and are saved once it answers again', async ({ page, app }) => {
    await page.goto(`${app.url}/journal/new?day=${localDay()}`);
    let down = true;
    await page.route('**/api/entries', (route) => (route.request().method() === 'POST' && down
      ? route.fulfill({ status: 500, body: '{}' })
      : route.continue()));
    await expect(page.getByLabel('Title')).toBeFocused(); // the cursor starts in the title
    await page.keyboard.press('Enter');
    await expect(text(page)).toBeFocused();
    await page.keyboard.type('Not saved yet');
    await expect(page.getByRole('status')).toHaveText("Couldn't save. Trying again…");
    await expect(text(page)).toHaveText('Not saved yet');
    down = false;
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 15_000 });
    expect((await entriesOf(app)).map((e) => e.preview)).toEqual(['Not saved yet']);
  });
});
