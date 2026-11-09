// Your assistant suggests where a capture goes (assistant/3), read by the stand-in claude
// command (tests/fake-claude.js): no test depends on a real AI model.
import { test, expect } from './fixtures.js';

const capture = (app, body) => fetch(`${app.url}/api/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }).then((r) => r.json());
const suggestion = (page) => page.getByRole('region', { name: 'Assistant suggestion' });
const send = (app, method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
// On a phone the list comes first: a capture opens by tapping it.
const current = (page) => page.getByRole('textbox', { name: 'Capture text' });
const showFirst = async (page) => {
  await expect(page.locator('.inbox-item:visible, [aria-label="Capture text"]:visible').first()).toBeVisible();
  if (page.viewportSize().width <= 600 && !(await current(page).isVisible())) await page.locator('.inbox-item').first().click();
};

test('a long suggestion and its Home wrap inside the bar at every screen width', async ({ page, app }, testInfo) => {
  const home = 'Save for the summer trip with the whole family';
  await send(app, 'POST', '/api/life', { kind: 'goal', title: home });
  await capture(app, `book the car service before the trip. ${home}`);
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(suggestion(page)).toContainText('Your assistant suggests a task');
  const widths = testInfo.project.name === 'phone' ? [page.viewportSize().width] : [2400, 1440, 1280, 800, 700];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: page.viewportSize().height });
      const layout = await suggestion(page).evaluate((bar) => {
        const text = bar.querySelector('.suggestion-text');
        const name = bar.querySelector('.home-dropdown-name');
        const accept = bar.querySelector('.suggestion-accept');
        const textBox = text.getBoundingClientRect();
        const nameBox = name.getBoundingClientRect();
        const acceptBox = accept.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        return {
          clippedHome: name.scrollWidth > name.clientWidth + 1,
          textOverflow: text.scrollWidth > text.clientWidth + 1,
          homeOverlapsAccept: nameBox.left < acceptBox.right && nameBox.right > acceptBox.left
            && nameBox.top < acceptBox.bottom && nameBox.bottom > acceptBox.top,
          lines: new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
          textWidth: textBox.width,
        };
      });
      expect(layout.clippedHome, `${theme}, ${width}px: full home name is readable`).toBe(false);
      expect(layout.textOverflow, `${theme}, ${width}px: text fits its column`).toBe(false);
      expect(layout.homeOverlapsAccept, `${theme}, ${width}px: Accept stays clear`).toBe(false);
      expect(layout.textWidth, `${theme}, ${width}px: words have room to wrap`).toBeGreaterThanOrEqual(150);
      expect(layout.lines).toBeGreaterThan(1);
      await expect(suggestion(page).getByRole('button', { name: 'Accept' })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`suggestion-${theme}-${width}.png`), fullPage: true });
    }
  }
  await suggestion(page).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Made a task.' })).toBeVisible();
});

test('book the car service before the trip: a task is proposed with a reason; Enter makes it, linked back', async ({ page, app }) => {
  await fetch(`${app.url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Trip plan', body: 'The car service is due.' }) });
  const made = await capture(app, 'book the car service before the trip');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(suggestion(page)).toContainText('Your assistant suggests a task');
  await expect(suggestion(page)).toContainText('“Book the car service before the trip”');
  // The reason is the bar's tooltip and its accessible description, not a line of its own.
  await expect(suggestion(page)).toHaveAttribute('title', 'It starts with something to do.');
  await expect(suggestion(page)).toHaveAccessibleDescription('It starts with something to do.');
  await expect(suggestion(page).locator('#suggestion-why')).toBeHidden();
  // Accept sits inside the bar.
  await expect(suggestion(page).getByRole('button', { name: 'Accept' })).toBeVisible();
  // Nothing moves until you accept it.
  expect((await (await fetch(`${app.url}/api/captures`)).json()).length).toBe(1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Made a task.' })).toBeVisible();
  await expect(page.locator('.inbox-zero')).toHaveText('Nothing waits.');
  const task = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Book the car service before the trip');
  expect(task.capture.id).toBe(made.id);
  // Undo puts it back, with its suggestion.
  await page.getByRole('button', { name: 'Undo' }).click();
  await showFirst(page);
  await expect(suggestion(page)).toContainText('Your assistant suggests a task');
});

test('the suggestion bar holds the Home box, the same value as the top bar\'s; the top bar\'s arrow opens it, and Accept uses it', async ({ page, app }) => {
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Save for the summer trip' });
  const made = await capture(app, 'book the car service. Save for the summer trip');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(page.locator('.suggestion-title')).toContainText('“Book the car service');
  await expect(suggestion(page)).toContainText('at home in');
  const inBar = suggestion(page).getByRole('button', { name: /Home: Save for the summer trip/ });
  await expect(inBar).toBeVisible();
  // The top bar's Home starts at the suggested one too, with its arrow.
  await expect(page.locator('.inbox-bar').getByRole('button', { name: /Home: Save for the summer trip/ })).toBeVisible();
  await expect(page.locator('.inbox-bar').getByRole('link', { name: 'Open the home' })).toHaveAttribute('href', `/life/${goal.id}`);
  await page.locator('.inbox-bar').getByRole('link', { name: 'Open the home' }).click();
  await expect(page).toHaveURL(new RegExp(`/life/${goal.id}$`));
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Save for the summer trip'); // drawn
  await page.goBack();
  await showFirst(page);
  await suggestion(page).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Made a task.' })).toBeVisible();
  const task = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.capture?.id === made.id);
  expect(task.home.id).toBe(goal.id);
});

test('a home changed in the top bar shows in the suggestion bar, and Accept uses it', async ({ page, app }) => {
  await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Save for the summer trip' });
  const other = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Garage tidy' });
  await capture(app, 'book the car service. Save for the summer trip');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await page.locator('.inbox-bar').getByRole('button', { name: /Home: Save for the summer trip/ }).click();
  await page.getByRole('option', { name: /Garage tidy/ }).click();
  await expect(suggestion(page).getByRole('button', { name: /Home: Garage tidy/ })).toBeVisible();
  await suggestion(page).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Made a task.' })).toBeVisible();
  const [task] = await (await fetch(`${app.url}/api/tasks`)).json();
  expect(task.home.id).toBe(other.id);
});

test('pick a home right in the suggestion bar: the top bar follows, it is kept, and Accept makes the note at that home', async ({ page, app }) => {
  const garage = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Garage tidy' });
  const made = await capture(app, 'Ideas for the shelves');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(suggestion(page)).toContainText('Your assistant suggests a note');
  const inBar = suggestion(page).getByRole('button', { name: 'Give it a home' });
  await expect(inBar).toHaveText('No home yet');
  await expect(page.locator('.inbox-bar .home-dropdown')).toHaveText('No home yet');
  await expect(page.locator('.inbox-bar').getByRole('link', { name: 'Open the home' })).toBeHidden();
  await inBar.click();
  await page.getByRole('option', { name: /Garage tidy/ }).click();
  await expect(suggestion(page).getByRole('button', { name: /Home: Garage tidy/ })).toBeVisible();
  await expect(page.locator('.inbox-bar').getByRole('button', { name: /Home: Garage tidy/ })).toBeVisible();
  await expect(page.locator('.inbox-bar').getByRole('link', { name: 'Open the home' })).toHaveAttribute('href', `/life/${garage.id}`);
  // Kept (captures.home_id), as with the top bar's.
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].home?.id).toBe(garage.id);
  await suggestion(page).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Made a new note.' })).toBeVisible();
  const [note] = await (await fetch(`${app.url}/api/notes`)).json();
  const full = await (await fetch(`${app.url}/api/notes/${note.id}`)).json();
  expect([full.capture_id, full.home.id]).toEqual([made.id, garage.id]);
});

test('choosing in the top bar and in the bar change both at once; "No home" in the bar clears the top bar', async ({ page, app }) => {
  await send(app, 'POST', '/api/life', { kind: 'project', title: 'Garage tidy' });
  await capture(app, 'Ideas for the shelves');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await page.locator('.inbox-bar').getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Garage tidy/ }).click();
  await expect(suggestion(page).getByRole('button', { name: /Home: Garage tidy/ })).toBeVisible();
  await suggestion(page).getByRole('button', { name: /Home: Garage tidy/ }).click();
  await page.getByRole('option', { name: /No home/ }).click();
  await expect(suggestion(page).locator('.home-dropdown')).toHaveText('No home yet');
  await expect(page.locator('.inbox-bar .home-dropdown')).toHaveText('No home yet');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].home).toBeNull();
});

test('a journal entry suggestion has no Home box in its bar', async ({ page, app }) => {
  await capture(app, 'Slept badly, a short walk helped');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(suggestion(page)).toContainText('a journal entry');
  await expect(suggestion(page).locator('.home-dropdown')).toHaveCount(0);
  await expect(page.locator('.inbox-bar .home-dropdown')).toBeVisible(); // the top bar keeps its own
});

test('saving never waits for the assistant: the capture is kept at once and the suggestion arrives by itself', async ({ page, app }) => {
  await page.goto(`${app.url}/inbox`);
  await capture(app, 'slow-suggest Slept badly, a short walk helped');
  await page.reload();
  await expect(page.locator('.inbox-item')).toHaveCount(1);
  await showFirst(page);
  await expect(page.locator('.suggestion.is-reading')).toContainText('Your assistant is reading it…');
  await expect(page.locator('.suggestion.is-reading').getByRole('button')).toHaveCount(0); // nothing to accept yet
  await expect(suggestion(page)).toContainText('Your assistant suggests a note', { timeout: 10_000 });
});

test('if the assistant can’t read it, the capture keeps its words and you sort it by hand', async ({ page, app }) => {
  await capture(app, 'fail-suggest call the plumber');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(page.locator('.suggestion.is-reading')).toContainText('couldn’t read it yet', { timeout: 10_000 });
  await expect(page.getByLabel('Capture text')).toHaveText('fail-suggest call the plumber');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Enter'); // nothing to accept: nothing happens
  await expect(page.locator('.inbox-item')).toHaveCount(1);
  await page.keyboard.press('d');
  await expect(page.locator('.inbox-zero')).toHaveText('Nothing waits.');
});

test('the journal suggestion, accepted with the button', async ({ page, app }) => {
  await capture(app, 'Slept badly, a short walk helped');
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
  await expect(suggestion(page)).toContainText('a journal entry');
  await suggestion(page).getByRole('button', { name: 'Accept' }).click();
  // Accepting a journal entry asks for its day first: the line with the words, the day (today) and Add.
  await expect(page.getByLabel('Day')).toHaveValue(new Date().toLocaleDateString('sv'));
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('The journal entry')).toHaveCount(0); // back: nothing made
  expect((await (await fetch(`${app.url}/api/captures`)).json()).length).toBe(1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Enter'); // Enter accepts too: the same line
  await expect(page.getByLabel('The journal entry')).toBeFocused();
  await page.locator('.inbox-picker-place').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added to today’s journal.' })).toBeVisible();
  await page.goto(`${app.url}/journal`);
  await expect(page.locator('.entry-row')).toContainText('Slept badly, a short walk helped');
});
