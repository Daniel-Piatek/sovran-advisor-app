import { test, expect } from './fixtures.js';

const sections = (page) => page.getByRole('navigation', { name: 'Sections' });

test('the sidebar shows Capture and every section, and marks where you are', async ({ page, app, isMobile }) => {
  const note = await app.createNote({ title: 'A note' });
  await page.goto(app.url);
  // On a phone, Timeline, People, My Life, Assistant, Tour and Settings wait under More. The Library is in Settings (2026-11-24).
  await expect(sections(page).getByRole('link')).toHaveText(isMobile
    ? ['Notes', 'Journal', 'Tasks', 'Planner', 'Calendar', 'Inbox']
    : ['Notes', 'Journal', 'Tasks', 'Planner', 'Calendar', 'Timeline', 'People', 'My Life', 'Reports', 'Inbox', 'Mail', 'Sovran Advisor', 'Help', 'Group Circle', 'Tour', 'Settings']);
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

test('on a phone, More opens People, My Life, Reports, Assistant and Settings, and shows when you are in one', async ({ page, app, isMobile }) => {
  test.skip(!isMobile, 'only a phone has More');
  await page.goto(app.url);
  await sections(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Timeline', 'People', 'My Life', 'Reports', 'Mail', 'Sovran Advisor', 'Group Circle', 'Help', 'Tour', 'Settings']);
  await menu.getByRole('menuitem', { name: 'My Life' }).click();
  await expect(page).toHaveURL(`${app.url}/life`);
  await expect(menu).toBeHidden();
  await expect(sections(page).getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
});

test('Tour and Settings sit at the foot of the column, and the others can be dragged into your own order', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'on a phone the sidebar is a bar along the bottom; reordering is for a computer');
  await page.goto(app.url);
  const names = () => sections(page).getByRole('link').allTextContents();
  const sidebarBox = await page.locator('#sidebar').boundingBox();
  const settings = await sections(page).getByRole('link', { name: 'Settings' }).boundingBox();
  const tour = await sections(page).getByRole('link', { name: 'Tour' }).boundingBox();
  const assistant = await sections(page).getByRole('link', { name: 'Sovran Advisor' }).boundingBox();
  // Settings is the very last, Tour just above it, and a gap of free space lies between them and the rest.
  await expect(sections(page).getByRole('link', { name: 'Library' })).toHaveCount(0); // in Settings now (2026-11-24)
  expect(Math.abs(sidebarBox.y + sidebarBox.height - (settings.y + settings.height))).toBeLessThanOrEqual(80); // only the small Arrange under it
  expect(tour.y).toBeLessThan(settings.y);
  expect(tour.y - (assistant.y + assistant.height)).toBeGreaterThan(40);
  // They can't be dragged.
  await expect(sections(page).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('draggable', 'true');
  await expect(sections(page).getByRole('link', { name: 'Tour' })).not.toHaveAttribute('draggable', 'true');

  // Drag Tasks below Calendar.
  await sections(page).getByRole('link', { name: 'Tasks' }).dragTo(sections(page).getByRole('link', { name: 'Calendar' }), { targetPosition: { x: 20, y: 30 } });
  await expect.poll(names).toEqual(['Notes', 'Journal', 'Planner', 'Calendar', 'Tasks', 'Timeline', 'People', 'My Life', 'Reports', 'Inbox', 'Mail', 'Sovran Advisor', 'Help', 'Group Circle', 'Tour', 'Settings']);
  // The order is kept.
  await page.reload();
  expect(await names()).toEqual(['Notes', 'Journal', 'Planner', 'Calendar', 'Tasks', 'Timeline', 'People', 'My Life', 'Reports', 'Inbox', 'Mail', 'Sovran Advisor', 'Help', 'Group Circle', 'Tour', 'Settings']);

  // Alt+Up moves a section up with the keyboard; it can't go past Tour.
  const tasks = sections(page).getByRole('link', { name: 'Tasks' });
  await tasks.focus();
  await page.keyboard.press('Alt+ArrowUp');
  expect(await names()).toEqual(['Notes', 'Journal', 'Planner', 'Tasks', 'Calendar', 'Timeline', 'People', 'My Life', 'Reports', 'Inbox', 'Mail', 'Sovran Advisor', 'Help', 'Group Circle', 'Tour', 'Settings']);
  const last = sections(page).getByRole('link', { name: 'Group Circle' });
  await last.focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await names()).slice(-3)).toEqual(['Group Circle', 'Tour', 'Settings']);
});

test('you arrange the sidebar: lines added, moved and taken away, Group Circle moved, kept, and Start over', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'on a phone the sidebar is a bar along the bottom; arranging is for a computer');
  await page.goto(app.url);
  const sidebar = page.locator('#sidebar');
  // What the column shows, top to bottom: a section's name, or — for a line you can see.
  const column = () => sidebar.evaluate((node) => [...node.querySelectorAll(':scope > .is-movable:not(.is-block), :scope > .sidebar-line')]
    .filter((item) => item.checkVisibility()).map((item) => (item.classList.contains('sidebar-line') ? '—' : item.dataset.section)));
  // At first one line, above Group Circle (Quest waits for a Quest group).
  expect((await column()).slice(-2)).toEqual(['—', 'Group Circle']);

  // A right click opens Arrange: Done in place of Capture, a + between two sections, an × on the line.
  await sidebar.getByRole('link', { name: 'Journal' }).click({ button: 'right' });
  await expect(sidebar.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /Capture/ })).toBeHidden();
  await sidebar.getByRole('button', { name: 'Add a line below Journal' }).click();
  expect((await column()).slice(0, 3)).toEqual(['Notes', 'Journal', '—']);
  // While arranging, a name doesn't open its page.
  await sidebar.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL(`${app.url}/`);
  // Group Circle can go anywhere: drag it to the top.
  await sidebar.getByRole('link', { name: 'Group Circle' }).dragTo(sidebar.getByRole('link', { name: 'Notes' }), { targetPosition: { x: 20, y: 4 } });
  expect((await column()).slice(0, 4)).toEqual(['Group Circle', 'Notes', 'Journal', '—']);
  // The old line, now last with nothing under it, is taken away.
  await sidebar.getByRole('button', { name: 'Take this line away' }).last().click();
  await sidebar.getByRole('button', { name: 'Done' }).click();
  await expect(sidebar.getByRole('button', { name: /Capture/ })).toBeVisible();
  const arranged = await column();
  expect(arranged.filter((n) => n === '—')).toHaveLength(1);
  expect(arranged.at(-1)).not.toBe('—');

  // Kept after a reload.
  await page.reload();
  expect(await column()).toEqual(arranged);

  // Alt+Down moves a line too. (Arrange, at the foot under Settings, opens it as a right click does; it hides while arranging.)
  await sidebar.getByRole('button', { name: 'Arrange', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Arrange', exact: true })).toBeHidden();
  await sidebar.getByRole('button', { name: 'Take this line away' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await column()).slice(0, 5)).toEqual(['Group Circle', 'Notes', 'Journal', 'Tasks', '—']);
  await page.keyboard.press('Escape');

  // Settings > Sidebar > Start over: the order and the line the app came with.
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Sidebar' });
  if (await part.getByRole('button', { name: 'Sidebar', exact: true }).getAttribute('aria-expanded') !== 'true') await part.getByRole('button', { name: 'Sidebar', exact: true }).click();
  await part.getByRole('button', { name: 'Start over' }).click();
  expect((await column()).slice(0, 2)).toEqual(['Notes', 'Journal']);
  expect((await column()).slice(-2)).toEqual(['—', 'Group Circle']);
});
