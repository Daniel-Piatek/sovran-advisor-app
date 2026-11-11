import { test, expect } from './fixtures.js';

const sections = (page) => page.getByRole('navigation', { name: 'Sections' });

test('the sidebar shows Capture and every section, and marks where you are', async ({ page, app, isMobile }) => {
  const note = await app.createNote({ title: 'A note' });
  await page.goto(app.url);
  // On a phone, Timeline, People, My Life, Assistant, Settings and Library wait under More.
  await expect(sections(page).getByRole('link')).toHaveText(isMobile
    ? ['Notes', 'Journal', 'Tasks', 'Planner', 'Calendar', 'Inbox']
    : ['Notes', 'Journal', 'Tasks', 'Planner', 'Calendar', 'Timeline', 'People', 'My Life', 'Inbox', 'Mail', 'Assistant', 'Settings', 'Library']);
  await expect(sections(page).getByRole('button', { name: 'More' })).toHaveCount(isMobile ? 1 : 0);
  await expect(sections(page).getByRole('button', { name: /Capture/ })).toBeVisible();
  await expect(sections(page).getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');

  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(sections(page).getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');

  await sections(page).getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(`${app.url}/journal`);
  await expect(sections(page).getByRole('link', { name: 'Journal' })).toHaveAttribute('aria-current', 'page');
  await expect(sections(page).getByRole('link', { name: 'Notes' })).not.toHaveAttribute('aria-current', 'page');

  await sections(page).getByRole('link', { name: 'Notes' }).click();
  await expect(page.locator('.note-card')).toHaveCount(1);
});

test('on a phone it is a bar along the bottom; on a computer, a column on the left', async ({ page, app, isMobile }) => {
  await page.goto(app.url);
  const bar = await sections(page).boundingBox();
  const viewport = page.viewportSize();
  if (isMobile) {
    expect(Math.round(bar.y + bar.height)).toBe(viewport.height);
    expect(Math.round(bar.width)).toBe(viewport.width);
    // Every section fits on the screen, its name on one line.
    for (const item of await sections(page).locator('a:visible, button:visible').all()) {
      const box = await item.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await item.evaluate((node) => [...node.querySelectorAll('span:not(.icon)')]
        .every((label) => label.getClientRects().length <= 1))).toBe(true);
    }
  } else {
    expect(bar.x).toBe(0);
    expect(bar.height).toBeGreaterThan(viewport.height / 2);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the bottom of the screen is not hidden behind the phone bar', async ({ page, app, isMobile }) => {
  test.skip(!isMobile, 'only a phone has the bar along the bottom');
  for (let i = 0; i < 12; i++) await app.createNote({ title: `Note ${i}` });
  await page.goto(app.url);
  await expect(page.locator('.note-card')).toHaveCount(12);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const theme = await page.getByRole('group', { name: 'Theme' }).boundingBox();
  const bar = await sections(page).boundingBox();
  expect(theme.y + theme.height).toBeLessThanOrEqual(bar.y);
});

test('on a phone, More opens People, My Life, Assistant and Settings, and shows when you are in one', async ({ page, app, isMobile }) => {
  test.skip(!isMobile, 'only a phone has More');
  await page.goto(app.url);
  await sections(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Timeline', 'People', 'My Life', 'Mail', 'Assistant', 'Settings', 'Library']);
  await menu.getByRole('menuitem', { name: 'My Life' }).click();
  await expect(page).toHaveURL(`${app.url}/life`);
  await expect(menu).toBeHidden();
  await expect(sections(page).getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
});

test('Settings and Library sit at the foot of the column, and the others can be dragged into your own order', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'on a phone the sidebar is a bar along the bottom; reordering is for a computer');
  await page.goto(app.url);
  const names = () => sections(page).getByRole('link').allTextContents();
  const sidebarBox = await page.locator('#sidebar').boundingBox();
  const library = await sections(page).getByRole('link', { name: 'Library' }).boundingBox();
  const settings = await sections(page).getByRole('link', { name: 'Settings' }).boundingBox();
  const assistant = await sections(page).getByRole('link', { name: 'Assistant' }).boundingBox();
  // Library is the very last, Settings just above it, and a gap of free space lies between them and the rest.
  expect(Math.abs(sidebarBox.y + sidebarBox.height - (library.y + library.height))).toBeLessThanOrEqual(40);
  expect(settings.y).toBeLessThan(library.y);
  expect(settings.y - (assistant.y + assistant.height)).toBeGreaterThan(40);
  // They can't be dragged.
  await expect(sections(page).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('draggable', 'true');

  // Drag Tasks below Calendar.
  await sections(page).getByRole('link', { name: 'Tasks' }).dragTo(sections(page).getByRole('link', { name: 'Calendar' }), { targetPosition: { x: 20, y: 30 } });
  await expect.poll(names).toEqual(['Notes', 'Journal', 'Planner', 'Calendar', 'Tasks', 'Timeline', 'People', 'My Life', 'Inbox', 'Mail', 'Assistant', 'Settings', 'Library']);
  // The order is kept.
  await page.reload();
  expect(await names()).toEqual(['Notes', 'Journal', 'Planner', 'Calendar', 'Tasks', 'Timeline', 'People', 'My Life', 'Inbox', 'Mail', 'Assistant', 'Settings', 'Library']);

  // Alt+Up moves a section up with the keyboard; it can't go past Settings.
  const tasks = sections(page).getByRole('link', { name: 'Tasks' });
  await tasks.focus();
  await page.keyboard.press('Alt+ArrowUp');
  expect(await names()).toEqual(['Notes', 'Journal', 'Planner', 'Tasks', 'Calendar', 'Timeline', 'People', 'My Life', 'Inbox', 'Mail', 'Assistant', 'Settings', 'Library']);
  const last = sections(page).getByRole('link', { name: 'Assistant' });
  await last.focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await names()).slice(-3)).toEqual(['Assistant', 'Settings', 'Library']);
});
