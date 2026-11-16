// The Tour (public/tour.js): Tour sits just above Settings; the basics film first, then a card for each part you can
// switch on, in the owner's order, each with its own short film and "Switch it on".
import { test, expect } from './fixtures.js';

const ORDER = ['Phone capture', 'Tasks', 'Planner', 'Calendar', 'Boards', 'My Life'];

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
  await expect(page.getByRole('heading', { name: 'The basics' })).toBeVisible();
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

test('a film plays inside the app, without its own title, and All videos and Back to all videos go back', async ({ page, app }) => {
  await page.goto(`${app.url}/tour`);
  await page.locator('.tour-card[data-film="planner"]').getByRole('link', { name: 'Watch' }).click();
  await expect(page).toHaveURL(/\/tour\?film=planner$/);
  await expect(page.getByRole('heading', { name: 'Planner', level: 1 })).toBeVisible();
  const film = page.frameLocator('.tour-frame');
  await expect(film.locator('#caph')).toHaveText('Switch on Planner');
  await expect(film.locator('html')).toHaveClass(/in-app/);
  await expect(film.locator('.wrap > h1')).toBeHidden();
  await expect(page.getByRole('link', { name: 'All videos', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to all videos' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(6);
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
