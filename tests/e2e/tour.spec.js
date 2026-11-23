import fs from 'node:fs';
// The Tour (public/tour.js): Tour sits just above Settings; the basics film first, then a card for each part you can
// switch on, in the owner's order, each with its own short film and "Switch it on".
import { test, expect } from './fixtures.js';

const ORDER = ['Group Circle', 'go Sovran', 'Tasks', 'Planner', 'Calendar', 'Boards', 'My Life'];

test('Tour sits just above Settings, and opens the films', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  if (test.info().project.name === 'phone') {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Tour' }).click();
  } else {
    const tour = page.locator('.sidebar > .sidebar-link[data-section="Tour"]');
    await expect(tour).toBeVisible();
    await expect(page.locator('.sidebar > .sidebar-link[data-section="Tour"] + .sidebar-link')).toHaveAttribute('data-section', 'Settings');
    await tour.click();
  }
  await expect(page).toHaveURL(/\/tour$/);
  await expect(page.getByRole('heading', { name: 'Tour', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Basics' })).toBeVisible();
  await expect(page.locator('.tour-card-title')).toHaveText(ORDER);
  await expect(page.getByText('Your Sovran Library')).toBeVisible();
});

test('Switch it on switches the part on, and its card offers to open it', async ({ page, app }) => {
  await page.request.patch(`${app.url}/api/modules`, { data: { id: 'tasks', on: false } }); // off, as in a new install
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="tasks"]');
  await card.getByRole('button', { name: 'Switch it on' }).click();
  await expect(card.getByText('On', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/tasks');
  const modules = await (await page.request.get(`${app.url}/api/modules`)).json();
  expect(modules.find((m) => m.id === 'tasks').on).toBe(true);
  if (test.info().project.name !== 'phone') await expect(page.locator('.sidebar-link[data-section="Tasks"]')).toBeVisible();
});

test('a film plays inside the app, without its own title, and All Videos and Back to All Videos go back', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.locator('.tour-card[data-film="planner"]').getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=planner$/);
  await expect(page.getByRole('heading', { name: 'Planner', level: 1 })).toBeVisible();
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  await expect(film.locator('html')).toHaveClass(/in-app/);
  await expect(film.locator('.wrap > h1')).toBeHidden();
  await expect(page.getByRole('link', { name: 'All Videos', exact: true })).toBeVisible();
  await film.getByRole('link', { name: '← Back to All Videos' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(7);
});

test('the basics film and its voice are served by the app', async ({ page, app }) => {
  const film = await page.request.get(`${app.url}/tour/basics.html`);
  expect(film.status()).toBe(200);
  expect(await film.text()).not.toContain('fonts.googleapis.com');
  const voice = await page.request.get(`${app.url}/tour/voice/basics/t01-00.mp3`);
  expect(voice.status()).toBe(200);
  expect(voice.headers()['content-type']).toBe('audio/mpeg');
});

test('the Sovran Library line opens Settings at the key box, ready to paste', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.getByRole('link', { name: 'Paste your key →' }).click();
  await expect(page).toHaveURL(/\/settings#sovran-library$/);
  await expect(page.getByRole('textbox', { name: 'Library key' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Library key' })).toBeInViewport();
});

test('the next and previous chapter buttons and the arrow keys move a chapter, within that video', async ({ page, app }) => {
  await page.goto(`${app.url}/tour?film=planner`);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch On Planner');
  await film.getByRole('button', { name: 'Next chapter' }).click();
  await expect(film.locator('#caph')).toHaveText('Plan Your Day');
  await film.locator('body').press('ArrowRight');
  await expect(film.locator('#caph')).toHaveText('A Highlight, and Closing the Day');
  await film.getByRole('button', { name: 'Next chapter' }).click(); // the last chapter of this video: it stays
  await expect(film.locator('#caph')).toHaveText('A Highlight, and Closing the Day');
  await film.getByRole('button', { name: 'Previous chapter' }).click();
  await expect(film.locator('#caph')).toHaveText('Plan Your Day');
});

test('Group Circle has its own film: on already, it opens the group, and the Group Circle help links to it', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  const card = page.locator('.tour-card[data-film="group"]');
  await expect(card.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/group');
  await card.getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=group$/);
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('What Group Circle Is');
  await expect(film.locator('.tour-note')).toBeHidden(); // "click Tour in your sidebar" is for the shared web page only
  await expect(film.locator('#scenes .scene')).toHaveCount(10); // six, then four on alerts (2026-11-22)
  expect(fs.readFileSync(new URL('../../docs/group.md', import.meta.url), 'utf8')).toContain('(/tour?film=group)');
});

test('the go Sovran card plays the go Sovran film, and its Back to All Videos comes back', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.locator('.tour-card[data-film="phone"]').getByRole('link', { name: 'Watch' }).click();
  await expect(page.getByRole('heading', { name: 'go Sovran', level: 1 })).toBeVisible();
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#gf-h')).toHaveText('This Is go Sovran');
  await expect(film.locator('#gf-img')).toHaveJSProperty('complete', true);
  expect(await film.locator('#gf-img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await film.getByRole('button', { name: 'Next chapter' }).click();
  await expect(film.locator('#gf-h')).toHaveText('Three Ways to Write');
  // its voice: one click on Sound on (it comes on by itself where the browser lets it), and Mute again
  const snd = film.locator('#gf-snd');
  if ((await snd.getAttribute('aria-pressed')) !== 'true') await snd.click();
  await expect(snd).toHaveText('🔇 Mute');
  await snd.click();
  await expect(snd).toHaveText('🔊 Sound on');
  const voice = await page.request.get(`${app.url}/tour/voice/sovran-go/g01-00s.mp3`);
  expect(voice.status()).toBe(200);
  expect(voice.headers()['content-type']).toBe('audio/mpeg');
  await film.getByRole('link', { name: '← Back to All Videos' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(7);
});
